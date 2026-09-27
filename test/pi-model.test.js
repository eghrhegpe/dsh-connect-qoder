/**
 * Tests for the pi-ai model descriptor.
 *
 * Run: node --test test/pi-model.test.js
 *
 * `toPiModel` builds a plain object — it touches no pi-ai API — but it lived in
 * a module whose top-level imports pull in `@earendil-works/pi-ai`, so nothing
 * could assert it. It carries two decisions whose failure mode is a total
 * outage rather than an error:
 *
 *   - `compat.supportsDeveloperRole: false`. Without it pi-ai resolves the flag
 *     by auto-detection, which returns true for anything that does not look
 *     like a known non-standard provider. This route's baseUrl is the loopback
 *     shim, so nothing matches. Every Qoder model declares `reasoning: true`, so
 *     pi-ai then emits `role: "developer"`, which Qoder does not have — and the
 *     gateway answers a request whose system message was dropped with
 *     `403 {"code":"10605"}` on every attempt, an error reading "your request is
 *     already in the queue" that has nothing to do with a queue.
 *   - the ABSENCE of `maxTokens`. A declared value becomes the model's output
 *     ceiling; reasoning shares that budget, so a long reasoned reply gets
 *     truncated mid-sentence and the harness reports `finish: max-tokens`.
 *
 * The first is asserted on the value; the second can only be asserted on its
 * absence, which is the whole point.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  FALLBACK_CONTEXT_WINDOW,
  NO_COST,
  contextWindowLabelFor,
  displayNameFor,
  formatContextWindow,
  imageEnabled,
  resolveContextWindow,
  thinkingLevelMapFor,
  toPiModel,
} from '../lib/pi-model.js'

const BASE_URL = 'http://127.0.0.1:51999/v1'
const NOW = new Date('2026-09-26T12:00:00+08:00') // midday: outside the window

const baseEntry = {
  id: 'GLM5.3',
  key: 'GLM',
  name: 'GLM 5.3',
  isVL: false,
  isReasoning: true,
  supportsEffort: true,
  alwaysThinking: false,
  effortLevels: ['low', 'medium', 'high'],
  maxInputTokens: 200000,
  defaultContextWindow: 128000,
  contextOptions: [128000, 200000, 1000000],
  priceFactor: 0.03,
  promotion: undefined,
}

/**
 * Build a descriptor with the common arguments filled in.
 *
 * `imageMode` and `preferMaximumContext` are named options rather than
 * positional ones: passing them through positionally after `now` is exactly the
 * kind of near-miss that makes a test assert the wrong thing.
 */
const model = (overrides = {}, { preferMaximumContext = false, imageMode = 'auto' } = {}) =>
  toPiModel({ ...baseEntry, ...overrides }, BASE_URL, 'qoder-cn', preferMaximumContext, imageMode, NOW)

// --- the two load-bearing decisions -------------------------------------

test('the system-prompt role is forced to system, not developer', () => {
  // The single most consequential field in the plugin. pi-ai decides the role
  // as `reasoning && compat.supportsDeveloperRole ? 'developer' : 'system'`,
  // so `undefined` is NOT neutral — pi-ai fills it in by auto-detection and
  // resolves it to true for this route.
  for (const entry of [baseEntry, { ...baseEntry, isReasoning: false }]) {
    const descriptor = toPiModel(entry, BASE_URL, 'qoder-cn')
    assert.strictEqual(
      descriptor.compat?.supportsDeveloperRole,
      false,
      'supportsDeveloperRole must be explicitly false, never undefined',
    )
    assert.ok(
      Object.prototype.hasOwnProperty.call(descriptor.compat ?? {}, 'supportsDeveloperRole'),
      'the key must be present: an absent key lets pi-ai auto-detect it as true',
    )
  }
})

test('no output ceiling is declared', () => {
  // Declaring one truncates long reasoned replies and the harness reports
  // `finish: max-tokens` with the visible text stopping mid-sentence.
  const descriptor = model()
  assert.strictEqual(
    descriptor.maxTokens,
    undefined,
    'a declared maxTokens truncates replies; it must be omitted so the harness applies its own',
  )
  assert.ok(
    !Object.prototype.hasOwnProperty.call(descriptor, 'maxTokens'),
    'the key must be absent, not merely undefined',
  )
})

test('the max-tokens field name is the snake_case one the endpoint expects', () => {
  // The complement of the omission above: when a ceiling IS supplied, pi-ai
  // must send it as `max_tokens`, not `max_completion_tokens`.
  assert.strictEqual(model().compat?.maxTokensField, 'max_tokens')
})

test('cost is reported as zero rather than invented', () => {
  // A subscription quota has no per-token price. Reporting zero reads as "this
  // turn cost nothing", which is the honest answer; a made-up figure would not be.
  assert.deepStrictEqual(model().cost, NO_COST)
  assert.strictEqual(model().cost.input, 0)
  assert.strictEqual(model().cost.output, 0)
})

// --- identity ------------------------------------------------------------

test('the id, key, provider and api are carried through', () => {
  const descriptor = model()
  assert.strictEqual(descriptor.id, 'GLM5.3', 'the id is what routing and the picker key on')
  assert.strictEqual(descriptor.provider, 'qoder-cn')
  assert.strictEqual(descriptor.api, 'openai-completions')
  assert.strictEqual(descriptor.baseUrl, BASE_URL)
  assert.strictEqual(
    descriptor.upstreamKey,
    'GLM',
    'the shim needs the Qoder-side key, which differs from the display id',
  )
})

test('the decorated name does not disturb the id', () => {
  // The multiplier rides in the NAME because listModels forwards only id, name
  // and modalities. If the id were decorated too, every join that keys on it
  // would break silently.
  const descriptor = model()
  assert.strictEqual(descriptor.id, 'GLM5.3')
  assert.notStrictEqual(descriptor.id, descriptor.name)
  assert.match(descriptor.name, /^GLM 5\.3/)
})

// --- context window ------------------------------------------------------

test('the context window comes from the catalog default, not the input floor', () => {
  // `max_input_tokens` is a per-request floor, not the advertised capacity;
  // using it would undersize the context DSH packs.
  assert.strictEqual(resolveContextWindow(baseEntry, false), 128000)
})

test('the maximum-context switch advertises the largest offered window', () => {
  assert.strictEqual(resolveContextWindow(baseEntry, true), 1000000)
})

test('the maximum is not clamped to max_input_tokens', () => {
  // 1M is what the Qoder client itself offers and the gateway accepts it.
  assert.strictEqual(resolveContextWindow(baseEntry, true), 1000000)
  assert.ok(1000000 > baseEntry.maxInputTokens)
})

test('context resolution degrades through the declared fallbacks', () => {
  assert.strictEqual(
    resolveContextWindow({ ...baseEntry, contextOptions: undefined, defaultContextWindow: 0 }, true),
    200000,
    'with no offered windows the input floor is used',
  )
  assert.strictEqual(
    resolveContextWindow({ ...baseEntry, defaultContextWindow: 0, maxInputTokens: 0 }, false),
    FALLBACK_CONTEXT_WINDOW,
    'with nothing declared at all, the built-in fallback applies',
  )
})

test('non-numeric and non-positive window values are ignored', () => {
  // The catalog is remote input; a string or a zero must not become a
  // contextWindow that DSH then sizes requests from.
  assert.strictEqual(
    resolveContextWindow({ ...baseEntry, defaultContextWindow: 'lots', contextOptions: [0, -1] }, false),
    200000,
  )
  assert.strictEqual(resolveContextWindow({ ...baseEntry, defaultContextWindow: 0, maxInputTokens: 'x' }, false), FALLBACK_CONTEXT_WINDOW)
})

test('formatContextWindow matches the catalog naming for K/M sizes', () => {
  assert.strictEqual(formatContextWindow(1000000), '1M')
  assert.strictEqual(formatContextWindow(200000), '200K')
  assert.strictEqual(formatContextWindow(128000), '128K')
  assert.strictEqual(formatContextWindow(0), '')
  assert.strictEqual(formatContextWindow(NaN), '')
})

test('the window label is empty when upstream declared no selectable windows', () => {
  // `max_input_tokens` and the built-in fallback are local degradation values,
  // not windows Qoder offers; showing them as a label would claim a choice
  // that does not exist.
  const bare = { ...baseEntry, defaultContextWindow: 0, contextOptions: [] }
  assert.strictEqual(contextWindowLabelFor(bare, true), '')
  assert.strictEqual(contextWindowLabelFor(bare, false), '')
})

test('the window label is the maximum or default window depending on the switch', () => {
  assert.strictEqual(contextWindowLabelFor(baseEntry, false), '128K')
  assert.strictEqual(contextWindowLabelFor(baseEntry, true), '1M')
})

// --- image input ---------------------------------------------------------

test('image input follows the catalog flag by default', () => {
  assert.deepStrictEqual(imageEnabled({ isVL: true }, 'auto'), true)
  assert.deepStrictEqual(imageEnabled({ isVL: false }, 'auto'), false)
  assert.deepStrictEqual(model({ isVL: true }).input, ['text', 'image'])
  assert.deepStrictEqual(model({ isVL: false }).input, ['text'])
})

test('the user can force image input on or off against the catalog', () => {
  assert.strictEqual(imageEnabled({ isVL: false }, 'on'), true, 'a mislabelled model can be turned on')
  assert.strictEqual(imageEnabled({ isVL: true }, 'off'), false, 'a rejected-by-endpoint model can be turned off')
  assert.deepStrictEqual(model({ isVL: true }, { imageMode: 'off' }).input, ['text'])
})

test('an unrecognised image mode degrades to auto, never to off', () => {
  // A stale saved value must not silently drop a capability. Defaulting to
  // "off" would turn images off for every model after a settings format change.
  assert.strictEqual(imageEnabled({ isVL: true }, 'nonsense'), true)
  assert.strictEqual(imageEnabled({ isVL: false }, 'nonsense'), false)
  assert.strictEqual(imageEnabled({ isVL: true }, undefined), true)
})

// --- thinking map --------------------------------------------------------

test('a reasoning model gets a thinking map with only the levels it offers', () => {
  const map = thinkingLevelMapFor(baseEntry)
  assert.strictEqual(map.off, 'off', 'it can be switched off')
  assert.strictEqual(map.low, 'low')
  assert.strictEqual(map.high, 'high')
  assert.strictEqual(map.xhigh, null, 'a level the catalog does not list is null, not invented')
  assert.strictEqual(map.max, null)
  assert.strictEqual(map.minimal, null)
})

test('a model that always thinks reports off as unsupported', () => {
  // Offering `off` here would be offering something the gateway rejects with
  // provider_error 1210. The picker must not present a choice that fails.
  const map = thinkingLevelMapFor({ ...baseEntry, alwaysThinking: true })
  assert.strictEqual(map.off, null, 'a model that always thinks must not offer "off"')
  assert.strictEqual(map.high, 'high', 'but the other levels still work')
})

test('a non-reasoning model gets no thinking map at all', () => {
  // An all-null map would show thinking controls for a model that has none.
  assert.strictEqual(thinkingLevelMapFor({ ...baseEntry, isReasoning: false }), undefined)
  assert.ok(!('thinkingLevelMap' in model({ isReasoning: false })), 'the key must be absent')
  assert.strictEqual(model({ isReasoning: false }).reasoning, false)
})

// --- displayed name ------------------------------------------------------

test('a zero multiplier reads as free rather than x0.00', () => {
  const entry = { ...baseEntry, priceFactor: 0, isFree: true }
  assert.strictEqual(displayNameFor(entry, NOW), 'GLM 5.3 · 免费')
})

test('a paid model shows its multiplier to two decimals', () => {
  assert.strictEqual(displayNameFor({ ...baseEntry, priceFactor: 0.05 }, NOW), 'GLM 5.3 · x0.05')
  assert.strictEqual(displayNameFor({ ...baseEntry, priceFactor: 1.234 }, NOW), 'GLM 5.3 · x1.23')
})

test('an entry with no usable multiplier keeps its bare name', () => {
  // `NaN` from rateNow means nothing was declared; decorating it would show
  // "xNaN" in the picker.
  assert.strictEqual(displayNameFor({ ...baseEntry, priceFactor: 'abc' }, NOW), 'GLM 5.3')
})

test('the off-peak window is marked in the name', () => {
  // The rate changes at 22:00 on its own; without the marker a number that
  // changes by itself looks like a bug.
  const entry = {
    ...baseEntry,
    priceFactor: 0.03,
    promotion: {
      active: true,
      windowStart: '22:00',
      windowEnd: '08:00',
      timezone: 'Asia/Shanghai',
      discountFactor: 0.4,
      beforePromotionPriceFactor: 0.025,
    },
  }
  assert.match(displayNameFor(entry, new Date('2026-09-26T23:30:00+08:00')), /错峰$/)
  assert.ok(!displayNameFor(entry, NOW).includes('错峰'), 'midday is outside the window')
})
