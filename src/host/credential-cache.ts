/**
 * The per-region credential cache.
 *
 * Split out of lib/index.js so the behaviour this plugin sells — "a re-sign-in
 * is picked up without restarting DSH" — can be asserted against the real code.
 * The two predicates on that path (`isStaleCredentialError`, `isCredentialUsable`)
 * were already testable, but the wiring between them was not: the flag that
 * turns a sign-in rejection into a re-read lived in a class that cannot be
 * imported, because lib/index.js pulls in the Cordis peer dependencies. Two
 * tested parts and one untested connection is still no test.
 *
 * Everything external is injected, so this module has no imports beyond
 * `isCredentialUsable` and no peer dependencies.
 *
 * @module dsh-connect-qoder/credential-cache
 */
import { isCredentialUsable } from './credentials.ts'
import type { LoadedCredential } from './credentials.ts'

/** What a PAT exchange answers — the three fields the cache copies across. */
export interface ExchangedPat {
  token: string
  refreshToken: string
  expiresAt: number
}

/**
 * The default wait imposed on an exchange refusal the platform gave no window
 * for. Doubles from here on each consecutive refusal and is capped at
 * `EXCHANGE_BACKOFF_CAP_MS`, so a persistently refused exchange settles at the
 * cap instead of producing a steady one-minute trickle of POSTs for as long as
 * the panel stays open.
 */
export const DEFAULT_EXCHANGE_BACKOFF_MS = 60_000

/**
 * Cap on a self-imposed exchange wait.
 *
 * Applies ONLY to a wait this cache invented. A window the platform stated
 * itself (a real `Retry-After`) is never truncated by it: capping that is what
 * walks back into a lockout that is still in force.
 */
export const EXCHANGE_BACKOFF_CAP_MS = 30 * 60_000

/** A refused PAT exchange, remembered so no poll retries it inside its window. */
export interface ExchangeThrottle {
  /** The class of refusal: `rate-limit` (honour a window) or `dead-credential`. */
  kind: string
  /**
   * Whether the refusal has no self-expiring window and must not be retried at
   * all until a deliberate re-read. A dead credential parked here stays parked
   * across restarts — re-exchanging the same rejected PAT is what turns one bad
   * token into a throttled account.
   */
  parked: boolean
  /** Epoch ms the rate-limit window closes, or `null` for a parked refusal. */
  until: number | null
  /** How many consecutive refusals this represents; drives the local backoff. */
  attempt: number
}

/**
 * Persistence for the exchange throttle, injected so a restart does not forget
 * a wait it is honouring.
 *
 * Kept as a seam (read/write/clear) rather than a `node:fs` import so this
 * module stays dependency-free and testable without touching the disk — the
 * same reason the credential readers are injected. A store that cannot be read
 * is treated as "no throttle", and one that cannot be written still lets the
 * in-memory gate hold the wait for this process.
 */
export interface ThrottleStore {
  read(): Promise<ExchangeThrottle | null> | ExchangeThrottle | null
  write(throttle: ExchangeThrottle): Promise<unknown> | unknown
  clear(): Promise<unknown> | unknown
}

export interface CredentialCacheOptions {
  /**
   * Reads the app's credential store. May answer a promise: the real reader is
   * `loadCredentialAsync`, which decrypts on a worker so a read does not freeze
   * the event loop — and `resolve` is async anyway, so awaiting costs nothing.
   */
  loadApp: () => LoadedCredential | undefined | Promise<LoadedCredential | undefined>
  loadEnv: () => LoadedCredential | undefined
  exchangePat?: (credential: LoadedCredential) => Promise<ExchangedPat> | ExchangedPat
  /**
   * Optional persistence for the exchange throttle. Absent means the gate lives
   * only in memory: correct within one process, and a restart simply retries
   * once. This plugin's entry always injects a file-backed one (see
   * `RegionRuntime`), so a lockout survives a restart there.
   */
  throttleStore?: ThrottleStore
  /** Wall clock, injectable for tests. Defaults to `Date.now`. */
  now?: () => number
}

/**
 * How long an unstated window should wait, doubling per consecutive refusal.
 *
 * @param attempt - how many consecutive refusals there have been (1 for the first).
 * @returns milliseconds, capped at `EXCHANGE_BACKOFF_CAP_MS`.
 */
export function localExchangeBackoffMs(attempt: number): number {
  const doubled = DEFAULT_EXCHANGE_BACKOFF_MS * 2 ** Math.max(0, attempt - 1)
  return Math.min(doubled, EXCHANGE_BACKOFF_CAP_MS)
}

/**
 * Classify an exchange failure into a throttle, or `undefined` to not gate on it.
 *
 * The status code is the whole distinction. A `429` is a rate limit that may
 * carry the platform's own window (`Retry-After`); honour it at face value, and
 * fall back to {@link localExchangeBackoffMs} only when none was stated. A
 * `401`/`403` is a dead credential with no useful window — keep polling it and
 * every exchange is a fresh attempt against a token that will never work, so it
 * parks until a deliberate re-read replaces it. Anything else (a 5xx, or a
 * network throw with no status) is transient and is NOT gated: the gate exists
 * for the two states a poll loop can turn permanent, not to hide a momentary
 * upstream hiccup behind a backoff.
 *
 * @param error - the thrown exchange error; its `.status` and `.retryAfterSeconds`
 *   are read as plain flags, since a thrown error may reach here having lost its
 *   prototype across the throw boundary.
 * @param now - the wall clock a stated window is measured against.
 * @param attempt - the consecutive-refusal count *after* this one.
 * @returns the throttle to hold, or `undefined` when this failure is not one
 *   the gate should stand for.
 */
export function throttleForExchangeError(
  error: unknown,
  now: number,
  attempt: number,
): ExchangeThrottle | undefined {
  const status = Number((error as { status?: unknown } | null | undefined)?.status)
  const stated = Number((error as { retryAfterSeconds?: unknown } | null | undefined)?.retryAfterSeconds)
  const statedWindow = Number.isFinite(stated) && stated > 0 ? stated : undefined
  if (status === 429) {
    // A platform-stated window is taken at its word and never capped; only an
    // unstated one falls back to the doubling local backoff.
    const waitMs = statedWindow !== undefined ? statedWindow * 1000 : localExchangeBackoffMs(attempt)
    return { kind: 'rate-limit', parked: false, until: now + waitMs, attempt }
  }
  if (status === 401 || status === 403) {
    // A dead credential parks with no deadline: waiting does not make a rejected
    // token valid, so the only release is a deliberate re-read.
    return { kind: 'dead-credential', parked: true, until: null, attempt }
  }
  return undefined
}

export class CredentialCache {
  /** Reads the app's credential store (see {@link CredentialCacheOptions.loadApp}). */
  loadApp: () => LoadedCredential | undefined | Promise<LoadedCredential | undefined>
  /** The PAT fallback reader. */
  loadEnv: () => LoadedCredential | undefined
  /**
   * Exchanges a PAT for a job token; absent when PATs are unsupported.
   *
   * The parameter and the answer are both `LoadedCredential`-derived rather
   * than `any`: the call below reads `credential.source` to decide whether to
   * exchange at all, and then copies three named fields off the answer. With
   * `any` neither the discriminant nor the three field names was checked, so a
   * rename on either side would have surfaced as `undefined` at runtime.
   */
  exchangePat?: (credential: LoadedCredential) => Promise<ExchangedPat> | ExchangedPat
  /**
   * The cached record: an app credential as read, or a PAT after exchange —
   * which is that same credential with its three token fields replaced, so it
   * is still a `LoadedCredential`.
   */
  cached: LoadedCredential | undefined
  /** Set when a request was rejected with a sign-in failure. */
  invalid: boolean
  /** How many times the underlying store was actually read. */
  reads: number
  /** How many times a PAT was exchanged for a job token. */
  exchanges: number
  /**
   * The exchange throttle currently in force, or `null`.
   *
   * Loaded lazily from the injected store on the first resolve that needs it,
   * so an app-credential path (the common one) never touches the throttle seam.
   *
   * @type {ExchangeThrottle | null}
   */
  throttle: ExchangeThrottle | null
  /** Whether the throttle has been read from the store yet this process. */
  private throttleLoaded: boolean
  /** Optional throttle persistence; see {@link CredentialCacheOptions.throttleStore}. */
  private throttleStore?: ThrottleStore
  /** The wall clock, for honouring windows and running tests. */
  private now: () => number

  /**
   * @param options.loadApp - `() => credential | undefined`, reading the app's store.
   * @param options.loadEnv - `() => credential | undefined`, the PAT fallback.
   * @param options.exchangePat - `(credential) => { token, refreshToken, expiresAt }`,
   *   called only for a PAT source; absent when PATs are not supported.
   * @param options.throttleStore - optional persistence for the exchange throttle.
   * @param options.now - the wall clock; injectable for tests.
   */
  constructor({ loadApp, loadEnv, exchangePat, throttleStore, now = () => Date.now() }: CredentialCacheOptions) {
    this.loadApp = loadApp
    this.loadEnv = loadEnv
    this.exchangePat = exchangePat
    this.throttleStore = throttleStore
    this.now = now
    /**
     * The cached record: an app credential as read, or a PAT after exchange.
     * Named `cached` rather than `credential` because the plugin's own field was
     * written on every resolve and read by nothing.
     */
    this.cached = undefined
    /**
     * Set when a request is rejected with a sign-in failure, so the next
     * `resolve` forces a re-read from disk. Without this, a cached app
     * credential whose token has expired stays cached for the process's life —
     * its `expired` flag was computed when it was read, not at request time —
     * and every request 401s until DSH is restarted.
     */
    this.invalid = false
    /** How many times the underlying store was actually read; asserted in tests. */
    this.reads = 0
    /** How many times a PAT was exchanged for a job token; asserted in tests. */
    this.exchanges = 0
    this.throttle = null
    this.throttleLoaded = false
  }

  /**
   * Resolve the current throttle from the store, once per process.
   *
   * A store that throws reads as "no throttle": a throttle that cannot be
   * remembered must not wedge credential resolution — the poll retries the
   * exchange, which is the pre-fix behaviour and no worse.
   */
  private async loadThrottle(): Promise<ExchangeThrottle | null> {
    if (this.throttleLoaded) return this.throttle
    this.throttleLoaded = true
    if (this.throttleStore === undefined) return this.throttle
    try {
      const held = await this.throttleStore.read()
      if (held !== null && held !== undefined) this.throttle = held
    } catch {
      // A store that cannot be read is treated as absent; the in-memory value
      // (if any) still stands.
    }
    return this.throttle
  }

  /** How much longer a held throttle is in force; `Infinity` for a parked one. */
  private waitRemainingMs(held: ExchangeThrottle): number {
    if (held.parked) return Number.POSITIVE_INFINITY
    if (held.until === null) return 0
    return Math.max(0, held.until - this.now())
  }

  /**
   * Resolve the credential to use for a request.
   *
   * A cached value is reused while it is still usable (see
   * `isCredentialUsable`); otherwise the app store is read, falling back to a
   * PAT, and a PAT is exchanged once for a job token — unless a previous
   * exchange was refused and its throttle window is still in force, in which
   * case this throws without reaching the platform.
   *
   * @returns the credential, or `undefined` when this machine has no sign-in.
   * @throws when an exchange is gated by the throttle, or when the exchange
   *   itself fails.
   */
  async resolve(): Promise<LoadedCredential | undefined> {
    // A request was rejected with a sign-in failure; force a re-read so a
    // freshly re-signed-in app is picked up without a DSH restart. A
    // deliberate re-read is ALSO the one path that clears the exchange
    // throttle: the user has replaced or re-signed the credential, so honouring
    // a stale lockout would be the same mistake from the other side.
    if (this.invalid) {
      this.invalid = false
      this.cached = undefined
      await this.clearThrottle()
    }
    // The two sources expire on different clocks: an app credential by the
    // `expired` flag its own store computed, an env PAT by the wall clock on the
    // job token it was exchanged for.
    if (isCredentialUsable(this.cached)) return this.cached

    this.reads += 1
    const fromApp = await this.loadApp()
    const credential = fromApp ?? this.loadEnv()
    if (credential === undefined) {
      this.cached = undefined
      return undefined
    }
    if (credential.source === 'env-pat') {
      if (this.exchangePat === undefined) {
        // No exchange available: the raw PAT is still better than nothing, and
        // the gateway is the one that will reject it if it is unusable.
        this.cached = credential
        return credential
      }
      // The throttle gate. A previous exchange that the platform refused (a 429
      // with a window, or a dead-credential 401/403) must not be re-POSTed while
      // it stands: the catalog-refresh timer, the card's `?refresh=1` route, the
      // account panel, and every chat turn all funnel through this one method,
      // so without the gate a transient lockout is re-probed on a schedule —
      // which is exactly how one refused exchange becomes a permanently
      // throttled account.
      const held = await this.loadThrottle()
      if (held !== null) {
        const remaining = this.waitRemainingMs(held)
        if (remaining > 0) {
          // The window has not closed; refuse without reaching the platform.
          throw this.throttleError(held)
        }
        // A rate-limit window has fully elapsed: allow exactly one attempt at
        // the deadline. The attempt counter is kept so that if this retry is
        // refused again, the backoff doubles from where it left off rather than
        // resetting to the base and resuming a fast re-probe.
        this.throttle = null
      }
      this.exchanges += 1
      try {
        const exchanged = await this.exchangePat(credential)
        // A success means no gate: clear the memory hold and the persisted
        // record together, so a later transient refusal starts its backoff
        // fresh at the base interval rather than stacking on a spent one.
        await this.clearThrottle()
        this.cached = {
          ...credential,
          token: exchanged.token,
          refreshToken: exchanged.refreshToken,
          expiresAt: exchanged.expiresAt,
        }
        return this.cached
      } catch (error) {
        // `held` was consumed to `null` above only on the "window elapsed"
        // path; on the "first refusal" path it is still the pre-existing
        // value (usually null). Either way the attempt count is the previous
        // one plus this refusal.
        const attempt = (held?.attempt ?? 0) + 1
        const next = throttleForExchangeError(error, this.now(), attempt)
        if (next !== undefined) {
          this.throttle = next
          try {
            // The store's write may answer a promise or a plain value; awaiting
            // both is safe, and a throw must not break resolution — this
            // process still honours the wait in memory (the field just set).
            await this.throttleStore?.write(next)
          } catch {
            // A store that cannot be written is degraded to memory-only.
          }
        }
        throw error
      }
    }
    this.cached = credential
    return credential
  }

  /**
   * The refusal an in-force throttle stands for.
   *
   * Carries `retryAfterSeconds` — the wait still remaining — so the card can
   * render a countdown instead of a bare "could not sign in", the same shape a
   * queue rejection already travels in. It is a fresh `Error` (not a rethrow of
   * the original, which is gone) because the gate produced this answer, not a
   * new platform reply: these are the plugin's own words about a wait it is
   * honouring.
   */
  private throttleError(held: ExchangeThrottle): Error & { retryAfterSeconds?: number } {
    const error = new Error(
      held.parked
        ? 'Qoder PAT exchange is not being retried: this credential was refused and needs to be re-entered'
        : 'Qoder PAT exchange is waiting out a rate-limit window before it retries',
    ) as Error & { retryAfterSeconds?: number }
    if (!held.parked && held.until !== null) {
      error.retryAfterSeconds = Math.ceil(this.waitRemainingMs(held) / 1000)
    }
    return error
  }

  /**
   * Drop the exchange throttle so the next resolve may retry.
   *
   * Called on a deliberate re-read (see {@link CredentialCache.invalidate}) and
   * after a successful exchange. It clears both the in-memory gate and the
   * persisted one.
   */
  async clearThrottle(): Promise<void> {
    this.throttle = null
    this.throttleLoaded = true
    try {
      await this.throttleStore?.clear()
      // Nothing else to do: the in-memory clear above already took effect, and
      // a store that cannot be cleared only loses the cross-restart hold.
    } catch {
      // Degraded to memory-only, as above.
    }
  }

  /**
   * Invalidate the cached credential after an upstream sign-in rejection.
   *
   * The next `resolve` re-reads the app's store, so a re-sign-in is picked up
   * without a restart. Called from the shim when the upstream answers with a
   * sign-in failure, and from the account-reload route when the user presses
   * "重读登录" — and, in both cases, it also clears the exchange throttle: a
   * deliberate re-read is the one event that says "the credential may have
   * changed, try again", which is what a stale gate must step aside for.
   */
  invalidate() {
    this.invalid = true
  }
}
