/**
 * Tests for the request gates every card route passes through.
 *
 * Run: node --test test/route-gates.test.js
 *
 * These four functions lived inside `lib/index.js`, which no test can import —
 * it pulls in the Cordis peer dependencies. That left the ENTIRE request
 * authentication surface able to be wrong while the suite stayed green: a
 * removed origin check, a body cap that never fires, a 405 that lies about
 * what is allowed. They now live in `lib/routes.js`, dependency-free, and this
 * file asserts them for real.
 *
 * The origin rule is asserted as WHAT IT IS rather than as what it should
 * ideally be. It compares host names only — any loopback port is trusted — and
 * that is a deliberate, documented trade: the read routes carry model metadata
 * and no credential, and the write route is the one that would need more. A
 * future change to that rule should fail here on purpose, not by accident.
 *
 * (The alternative to this move was `--experimental-test-module-mocks`. It was
 * implemented and measured: it does not work in this repository, because
 * `mock.module()` requires the specifier to be resolvable and the whole point
 * is that these packages are absent. See docs/KNOWN_GAPS.md item 1（`adapter.js` 的 Cordis 接线与 profile 构造）.)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'

import {
  readJsonBody,
  readJsonBodyOr400,
  loopbackRequest,
  methodAllowed,
  originAllowed,
} from '../lib/routes.js'

/** A response stand-in recording what the gate wrote. */
function fakeRes() {
  return {
    req: { method: 'GET' },
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

const request = (method, origin) => ({
  method,
  headers: origin === undefined ? {} : { origin },
})

// --- the origin gate -------------------------------------------------------

test('a request with no Origin is allowed — same-origin GET is the normal case', () => {
  // The card's fetches are same-origin, so the browser omits Origin on a GET.
  // Rejecting that would break every read route.
  assert.strictEqual(loopbackRequest(request('GET')), true)
  const res = fakeRes()
  assert.strictEqual(originAllowed(request('GET'), res), true)
  assert.strictEqual(res.ended, false, 'nothing may be written on the happy path')
})

test('loopback origins are allowed, on any port', () => {
  // The port is deliberately not compared. This is the documented rule, and
  // the DSH web UI's port is chosen at runtime, so pinning it here would be
  // pinning a value this code does not know.
  for (const origin of [
    'http://127.0.0.1:19387',
    'http://localhost:8080',
    'http://[::1]:3000',
    'https://localhost',
  ]) {
    assert.strictEqual(loopbackRequest(request('GET', origin)), true, origin)
  }
})

test('a non-loopback origin is refused with 403', () => {
  for (const origin of [
    'http://example.com',
    'http://127.0.0.1.evil.com',
    'https://localhost.evil.com',
    'file://',
    'not a url at all',
    'http://192.168.1.10:19387',
  ]) {
    assert.strictEqual(loopbackRequest(request('GET', origin)), false, origin)
    const res = fakeRes()
    assert.strictEqual(originAllowed(request('GET', origin), res), false, origin)
    assert.strictEqual(res.status, 403, origin)
    assert.deepStrictEqual(JSON.parse(res.body), { error: 'origin-not-trusted' })
  }
})

test('a non-string Origin header is refused, not coerced', () => {
  // `req.headers.origin` is typed as a string by Node, but a test double or an
  // unusual server can produce anything; the guard is `typeof`, not truthiness.
  for (const origin of [123, {}, [], true]) {
    assert.strictEqual(loopbackRequest({ method: 'GET', headers: { origin } }), false, String(origin))
  }
})

// --- the method gate -------------------------------------------------------

test('the declared method is allowed and writes nothing', () => {
  const res = fakeRes()
  assert.strictEqual(methodAllowed(request('POST'), res, 'POST'), true)
  assert.strictEqual(res.ended, false)
})

test('a wrong method is 405 and advertises what would have worked', () => {
  const res = fakeRes()
  assert.strictEqual(methodAllowed(request('POST'), res, 'GET'), false)
  assert.strictEqual(res.status, 405)
  assert.strictEqual(res.headers.Allow, 'GET, HEAD')
  assert.deepStrictEqual(JSON.parse(res.body).allow, ['GET', 'HEAD'])
})

test('a POST-only route does not advertise HEAD', () => {
  // HEAD on a POST route is meaningless, and claiming otherwise would invite a
  // client to try it.
  const res = fakeRes()
  methodAllowed(request('GET'), res, 'POST')
  assert.strictEqual(res.headers.Allow, 'POST')
})

// --- the body reader -------------------------------------------------------

/** A request stream carrying `chunks`, as the host would hand one over. */
function bodyRequest(chunks) {
  const stream = Readable.from(chunks)
  stream.destroyed = false
  return stream
}

test('a JSON body is parsed', async () => {
  const value = await readJsonBody(bodyRequest([Buffer.from('{"field":"enabledModelIds"}')]))
  assert.deepStrictEqual(value, { field: 'enabledModelIds' })
})

test('an empty body is undefined, not a parse error', async () => {
  // The reload route accepts "no body" as "re-read every region", so the empty
  // case has to be expressible rather than throwing.
  assert.strictEqual(await readJsonBody(bodyRequest([])), undefined)
})

test('a malformed body throws rather than yielding something odd', async () => {
  await assert.rejects(
    () => readJsonBody(bodyRequest([Buffer.from('{not json')])),
    /JSON/i,
  )
})

test('a body over the cap is rejected, and the request destroyed', async () => {
  // The cap is the only thing between this route and an unbounded allocation,
  // so it is asserted on BOTH halves: the rejection and the destruction. A cap
  // that throws but keeps reading would still accumulate the bytes.
  const request = bodyRequest([Buffer.alloc(200, 0x61)])
  await assert.rejects(() => readJsonBody(request, 100), /exceeds 100 bytes/)
  assert.strictEqual(request.destroyed, true, 'an over-cap body must stop being read')
})

test('a body exactly at the cap is accepted', async () => {
  // Off-by-one in the other direction would reject a legitimate body, so the
  // boundary is pinned from both sides.
  const payload = Buffer.from(JSON.stringify({ region: 'qoder-cn' }))
  const value = await readJsonBody(bodyRequest([payload]), payload.length)
  assert.deepStrictEqual(value, { region: 'qoder-cn' })
})

test('the default cap is 64 KiB', async () => {
  // Quoted rather than assumed: the write routes carry a field and a region id,
  // and a silently lowered cap would start rejecting real saves.
  const small = Buffer.from('{"a":1}')
  assert.deepStrictEqual(await readJsonBody(bodyRequest([small])), { a: 1 })
  const over = Buffer.alloc(64 * 1024 + 1, 0x20)
  await assert.rejects(() => readJsonBody(bodyRequest([over])), /exceeds 65536 bytes/)
})

// --- the guarded variant ---------------------------------------------------

test('a good body comes through the guarded reader', async () => {
  const res = fakeRes()
  const read = await readJsonBodyOr400(bodyRequest([Buffer.from('{"region":"qoder-cn"}')]), res)
  assert.deepStrictEqual(read, { ok: true, body: { region: 'qoder-cn' } })
  assert.strictEqual(res.ended, false, 'nothing is written on the happy path')
})

test('a malformed body becomes a 400 with a body, not an escaped rejection', async () => {
  // The failure this exists for: awaited bare, the rejection escaped the handler
  // and the web server answered a BODYLESS 400, which the card can only render
  // as "HTTP 400" — undiagnosable from the browser, and identical for a
  // malformed request, an oversized one, and a bug in the route.
  const res = fakeRes()
  const read = await readJsonBodyOr400(bodyRequest([Buffer.from('{not json')]), res)
  assert.deepStrictEqual(read, { ok: false, body: undefined })
  assert.strictEqual(res.status, 400)
  const body = JSON.parse(res.body)
  assert.match(body.error, /invalid request body/)
  assert.strictEqual(typeof body.errorName, 'string', 'the card needs a name to show')
  assert.ok(body.detail.length > 0, 'and something to go on')
  assert.strictEqual(res.headers.Allow, 'POST', 'a 405-shaped refusal still advertises what works')
})

test('an over-cap body is refused the same way, not thrown', async () => {
  const res = fakeRes()
  const read = await readJsonBodyOr400(bodyRequest([Buffer.alloc(200, 0x61)]), res, 100)
  assert.strictEqual(read.ok, false)
  assert.strictEqual(res.status, 400)
  assert.match(JSON.parse(res.body).detail, /exceeds 100 bytes/)
})

test('an empty body is still a success, because the reload route accepts it', async () => {
  // "No body" means "re-read every region" for the reload route, so it must not
  // be turned into a 400 by the guard.
  const res = fakeRes()
  const read = await readJsonBodyOr400(bodyRequest([]), res)
  assert.deepStrictEqual(read, { ok: true, body: undefined })
  assert.strictEqual(res.ended, false)
})
