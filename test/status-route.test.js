/**
 * The status route's answer: the one surface that distinguishes "this host
 * serves no such route" from "this plugin failed while activating".
 *
 * Run: node --test test/status-route.test.js
 *
 * WHY THIS FILE EXISTS
 *
 * `test/activation-gate-decoupling.test.js` guards that a failed provider
 * registration no longer unwinds activation, so the card routes stay mounted.
 * That file asserts the WIRING as source text, because `index.ts` cannot be
 * imported (Cordis peers at module scope). This file covers the other half:
 * `statusHandler` itself, which IS importable and therefore exercised for real.
 *
 * The property worth pinning is the status code. A 5xx here would re-collapse
 * the two states the route exists to separate — a card that can only render a
 * response would show the same "读取失败" for a failed activation as for a host
 * that never served the route. The answer IS the status, so it is always 200
 * once the route is reachable.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { statusHandler } from '../src/host/handlers.ts'

function fakeReq({ method = 'GET', url = '/', origin, host = '127.0.0.1:19387' } = {}) {
  const req = new EventEmitter()
  req.method = method
  req.url = url
  req.headers = { ...(origin === undefined ? {} : { origin }), host }
  req.destroy = () => { req.destroyed = true }
  return req
}

function fakeRes(req) {
  const bodies = []
  const out = { status: null, headers: null }
  const res = {
    req,
    writeHead: (status, headers) => {
      out.status = status
      out.headers = headers
    },
    end: (payload) => {
      if (payload !== undefined) bodies.push(payload)
    },
  }
  return { res, out, bodies }
}

function lastJson({ bodies }) {
  assert.ok(bodies.length > 0, 'the handler sent no body')
  return JSON.parse(bodies.at(-1))
}

test('a healthy activation answers 200 with providerRegistration.ok true', async () => {
  const req = fakeReq()
  const { res, out, bodies } = fakeRes(req)
  await statusHandler(req, res, { startedCount: 2 })
  assert.strictEqual(out.status, 200)
  const json = lastJson({ bodies })
  assert.strictEqual(json.activated, true)
  assert.strictEqual(json.startedRegions, 2)
  assert.deepStrictEqual(json.providerRegistration, { ok: true })
})

test('a failed provider registration answers 200, not 5xx, with the failure kind attached', async () => {
  const req = fakeReq()
  const { res, out, bodies } = fakeRes(req)
  await statusHandler(req, res, {
    startedCount: 1,
    providerRegistrationError: new TypeError("Cannot read properties of undefined (reading 'effect')"),
  })
  // A 5xx would make this indistinguishable from the route being absent, which
  // is the ambiguity the route was added to remove.
  assert.strictEqual(out.status, 200)
  const json = lastJson({ bodies })
  assert.strictEqual(json.activated, false)
  assert.strictEqual(json.providerRegistration.ok, false)
  assert.strictEqual(json.providerRegistration.errorName, 'TypeError')
})

test('the published error is a name only — the message never reaches the card', async () => {
  const req = fakeReq()
  const { res, bodies } = fakeRes(req)
  // `describeThrown` returns the message verbatim, and a thrown value can carry
  // a credential-bearing URL. This surface is browser-visible, so the message
  // stays in the host log and only the name is published.
  const secret = 'https://example.invalid/?token=SUPERSECRETVALUE'
  await statusHandler(req, res, { startedCount: 0, providerRegistrationError: new Error(secret) })
  const json = lastJson({ bodies })
  assert.ok(!JSON.stringify(json).includes('SUPERSECRETVALUE'), 'the raw error text leaked to the card')
  assert.strictEqual(json.providerRegistration.errorName, 'Error')
})

test('a non-GET method is refused without reporting activation state', async () => {
  const req = fakeReq({ method: 'POST' })
  const { res, out, bodies } = fakeRes(req)
  await statusHandler(req, res, { startedCount: 1 })
  // `methodAllowed` answers the refusal itself (405 + Allow), so the status is
  // not 200 and no activation state is published either way.
  assert.notStrictEqual(out.status, 200)
  assert.ok(!bodies.some((body) => String(body).includes('providerRegistration')))
})
