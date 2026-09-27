/**
 * Guard the card's off-peak gate against regressions in the shipped bundle.
 *
 * Run: node --test test/client-bundle.test.js
 *
 * WHY THIS FILE EXISTS
 *
 * `test/model-row.test.js` carries a hand-written transcription of the card's
 * `offPeakState` rule, and that transcription is correct. It is also useless as
 * a guard: it asserts against itself. Measured, not assumed — deleting the
 * `promo.active !== true` line from `lib/client.js` (the one that stopped the
 * card showing a discount nobody gets) leaves that file fully green, because the
 * copy in the test still has the line.
 *
 * The bundle cannot simply be imported: it is an esbuild output that calls
 * `window.__ModuleLoader__.load` and reaches for `react` and `react/jsx-runtime`
 * at load time. So the two pure functions the gate depends on are extracted from
 * the bundle TEXT and evaluated here. They are the real shipped code, so
 * removing a line from `lib/client.js` turns this file red — which is what makes
 * it a guard rather than a restatement.
 *
 * WHAT IS STILL NOT COVERED
 *
 * Everything around the gate: the JSX rendering, the clock interval, the fetch
 * of the host route, the settings write. Those need the browser, or the
 * TypeScript sources this repository does not have (docs/KNOWN_GAPS.md item 2).
 * What is covered is the one thing that computes a number the user is shown.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const BUNDLE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'client.js'),
  'utf8',
)

/**
 * Pull one function out of the bundle by name.
 *
 * The bundle nests its helpers two tabs deep inside the module factory, and the
 * indentation is not stable across a rebuild — so this walks the braces instead
 * of matching to a fixed prefix. A miss returns `null` and the caller reports
 * it as a test failure, so a restructure surfaces as a readable message rather
 * than a syntax error.
 */
function extract(name) {
  const header = new RegExp(`function ${name}\\([^)]*\\) \\{`).exec(BUNDLE)
  if (header === null) return null
  const start = header.index
  let depth = 0
  for (let i = BUNDLE.indexOf('{', start); i < BUNDLE.length; i++) {
    if (BUNDLE[i] === '{') depth++
    else if (BUNDLE[i] === '}') {
      depth--
      if (depth === 0) return BUNDLE.slice(start, i + 1)
    }
  }
  return null
}

/** Evaluate the extracted functions and return them. */
function loadCardGate() {
  const parts = ['parseClock', 'localSecondsOf', 'offPeakState'].map((name) => {
    const source = extract(name)
    assert.ok(source !== null, `could not extract \`${name}\` from lib/client.js — the bundle was restructured`)
    return source
  })
  return new Function(`${parts.join('\n')}; return { offPeakState };`)()
}

const { offPeakState } = loadCardGate()

const P = {
  active: true,
  windowStart: '22:00',
  windowEnd: '08:00',
  timezone: 'Asia/Shanghai',
  discountFactor: 0.4,
  beforePromotionPriceFactor: 0.025,
}

const at = (iso) => new Date(iso)

test('the real bundle function is under test, not a copy', () => {
  // A copy of `offPeakState` in this file would pass everything below even if
  // the bundle lost the `active` gate. This asserts the shipped code has it.
  const source = extract('offPeakState')
  assert.ok(
    source.includes('promo.active !== true'),
    'lib/client.js no longer gates on promotion.active — the card would show a discount for a ' +
      'promotion Qoder has switched off. The test file mirror would NOT catch this.',
  )
})

test('the check-in row and the route it posts to are in the shipped bundle', () => {
  // The check-in is the card's only write action, so losing it in a rebuild is
  // silent in every other sense: nothing else here would go red, the card would
  // simply render one row fewer. Called out by name rather than by index into a
  // rendered tree, which this bundle cannot produce anyway.
  for (const needle of [
    '/plugins/dsh-connect-qoder/checkin',
    'todayCheckedIn',
    'usage.checkinClaiming',
  ]) {
    assert.ok(
      BUNDLE.includes(needle),
      `lib/client.js is missing ${needle} — the daily check-in has been dropped from the shipped ` +
        'card. Rebuild it from src/client/ instead of editing the bundle.',
    )
  }
})

test('a live promotion inside its hours is off-peak', () => {
  const state = offPeakState({ promotion: P }, at('2026-09-26T23:30:00+08:00'))
  assert.strictEqual(state?.active, true)
  assert.ok(state.remainingSeconds > 0, 'a countdown must be offered while the window is open')
})

test('a live promotion outside its hours is not off-peak', () => {
  const state = offPeakState({ promotion: P }, at('2026-09-26T12:00:00+08:00'))
  assert.ok(state === undefined || state.active === false)
})

test('a promotion Qoder has switched off is never off-peak', () => {
  // The regression this file exists to guard. Qoder keeps windowStart/windowEnd
  // populated on a promotion it switches off, so the window alone is not
  // evidence the discount is live — and a card that reads only the window shows
  // the user a price they are not charged.
  for (const label of ['inactive', 'active undefined', 'active false', 'active truthy string']) {
    const promotion = {
      ...P,
      active: label === 'inactive' ? false
        : label === 'active undefined' ? undefined
        : label === 'active false' ? false
        : 'true',
    }
    const inside = at('2026-09-26T23:30:00+08:00')
    const state = offPeakState({ promotion }, inside)
    assert.ok(
      state === undefined || state.active === false,
      `a promotion with ${label} must not render as off-peak, even inside its own hours`,
    )
  }
})

test('the gate agrees with the host rule the picker uses', () => {
  // The card and the picker render the same number in two places. The host
  // rule is the tested one (lib/offpeak.js), so the bundle must match it.
  const cases = [
    { promotion: P, at: '2026-09-26T23:30:00+08:00' },
    { promotion: P, at: '2026-09-26T12:00:00+08:00' },
    { promotion: P, at: '2026-09-26T22:00:00+08:00' },
    { promotion: P, at: '2026-09-26T08:00:00+08:00' },
    { promotion: P, at: '2026-09-26T07:59:00+08:00' },
    { promotion: { ...P, active: false }, at: '2026-09-26T23:30:00+08:00' },
    { promotion: { ...P, active: undefined }, at: '2026-09-26T23:30:00+08:00' },
    { promotion: { ...P, active: 'true' }, at: '2026-09-26T23:30:00+08:00' },
    { promotion: undefined, at: '2026-09-26T23:30:00+08:00' },
  ]
  for (const { promotion, at: when } of cases) {
    const card = offPeakState({ promotion }, at(when))
    const hostActive = promotion?.active === true &&
      (() => {
        const start = Number(promotion.windowStart.slice(0, 2)) * 3600 + Number(promotion.windowStart.slice(3)) * 60
        const end = Number(promotion.windowEnd.slice(0, 2)) * 3600 + Number(promotion.windowEnd.slice(3)) * 60
        const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: promotion.timezone, hour: '2-digit', hour12: false }).format(at(when)))
        const minute = Number(new Intl.DateTimeFormat('en-GB', { timeZone: promotion.timezone, minute: '2-digit' }).format(at(when)))
        const seconds = hour * 3600 + minute * 60
        return start < end ? seconds >= start && seconds < end : seconds >= start || seconds < end
      })()
    assert.strictEqual(
      card === undefined ? false : card.active === true,
      hostActive,
      `card and host disagree at ${when} for active=${String(promotion?.active)}`,
    )
  }
})

test('a malformed window does not throw', () => {
  for (const promotion of [
    { ...P, windowStart: 'nonsense' },
    { ...P, windowEnd: '99:99' },
    { ...P, windowStart: '', windowEnd: '' },
    { ...P, windowStart: '22:00', windowEnd: '22:00' },
    { ...P, timezone: 'Not/AZone' },
  ]) {
    assert.doesNotThrow(
      () => offPeakState({ promotion }, at('2026-09-26T23:30:00+08:00')),
      JSON.stringify(promotion),
    )
  }
})

test('a missing promotion yields nothing rather than throwing', () => {
  for (const model of [{}, { promotion: null }, { promotion: 'string' }, { promotion: 42 }]) {
    assert.doesNotThrow(() => offPeakState(model, at('2026-09-26T23:30:00+08:00')), JSON.stringify(model))
  }
})
