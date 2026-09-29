/**
 * Tests for the HTTP surface the card's routes present.
 *
 * Run: node --test test/http-surface.test.js
 *
 * Two things that a browser — or any HTTP client — reads to decide what to do
 * next, and which were both wrong (docs/issues/12, item 4):
 *
 * - **A 405 must carry `Allow`** (RFC 9110 §15.5.6). Without it the response is
 *   malformed: the status says "not this method" and nothing says what would
 *   have been accepted.
 * - **A HEAD on a GET route is a GET without a body**, not a rejection. It was
 *   rejected, which made a correct request fail and removed the cheapest
 *   "is this endpoint there" probe there is.
 *
 * `sendJson` is importable (no peer dependencies), so the writer is tested for
 * real against a response stand-in. The 405 path itself lives in lib/index.js,
 * which cannot be imported — that half is pinned textually by
 * test/account-route-wiring.test.js's approach, here in a smaller form.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { sendJson } from '../lib/http-utils.js'
import { methodAllowed, originAllowed, loopbackRequest, readJsonBody } from '../lib/routes.js'

/**
 * A Node response stand-in that records exactly what was written.
 *
 * `method` also lands on `res.req.method`, because `sendJson` drops the body on
 * a HEAD — the response object has to know what was asked for.
 */
function fakeRes(method = 'GET') {
  return {
    req: { method },
    status: undefined,
    headers: undefined,
    body: undefined,
    ended: false,
    writeHead(status, headers) {
      this.status = status
      this.headers = headers
    },
    end(payload) {
      this.body = payload
      this.ended = true
    },
  }
}

test('a JSON response is no-store, so the card never reads a cached list', () => {
  // The card polls these endpoints on every render; a cached response would
  // show a model list or quota that is minutes old with nothing indicating it.
  const res = fakeRes()
  sendJson(res, 200, { ok: true })
  assert.strictEqual(res.headers['Cache-Control'], 'no-store')
  assert.strictEqual(res.headers['Content-Type'], 'application/json')
  assert.strictEqual(res.headers['Content-Length'], Buffer.byteLength('{"ok":true}'))
})

test('a 405 can advertise the methods that would have worked', () => {
  // Passing `Allow` separately is the only way it survives: `writeHead`'s
  // object REPLACES the header set, so a `setHeader` before this call is
  // dropped. That is the bug the first attempt at this fix had.
  const res = fakeRes('POST')
  sendJson(res, 405, { error: 'method not allowed', allow: ['GET', 'HEAD'] }, { Allow: 'GET, HEAD' })
  assert.strictEqual(res.status, 405)
  assert.strictEqual(res.headers.Allow, 'GET, HEAD', 'the header must survive writeHead')
  assert.deepStrictEqual(JSON.parse(res.body).allow, ['GET', 'HEAD'])
})

test('a HEAD response carries the headers but no body', () => {
  // The advertised `Content-Length` describes the body GET would have sent, so
  // it stays truthful; the payload itself must not go out, or a client reading
  // Content-Length bytes on a HEAD response hangs or mis-frames.
  const res = fakeRes('HEAD')
  sendJson(res, 200, { hello: 'world' })
  assert.strictEqual(res.body, undefined, 'HEAD must not send a payload')
  assert.strictEqual(res.headers['Content-Length'], Buffer.byteLength('{"hello":"world"}'))
  assert.strictEqual(res.headers['Cache-Control'], 'no-store')
})

test('a GET response still sends its body', () => {
  // The counterpart to the rule above, so a change that dropped bodies
  // everywhere (the easy way to "fix" HEAD) is caught.
  const res = fakeRes('GET')
  sendJson(res, 200, { hello: 'world' })
  assert.strictEqual(res.body, '{"hello":"world"}')
})

test('a response object without a `req` still gets its body', () => {
  // `res.req?.method` — a stand-in or an unusual host response may have no
  // `req` at all, and that must not turn every response body-less.
  const res = fakeRes()
  res.req = undefined
  sendJson(res, 200, { ok: true })
  assert.strictEqual(res.body, '{"ok":true}')
})

test('the 405 path advertises Allow and treats HEAD as GET', () => {
  // This half used to be a source-text assertion against lib/index.js. The
  // gates now live in lib/routes.js, which has no peer dependencies and is
  // imported here, so it is asserted for real instead — the text version could
  // only ever prove a string was present.
  for (const method of ['POST', 'PUT', 'DELETE']) {
    const res = fakeRes(method)
    assert.strictEqual(methodAllowed({ method, headers: {} }, res, 'GET'), false, method)
    assert.strictEqual(res.status, 405)
    assert.strictEqual(res.headers.Allow, 'GET, HEAD')
  }
  // And the HEAD-on-a-GET case, end to end through the gate and the writer.
  const head = fakeRes('HEAD')
  assert.strictEqual(methodAllowed({ method: 'HEAD', headers: {} }, head, 'GET'), true)
  assert.strictEqual(head.ended, false, 'a HEAD answered as a GET sends no body')
})
