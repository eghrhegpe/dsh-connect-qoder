/**
 * Tests for `src/client/http.ts` — the card's only `fetch` surface.
 *
 * Run: node --test test/client-http.test.js
 *
 * `getJson` / `postJson` are plain async functions over the global `fetch`, so
 * unlike the JSX card they can be imported into a bare `node --test` and driven
 * with a stubbed `fetch` — no jsdom, no bundle scraping, no mirror.
 *
 * The failure contract is the point here. A non-OK GET must surface the host's
 * OWN `error` field when the body carries one (the loopback origin check
 * answers `{ error: "origin-not-trusted" }`), because a bare "HTTP 403" hands
 * the user a status code and drops the diagnosis. A GET whose 200 body will
 * not parse must THROW — the reads that use it have no "no data" state to fall
 * back to.
 */
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import { getJson } from '../src/client/http.ts'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

/** Install a `fetch` stub answering every call from `handler`. */
function stubFetch(handler) {
  globalThis.fetch = (url, init) => handler(url, init)
}

const ok = (value) => ({ ok: true, status: 200, json: async () => value })

test('a non-OK GET throws the host\'s own error field, not a bare status', async () => {
  stubFetch(() => Promise.resolve({
    ok: false,
    status: 403,
    json: async () => ({ error: 'origin-not-trusted' }),
  }))
  await assert.rejects(
    () => getJson('/plugins/dsh-connect-qoder/models'),
    /origin-not-trusted/,
    'the host\'s diagnosis must survive to the card\'s catch block',
  )
})

test('a non-OK GET without an error field falls back to the status code', async () => {
  stubFetch(() => Promise.resolve({
    ok: false,
    status: 500,
    json: async () => ({}),
  }))
  await assert.rejects(() => getJson('/models'), /HTTP 500/)
})

test('a GET whose 200 body will not parse throws instead of degrading', async () => {
  stubFetch(() => Promise.resolve({
    ok: true,
    status: 200,
    json: async () => { throw new Error('not json') },
  }))
  await assert.rejects(
    () => getJson('/models'),
    /unparseable JSON body \(HTTP 200\)/,
    'a roster that cannot be read must be reported, not treated as empty',
  )
})

test('a successful GET returns the decoded answer with the credential flag', async () => {
  let seen
  stubFetch((url, init) => {
    seen = { url, init }
    return Promise.resolve(ok({ models: [] }))
  })
  const value = await getJson('/models')
  assert.deepEqual(value, { models: [] })
  assert.equal(seen.url, '/models')
  assert.equal(seen.init.credentials, 'same-origin')
  assert.equal(seen.init.headers.accept, 'application/json')
})
