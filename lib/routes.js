/**
 * The gates every card route passes through, and the body reader they share.
 *
 * WHY THIS IS A MODULE
 *
 * These four functions used to live inside `lib/index.js`, which cannot be
 * imported by a test — it pulls in the Cordis peer dependencies, and this
 * repository installs none of them. That made the whole request-authentication
 * surface untestable: the method check, the origin check, the body cap, and the
 * 405/403 responses could all be wrong with the suite fully green
 * (docs/KNOWN_GAPS.md item 1（`adapter.js` 的 Cordis 接线与 profile 构造）and item 2（`RegionRuntime` 本身与 `activate` 的 Cordis 接线）).
 *
 * The alternative considered and rejected first was
 * `--experimental-test-module-mocks`. It was implemented and measured, and it
 * does not work here: `mock.module()` requires the specifier to be RESOLVABLE
 * before it can stub it, and the whole point is that these packages are not
 * installed. A resolver hook cannot help either — `lib/index.js` imports
 * `adapter.js` statically at module scope, which is resolved before the hook
 * chain sees it. KNOWN_GAPS claimed this route was "verified feasible"; on this
 * machine it is not, and that claim is corrected there.
 *
 * So the gates are here, dependency-free and importable, and `lib/index.js`
 * imports them. The handlers themselves stay where they are: what is worth
 * asserting is that every route passes the same gates with the same
 * parameters, and that is now a matter of reading five call sites rather than
 * re-deriving a whole module.
 *
 * @module dsh-connect-qoder/routes
 */
import { sendJson } from './http-utils.js'

/**
 * Read a JSON request body, capped.
 *
 * The cap is enforced WHILE reading rather than after: a body larger than the
 * limit is rejected and the request destroyed rather than drained, so an
 * oversized upload cannot be accumulated in memory first. An empty body parses
 * as `undefined` from `JSON.parse`'s standpoint, so callers that accept "no
 * body" do so explicitly — the cap is enforced regardless.
 *
 * @param req - the Node request.
 * @param maxBytes - the largest body accepted, in bytes.
 * @returns the parsed value, or `undefined` for an empty body.
 */
export async function readJsonBody(req, maxBytes = 64 * 1024) {
  const chunks = []
  let size = 0
  await new Promise((resolve, reject) => {
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > maxBytes) {
        reject(new Error(`body exceeds ${maxBytes} bytes`))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', resolve)
    req.on('error', reject)
  })
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.length === 0) return undefined
  return JSON.parse(text)
}

/**
 * Read a JSON body and answer a bad one properly, instead of throwing.
 *
 * `readJsonBody` rejects on malformed JSON and on an over-cap body. A route that
 * awaits it bare lets that rejection escape the handler, and the web server's
 * catch-all answers a **bodyless 400** — which the card can only render as
 * "HTTP 400". That is undiagnosable from the browser: the same status would mean
 * a malformed request, a request that was too large, or a bug in the route, and
 * the user is told none of which.
 *
 * So the failure is turned into a response here: a 400 carrying `errorName` and
 * the parse message, matching what the save route already does with its own
 * failures (`lib/settings-save.js` reports `read-back-mismatch` the same way).
 * The route then simply returns, and every caller gets the same shape.
 *
 * @param req - the Node request.
 * @param res - the Node response, used to answer a failure.
 * @param maxBytes - the largest body accepted, in bytes.
 * @returns `{ ok: true, body }`, or `{ ok: false }` once a 400 has been sent.
 */
export async function readJsonBodyOr400(req, res, maxBytes) {
  try {
    return { ok: true, body: await readJsonBody(req, maxBytes) }
  } catch (error) {
    sendJson(
      res,
      400,
      {
        error: 'invalid request body',
        errorName: error?.name ?? 'Error',
        detail: String(error?.message ?? error).slice(0, 200),
      },
      { Allow: 'POST' },
    )
    return { ok: false, body: undefined }
  }
}

/**
 * Whether a card request came from this machine, same-origin.
 *
 * The routes expose model metadata, not credentials, but they stay loopback-only
 * anyway: they are an internal read path for a browser page this host itself
 * served, and a missing Origin (a same-origin GET) is the normal case.
 *
 * WHAT WAS WRONG, AND WHY IT WAS NOT JUST COSMETIC
 *
 * The rule used to be "the Origin's host NAME is loopback" — the port was not
 * compared at all, with a comment saying that was a deliberate trade. It was not
 * a trade, it was a hole, and the three POST routes made it expensive:
 *
 *   /save           change which models appear in DSH's picker, and per-model
 *                   image input
 *   /checkin        claim the daily Credits — a real account mutation
 *   /account/reload bring a region online and re-read the credential store
 *
 * Any HTTP server the user visits on their own machine could have its JavaScript
 * call these. A page at `http://127.0.0.1:anything` posting to
 * `http://127.0.0.1:19387/…` sends `Origin: http://127.0.0.1:anything`, which
 * passed a name-only check. The browser would not stop it either: the response
 * is not readable cross-origin, but the SIDE EFFECT has already happened.
 *
 * THE RULE NOW: same-origin, verified against the request's own `Host` header.
 *
 * `Host` is what the client actually dialled, so comparing Origin's authority to
 * it needs no configured port and cannot drift when DSH picks a different one at
 * runtime — which is why this is right where "hardcode the web port" would not
 * be. The host must ALSO be loopback, because a same-origin check alone would
 * trust a DSH served on a real interface, and this plugin's routes are an
 * internal surface whether or not the front end is.
 *
 * @param req - the Node request.
 * @returns true when the request may proceed.
 */
export function loopbackRequest(req) {
  const origin = req.headers.origin
  // No Origin is the same-origin GET case (and any non-browser client). The
  // browser always sends one for a cross-origin request, so its absence cannot
  // mean "a page on another loopback port did this".
  if (origin === undefined) return true
  if (typeof origin !== 'string') return false
  let authority
  try {
    authority = new URL(origin).host
  } catch {
    return false
  }
  if (!isLoopbackAuthority(authority)) return false
  // Same-origin, or nothing. A missing Host header (HTTP/1.0, a test double)
  // leaves the comparison with nothing to check, and the loopback test above has
  // already done what it can.
  const host = req.headers.host
  if (typeof host !== 'string' || host.length === 0) return true
  return authority.toLowerCase() === host.toLowerCase()
}

/**
 * Whether an `host[:port]` authority names this machine.
 *
 * The port is irrelevant here and stripped: what is being asked is "is this
 * address on this box", and the exact port is settled by the same-origin
 * comparison in {@link loopbackRequest}. Exported so the loopback set is one
 * list rather than a condition repeated in two places.
 */
export function isLoopbackAuthority(authority) {
  const text = String(authority).toLowerCase()
  // Strip the port, keeping an IPv6 literal's brackets intact: `[::1]:19387`
  // is loopback, `::1:19387` is not a valid authority to compare.
  const withoutPort = text.startsWith('[')
    ? (text.indexOf(']') === -1 ? text : text.slice(0, text.indexOf(']') + 1))
    : text.split(':')[0]
  const bare = withoutPort.startsWith('[') && withoutPort.endsWith(']')
    ? withoutPort.slice(1, -1)
    : withoutPort
  return bare === '127.0.0.1' || bare === 'localhost' || bare === '::1' || bare.startsWith('127.')
}

/**
 * Assert the request method is one of the allowed methods.
 *
 * Every card route starts with this check. Extracts the 405 response so each
 * handler's first line is the check and the rest is the handler logic.
 *
 * Two details that were both wrong before, and both are what an HTTP client
 * reads to decide what it is allowed to try next:
 *
 * - **A 405 must carry `Allow`** (RFC 9110 §15.5.6). Without it the response is
 *   technically malformed, and a client has nothing to go on but a bare status.
 * - **`HEAD` is answered by the `GET` path, not rejected.** HEAD is GET without
 *   a body: the server computes the same headers and sends no payload. Treating
 *   it as "not allowed" made a correct request to a read-only route fail, and it
 *   was the only route family where a HEAD probe was plausible.
 *
 * @returns true if the method is allowed, false if the response was sent.
 */
export function methodAllowed(req, res, ...methods) {
  // A HEAD on a GET route is served as a GET; the writer omits the body.
  if (req.method === 'HEAD' && methods.includes('GET')) return true
  if (methods.includes(req.method)) return true
  // Advertise the methods that WOULD have worked, which for a GET route means
  // GET, HEAD and OPTIONS are all acceptable answers to a probe.
  const advertised = methods.includes('GET') ? [...methods, 'HEAD'] : methods
  sendJson(res, 405, { error: 'method not allowed', allow: advertised }, { Allow: advertised.join(', ') })
  return false
}

/**
 * Assert the request came from this machine.
 *
 * Every card route calls this after the method check. Extracts the 403
 * response so each handler's second line is the check and the rest is the
 * handler logic.
 *
 * @returns true if the origin is trusted, false if the response was sent.
 */
export function originAllowed(req, res) {
  if (loopbackRequest(req)) return true
  sendJson(res, 403, { error: 'origin-not-trusted' })
  return false
}
