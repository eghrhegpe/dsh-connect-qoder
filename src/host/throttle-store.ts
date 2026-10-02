/**
 * The on-disk exchange throttle.
 *
 * The throttle gate lives in `CredentialCache`; this is only its persistence,
 * so a rate-limit window the platform stated is still honoured after a DSH
 * restart rather than forgotten the moment the process dies. That matters
 * because the lockout the window describes is a platform-side fact measured in
 * wall-clock time, not a fact about this process: forget it across a restart
 * and the first poll walks straight back into a lockout still in force, which
 * is precisely the runaway the gate exists to stop.
 *
 * Split from `credential-cache.ts` for the same reason the catalog store was:
 * it depends only on `node:fs`/`node:path` once the path is injected, so it can
 * be tested against a real temporary directory, and the atomicity of its write
 * must be checked on the platform rather than assumed.
 *
 * Persistence policy, and the two kinds it distinguishes:
 *
 * - a **rate-limit** window (`parked: false`, an `until` in the future) is
 *   written and read back: it is time-boxed and a restart must not resume the
 *   re-probe before the platform's own clock says the window has closed;
 * - a **parked** refusal (a dead credential — `parked: true`, no deadline) is
 *   deliberately NOT persisted. It is released only by a deliberate re-read
 *   (`invalidate`), and a restart is treated as exactly that: a fresh process
 *   gets one exchange attempt so a corrected env PAT is picked up. Keeping the
 *   park in memory is still enough to stop the within-process poll loop, which
 *   is the failure the sibling plugin's fix was written against.
 *
 * The record carries only `{ kind, parked, until, attempt }` — never a token.
 *
 * @module dsh-connect-qoder/throttle-store
 */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ExchangeThrottle, ThrottleStore } from './credential-cache.ts'

/** On-disk format this reader accepts; other versions are discarded. */
export const THROTTLE_FORMAT_VERSION = 1

export interface FileThrottleStoreOptions {
  /** Where the throttle file lives. Required; same reasoning as CatalogStore. */
  path: string
  /** Wall clock, injectable for tests. Defaults to `Date.now`. */
  now?: () => number
  logger?: { warn?: (message: string, error?: unknown) => void }
}

/**
 * A {@link ThrottleStore} backed by one JSON file, written atomically.
 *
 * Reads and writes never throw out of this class: a store that cannot be
 * reached must degrade to "no persisted throttle", not wedge credential
 * resolution. A failure is logged and otherwise ignored, because the in-memory
 * gate in `CredentialCache` already holds the wait for this process — the file
 * is only an extension of it across restarts.
 */
export class FileThrottleStore implements ThrottleStore {
  /** Where the throttle file lives. */
  path: string
  /** The wall clock, for dropping an expired window on read. */
  private now: () => number
  /** Optional logger for a failed write. */
  private logger?: { warn?: (message: string, error?: unknown) => void }

  constructor({ path, now = () => Date.now(), logger }: FileThrottleStoreOptions) {
    this.path = path
    this.now = now
    this.logger = logger
  }

  /**
   * Read the persisted rate-limit window.
   *
   * Returns `null` (rather than a throttle) for anything that is not a live,
   * non-parked window: no file, a damaged file, a foreign version, a parked
   * refusal, or a window that has already closed. Each of those means "nothing
   * to honour here", which is the safe answer for a lock this is only extending
   * across restarts.
   */
  read(): ExchangeThrottle | null {
    if (!existsSync(this.path)) return null
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8'))
      if (parsed?.version !== THROTTLE_FORMAT_VERSION) return null
      // A parked refusal is never persisted and never restored; a malformed
      // record of any other shape reads as absent.
      if (parsed.parked !== false) return null
      const until = Number(parsed.until)
      if (!Number.isFinite(until)) return null
      // A window that closed while this process was down is not a reason to
      // refuse: let the next resolve retry.
      if (until <= this.now()) return null
      const attempt = Number(parsed.attempt)
      return {
        kind: typeof parsed.kind === 'string' ? parsed.kind : 'rate-limit',
        parked: false,
        until,
        attempt: Number.isFinite(attempt) && attempt > 0 ? attempt : 1,
      }
    } catch {
      // A damaged cache is simply ignored; the next write replaces it.
      return null
    }
  }

  /**
   * Persist a rate-limit window.
   *
   * A parked refusal is not written at all (see the persistence policy): the
   * next restart is meant to be free to try once. Only a future window is
   * worth keeping across the restart.
   */
  write(throttle: ExchangeThrottle): void {
    if (throttle.parked) return
    if (throttle.until === null || throttle.until <= this.now()) return
    const tmp = `${this.path}.tmp`
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      writeFileSync(
        tmp,
        JSON.stringify(
          { version: THROTTLE_FORMAT_VERSION, kind: throttle.kind, parked: throttle.parked, until: throttle.until, attempt: throttle.attempt },
          null,
          2,
        ),
        'utf8',
      )
      // Write to a sibling temp file, then rename onto the target, exactly as
      // CatalogStore.save() does: on Windows the rename-over-existing works
      // (MoveFileEx), verified in test, so a crash mid-write never leaves a
      // half-written JSON the next `read()` would discard.
      renameSync(tmp, this.path)
    } catch (error) {
      try {
        if (existsSync(tmp)) unlinkSync(tmp)
      } catch {
        // A leftover temp file is inert; the next write overwrites it.
      }
      this.logger?.warn?.(`dsh-connect-qoder: could not save exchange throttle ${this.path}`, error)
    }
  }

  /**
   * Remove the persisted window.
   *
   * Called after a deliberate re-read and after a successful exchange. An
   * absent file is a no-op, not an error.
   */
  clear(): void {
    try {
      if (existsSync(this.path)) unlinkSync(this.path)
    } catch (error) {
      this.logger?.warn?.(`dsh-connect-qoder: could not clear exchange throttle ${this.path}`, error)
    }
  }
}
