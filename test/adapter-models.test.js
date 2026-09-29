/**
 * Tests for the model list one region offers DSH.
 *
 * Run: node --test test/adapter-models.test.js
 *
 * This is the model list DSH's picker is built from, and it was previously
 * inside `createQoderAdapter` — which no test can import, because it pulls in
 * pi-ai (docs/KNOWN_GAPS.md item 1（`adapter.js` 的 Cordis 接线与 profile 构造）).
 * So every curation decision the user makes — the per-region switch, the
 * allow-list, the maximum-context preference, the per-model image mode — was
 * made in code with no test over it, in a file outside the coverage
 * denominator entirely.
 *
 * All four failures are silent, which is why they are worth pinning here rather
 * than assumed:
 *
 * - a region switch that stops switching hides a provider with no error;
 * - a filter that stops filtering offers models the user deliberately unticked;
 * - a context preference that is ignored is invisible until someone notices the
 *   picker disagreeing with the card;
 * - an image mode that is dropped makes every image request fail with
 *   UNSUPPORTED_CONTENT instead of an obviously wrong model list.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildModelsFor } from '../lib/adapter-models.js'
import { normalizeEntry } from '../lib/catalog-entry.js'

const REGION = { id: 'qoder-cn', displayName: 'Qoder CN' }
const BASE = 'http://127.0.0.1:1234/v1'

const entry = (key, overrides = {}) =>
  normalizeEntry({
    key,
    name: key,
    priceFactor: 0.01,
    defaultContextWindow: 128000,
    contextOptions: [128000, 200000],
    ...overrides,
  })

const runtimeOf = (entries) => ({ region: REGION, catalog: () => entries })

/** The default options, overridable per case. */
const options = (overrides = {}) => ({
  baseUrl: BASE,
  preferMaximumContext: false,
  enabledIds: [],
  regionEnabled: true,
  imageModeFor: () => 'auto',
  ...overrides,
})

test('every catalog entry is offered when nothing is filtered', () => {
  const models = buildModelsFor(runtimeOf([entry('A'), entry('B')]), options())
  assert.strictEqual(models.length, 2)
  // The base URL is what routes the request to the region's own shim, so it is
  // part of the contract, not an implementation detail — a model that carried
  // the wrong one would be dispatched to a provider this plugin does not serve.
  for (const model of models) {
    assert.strictEqual(model.baseUrl, BASE)
    assert.strictEqual(model.provider, REGION.id, 'each model is tagged with the region that serves it')
  }
})

test('a switched-off region offers nothing', () => {
  // Returning the empty list is what makes DSH hide the group's model list.
  // Asserting it is what pins "hidden" against "offers models nobody can route".
  const models = buildModelsFor(runtimeOf([entry('A')]), options({ regionEnabled: false }))
  assert.deepStrictEqual(models, [])
})

test('only an explicit `true` switches a region on', () => {
  // This switch decides whether a provider is published at all, so an absent or
  // malformed value must not be read as on: a default-on would offer a region
  // the user turned off, and it would be the harder failure to notice because
  // the models do work.
  for (const regionEnabled of [false, undefined, null, 0, 1, 'true', {}]) {
    const models = buildModelsFor(runtimeOf([entry('A')]), options({ regionEnabled }))
    assert.deepStrictEqual(models, [], `regionEnabled=${JSON.stringify(regionEnabled)}`)
  }
})

test('an empty allow-list means no filter, not no models', () => {
  // The fresh-install case: nothing saved yet, and every model must still be
  // offered. Reading `[]` as "hide all" would make a new profile look empty.
  const models = buildModelsFor(runtimeOf([entry('A'), entry('B')]), options({ enabledIds: [] }))
  assert.strictEqual(models.length, 2)
})

test('a non-empty allow-list offers only what it names', () => {
  const models = buildModelsFor(runtimeOf([entry('A'), entry('B'), entry('C')]), options({
    enabledIds: [entry('B').id],
  }))
  assert.strictEqual(models.length, 1)
})

test('the maximum-context switch reaches the projected model', () => {
  const entries = [entry('A')]
  const off = buildModelsFor(runtimeOf(entries), options({ preferMaximumContext: false }))
  const on = buildModelsFor(runtimeOf(entries), options({ preferMaximumContext: true }))
  assert.notStrictEqual(
    JSON.stringify(off[0]),
    JSON.stringify(on[0]),
    'preferMaximumContext must change the projected model — it is the whole point of the switch',
  )
  // And the switch is a boolean, not a truthy value.
  const truthy = buildModelsFor(runtimeOf(entries), options({ preferMaximumContext: 'yes' }))
  assert.deepStrictEqual(truthy, off, 'a non-boolean must behave as off, matching resolvePreferences')
})

test('the per-model image mode is passed through per model', () => {
  // The image mode is a per-model decision, so a shared answer across models
  // would be wrong; and it is read by id, so the right id must be the one asked.
  const asked = []
  const models = buildModelsFor(runtimeOf([entry('A'), entry('B')]), options({
    imageModeFor: (id) => {
      asked.push(id)
      return id === 'A' ? 'off' : 'on'
    },
  }))
  assert.strictEqual(models.length, 2)
  assert.deepStrictEqual(asked, ['A', 'B'], 'asked once per model, by id')
  assert.notDeepStrictEqual(models[0], models[1], 'a different image mode must reach a different model')
})

test('an empty catalog yields an empty list, not a throw', () => {
  // A signed-out or retired region has an empty catalog; that is how DSH hides
  // the group before the switch is even consulted.
  assert.deepStrictEqual(buildModelsFor(runtimeOf([]), options()), [])
})

test('a runtime whose catalog throws is not caught here', () => {
  // The catalog is in-memory state owned by the same process, so a throw from
  // it is a bug rather than an expected condition, and swallowing it here would
  // turn a crash into a silently empty model group — the exact "empty means
  // hidden" rule then hiding a provider for a reason nobody can see.
  assert.throws(
    () => buildModelsFor({ region: REGION, catalog: () => { throw new Error('boom') } }, options()),
    /boom/,
  )
})
