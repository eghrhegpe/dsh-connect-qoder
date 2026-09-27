/**
 * Read a Qoder error frame and decide what it actually is.
 *
 * Two codes arrive here with very different meanings, and conflating them sent
 * the user looking at their account for what is really a queue:
 *
 * - **105 / TOKEN_EXPIRE** — the sign-in is gone. Nothing will succeed until
 *   the user signs in to the Qoder app again.
 * - **10605** — the request was queued or rate-limited. The body carries
 *   `retryAfterSeconds` and `serviceAvailable`, so it is transient and must be
 *   treated as retryable rather than as a rejection.
 *
 * Exact code matches decide first, so a sign-in failure is never shadowed by a
 * stray field name; the marker regex only fires as a fallback, and only when
 * at least two queue markers co-occur, so an auth error that happens to carry
 * a `retryAfterSeconds` field is not misread as a queue.
 */

/** The queue descriptor's field names; any two co-occurring mark a queue. */
const QUEUE_MARKERS = ['"queueType"', '"retryAfterSeconds"', '"isQueued"', '"serviceAvailable"']

/** How many of the queue markers appear in a payload text. */
function queueMarkerCount(text) {
  let count = 0
  for (const marker of QUEUE_MARKERS) {
    if (text.includes(marker)) count += 1
  }
  return count
}

/** Extract `retryAfterSeconds` from a queue payload, best-effort. */
function queueSeconds(text) {
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
    let parsed
    try {
      parsed = JSON.parse(node)
    } catch {
      return 0
    }
    if (parsed === null || typeof parsed !== 'object') return 0
    const seconds = Number(parsed.retryAfterSeconds)
    if (Number.isFinite(seconds) && seconds > 0) return seconds
    // Descend: a `message` that is a string is another JSON document.
    if (typeof parsed.message !== 'string') return 0
    node = parsed.message
  }
  return 0
}

function classifyUpstreamError(chunk, code, detail) {
  // `code` may arrive as a JSON number from a gateway that stopped quoting it
  // (the unwrap layer normalises, but this stays defensive), so normalise
  // before comparing instead of strict-string-matching.
  const text = String(detail ?? '')
  const normalized = String(code ?? '')
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
export function isStaleCredentialError(error) {
  if (error?.signInExpired === true) return true
  return /sign-in is no longer valid|sign-in-expired/i.test(String(error?.message ?? ''))
}

export { classifyUpstreamError }
