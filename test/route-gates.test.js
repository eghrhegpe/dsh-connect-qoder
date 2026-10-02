/**
 * Tests for the request gates every card route passes through.
 *
 * Run: node --test test/route-gates.test.js
 *
 * These four functions lived inside `src/host/index.ts`, which no test can import —
 * it pulls in the Cordis peer dependencies. That left the ENTIRE request
 * authentication surface able to be wrong while the suite stayed green: a
 * removed origin check, a body cap that never fires, a 405 that lies about
 * what is allowed. They now live in `src/host/routes.ts`, dependency-free, and this
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
 * is that these packages are absent. See docs/KNOWN_GAPS.md item 1（`adapter.ts` 的 Cordis 接线与 profile 构造）.)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'

import {
  readJsonBody,
  readJsonBodyOr400,
  loopbackRequest,
  isLoopbackAuthority,
  methodAllowed,
  originAllowed,
} from '../src/host/routes.ts'

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

/**
 * A request with the headers the origin gate reads.
 *
 * `host` is what the client dialled — the same-origin comparison needs it, and
 * leaving it undefined exercises the "no Host header" path.
 */
const request = (method, origin, host) => {
  const headers = {}
  if (origin !== undefined) headers.origin = origin
  if (host !== undefined) headers.host = host
  return { method, headers }
}

// --- the origin gate -------------------------------------------------------

test('a request with no Origin is allowed — same-origin GET is the normal case', () => {
  // The card's fetches are same-origin, so the browser omits Origin on a GET.
  // Rejecting that would break every read route.
  assert.strictEqual(loopbackRequest(request('GET')), true)
  const res = fakeRes()
  assert.strictEqual(originAllowed(request('GET'), res), true)
  assert.strictEqual(res.ended, false, 'nothing may be written on the happy path')
})

test('a same-origin request is allowed, on the port the client dialled', () => {
  // This is the rule that replaced "any loopback port will do", and the reason
  // it can be written without knowing DSH's port in advance: `Host` IS what the
  // client dialled, so an Origin that matches it is same-origin by definition.
  const host = '127.0.0.1:19387'
  for (const origin of [`http://${host}`, `https://${host}`]) {
    assert.strictEqual(loopbackRequest(request('GET', origin, host)), true, origin)
  }
  // The names that mean "this machine" all work, each with its own Host.
  for (const authority of ['localhost:19387', '127.0.0.1:19387', '[::1]:19387', '127.0.0.2:19387']) {
    assert.strictEqual(
      loopbackRequest(request('GET', `http://${authority}`, authority)),
      true,
      authority,
    )
  }
})

test('a page on ANOTHER loopback port cannot drive the write routes', () => {
  // The hole this closes (docs/issues/12, item 11). Any HTTP server the user
  // visits could have its JavaScript call /checkin — a real account mutation —
  // or /save. The browser blocks reading the RESPONSE cross-origin, but the side
  // effect has already happened by then, so the only place to stop it is here.
  const res = fakeRes()
  const request = { method: 'POST', headers: { origin: 'http://127.0.0.1:9999', host: '127.0.0.1:19387' } }
  assert.strictEqual(loopbackRequest(request), false, 'a different loopback port is not this origin')
  assert.strictEqual(originAllowed(request, res), false)
  assert.strictEqual(res.status, 403)
})

test('the same name on a different port, and the same port on another name, are both refused', () => {
  // Both directions, because the two are different mistakes: a proxy rewriting
  // Host, and a page reached by a name that resolves here.
  const cases = [
    ['http://127.0.0.1:9999', '127.0.0.1:19387'],
    ['http://localhost:9999', 'localhost:19387'],
    // Same port, different name: not the same origin, and the browser's own
    // same-origin policy would refuse to share a response either.
    ['http://127.0.0.1:19387', 'localhost:19387'],
    ['http://localhost:19387', '127.0.0.1:19387'],
    // IPv6 must be compared as a bracketed authority, not as a bare host.
    ['http://[::1]:9999', '[::1]:19387'],
  ]
  for (const [origin, host] of cases) {
    assert.strictEqual(
      loopbackRequest({ method: 'GET', headers: { origin, host } }),
      false,
      `${origin} vs Host ${host}`,
    )
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
    assert.strictEqual(loopbackRequest(request('GET', origin, '127.0.0.1:19387')), false, origin)
    const res = fakeRes()
    assert.strictEqual(originAllowed(request('GET', origin, '127.0.0.1:19387'), res), false, origin)
    assert.strictEqual(res.status, 403, origin)
    assert.deepStrictEqual(JSON.parse(res.body), { error: 'origin-not-trusted' })
  }
})

test('a request with no Host header falls back to the loopback test alone', () => {
  // HTTP/1.0 and some test doubles omit it. The loopback check has already run
  // at that point, so the most this can do is not make things stricter than the
  // rule intends — and a request that did not name a host cannot be shown to
  // have come from a different one.
  assert.strictEqual(
    loopbackRequest({ method: 'GET', headers: { origin: 'http://127.0.0.1:19387' } }),
    true,
  )
  // …but a non-loopback Origin is still refused even with no Host.
  assert.strictEqual(
    loopbackRequest({ method: 'GET', headers: { origin: 'http://example.com' } }),
    false,
  )
})

test('a non-string Origin header is refused, not coerced', () => {
  // `req.headers.origin` is typed as a string by Node, but a test double or an
  // unusual server can produce anything; the guard is `typeof`, not truthiness.
  for (const origin of [123, {}, [], true]) {
    assert.strictEqual(
      loopbackRequest({ method: 'GET', headers: { origin, host: '127.0.0.1:19387' } }),
      false,
      String(origin),
    )
  }
})

test('the loopback set treats the whole 127/8 range as this machine', () => {
  // `127.0.0.2` is loopback by definition, and a host can legitimately answer
  // on it; treating it as "somebody else" would be a rule that breaks on a
  // correct configuration rather than on an attack.
  for (const authority of ['127.0.0.1:1', '127.0.0.2:1', '127.1.2.3:1', '127.255.255.254:1']) {
    assert.strictEqual(isLoopbackAuthority(authority), true, authority)
  }
  // And the near-misses are not.
  for (const authority of ['128.0.0.1:1', '12.0.0.1:1', '10.0.0.1:1', '192.168.1.1:1', 'example.com:1', 'notlocalhost:1']) {
    assert.strictEqual(isLoopbackAuthority(authority), false, authority)
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

test('omitting the cap defers to readJsonBody, so the 64 KiB default is not shadowed', async () => {
  // The regression this pins: adding `= 1024 * 1024` to this layer's `maxBytes`
  // while giving it a type silently raised the body cap on both card POST routes
  // 16x. Nothing failed, because every other test here either passes an explicit
  // cap or sends a tiny body — the default itself was never asserted. A body
  // just under the real cap must pass, and one over it must be refused with
  // `readJsonBody`'s own number in the message.
  //
  // The filler has to be valid JSON, or the 400 would come from `JSON.parse`
  // instead of from the cap and the test would pass for the wrong reason. Size
  // is asserted on the Buffer, never on the character count: quoting the filler
  // is what makes "N characters" and "N bytes" disagree.
  const CAP = 64 * 1024
  const jsonOfBytes = (bytes) => {
    const prefix = '{"pad":"'
    const suffix = '"}'
    const body = Buffer.from(prefix + 'a'.repeat(bytes - prefix.length - suffix.length) + suffix, 'utf8')
    assert.strictEqual(body.length, bytes, `fixture must be exactly ${bytes} bytes`)
    return body
  }

  const under = fakeRes()
  const ok = await readJsonBodyOr400(bodyRequest([jsonOfBytes(CAP - 1)]), under)
  assert.strictEqual(ok.ok, true, 'a body under 64 KiB must still be accepted')

  const over = fakeRes()
  const refused = await readJsonBodyOr400(bodyRequest([jsonOfBytes(CAP + 1)]), over)
  assert.strictEqual(refused.ok, false)
  assert.strictEqual(over.status, 400)
  assert.match(
    JSON.parse(over.body).detail,
    /exceeds 65536 bytes/,
    "the cap that applies must be readJsonBody's own 64 KiB default, not a shadowing one",
  )
})

test('an empty body is still a success, because the reload route accepts it', async () => {
  // "No body" means "re-read every region" for the reload route, so it must not
  // be turned into a 400 by the guard.
  const res = fakeRes()
  const read = await readJsonBodyOr400(bodyRequest([]), res)
  assert.deepStrictEqual(read, { ok: true, body: undefined })
  assert.strictEqual(res.ended, false)
})
