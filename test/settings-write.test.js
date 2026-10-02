/**
 * Tests for the card's settings write-through (src/client/settings-write.ts).
 *
 * Run: node --test test/settings-write.test.js
 *
 * WHY THIS FILE EXISTS
 *
 * `writeSettingsField` decides whether a save is CONFIRMED (the host endpoint
 * read the value back out of the document), UNCONFIRMED (the endpoint was
 * absent — an HTTP 404, a host that predates `__save` — and only the settings
 * scope's own snapshot saw it), or a hard FAILURE (the endpoint definitively
 * refused: 503 settings service unavailable, 500, 400, or a read-back
 * mismatch).
 *
 * The P0 defect this guards is docs/issues/06: a refused save (the 503 that
 * was once unreachable) used to fall through to the scope snapshot and show a
 * false "已保存". It is now a thrown failure the card renders as a failed save;
 * only a genuine 404 degrades, and even then it returns an unconfirmed marker
 * rather than a clean save.
 *
 * `saveFieldViaHost` is not exported, so this drives `writeSettingsField` with a
 * stubbed global `fetch` and a hand-built settings scope — the two and only
 * dependencies the module reads.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { writeSettingsField } from '../src/client/settings-write.ts'

/**
 * A settings scope.
 *
 * `set` records every call, and its deliverability / throwing is configurable so
 * a test can model "the scope settled" vs "the scope rejected". `getSnapshot`
 * answers with what `set` stored, which is what the unconfirmed read-back reads.
 */
function makeScope({ stored = {}, setDelivers = true, setThrows = false } = {}) {
  const scope = {
    stored: { ...stored },
    setCalls: [],
    async set(field, value) {
      this.setCalls.push({ field, value })
      if (setThrows) throw new Error('scope.set rejected')
      if (setDelivers === false) return false
      this.stored[field] = value
      return true
    },
    getSnapshot() {
      return { value: this.stored }
    },
  }
  return scope
}

/** A fetch that answers the save endpoint with a fixed status + JSON body. */
function stubFetchResponse(status, body) {
  globalThis.fetch = async () => ({
    ok: status >= 200 && status < 400,
    status,
    json: async () => body,
  })
}

/** A fetch that throws, as a genuinely unreachable host would. */
function stubFetchUnreachable() {
  globalThis.fetch = async () => {
    throw new Error('network down')
  }
}

test('a confirmed host write returns the authoritative value, not a marker', async () => {
  const scope = makeScope({ stored: { imageOverrides: {} } })
  stubFetchResponse(200, { ok: true, value: { M: 'off' }, readBack: { M: 'off' } })

  const result = await writeSettingsField(scope, 'imageOverrides', { M: 'off' })

  // A confirmed save is the endpoint's value itself — NOT an unconfirmed marker.
  assert.deepStrictEqual(result, { M: 'off' })
  assert.strictEqual(result && result.unconfirmed, undefined, 'a confirmed write carries no marker')
  // The endpoint already persisted it, so the scope write is a mirror and ran.
  assert.ok(scope.setCalls.length >= 1, 'the mirror scope.set runs after a confirmed write')
})

test('a 503 (settings service unavailable) is a hard failure, not a false "已保存"', async () => {
  // The whole point of docs/issues/06: the endpoint exists and says the value
  // did not persist. The scope snapshot must NOT paper over it.
  const scope = makeScope({ stored: { imageOverrides: {} } })
  stubFetchResponse(503, { error: 'settings service unavailable to this fiber' })

  await assert.rejects(
    () => writeSettingsField(scope, 'imageOverrides', { M: 'off' }),
    (error) => {
      assert.strictEqual(error.name, 'QoderSettingsWriteError')
      assert.strictEqual(error.kind, 'refused', 'a 503 must be a refused save, not an unconfirmed one')
      assert.match(error.message, /503|settings service unavailable|refused/)
      return true
    },
  )
  // No scope fallback ran: a definitive refusal is not degraded to the snapshot.
  assert.deepStrictEqual(
    scope.setCalls,
    [],
    'a 503 must not fall back to the settings scope — that would be the false "已保存"',
  )
})

test('a read-back mismatch (200 ok:false) is also a hard failure', async () => {
  const scope = makeScope({ stored: { imageOverrides: {} } })
  stubFetchResponse(200, { ok: false, errorName: 'read-back-mismatch', error: 'did not land', value: { M: 'off' }, readBack: { M: 'on' } })

  await assert.rejects(
    () => writeSettingsField(scope, 'imageOverrides', { M: 'off' }),
    (error) => {
      assert.strictEqual(error.kind, 'refused')
      assert.match(error.message, /read-back mismatch|did not land/)
      return true
    },
  )
})

test('an unreachable endpoint (network) is a failure, not an unconfirmed save', async () => {
  // A downed web server is not the 404 "host without the route" case: it cannot
  // confirm anything, so the degraded scope path is not owed to it.
  const scope = makeScope({ stored: { imageOverrides: {} } })
  stubFetchUnreachable()

  await assert.rejects(
    () => writeSettingsField(scope, 'imageOverrides', { M: 'off' }),
    (error) => {
      assert.strictEqual(error.name, 'QoderSettingsWriteError')
      assert.strictEqual(error.kind, 'refused')
      return true
    },
  )
  assert.deepStrictEqual(scope.setCalls, [], 'an unreachable endpoint takes no scope fallback')
})

test('a 404 with a delivering scope returns the unconfirmed marker', async () => {
  // The legacy path: the host does not serve the route at all. The scope is the
  // only writer, and it delivers + reads back consistently — but only IT saw the
  // value, so the result is a marker, never a clean save.
  const scope = makeScope({ stored: { imageOverrides: {} } })
  stubFetchResponse(404, { error: 'Not Found' })

  const result = await writeSettingsField(scope, 'imageOverrides', { M: 'off' })

  assert.ok(result && typeof result === 'object', 'the 404 fallback returns an object marker')
  assert.strictEqual(result.unconfirmed, true, 'a 404 save must be flagged unconfirmed')
  assert.deepStrictEqual(result.value, { M: 'off' })
})

test('a 404 whose scope does not deliver is a hard failure', async () => {
  const scope = makeScope({ stored: { imageOverrides: {} }, setDelivers: false })
  stubFetchResponse(404, { error: 'Not Found' })

  await assert.rejects(
    () => writeSettingsField(scope, 'imageOverrides', { M: 'off' }),
    (error) => error.name === 'QoderSettingsWriteError',
  )
})

test('the 404 fallback keeps the sibling region for the per-region field', async () => {
  // `enabledModelIds` is per-region: the scope mirror must preserve the regions
  // the card did not edit, and the read-back confirms "all posted regions equal".
  const scope = makeScope({ stored: { enabledModelIds: { 'qoder-cn': ['A'], qoder: ['B', 'C'] } } })
  stubFetchResponse(404, { error: 'Not Found' })

  const result = await writeSettingsField(scope, 'enabledModelIds', { 'qoder-cn': ['A', 'D'] })

  assert.strictEqual(result.unconfirmed, true)
  assert.deepStrictEqual(
    result.value,
    { 'qoder-cn': ['A', 'D'], qoder: ['B', 'C'] },
    'the unconfirmed value must keep the sibling region the card did not touch',
  )
})
