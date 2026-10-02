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
import type { ServerResponse } from 'node:http'

/** Response headers this plugin sets, passed through to `writeHead`. */
export type ResponseHeaders = Record<string, number | string | readonly string[]>

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
 * @param extraHeaders - headers this response must also carry. They are passed
 *   to `writeHead` rather than set separately, because `writeHead`'s object
 *   REPLACES the header set — a `res.setHeader('Allow', …)` before a
 *   `sendJson` call would otherwise be silently dropped, which is exactly the
 *   bug the 405 path had when it tried to advertise `Allow` that way.
 */
export function sendJson(
  res: ServerResponse,
  status: number,
  value: unknown,
  extraHeaders: ResponseHeaders | undefined = undefined,
): void {
  const payload = JSON.stringify(value)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    ...(extraHeaders ?? {}),
  })
  // A HEAD response carries the headers GET would have produced and no body, so
  // the advertised `Content-Length` stays truthful while the payload is dropped.
  res.end(res.req?.method === 'HEAD' ? undefined : payload)
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
export function writeError(
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
  extraHeaders: ResponseHeaders | undefined = undefined,
): void {
  const payload = JSON.stringify({ error: { message, type: code, code } })
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    ...(extraHeaders ?? {}),
  })
  res.end(payload)
}
