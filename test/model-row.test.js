/**
 * Contract test for the row the settings card actually renders.
 *
 * Run: node --test test/model-row.test.js
 *
 * This is the guard for the second half of the off-peak regression, and the half
 * that was still broken when the first guard was written. `normalizeEntry` did
 * carry the whole `promotion` block, and `catalog-fields.test.js` did assert it
 * — but the host route re-projected that block field by field on its way to the
 * card, and the projection left out `active` and `timezone`.
 *
 * The card gates its ticking clock on `models.some((m) => m.promotion?.active
 * === true)`. With `active` missing that gate is permanently false, so the
 * one-second interval is never installed, `setClock` never fires again, and the
 * 22:00 rate flip and countdown never happen without a manual card refresh. The
 * window and the rate still rendered, so nothing looked broken.
 *
 * The projection now lives in `lib/catalog-entry.js` as a pure function so it
 * can be asserted directly; the test imports it for the same reason the sibling
 * test stopped mirroring: a hand-written copy cannot catch a bug in the code it
 * is a copy of.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { normalizeEntry, projectModelRow } from '../lib/catalog-entry.js'
import { isOffPeakActive, offPeakRemaining, effectiveRate } from '../lib/offpeak.js'

const RATES = { rateNow: effectiveRate, offPeakActive: isOffPeakActive, offPeakRemaining }

/**
 * The card's own gate, reproduced so this test fails if the card's rule changes.
 *
 * SYNC CONSTRAINT: this is a copy of an expression that lives in the client
 * card (src/client/card.ts, `models.some((m) => m.promotion?.active === true)`).
 * The card is a browser bundle built from TypeScript sources, so it cannot be
 * imported directly from a Node test. This file is deliberately NOT import-clean,
 * and it should not be read as being so.
 *
 * If the card's gate is ever rewritten, this copy has to be rewritten with it,
 * or these tests will keep passing while asserting a rule nothing implements.
 * That is the same mirror failure the sibling tests were rewritten to eliminate;
 * it is accepted here only because the alternative — no coverage of the layer
 * where the regression actually happened — is worse.
 */
function cardInstallsClock(rows) {
  return rows.some((m) => m.promotion?.active === true)
}

/**
 * The card's per-row off-peak gate, reproduced for the same reason as
 * {@link cardInstallsClock}.
 *
 * SYNC CONSTRAINT: this mirrors `offPeakState` in lib/client.js. The card
 * evaluates the window in the browser so it can tick on its own, and that copy
 * of the rule used to look at the window fields alone — not at
 * `promotion.active`. Qoder keeps `windowStart`/`windowEnd` populated on a
 * promotion it has switched off (upstream.normalizePromotion carries `active`
 * and the window independently), so such a row was rendered at the DISCOUNTED
 * rate during its own hours: a price the user is not charged, and one the host
 * contradicted — the picker, resolving the same catalog entry through `rateNow`,
 * correctly showed the `before` rate.
 *
 * The bug needs a mixed catalog to surface: the ticking clock is installed when
 * ANY model reports `active === true`, and from then on every row re-resolves
 * through this gate.
 *
 * This is a faithful transcription, guards and window arithmetic both, so the
 * comparison below is over the whole verdict. It is a SPECIFICATION of the
 * card's rule, not the card's code: the bundle is built from TypeScript sources
 * not in this repository, so the real function cannot be imported here at all
 * (see docs/KNOWN_GAPS.md item 3). If the card's gate is rewritten, this copy
 * has to be rewritten with it.
 *
 * @returns whether the card would render an off-peak badge for this row.
 */
function cardRendersOffPeak(row, now) {
  const promo = row.promotion
  if (promo === null || typeof promo !== 'object') return false
  if (promo.active !== true) return false
  const start = cardParseClock(promo.windowStart)
  const end = cardParseClock(promo.windowEnd)
  if (start === undefined || end === undefined || start === end) return false
  const seconds = cardLocalSecondsOf(now, promo.timezone ?? 'Asia/Shanghai')
  if (seconds === undefined) return false
  // `end` not after `start` means the window crosses midnight.
  return start < end ? seconds >= start && seconds < end : seconds >= start || seconds < end
}

/** `HH:MM` (or `HH:MM:SS`) to seconds past midnight, as the card parses it. */
function cardParseClock(text) {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(text ?? '').trim())
  if (match === null) return undefined
  const hour = Number(match[1])
  const minute = Number(match[2])
  const second = Number(match[3] ?? 0)
  if (hour > 23 || minute > 59 || second > 59) return undefined
  return hour * 3600 + minute * 60 + second
}

/** Seconds past local midnight in `timezone`, as the card computes it. */
function cardLocalSecondsOf(date, timezone) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(date)
    const read = (type) => Number(parts.find((part) => part.type === type)?.value ?? Number.NaN)
    const hour = read('hour') % 24
    const minute = read('minute')
    const second = read('second')
    if (![hour, minute, second].every(Number.isFinite)) return undefined
    return hour * 3600 + minute * 60 + second
  } catch {
    return undefined
  }
}

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

const REGION = { id: 'qoder-cn', displayName: 'Qoder CN' }

// The window is open, so the discount applies and the rate is the product.
const NOW = new Date('2026-09-26T23:30:00+08:00')

/**
 * The REAL rate helpers, not a stand-in.
 *
 * This used to be a hand-written `RATES` object duplicating the arithmetic. That
 * made the file unfalsifiable in the way its siblings used to be: nothing
 * checked the stand-in against the shipped `rateNow`, so "the rate flips at
 * 22:00" was being asserted against a fiction. The helpers were then moved into
 * lib/offpeak.js, which has no pi-ai dependency, so the real ones can be
 * imported here.
 *
 * The fixture's `priceFactor` is deliberately different from
 * `beforePromotionPriceFactor × discountFactor`, so a change that skipped the
 * product would be visible rather than masked by a coincidentally equal
 * fallback.
 */
const ENTRY = normalizeEntry({
  key: 'GLM',
  name: 'GLM 5.3',
  isVL: false,
  isReasoning: true,
  alwaysThinking: true,
  maxInputTokens: 200000,
  defaultContextWindow: 128000,
  contextOptions: [128000, 200000],
  priceFactor: 0.03,
  isFree: false,
  isDefault: true,
  promotion: PROMOTION,
})

test('the projected row lets the card install its ticking clock', () => {
  const row = projectModelRow(ENTRY, REGION, NOW, RATES)
  // The single assertion whose absence let a dead feature ship green: without
  // `active` on the wire this is false and the rate never updates on its own.
  assert.strictEqual(
    cardInstallsClock([row]),
    true,
    'promotion.active must reach the card or the off-peak clock never ticks',
  )
})

test('the projected row carries promotion.timezone', () => {
  const row = projectModelRow(ENTRY, REGION, NOW, RATES)
  assert.strictEqual(
    row.promotion.timezone,
    'Asia/Shanghai',
    'promotion.timezone must reach the card or the window cannot be resolved',
  )
})

test('the projected row forwards every promotion field', () => {
  const row = projectModelRow(ENTRY, REGION, NOW, RATES)
  for (const field of Object.keys(PROMOTION)) {
    assert.ok(field in row.promotion, `promotion.${field} was dropped by the host projection`)
  }
  // Plus the one field the host computes itself: the countdown to the next
  // boundary. At 23:30 with a 22:00-08:00 window, that is 8h30m away.
  assert.strictEqual(row.promotion.remainingSeconds, 8.5 * 3600)
})

test('the projected rate is the real discounted rate, not the stand-in', () => {
  // This is the assertion that was impossible while `RATES` was a hand-written
  // stand-in. Inside the window the rate must be before × discount, which for
  // this entry differs from both the raw priceFactor and the before figure.
  const row = projectModelRow(ENTRY, REGION, NOW, RATES)
  assert.ok(Math.abs(row.effectiveRate - 0.01) < 1e-9, `expected 0.01, got ${row.effectiveRate}`)
  assert.notStrictEqual(row.effectiveRate, 0.03, 'must not fall back to priceFactor')
  assert.strictEqual(row.offPeakActive, true)
})

test('a bare model projects with no promotion block at all', () => {
  const bare = normalizeEntry({
    key: 'Kimi',
    name: 'Kimi K3',
    priceFactor: 0.01,
    promotion: undefined,
  })
  const row = projectModelRow(bare, REGION, NOW, RATES)
  assert.strictEqual(row.promotion, undefined)
  assert.strictEqual(cardInstallsClock([row]), false)
  assert.strictEqual(cardRendersOffPeak(row, NOW), false, 'a model with no promotion shows no off-peak badge')
  assert.strictEqual(row.effectiveRate, 0.01)
})

test('a switched-off promotion shows the standard rate, not the discount', () => {
  // The regression this file's second gate guards. Qoder leaves the window
  // fields in place when it switches a promotion off, so "the window contains
  // this instant" is not the same question as "the discount is live".
  //
  // The host already answered it correctly — `offPeakActive` is false and the
  // rate is the `before` figure. What was wrong was the card's own copy of the
  // rule, which showed this row at 0.01 while the picker charged 0.025.
  const inactive = normalizeEntry({
    key: 'GLM',
    name: 'GLM 5.3',
    priceFactor: 0.03,
    promotion: { ...PROMOTION, active: false },
  })
  const row = projectModelRow(inactive, REGION, NOW, RATES)

  // The host side, for reference: the window is open but the discount is off.
  assert.strictEqual(row.offPeakActive, false, 'the host must not report a discount nobody gets')
  assert.strictEqual(row.effectiveRate, 0.025, 'and must charge the before rate')

  // The card side: the gate the fix added. Before it, this was true and the row
  // rendered `x0.01` under a 错峰价 badge.
  assert.strictEqual(
    cardRendersOffPeak(row, NOW),
    false,
    'a promotion that is not active must render no off-peak badge and no discounted rate',
  )
})

test('the two off-peak gates agree across the states a catalog can hold', () => {
  // The card's gate and the host's must never disagree, because they render the
  // same number in two places. Each case is built from what
  // `upstream.normalizePromotion` can actually emit.
  const cases = [
    ['active window, inside its hours', { ...PROMOTION }, true],
    ['active window, outside its hours', { ...PROMOTION }, false, '2026-09-26T12:00:00+08:00'],
    ['switched off, hours still populated', { ...PROMOTION, active: false }, false],
    ['no promotion at all', undefined, false],
  ]
  for (const [label, promotion, expectedActive, at] of cases) {
    const when = at === undefined ? NOW : new Date(at)
    const entry = normalizeEntry({
      key: 'GLM',
      name: 'GLM 5.3',
      priceFactor: 0.03,
      promotion,
    })
    const row = projectModelRow(entry, REGION, when, RATES)
    assert.strictEqual(
      cardRendersOffPeak(row, when),
      row.offPeakActive,
      `${label}: the card's gate and the host's must agree`,
    )
    assert.strictEqual(row.offPeakActive, expectedActive, `${label}: unexpected host verdict`)
  }
})

test('a live promotion on one model does not put the others into off-peak', () => {
  // The mixed catalog is what made the bug visible in the first place: the
  // ticking clock is installed when ANY row reports `active === true`, so every
  // row then re-resolves. A neighbour with its promotion off must still render
  // the standard rate while the clock is ticking.
  const live = normalizeEntry({ key: 'A', name: 'A', priceFactor: 0.03, promotion: { ...PROMOTION } })
  const off = normalizeEntry({ key: 'B', name: 'B', priceFactor: 0.03, promotion: { ...PROMOTION, active: false } })
  const rows = [projectModelRow(live, REGION, NOW, RATES), projectModelRow(off, REGION, NOW, RATES)]

  assert.strictEqual(cardInstallsClock(rows), true, 'the live row installs the clock')
  assert.strictEqual(cardRendersOffPeak(rows[0], NOW), true, 'and the live row renders off-peak')
  assert.strictEqual(cardRendersOffPeak(rows[1], NOW), false, 'while its switched-off neighbour does not')
  assert.strictEqual(rows[1].effectiveRate, 0.025, 'and the neighbour is still charged the before rate')
})

test('the projected row keeps identity and region fields', () => {
  const row = projectModelRow(ENTRY, REGION, NOW, RATES)
  assert.strictEqual(row.id, 'GLM5.3')
  assert.strictEqual(row.name, 'GLM 5.3')
  assert.strictEqual(row.region, 'qoder-cn')
  assert.strictEqual(row.regionName, 'Qoder CN')
  assert.strictEqual(row.isFree, false)
  assert.strictEqual(row.isDefault, true)
  assert.strictEqual(row.offPeakActive, true)
})

// --- context window label -------------------------------------------------

test('a model with real context options shows its default window', () => {
  const row = projectModelRow(ENTRY, REGION, NOW, RATES, false)
  assert.strictEqual(row.contextWindow, 128000)
  assert.strictEqual(row.contextWindowLabel, '128K')
})

test('preferring the maximum shows the widest offered window', () => {
  const row = projectModelRow(ENTRY, REGION, NOW, RATES, true)
  assert.strictEqual(row.contextWindow, 200000)
  assert.strictEqual(row.contextWindowLabel, '200K')
})

test('a model with no context options shows no window label', () => {
  const bare = normalizeEntry({
    key: 'Kimi',
    name: 'Kimi K3',
    priceFactor: 0.01,
    defaultContextWindow: 0,
    contextOptions: [],
    maxInputTokens: 32000,
  })
  const row = projectModelRow(bare, REGION, NOW, RATES, true)
  // `max_input_tokens` is a per-request floor, not a window Qoder offers;
  // the label stays empty rather than claiming a real choice.
  assert.strictEqual(row.contextWindow, 32000)
  assert.strictEqual(row.contextWindowLabel, '')
})
