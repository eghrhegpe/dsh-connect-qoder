/**
 * The `message` of a thrown value, as a string, or `''` when it has none.
 *
 * A catch block's binding is `unknown` (`useUnknownInCatchVariables` is on), so
 * `.message` is not readable without narrowing first. This is that narrowing,
 * written once instead of as `String((error as { message?: unknown })?.message ?? error)`
 * at each of the two dozen catch sites — a spelling that also quietly loses the
 * non-Error throw (a bare string, a rejected non-object) by stringifying
 * `undefined` into the word "undefined".
 *
 * Deliberately narrow: it reads ONE field off a value it does not trust, and
 * answers `''` rather than inventing a description. Callers that need the
 * original value stringified should use {@link describeThrown}.
 *
 * @param error - the thrown value.
 * @returns its `message` when that is a string, otherwise `''`.
 */
export function errorMessage(error: unknown): string {
  const message = (error as { message?: unknown } | null | undefined)?.message
  return typeof message === 'string' ? message : ''
}

/**
 * A human-readable description of a thrown value, whatever it turned out to be.
 *
 * The three cases that actually occur, in the order that reads best:
 *
 * 1. an `Error` (or anything with a string `message`) — its message;
 * 2. a bare string thrown by hand — the string itself;
 * 3. anything else (a rejection carrying an object, `undefined`) — `String()`.
 *
 * The reason this is not just `String(error)` is that it turns an `Error` into
 * `"Error: the real reason"`, prefixing the noise the caller is trying to read
 * past. The reason it is not just `error.message` is that a non-Error throw
 * then arrives as the literal text `"undefined"`, which is how a bare string
 * rejection reached the account panel as an empty-looking message.
 *
 * @param error - the thrown value.
 * @returns a non-empty description; `'undefined'` only for an actual `undefined` throw.
 */
export function describeThrown(error: unknown): string {
  const message = errorMessage(error)
  if (message !== '') return message
  if (typeof error === 'string') return error
  return String(error)
}

/**
 * Read a flag or field off a thrown value, without trusting its shape.
 *
 * The shim and the classifier both hang their own flags on errors
 * (`retryable`, `dailyLimit`, `signInExpired`, `protocolShapeChanged`) precisely
 * because the value crosses a throw boundary and may lose its prototype on the
 * way. Reading those flags off an `unknown` binding is the same narrowing every
 * time, so it is written once here.
 *
 * `key` is one of the known flag names, NOT an arbitrary string: a helper that
 * accepts any key would let a typo (`'retryble'`) compile and read `undefined`
 * forever, which is the failure mode this whole file exists to avoid.
 *
 * @param error - the thrown value.
 * @param key - the field to read.
 * @returns the field's value, still `unknown` — callers compare it, never
 *   assume it. An absent field and a `null` one both answer `undefined`.
 */
export function thrownFlag(error: unknown, key: ThrownFlag): unknown {
  return (error as Record<string, unknown> | null | undefined)?.[key]
}

/** The flag names {@link thrownFlag} will read. A literal union, so typos fail to compile. */
export type ThrownFlag = 'name' | 'message' | 'cause' | 'code' | 'retryable' | 'dailyLimit' | 'signInExpired' | 'protocolShapeChanged' | 'retryAfterSeconds' | 'status'

/**
 * A refusal that means the sign-in is gone, so the cached credential is stale.
 *
 * The upstream layer used to build this as `const error: any = new Error(msg)`
 * and then hang `signInExpired = true` on it. That worked, and the flag is
 * genuinely what {@link isStaleCredentialError} reads — but declaring the local
 * `any` meant the assignment itself was never checked, and the two throw sites
 * had to agree by hand with a reader in another file.
 *
 * The property is declared here rather than inferred, so the two sites and the
 * reader are tied together by the compiler.
 */
export class SignInExpiredError extends Error {
  /** Read by {@link isStaleCredentialError}. Always true (see class doc). */
  signInExpired: boolean

  /**
   * @param message - the readable sentence; built by the caller, which knows
   *   which of the two failure shapes produced it.
   */
  constructor(message: string) {
    super(message)
    this.signInExpired = true
  }
}

/**
 * Read a Qoder error frame and decide what it actually is.
 *
 * Codes that arrive here have very different meanings, and conflating them sent
 * the user looking at their account for what is really a queue:
 *
 * - **105 / TOKEN_EXPIRE** — the sign-in is gone. Nothing will succeed until
 *   the user signs in to the Qoder app again.
 * - **10605** — the request was queued or rate-limited. The body carries
 *   `retryAfterSeconds` and `serviceAvailable`, so it is transient and must be
 *   treated as retryable rather than as a rejection.
 * - **110** — the account's DAILY billing count is spent. Transient in the sense
 *   that it clears, but not in the sense that waiting helps within a session: it
 *   resets at the day boundary, and the gateway still sends a Retry-After
 *   measured in HOURS with it (7350 s in the report this rule is written from).
 *   Retrying it produced a user reading "重试延迟：7350 毫秒" for something a
 *   queue would have cleared in two seconds. So it is its own kind, never a
 *   queue — see the ordering note on the check itself.
 * - **protocol shape changes** — not a frame at all but an envelope this code
 *   no longer recognises; they arrive as a 200 and are raised separately, as
 *   ProtocolShapeChangedError.
 *
 * Exact code matches decide first, so a sign-in failure is never shadowed by a
 * stray field name; the marker regex only fires as a fallback, and only when
 * at least two queue markers co-occur, so an auth error that happens to carry
 * a `retryAfterSeconds` field is not misread as a queue.
 */

/** The queue descriptor's field names; any two co-occurring mark a queue. */
const QUEUE_MARKERS = ['"queueType"', '"retryAfterSeconds"', '"isQueued"', '"serviceAvailable"']

/** How many of the queue markers appear in a payload text. */
function queueMarkerCount(text: string): number {
  let count = 0
  for (const marker of QUEUE_MARKERS) {
    if (text.includes(marker)) count += 1
  }
  return count
}

/** Extract `retryAfterSeconds` from a queue payload, best-effort. */
function queueSeconds(text: string): number {
  // The payload reaches here already unwrapped once from the outer envelope,
  // but the queue descriptor is still buried: per the shape documented at the
  // top of this file, `detail` is `{ code, message }` whose `message` is a JSON
  // *string* holding another object whose `message` is a JSON string holding the
  // descriptor. So the value can be two parses and one property hop away.
  //
  // This used to try `JSON.parse(`"${text}"`)` for text not starting with `{`,
  // on the assumption it was a bare string fragment. Any such text contains
  // quotes of its own, so the interpolated literal was never valid JSON, the
  // throw was swallowed, and the gateway's own `retryAfterSeconds` came back as
  // 0 for every real 10605 — leaving the caller's escalation ladder polling a
  // queue the server had already said how long to wait for.
  let node = text
  for (let depth = 0; depth < 4; depth++) {
    let parsed: unknown
    try {
      parsed = JSON.parse(node)
    } catch {
      return 0
    }
    if (parsed === null || typeof parsed !== 'object') return 0
    // Narrow to an indexable record. `typeof x === 'object'` alone lands on
    // `object`, which has neither `retryAfterSeconds` nor `message` — the field
    // reads below only ever worked because `parsed` used to be an implicit
    // `any`. Re-widening here is what makes those reads checked rather than
    // merely unchecked: the values stay `unknown`, so a non-numeric
    // `retryAfterSeconds` still falls through `Number.isFinite` as before.
    const descriptor = parsed as Record<string, unknown>
    const seconds = Number(descriptor.retryAfterSeconds)
    if (Number.isFinite(seconds) && seconds > 0) return seconds
    // Descend: a `message` that is a string is another JSON document.
    if (typeof descriptor.message !== 'string') return 0
    node = descriptor.message
  }
  return 0
}

function classifyUpstreamError(
  _chunk: unknown,
  code: unknown,
  detail: string,
): { kind: string; retryAfterSeconds?: number } {
  // `code` may arrive as a JSON number from a gateway that stopped quoting it
  // (the unwrap layer normalises, but this stays defensive), so normalise
  // before comparing instead of strict-string-matching.
  const text = String(detail ?? '')
  // Quotes stripped as well as normalised to a string: the unwrap layer
  // already unwraps the code, but a caller that hands this the raw
  // `'"110"'` should not be told "upstream" — the difference between a spent
  // allowance and a mystery is exactly the diagnosis the user needs.
  const normalized = String(code ?? '').replace(/^["']|["']$/g, '')
  // The daily billing allowance, checked BEFORE anything queue-shaped. The
  // order is the whole point: the gateway answers this one with a `Retry-After`
  // measured in HOURS (7350 s in the one report this rule is written from), so
  // the queue-marker fallback below would otherwise read it as a queue and the
  // plugin would burn a two-minute budget waiting for something that resets at
  // the day boundary and is not improved by waiting at all.
  if (normalized === '110' || /billing daily count|daily count exceeded|daily limit/i.test(text)) {
    // The hint IS carried through, even though the kind is not a queue. It is
    // the only thing the UI can turn into "resets at HH:MM", and discarding it
    // is what left the user with a bare "重试延迟" and nothing to plan around.
    // `queueSeconds` reads the gateway's own `retryAfterSeconds` field rather
    // than the HTTP header — the frame path has no headers — and falls back to
    // 0 when the payload carries none, which is a correct "we do not know when".
    return { kind: 'daily-limit', retryAfterSeconds: queueSeconds(text) }
  }
  if (normalized === '10605') {
    return { kind: 'rate-limit', retryAfterSeconds: queueSeconds(text) }
  }
  if (/Login expired|TOKEN_EXPIRE|token is not active/i.test(text) || normalized === '105') {
    return { kind: 'sign-in-expired' }
  }
  if (queueMarkerCount(text) >= 2) {
    return { kind: 'rate-limit', retryAfterSeconds: queueSeconds(text) }
  }
  return { kind: 'upstream' }
}

/**
 * Read a `Retry-After` hint as seconds, from either spelling the gateway uses.
 *
 * The header (and the JSON `retryAfterSeconds` field the frame path carries)
 * reach this as an `unknown`: it has been a bare number, a numeric string, and
 * an HTTP-date string ("Wed, 21 Oct 2026 07:28:00 GMT") across builds. The delta
 * form is the wait itself; the date form is resolved against the wall clock, so
 * a stale absolute deadline reads as `0` rather than a negative number that a
 * caller would then have to clamp again.
 *
 * It is a pure function with no imports so the throttle gate (see
 * `credential-cache.ts`) can honour a platform-stated window without inventing
 * one — and so a test can feed it each real spelling.
 *
 * @param value - the header or field value, still `unknown`.
 * @param now - the wall clock the date form is measured against; defaults to now.
 * @returns whole seconds to wait (never negative), or `undefined` when the value
 *   names no window at all. `undefined` and `0` differ: the first means "the
 *   platform said nothing" and a caller falls back to its own backoff; the second
 *   means "it said wait zero", which is already open.
 */
export function parseRetryAfterSeconds(value: unknown, now: number = Date.now()): number | undefined {
  if (value === undefined || value === null) return undefined
  // A number or a numeric string is a delta in seconds, the common case.
  const asNumber = Number(value)
  if (Number.isFinite(asNumber)) return Math.max(0, Math.round(asNumber))
  // Anything else that is a string may be an HTTP-date (RFC 9110 §15.5.1).
  if (typeof value === 'string') {
    const at = Date.parse(value)
    if (Number.isFinite(at)) return Math.max(0, Math.ceil((at - now) / 1000))
  }
  return undefined
}

/**
 * Whether an upstream failure means the cached credential has gone stale.
 *
 * A sign-in rejection is the one failure that must invalidate the cached
 * credential: the Qoder app owns the token's lifecycle and refreshes it in its
 * own store, so a re-sign-in is already on disk and simply not being read.
 * Without this the stale entry stays cached for the life of the process and
 * every request 401s until DSH is restarted.
 *
 * It lives here, rather than inline at each of the shim's two catch sites,
 * because this module has no imports at all — so a test can import it and
 * assert against the real predicate. The test that covers this used to
 * re-implement the same expression inside the test file, which meant rewording
 * or breaking the regex in production code left that test green; that was
 * confirmed by mutation, not assumed.
 *
 * @param error - the thrown error, or `undefined` from a catch block.
 * @returns true when the credential should be re-read on the next request.
 */
export function isStaleCredentialError(error: unknown): boolean {
  // Narrowed through an explicit local rather than a cast on the argument, so
  // both flag reads below are checked against the shape they claim to need.
  const e = error as { signInExpired?: unknown; message?: unknown } | null | undefined
  if (e?.signInExpired === true) return true
  return /sign-in is no longer valid|sign-in-expired/i.test(String(e?.message ?? ''))
}

/**
 * A reply that is not a failure at all, but is not the protocol either.
 *
 * This plugin clones a private protocol with no version negotiation and no
 * contract, so the most likely way it breaks is not a rejection — it is a
 * successful HTTP 200 carrying an envelope this code no longer recognises (a
 * renamed product-surface group, a new wrapper object, an HTML SSO page where
 * JSON used to be). Before this error existed, every one of those arrived as
 * "0 models", indistinguishable from an account that genuinely has none, and
 * the plugin's own queue budget turned the rejection-shaped variants into a
 * long wait instead of a diagnosis.
 *
 * The class carries `retryable = false` so {@link queueWaitFor} leaves it
 * alone: waiting cannot fix a shape, and burning the two-minute budget on it
 * is what produced "the plugin needs an update" arriving as a two-minute hang.
 *
 * The flag is on the error rather than in its name so the classifier can read
 * it from a caught value that lost its prototype (a cross-realm throw, a
 * re-wrapped error) — the same reason `signInExpired` is a flag.
 */
export class ProtocolShapeChangedError extends Error {
  /** Whether this is a protocol-shape change rather than a refusal (see class doc). */
  protocolShapeChanged: boolean
  /** Always false: waiting cannot fix a shape (see class doc). */
  retryable: boolean
  /** What was received, in a form a human can act on. */
  detail: unknown

  /**
   * @param detail - what was received, in a form a human can act on.
   */
  constructor(detail: unknown) {
    super(
      `Qoder replied in a shape this plugin does not recognise (${detail}) — ` +
        'the client API it mirrors has probably changed and the plugin needs an update',
    )
    this.name = 'ProtocolShapeChangedError'
    this.protocolShapeChanged = true
    this.retryable = false
    this.detail = detail
  }
}

/**
 * Whether a failure is a protocol-shape change rather than a refusal.
 *
 * Exported so the classifier reads the real predicate: a copy of this
 * expression inside a test would only prove the copy agrees with itself, which
 * is the exact failure mode this repository keeps rewriting its tests to
 * remove.
 *
 * @param error - the thrown error, or `undefined` from a catch block.
 * @returns true when the plugin should tell the user to update, not to re-sign.
 */
export function isProtocolShapeChangedError(error: unknown): boolean {
  return (error as { protocolShapeChanged?: unknown } | null | undefined)?.protocolShapeChanged === true
}

export { classifyUpstreamError }
