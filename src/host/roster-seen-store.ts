/**
 * When each model in a region's catalog was FIRST seen — this plugin's OWN
 * state file, one per region (`.qoder-roster-seen.<region>.json`), following
 * the same per-region convention as the catalog cache.
 *
 * Why the history has to be persisted at all: Qoder's catalog rows carry no
 * "listed since" fact (`display_name` / `key` / price fields and nothing
 * else), so "this model is new to the user" is only knowable by diffing
 * today's roster against a roster this plugin wrote down. In memory would do
 * for one process; the marker has to survive restarts to be worth rendering.
 *
 * Semantics, stated once because the pill and the route read them:
 *  - the FIRST ever write SEEDS: it records the roster as already seen
 *    (stamped one window back) and announces nothing — an upgrade must not
 *    tell every existing user that the whole roster is brand new;
 *  - an id that leaves the roster is dropped, so a model that comes back later
 *    counts as new again (a re-listing IS a change the user may want to see);
 *  - "new" is a WINDOW, not a tick: an id first seen less than
 *    {@link ROSTER_NEW_WINDOW_MS} ago stays new across reads, so the marker
 *    does not vanish between two five-minute pill polls;
 *  - a file whose shape/version this build does not know is REFUSED, not
 *    stomped: reads answer "no history" and writes are refused, so an older
 *    build can never silently reset a newer build's history. The marker
 *    degrades to absent, never to wrong. A file that does not PARSE at all is a
 *    different case and is rebuilt instead: garbage has no owner, and refusing
 *    forever would disable the marker for the life of the install after one
 *    truncated write;
 *  - a roster larger than {@link ROSTER_SEEN_MAX_IDS} is a SHAPE-DRIFT guard,
 *    not a queue: nothing is written and nothing is announced for its
 *    duration. Evicting an id that is still in the live roster makes it look
 *    unseen on the next read and re-announce, oscillating — a history file
 *    that invents new models is worse than none.
 *
 * A failed read or write is not a failed route: the caller keeps serving rows
 * and the marker is simply absent. That direction is deliberate (a marker is a
 * suggestion, not a fact the panel needs), and the logger line is what keeps
 * the degradation visible to a maintainer rather than silent.
 *
 * @module dsh-connect-qoder/roster-seen-store
 */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** Shape version, bumped when the persisted form changes incompatibly. */
export const ROSTER_SEEN_VERSION = 1

/** Every persisted shape THIS build can read (the write-side whitelist). */
export const KNOWN_ROSTER_SEEN_VERSIONS: readonly number[] = [1]

/**
 * How long a first sighting keeps reading as "new".
 *
 * Seven days: long enough that a user who opens the panel twice a week still
 * catches it, short enough that a stale marker cannot outlive the model it
 * announces. A shorter window is invisible to the weekly user; a longer one
 * turns the marker into permanent furniture.
 */
export const ROSTER_NEW_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

/**
 * The largest roster one file will track.
 *
 * Qoder lists a handful of chat models per region today; the cap is a
 * shape-drift guard, not a queue (see the module comment). It deliberately does
 * NOT "keep the newest N".
 */
export const ROSTER_SEEN_MAX_IDS = 200

/** id → first-seen epoch ms. */
export type RosterSeen = Readonly<Record<string, number>>

interface PersistedRosterSeen {
  version: number
  seen: RosterSeen
  updatedAt?: string
}

export interface RosterSeenStoreOptions {
  /** Where the history file lives. Required, not optional (same reasoning as CatalogStore). */
  path: string
  logger?: { warn?: (message: string, error?: unknown) => void }
}

/**
 * Read one persisted map, keeping only well-formed entries.
 *
 * A hand-edited or half-written file must not poison the answer: a non-numeric
 * stamp is dropped rather than coerced (a coerced `0` would read as "seen since
 * 1970" and mark nothing new forever). An array is rejected like any other
 * unrecognised shape — its numeric indices would otherwise become model ids.
 * @param raw - the persisted or posted value.
 * @returns the usable entries (possibly empty).
 */
export function normalizeRosterSeen(raw: unknown): Record<string, number> {
  const source = raw !== null && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {}
  const seen: Record<string, number> = {}
  for (const [id, stamp] of Object.entries(source)) {
    if (id === '' || typeof stamp !== 'number' || !Number.isFinite(stamp) || stamp <= 0) continue
    seen[id] = stamp
  }
  return seen
}

export class RosterSeenStore {
  /** Where the history file lives. */
  path: string
  /** Optional logger for a refused or failed write. */
  logger: RosterSeenStoreOptions['logger'] | undefined
  /** The loaded map, or `null` when this store has no usable history. */
  seen: Record<string, number> | null
  /**
   * The file exists but this build cannot read its shape. Set on load and
   * never cleared for the life of this instance: the file belongs to a build
   * that knows more than this one, and stomping it would reset that build's
   * history (see the module comment).
   */
  refused: boolean
  /** The error from the last failed save, or `undefined`. */
  lastSaveError: unknown

  constructor({ path, logger }: RosterSeenStoreOptions) {
    this.path = path
    this.logger = logger
    this.seen = null
    this.refused = false
    this.lastSaveError = undefined
    this.load()
  }

  /** Read the file once, at construction; a crash mid-save leaves a `.tmp` sibling to clean. */
  load(): void {
    const tmp = `${this.path}.tmp`
    try {
      if (existsSync(tmp)) unlinkSync(tmp)
    } catch {
      // Inert; the next save overwrites it.
    }
    if (!existsSync(this.path)) return
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(this.path, 'utf8'))
    } catch (error) {
      // Unreadable is NOT the same as "someone newer owns this file": garbage has
      // no owner, so this build re-seeds on the next note instead of refusing
      // forever. The difference matters — a truncated file after a crash must not
      // disable the marker for the life of the install.
      this.seen = null
      this.logger?.warn?.(`dsh-connect-qoder: could not read roster history ${this.path}; it will be rebuilt`, error)
      return
    }
    if (parsed === null || typeof parsed !== 'object' || !KNOWN_ROSTER_SEEN_VERSIONS.includes(Number((parsed as Partial<PersistedRosterSeen>).version))) {
      // A parseable file in a shape this build does not know belongs to a NEWER
      // build. Leave it alone: overwriting would reset that build's history.
      this.seen = null
      this.refused = true
      this.logger?.warn?.(`dsh-connect-qoder: roster history ${this.path} has an unknown shape; leaving it untouched`)
      return
    }
    this.seen = normalizeRosterSeen((parsed as Partial<PersistedRosterSeen>).seen)
  }

  /** Whether this store has ever written a history (distinguishes seed from growth). */
  isSet(): boolean {
    return this.seen !== null
  }

  /**
   * Persist one map atomically (temp file + rename), matching CatalogStore's
   * Windows-verified discipline. A failed write is recorded and logged; the
   * in-memory view stays correct for this process, and the next restart simply
   * re-seeds (announcing nothing), which is the safe direction.
   */
  private save(seen: Record<string, number>): void {
    this.lastSaveError = undefined
    const tmp = `${this.path}.tmp`
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      const payload: PersistedRosterSeen = { version: ROSTER_SEEN_VERSION, seen, updatedAt: new Date().toISOString() }
      writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8')
      renameSync(tmp, this.path)
    } catch (error) {
      this.lastSaveError = error
      try {
        if (existsSync(tmp)) unlinkSync(tmp)
      } catch {
        // A leftover temp file is inert; the next save overwrites it.
      }
      this.logger?.warn?.(`dsh-connect-qoder: could not save roster history ${this.path}`, error)
    }
  }

  /**
   * Record today's roster and answer which ids still read as new.
   *
   * One call both diffs and persists, because the two must agree: a caller that
   * diffed a cached map and wrote later could announce a model that another
   * read had already recorded.
   * @param ids - the FULL roster as the region's catalog just listed it.
   * @param nowMs - the clock (tests inject it).
   * @returns ids first seen inside the window, oldest first; empty on the
   *   seeding write, on an empty roster, on a refused file and on shape drift.
   */
  note(ids: readonly string[], nowMs: number = Date.now()): { newIds: string[] } {
    const list = Array.isArray(ids) ? ids.filter((id) => typeof id === 'string' && id !== '') : []
    const unique = [...new Set(list)]
    if (unique.length === 0) return { newIds: [] }
    const now = Number.isFinite(nowMs) ? nowMs : Date.now()
    // The file belongs to a build this one cannot read: keep it, announce nothing.
    if (this.refused) return { newIds: [] }
    const previous = normalizeRosterSeen(this.seen ?? {})
    const seeded = this.seen === null
    const next: Record<string, number> = {}
    // A stamp in the FUTURE (a clock jumped back, or a hand-edited file) is
    // clamped to now rather than trusted: `now - stamp` negative would keep the
    // marker alive past the window.
    for (const id of unique) {
      const first = previous[id]
      next[id] = typeof first === 'number' && first > 0
        ? Math.min(first, now)
        : seeded ? now - ROSTER_NEW_WINDOW_MS : now
    }
    // Shape drift: keep the previous map untouched, write nothing, announce nothing.
    if (Object.keys(next).length > ROSTER_SEEN_MAX_IDS) return { newIds: [] }
    const changed = seeded
      || Object.keys(previous).length !== Object.keys(next).length
      || Object.keys(next).some((id) => previous[id] !== next[id])
    if (changed) this.save(next)
    this.seen = next
    // A SEEDED roster is stamped as if it had already aged out: the first write
    // knows the roster exists, not that any of it is new.
    const newIds = seeded
      ? []
      : Object.entries(next)
        .filter(([, first]) => now - first < ROSTER_NEW_WINDOW_MS)
        .sort((left, right) => left[1] - right[1])
        .map(([id]) => id)
    return { newIds }
  }

  /**
   * The ids still inside the freshness window, oldest first — a read with no
   * write. Used by the models route, which must not touch the disk on a GET.
   */
  fresh(nowMs: number = Date.now()): string[] {
    if (this.seen === null) return []
    const now = Number.isFinite(nowMs) ? nowMs : Date.now()
    return Object.entries(this.seen)
      .filter(([, first]) => now - first < ROSTER_NEW_WINDOW_MS)
      .sort((left, right) => left[1] - right[1])
      .map(([id]) => id)
  }
}
