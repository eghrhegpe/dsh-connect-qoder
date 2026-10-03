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
 * It imports the real `normalizeEntry` (src/host/catalog-entry.ts). It used to keep
 * a hand-written MIRROR of that function and assert against the mirror, which
 * is why the same class of bug got through a second time: the host projection in
 * `src/host/index.ts` dropped `promotion.active` and `promotion.timezone`, the card's
 * clock gate `promotion?.active === true` was therefore permanently false, and
 * the interval was never installed — so the 22:00 rate flip still never
 * happened, while this test stayed green throughout. A mirror asserts that the
 * copy is correct; only an import can assert that the code is.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { normalizeEntry, projectModelRow } from '../src/host/catalog-entry.ts'
import { HIDE_ALL_MODELS } from '../src/host/preferences.ts'
import { displayNameFor } from '../src/host/pi-model.ts'
import { effectiveRate, isOffPeakActive, offPeakRemaining } from '../src/host/offpeak.ts'
import { fetchModels } from '../src/host/upstream.ts'
import { rateAt, rateLabelOf } from '../src/client/card-model.ts'

const REGION = { id: 'qoder-cn', displayName: 'Qoder CN' }
/** A fixed instant: the rate is time-dependent, so the clock is not real. */
const AT = new Date('2026-10-03T14:00:00+08:00')
/** The region `fetchModels` signs against; the stub ignores the URL itself. */
const CN_REGION = { id: 'qoder-cn', displayName: 'Qoder CN', baseUrl: 'https://openapi.qoder.com.cn/' }
const CREDENTIAL = { userID: 'u-test', token: 'tok-test', name: 'n', email: 'e@x', machineID: 'm' }

// A raw catalog row as `fetchModels` pushes it into `models[]`
// (src/host/upstream.ts), with the `promotion` block already shaped by
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

test('no model can ever be minted with the id that means "hide all"', () => {
  // The `__hide-all__` sentinel in a region's allow-list means "show nothing",
  // and the whole mechanism rests on no real model id equalling it. Today that
  // holds because Qoder's display names are things like "GLM 5.3", but it was an
  // ASSUMPTION about the catalog rather than a property of the code — and a
  // collision would be silent in the worst way: one model's row would behave as
  // "hide all", and un-ticking it would drop the marker and show every model.
  //
  // The guard therefore sits where ids are minted, and it renames rather than
  // drops: hiding a real model would be worse than giving it an id the user
  // never sees (the picker shows the display name).
  const hostile = normalizeEntry({ key: 'X', name: '__hide-all__', priceFactor: 0.01 })
  assert.notStrictEqual(
    hostile.id,
    HIDE_ALL_MODELS,
    'a model whose display name is the sentinel must be renamed, not collide',
  )
  assert.strictEqual(hostile.name, '__hide-all__', 'and it must still be a usable model')
  // The ordinary path is untouched — a suffix on every id would break every
  // allow-list users have already saved.
  assert.strictEqual(normalizeEntry({ key: 'A', name: 'GLM 5.3' }).id, 'GLM5.3')
})

/**
 * The chain tests.
 *
 * Everything above asserts what `normalizeEntry` STORES. These assert what the
 * stored value becomes in the two places a person actually reads a rate: the
 * model picker's name (`displayNameFor`) and the settings card's row
 * (`projectModelRow` → the card's `rateAt` → `rateLabelOf`).
 *
 * That link is the one no test held. `pi-model.test.js` has a case "an entry
 * with no usable multiplier keeps its bare name" that passes `priceFactor:
 * 'abc'` STRAIGHT to `displayNameFor`, so it proved the formatter tolerates
 * garbage while `normalizeEntry` was busy turning that same garbage into `0` —
 * the state the formatter has a branch for never arrived, and the assertion
 * could not fail. A test that hand-builds the input at the last hop cannot see
 * a defect at the first one.
 */
const RATES = { rateNow: effectiveRate, offPeakActive: isOffPeakActive, offPeakRemaining }

test('a model whose price_factor the upstream does not send shows NO rate, not 免费', () => {
  // The defect: `Number(x) || 0` made "absent" and "declared zero" the same
  // value, and `factor <= 0` renders as 免费. So a renamed or dropped
  // `price_factor` — the upstream changing a field name, the exact class of
  // drift this plugin has been bitten by before — presented every affected
  // model as confidently free. Being wrong about a price is worse than saying
  // nothing, which is issue 16's rule in one line.
  const absent = normalizeEntry({ key: 'GLM53', name: 'GLM 5.3' })
  assert.strictEqual(absent.priceFactor, undefined, 'absence must survive normalization')

  assert.strictEqual(
    displayNameFor(absent, AT),
    'GLM 5.3',
    'the picker must keep the bare name rather than claim 免费',
  )

  const row = projectModelRow(absent, REGION, AT, RATES)
  assert.strictEqual(row.priceFactor, undefined, 'and the card row must not carry a manufactured 0')
  // The card resolves `rateAt` against its own clock and reads `priceFactor`.
  // `undefined` inside the payload arrives as a missing key (JSON drops it), so
  // the card's `Number(undefined)` is NaN and `rateAt` answers undefined — the
  // row shows no rate instead of a free badge.
  assert.strictEqual(rateAt(row, AT), undefined, 'the card must read "no rate" from the row')
  assert.strictEqual(rateLabelOf((k) => k, rateAt(row, AT)), undefined, 'and render no label')
})

test('a model the upstream really does price at zero still reads 免费', () => {
  // The other half: this fix must not turn a genuine free model into a blank.
  // A declared 0 is a fact; a missing field is a gap. Both survive now, and only
  // the second is silent.
  const free = normalizeEntry({ key: 'FreeModel', name: 'Free Model', priceFactor: 0, isFree: true })
  assert.strictEqual(free.priceFactor, 0, 'a declared zero is kept — it is a value, not a gap')
  assert.strictEqual(displayNameFor(free, AT), 'Free Model · 免费')
  // `rateLabelOf` answers a translation KEY, not the translated text — the key
  // is what makes the card's two locales agree, so asserting the key is the
  // point (the English/Chinese text lives in copy-row.ts).
  assert.strictEqual(rateLabelOf((key) => key, rateAt(free, AT)), 'row.rateFree')
})

test('a non-numeric price_factor is treated as absent rather than as free', () => {
  // `Number('abc')` is NaN; `NaN || 0` is 0, which is how a typo in the upstream
  // became a free model. It must read as "no rate" instead.
  const bogus = normalizeEntry({ key: 'GLM53', name: 'GLM 5.3', priceFactor: 'abc' })
  assert.strictEqual(bogus.priceFactor, undefined)
  assert.strictEqual(displayNameFor(bogus, AT), 'GLM 5.3')
})

test('a paid model is unaffected by the absence rule', () => {
  // The guard against over-correcting: an ordinary multiplier must still be
  // carried and still be shown.
  const paid = normalizeEntry({ key: 'GLM53', name: 'GLM 5.3', priceFactor: 0.05 })
  assert.strictEqual(paid.priceFactor, 0.05)
  assert.strictEqual(displayNameFor(paid, AT), 'GLM 5.3 · x0.05')
})

test('every path that mints a catalog entry agrees that absence is not zero', () => {
  // Three places coerced this field. They are asserted together because fixing
  // one and missing another is how the original defect survived: the picker and
  // the card read DIFFERENT projections of the same upstream row, so a
  // single-site fix leaves one of the two still claiming 免费.
  for (const raw of [
    { key: 'GLM53', name: 'GLM 5.3' },
    { key: 'GLM53', name: 'GLM 5.3', priceFactor: undefined },
    { key: 'GLM53', name: 'GLM 5.3', priceFactor: null },
  ]) {
    assert.strictEqual(
      normalizeEntry(raw).priceFactor,
      undefined,
      `normalizeEntry must not mint a 0 for ${JSON.stringify(raw)}`,
    )
  }
})

test('fetchModels, the producer of the raw row, follows the same rule', async () => {
  // `normalizeEntry` is not the only door this field comes through. `fetchModels`
  // builds the raw row that `normalizeEntry` then reads, and it read
  // `price_factor` with its own `|| 0` — so asserting only on `normalizeEntry`
  // would leave this half free to reintroduce 免费 from a missing field.
  //
  // Driven through `globalThis.fetch`, the way `userinfo-headers.test.js` does,
  // so the real mapping loop runs rather than a copy of it.
  const original = globalThis.fetch
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        chat: [
          { key: 'GLM53', display_name: 'GLM 5.3' },
          { key: 'Other', display_name: 'Other', price_factor: 0 },
          { key: 'Paid', display_name: 'Paid', price_factor: 0.05 },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  try {
    const models = await fetchModels(CN_REGION, CREDENTIAL)
    const byKey = Object.fromEntries(models.map((model) => [model.key, model]))
    assert.strictEqual(
      byKey.GLM53.priceFactor,
      undefined,
      'a missing price_factor must stay missing, not become 0 (which reads as 免费)',
    )
    assert.strictEqual(byKey.Other.priceFactor, 0, 'a sent zero must stay zero — that model is really free')
    assert.strictEqual(byKey.Paid.priceFactor, 0.05, 'an ordinary multiplier must be carried unchanged')
  } finally {
    globalThis.fetch = original
  }
})
