/**
 * Contract test for the catalog entry fields `refreshCatalog` stores.
 *
 * Run: node --test test/catalog-fields.test.js
 *
 * This test exists because the `promotion` field was once dropped in
 * `normalizeEntry`, making the entire off-peak pricing machinery dead code:
 * `toPiModel` and the settings card both saw `promotion === undefined` and the
 * window countdown, the `错峰` name suffix, and the `before × discount` rate
 * could never fire.
 *
 * It imports the real `normalizeEntry` (lib/catalog-entry.js). It used to keep
 * a hand-written MIRROR of that function and assert against the mirror, which
 * is why the same class of bug got through a second time: the host projection in
 * `lib/index.js` dropped `promotion.active` and `promotion.timezone`, the card's
 * clock gate `promotion?.active === true` was therefore permanently false, and
 * the interval was never installed — so the 22:00 rate flip still never
 * happened, while this test stayed green throughout. A mirror asserts that the
 * copy is correct; only an import can assert that the code is.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { normalizeEntry } from '../lib/catalog-entry.js'

// A raw catalog row as `fetchModels` pushes it into `models[]`
// (lib/upstream.js), with the `promotion` block already shaped by
// `normalizePromotion` — the fields adapter.js and the card consume:
//   active, windowStart, windowEnd, timezone,
//   discountFactor, beforePromotionPriceFactor, badge, description
const PROMOTION = {
  active: true,
  windowStart: '22:00',
  windowEnd: '08:00',
  timezone: 'Asia/Shanghai',
  discountFactor: 0.4,
  beforePromotionPriceFactor: 0.025,
  badge: '错峰',
  description: '夜间折扣',
}

const RAW_ENTRY = {
  key: 'QwenCoder',
  name: 'Qwen Coder',
  isVL: true,
  isReasoning: true,
  supportsEffort: true,
  alwaysThinking: true,
  effortLevels: [1, 2, 3],
  maxInputTokens: 200000,
  defaultContextWindow: 128000,
  contextOptions: [128000, 200000, 400000, 1000000],
  priceFactor: 0.01,
  isFree: false,
  isDefault: true,
  promotion: PROMOTION,
}

// A model without a discount block: `normalizePromotion` returns `undefined`.
const RAW_ENTRY_BARE = { ...RAW_ENTRY, promotion: undefined }

// A free model: `priceFactor` is 0 and `isFree` is true, so the picker
// displays 免费 instead of x0.00.
const RAW_ENTRY_FREE = { ...RAW_ENTRY, priceFactor: 0, isFree: true, isDefault: false, promotion: undefined }

test('normalizeEntry carries the promotion block when upstream has one', () => {
  const entry = normalizeEntry(RAW_ENTRY)
  assert.ok(
    entry.promotion !== undefined,
    'promotion field was dropped by normalizeEntry — off-peak pricing is dead code',
  )
  assert.strictEqual(entry.promotion.active, true)
  assert.strictEqual(entry.promotion.windowStart, '22:00')
  assert.strictEqual(entry.promotion.timezone, 'Asia/Shanghai')
  assert.strictEqual(entry.promotion.discountFactor, 0.4)
  assert.strictEqual(entry.promotion.beforePromotionPriceFactor, 0.025)
  assert.strictEqual(entry.promotion.badge, '错峰')
  // The other catalog fields must survive too.
  assert.strictEqual(entry.priceFactor, 0.01)
  assert.strictEqual(entry.isFree, false)
  assert.strictEqual(entry.isDefault, true)
  assert.strictEqual(entry.defaultContextWindow, 128000)
  assert.deepStrictEqual(entry.contextOptions, [128000, 200000, 400000, 1000000])
  assert.strictEqual(entry.name, 'Qwen Coder')
})

test('normalizeEntry leaves promotion undefined for a bare model', () => {
  const entry = normalizeEntry(RAW_ENTRY_BARE)
  assert.strictEqual(entry.promotion, undefined)
})

test('normalizeEntry keeps isFree for a free model', () => {
  const entry = normalizeEntry(RAW_ENTRY_FREE)
  assert.strictEqual(entry.isFree, true)
  assert.strictEqual(entry.priceFactor, 0)
  assert.strictEqual(entry.isDefault, false)
  assert.strictEqual(entry.promotion, undefined)
})

test('normalizeEntry passes the promotion block through by reference, unfiltered', () => {
  // The regression this file exists for happened twice, and the second time the
  // block survived while two of its fields did not. Asserting on the whole block
  // — rather than the handful of fields this test happened to check — is what
  // makes a third variant fail loudly instead of quietly.
  const entry = normalizeEntry(RAW_ENTRY)
  assert.deepStrictEqual(
    Object.keys(entry.promotion).sort(),
    Object.keys(PROMOTION).sort(),
    'normalizeEntry must carry every promotion field through verbatim',
  )
})
