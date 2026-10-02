/**
 * Direct tests for `src/client/card-model.ts` — the card's browser-free
 * decision layer.
 *
 * Run: node --test test/card-model.test.js
 *
 * WHY THIS FILE EXISTS
 *
 * `card-model.ts` is the module the card's pure rules were hoisted into so that
 * a plain Node test can import the REAL implementation and assert on it, instead
 * of copying a rule into the test and letting the source drift (the hand-copied
 * transcription `docs/KNOWN_GAPS.md` warns about, which `test/rule-layer.test.js`
 * turns into a gate). `model-row.test.js` / `card-host-parity.test.js` /
 * `protocol-shape-card.test.js` already cover `offPeakState` / `windowLabelOf` /
 * `refreshNoticeKey`; six exported rules had no direct test at all:
 *
 *   `withDate`, `rateLabelOf`, `formatCountdown`, `formatContextWindowForUi`,
 *   `rateAt`, `describeThrown`.
 *
 * This file closes that. Every assertion runs the shipped source directly —
 * `npm run build:client` then turns that same source into `lib/client.js`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  withDate,
  rateLabelOf,
  formatCountdown,
  formatContextWindowForUi,
  rateAt,
  describeThrown,
} from '../src/client/card-model.ts'

/** A translation stub that names the key it is asked for. */
const t = (key, params) => (params === undefined ? key : `${key}${JSON.stringify(params)}`)

// --- withDate ---------------------------------------------------------------

test('withDate fills a {date} placeholder from a real timestamp', () => {
  const out = withDate('renews on {date}', 1750000000000)
  assert.equal(typeof out, 'string')
  assert.ok(!out.includes('{date}'), 'the placeholder must be replaced')
  assert.ok(out.startsWith('renews on '), `prefix must survive; got ${out}`)
  assert.ok(out.length > 'renews on '.length, 'a date must actually be inserted')
})

test('withDate leaves a template with no placeholder untouched', () => {
  assert.equal(withDate('no placeholder here', 1750000000000), 'no placeholder here')
})

test('withDate renders nothing when the timestamp is unusable', () => {
  for (const at of [undefined, 0, -1, Number.NaN]) {
    assert.equal(withDate('renews on {date}', at), '', `at=${String(at)} must yield ""`)
  }
})

// --- rateLabelOf ------------------------------------------------------------

test('rateLabelOf names a free model instead of x0.00', () => {
  assert.equal(rateLabelOf(t, 0), 'row.rateFree')
  assert.equal(rateLabelOf(t, -1), 'row.rateFree', 'a negative factor is also free')
})

test('rateLabelOf renders a paid multiplier with two decimals', () => {
  assert.equal(rateLabelOf(t, 1.5), 'x1.50')
  assert.equal(rateLabelOf(t, 2), 'x2.00')
})

test('rateLabelOf shows nothing for a factor that is not a number', () => {
  for (const factor of [undefined, Number.NaN, 'abc']) {
    assert.equal(rateLabelOf(t, factor), undefined, `factor=${String(factor)} must be undefined`)
  }
})

// --- formatCountdown --------------------------------------------------------

test('formatCountdown is a zero-padded HH:MM:SS', () => {
  assert.equal(formatCountdown(0), '00:00:00')
  assert.equal(formatCountdown(3661), '01:01:01')
})

test('formatCountdown clamps and floors instead of emitting junk', () => {
  assert.equal(formatCountdown(-5), '00:00:00', 'a negative count is clamped to zero')
  assert.equal(formatCountdown(undefined), '00:00:00', 'a missing count renders as zero')
  assert.equal(formatCountdown(59.9), '00:00:59', 'a fractional second is floored')
})

// --- formatContextWindowForUi -----------------------------------------------

test('formatContextWindowForUi abbreviates the catalog sizes', () => {
  assert.equal(formatContextWindowForUi(200000), '200K')
  assert.equal(formatContextWindowForUi(128000), '128K')
  assert.equal(formatContextWindowForUi(1000000), '1M')
})

test('formatContextWindowForUi shows a small window in full', () => {
  assert.equal(formatContextWindowForUi(500), '500')
})

test('formatContextWindowForUi renders nothing for an unusable token count', () => {
  for (const n of [0, -1, Number.NaN, undefined]) {
    assert.equal(formatContextWindowForUi(n), '', `tokens=${String(n)} must yield ""`)
  }
})

// --- rateAt -----------------------------------------------------------------

/** A promotion window that holds for any mid-day instant. */
const ALL_DAY_WINDOW = {
  active: true,
  windowStart: '00:00',
  windowEnd: '23:58',
  beforePromotionPriceFactor: 2,
  discountFactor: 0.5,
}
// 2025-06-15T04:00:00Z is 12:00 in Asia/Shanghai, safely inside 00:00–23:58.
const NOW = new Date('2025-06-15T04:00:00Z')

test('rateAt reads the discounted factor inside an active window', () => {
  const rate = rateAt({ id: 'm', priceFactor: 2, promotion: { ...ALL_DAY_WINDOW, timezone: 'Asia/Shanghai' } }, NOW)
  assert.equal(rate, 1, 'an active promotion applies before x discount')
})

test('rateAt reports the before price when the promotion is switched off', () => {
  const rate = rateAt(
    { id: 'm', priceFactor: 2, promotion: { ...ALL_DAY_WINDOW, active: false } },
    NOW,
  )
  assert.equal(rate, 2, 'a dead window must not discount')
})

test('rateAt falls back to the base factor when there is no promotion', () => {
  assert.equal(rateAt({ id: 'm', priceFactor: 2.5 }, NOW), 2.5)
})

test('rateAt reports undefined when nothing yields a finite factor', () => {
  assert.equal(rateAt({ id: 'm' }, NOW), undefined)
})

// --- describeThrown ---------------------------------------------------------

test('describeThrown reads a real message from an Error', () => {
  assert.equal(describeThrown(new Error('boom')), 'boom')
})

test('describeThrown passes a bare string through', () => {
  assert.equal(describeThrown('bare'), 'bare')
})

test('describeThrown reads a message off a thrown object', () => {
  assert.equal(describeThrown({ message: 'obj' }), 'obj')
})

test('describeThrown never prints the literal word undefined', () => {
  // A thrown `undefined` used to render as the text "undefined" — a failure
  // message that says nothing at all. The narrowing must turn it into the
  // string "undefined" rather than the literal token.
  assert.equal(describeThrown(undefined), 'undefined')
  assert.equal(describeThrown(null), 'null')
})

test('describeThrown falls back to String() for a message-less throw', () => {
  assert.equal(describeThrown({ code: 42 }), '[object Object]')
  assert.equal(describeThrown({ message: 42 }), '[object Object]', 'a non-string message is not a message')
})
