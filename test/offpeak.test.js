/**
 * Tests for the off-peak pricing arithmetic.
 *
 * Run: node --test test/offpeak.test.js
 *
 * This is the logic the settings card and the model picker both read to decide
 * what a call actually costs. It had no coverage, and it is the one place where
 * being wrong is invisible: a wrong multiplier does not fail a request, it
 * quietly tells the user a 5x-more-expensive model is cheap.
 *
 * The two rules that matter are asserted directly rather than through a
 * stand-in. A previous version of the row-projection test passed a hand-written
 * `RATES` object into `projectModelRow`, so the "22:00 rate flip" was being
 * asserted against a fiction that nothing checked against the shipped code.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  effectiveRate,
  isOffPeakActive,
  offPeakActive,
  offPeakRemaining,
  offPeakRemainingSeconds,
  rateNow,
} from '../lib/offpeak.js'

/**
 * An entry with the 22:00-08:00 window Qoder actually publishes.
 *
 * The numbers are deliberately NOT self-consistent: `priceFactor` is 0.03 while
 * `beforePromotionPriceFactor × discountFactor` is 0.01. Real catalogs do
 * describe it that way — `price_factor` is the discounted figure only *while
 * the window is open*, and the window is evaluated locally — but a fixture where
 * the two agree cannot tell the product path from the fallback, so a change that
 * skipped the multiplication entirely would still pass. Verified by mutation.
 */
const PROMOTED = {
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

/**
 * Shanghai-local instants, expressed as UTC so they are unambiguous.
 * 22:00 +08 is 14:00Z the same day; 08:00 +08 is 00:00Z the same day; the
 * window closes at 08:00 and does not reopen until 22:00, so 07:59 +08 is
 * 23:59Z on the PREVIOUS day.
 */
const AT = {
  '21:59': '2026-09-26T13:59:00Z',
  '22:00': '2026-09-26T14:00:00Z',
  '23:30': '2026-09-26T15:30:00Z',
  '07:59': '2026-09-25T23:59:00Z',
  '08:00': '2026-09-26T00:00:00Z',
  '12:00': '2026-09-26T04:00:00Z',
}

const at = (key) => new Date(AT[key])

/** Compare multipliers with a tolerance; 0.025 × 0.4 is not exactly 0.01. */
function rateIs(actual, expected) {
  return Math.abs(actual - expected) < 1e-9
}

test('the aliases are the same functions, not re-implementations', () => {
  // lib/adapter.js re-exports these under the names the rest of the plugin
  // imports. If a copy had crept in, the card and the picker could disagree.
  assert.strictEqual(rateNow, effectiveRate)
  assert.strictEqual(offPeakActive, isOffPeakActive)
  assert.strictEqual(offPeakRemaining, offPeakRemainingSeconds)
})

test('a window that crosses midnight is active on both sides of the day', () => {
  // The disjunction, not a range check: 22:00-08:00 means "late evening and
  // early morning", and a naive start <= now <= end would report inactive for
  // the entire window.
  assert.strictEqual(isOffPeakActive(PROMOTED, at('22:00')), true, 'the window opens at 22:00')
  assert.strictEqual(isOffPeakActive(PROMOTED, at('23:30')), true, 'after midnight still counts')
  assert.strictEqual(isOffPeakActive(PROMOTED, at('07:59')), true, 'just before it closes')
})

test('the window is inactive outside it, on both edges', () => {
  assert.strictEqual(isOffPeakActive(PROMOTED, at('21:59')), false, 'one minute before opening')
  assert.strictEqual(isOffPeakActive(PROMOTED, at('08:00')), false, 'the end is exclusive')
  assert.strictEqual(isOffPeakActive(PROMOTED, at('12:00')), false, 'the working day')
})

test('the rate is the discounted product inside the window', () => {
  // 0.025 before x 0.4 discount = 0.01, which is what the catalog reports as
  // price_factor while the window is open.
  assert.ok(Math.abs(rateNow(PROMOTED, at('23:30')) - 0.01) < 1e-9)
})

test('the rate outside the window is the BEFORE rate, not the discounted one', () => {
  // This is the rule with real money attached. Reading price_factor directly
  // would report 0.01 at noon, understating a 0.025 call by 2.5x.
  assert.strictEqual(rateNow(PROMOTED, at('12:00')), 0.025)
  assert.strictEqual(rateNow(PROMOTED, at('21:59')), 0.025)
  assert.strictEqual(rateNow(PROMOTED, at('08:00')), 0.025)
})

test('the rate flips exactly at the window boundary', () => {
  assert.ok(rateIs(rateNow(PROMOTED, at('21:59')), 0.025))
  assert.ok(rateIs(rateNow(PROMOTED, at('22:00')), 0.01))
  assert.ok(rateIs(rateNow(PROMOTED, at('07:59')), 0.01))
  assert.ok(rateIs(rateNow(PROMOTED, at('08:00')), 0.025))
})

test('the window and the discount are both required for the discounted rate', () => {
  // Separated from the boundary test so a change that skipped the product
  // entirely cannot hide behind the fallback branches: this entry declares
  // every field, so the only correct answer inside the window is before×discount.
  const full = { ...PROMOTED }
  assert.ok(rateIs(rateNow(full, at('23:30')), 0.025 * 0.4))
  assert.notStrictEqual(
    rateNow(full, at('23:30')),
    0.025,
    'inside the window the rate must not be the before figure',
  )
})

test('a missing discount factor falls back rather than dividing by zero', () => {
  // The catalog can omit either half. Falling back to the before figure is the
  // conservative choice: it never shows a discount that will not be applied.
  const noDiscount = { priceFactor: 0.01, promotion: { ...PROMOTED.promotion, discountFactor: undefined } }
  assert.ok(rateIs(rateNow(noDiscount, at('23:30')), 0.01), 'falls back to the catalog price_factor')
  const noBefore = { priceFactor: 0.01, promotion: { ...PROMOTED.promotion, beforePromotionPriceFactor: undefined } }
  assert.ok(rateIs(rateNow(noBefore, at('23:30')), 0.01))
  assert.ok(rateIs(rateNow(noBefore, at('12:00')), 0.01))
})

test('a model with no promotion is rated at its plain price factor', () => {
  const plain = { priceFactor: 0.05 }
  assert.strictEqual(rateNow(plain, at('23:30')), 0.05)
  assert.strictEqual(rateNow(plain, at('12:00')), 0.05)
  assert.strictEqual(isOffPeakActive(plain, at('23:30')), false)
  assert.strictEqual(offPeakRemaining(plain, at('23:30')), undefined)
})

test('an inactive promotion never discounts', () => {
  // `active: false` is what a model with a window Qoder has switched off looks
  // like. Treating it as active would show a discount nobody gets.
  const inactive = { ...PROMOTED, promotion: { ...PROMOTED.promotion, active: false } }
  assert.strictEqual(isOffPeakActive(inactive, at('23:30')), false)
  assert.strictEqual(rateNow(inactive, at('23:30')), 0.025)
})

test('the countdown points at the next boundary, from either side', () => {
  // 23:30 -> 08:00 is 8h30m.
  assert.strictEqual(offPeakRemaining(PROMOTED, at('23:30')), 8.5 * 3600)
  // 12:00 -> 22:00 is 10h, and the window is not currently open.
  assert.strictEqual(offPeakRemaining(PROMOTED, at('12:00')), 10 * 3600)
  // Exactly at the opening, the remaining time is the whole window.
  assert.strictEqual(offPeakRemaining(PROMOTED, at('22:00')), 10 * 3600)
  // And it never returns zero or negative, which would make a countdown render
  // as an immediate flip.
  assert.ok(offPeakRemaining(PROMOTED, at('07:59')) > 0)
})

test('a malformed window degrades to no discount rather than throwing', () => {
  // The window comes from a remote catalog. A typo in it must not take the
  // settings card down or invent a discount.
  const cases = [
    { windowStart: 'nonsense', windowEnd: '08:00' },
    { windowStart: '22:00', windowEnd: '99:99' },
    { windowStart: '22:00', windowEnd: '22:00' }, // zero-length
    { windowStart: '', windowEnd: '' },
  ]
  for (const promotion of cases) {
    const entry = { ...PROMOTED, promotion: { ...PROMOTED.promotion, ...promotion } }
    assert.strictEqual(isOffPeakActive(entry, at('23:30')), false, JSON.stringify(promotion))
    assert.strictEqual(offPeakRemaining(entry, at('23:30')), undefined, JSON.stringify(promotion))
    // The rate still resolves, to the before figure.
    assert.strictEqual(rateNow(entry, at('23:30')), 0.025, JSON.stringify(promotion))
  }
})

test('an unusable timezone degrades instead of throwing', () => {
  const entry = { ...PROMOTED, promotion: { ...PROMOTED.promotion, timezone: 'Not/AZone' } }
  assert.strictEqual(isOffPeakActive(entry, at('23:30')), false)
  assert.strictEqual(offPeakRemaining(entry, at('23:30')), undefined)
})

test('a missing timezone is treated as Shanghai, not as UTC', () => {
  // Falling back to UTC would shift the window by eight hours and invert the
  // whole day for a Chinese user.
  const entry = { ...PROMOTED, promotion: { ...PROMOTED.promotion, timezone: undefined } }
  assert.strictEqual(isOffPeakActive(entry, at('23:30')), true, '23:30 Shanghai must be inside the window')
  assert.strictEqual(isOffPeakActive(entry, at('12:00')), false)
})

test('a same-day window is handled without the midnight disjunction', () => {
  // Not the shape Qoder uses, but the arithmetic must not invert it.
  const daytime = {
    priceFactor: 0.01,
    promotion: { ...PROMOTED.promotion, windowStart: '09:00', windowEnd: '17:00' },
  }
  assert.strictEqual(isOffPeakActive(daytime, at('12:00')), true)
  assert.strictEqual(isOffPeakActive(daytime, at('21:59')), false)
  assert.ok(rateIs(rateNow(daytime, at('12:00')), 0.01))
  assert.ok(rateIs(rateNow(daytime, at('21:59')), 0.025))
})
