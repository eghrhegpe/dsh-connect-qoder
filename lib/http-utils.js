/**
 * Shared HTTP response helpers for the loopback routes.
 *
 * Both the host-side card routes (lib/index.js) and the loopback shim
 * (lib/shim.js) serve JSON to an in-process browser page. The response shape is
 * identical: JSON content type, correct Content-Length, and no cache (the card
 * polls these endpoints, and a cached response would show stale data).
 *
 * @module dsh-connect-qoder/http-utils
 */

/**
 * Write one JSON body.
 *
 * `Cache-Control: no-store` is set so the browser never caches the response.
 * The card polls these endpoints on every render, and a cached response would
 * show stale model lists, usage, or account state.
 *
 * @param res - the Node HTTP response.
 * @param status - the HTTP status code.
 * @param value - the value to serialize as JSON.
 */
export function sendJson(res, status, value) {
  const payload = JSON.stringify(value)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  })
  res.end(payload)
}

/**
 * Write one OpenAI-shaped error body.
 *
 * Used by the shim to answer with a structured error the host can parse.
 *
 * @param res - the Node HTTP response.
 * @param status - the HTTP status code.
 * @param code - the error type string.
 * @param message - the human-readable error message.
 * @param extraHeaders - optional additional headers (e.g., Retry-After).
 */
export function writeError(res, status, code, message, extraHeaders = undefined) {
  const payload = JSON.stringify({ error: { message, type: code, code } })
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    ...(extraHeaders ?? {}),
  })
  res.end(payload)
}
