/**
 * Contract test for the quota-amount heuristic shared by the two normalizers.
 *
 * Run: node --test test/quota-amounts.test.js
 *
 * `normalizeQuotaBucket` and `normalizeDedicatedPackage` used to carry the
 * `used` / `remaining` / `percentage` / `unit` block VERBATIM — the same
 * `> 1 means percent` guess, the same `[0, 1]` clamp, the same `'credits'`
 * default. A heuristic that exists twice can be corrected once, and this
 * plugin has already paid for that lesson in `time.ts` (two copies of a time
 * comparison drawn on different thresholds).
 *
 * They are also the reason no test caught it: every existing test builds a
 * usage snapshot that is ALREADY normalized (`card-dom.test.js` passes
 * `percentage: 0.1`, a fraction, never `10`), so nothing exercised the raw
 * upstream → display conversion at all. These do, through the real `fetchUsage`
 * and the real `fetchModels`-style fetch stub, so the fields are asserted on
 * the path that actually produces them.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { fetchUsage } from '../src/host/upstream.ts'

const REGION = { id: 'qoder-cn', displayName: 'Qoder CN', baseUrl: 'https://openapi.qoder.com.cn/' }
const CREDENTIAL = { userID: 'u-test', token: 'tok-test', name: 'n', email: 'e@x', machineID: 'm' }

/**
 * Drive `fetchUsage` with a body, returning the normalized snapshot.
 *
 * Two routes are tried in order (`sash` presentation, then `quota/usage`), so
 * the stub answers every URL with the same body and the first route wins.
 */
async function usageFrom(body) {
  const original = globalThis.fetch
  globalThis.fetch = async () =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  try {
    // The campaigns read is supplementary and shares this stub; whatever it
    // makes of the body cannot change the quota fields under test.
    return await fetchUsage(REGION, CREDENTIAL)
  } finally {
    globalThis.fetch = original
  }
}

test('an out-of-range percentage is clamped into [0, 1]', async () => {
  // A clamped display value is the honest reading of a nonsense one; the point
  // is that it cannot escape the range and draw a bar past its track.
  const over = await usageFrom({ user_quota: { total: 100, used: 10, percentage: 4000 } })
  assert.strictEqual(over.userQuota.percentage, 1)
  const under = await usageFrom({ user_quota: { total: 100, used: 10, percentage: -5 } })
  assert.strictEqual(under.userQuota.percentage, 0)
})

test('the divide-by-100 threshold sits above 1 and at or below 2', async () => {
  // The one input that separates the plausible thresholds. `42` cannot: every
  // threshold from `>1` to `>100` divides it. `2` can — under the shipped `>1`
  // rule it is a percentage (0.02), while a `>=2` or `>2` rule would keep it as
  // the fraction 2 and then clamp it to 1. Pinning 2 therefore fixes the
  // boundary rather than just the branch, which is what makes a future
  // threshold change fail here instead of only in the panel.
  const atTwo = await usageFrom({ user_quota: { total: 100, used: 2, percentage: 2 } })
  assert.strictEqual(atTwo.userQuota.percentage, 0.02, 'a value above 1 is read as a percentage')
  const atOne = await usageFrom({ user_quota: { total: 100, used: 1, percentage: 1 } })
  assert.strictEqual(atOne.userQuota.percentage, 1, '1 itself is read as a fraction')
})

test('a percentage sent as a fraction is used as-is', async () => {
  const usage = await usageFrom({ user_quota: { total: 100, used: 25, percentage: 0.25 } })
  assert.strictEqual(usage.userQuota.percentage, 0.25)
})

test('an out-of-range percentage is clamped into [0, 1]', async () => {
  // A clamped display value is the honest reading of a nonsense one; the point
  // is that it cannot escape the range and draw a bar past its track.
  const over = await usageFrom({ user_quota: { total: 100, used: 10, percentage: 4000 } })
  assert.strictEqual(over.userQuota.percentage, 1)
  const under = await usageFrom({ user_quota: { total: 100, used: 10, percentage: -5 } })
  assert.strictEqual(under.userQuota.percentage, 0)
})

test('a missing percentage falls back to used / total', async () => {
  const usage = await usageFrom({ user_quota: { total: 200, used: 50 } })
  assert.strictEqual(usage.userQuota.percentage, 0.25)
})

test('a missing remaining is derived, and an absurd one is floored at 0', async () => {
  // Deriving is what keeps the panel from showing "0 remaining" beside
  // "50 used" when the upstream simply omitted the field.
  const derived = await usageFrom({ user_quota: { total: 100, used: 40 } })
  assert.strictEqual(derived.userQuota.remaining, 60)
  // `used` beyond `total` must not produce negative remaining (which would
  // render as a negative bar) — it floors, and the percentage clamps with it.
  const overUsed = await usageFrom({ user_quota: { total: 100, used: 150 } })
  assert.strictEqual(overUsed.userQuota.remaining, 0)
  assert.strictEqual(overUsed.userQuota.percentage, 1)
  // A negative `used` is floored too, and remaining is derived from the floor.
  const negative = await usageFrom({ user_quota: { total: 100, used: -20 } })
  assert.strictEqual(negative.userQuota.used, 0)
  assert.strictEqual(negative.userQuota.remaining, 100)
})

test('the unit defaults to credits and a declared one is kept', async () => {
  const bare = await usageFrom({ user_quota: { total: 100, used: 1 } })
  assert.strictEqual(bare.userQuota.unit, 'credits')
  const named = await usageFrom({ user_quota: { total: 100, used: 1, unit: 'calls' } })
  assert.strictEqual(named.userQuota.unit, 'calls')
  // An empty string is "not declared", not a unit the panel should render.
  const empty = await usageFrom({ user_quota: { total: 100, used: 1, unit: '' } })
  assert.strictEqual(empty.userQuota.unit, 'credits')
})

test('a bucket with no usable total is dropped rather than shown as zero', async () => {
  // A bucket that cannot be divided must not become a 0/0 progress bar; the
  // card distinguishes "no bucket" from "an empty bucket".
  for (const total of [0, -1, 'nonsense', undefined, null]) {
    const usage = await usageFrom({ user_quota: { total, used: 1 } })
    assert.strictEqual(usage?.userQuota, undefined, `total=${JSON.stringify(total)} must drop the bucket`)
  }
})

test('the dedicated package normalizer applies the SAME heuristic', async () => {
  // This is the assertion the duplication made impossible: one input shape, two
  // normalizers, and the same four fields out of both. If the shared helper is
  // ever split back apart, one of these two disagreeing is what catches it.
  //
  // The percentage is deliberately a THRESHOLD-SENSITIVE value (`2`, not `42`).
  // `42` cannot detect a divergence between a `>1` and a `>100` threshold
  // because both divide it to the same fraction — so the original version of
  // this test passed against a deliberately broken package path. `2` splits
  // them: one rule answers 0.02, the other answers 2 (then clamps to 1).
  const usage = await usageFrom({
    user_quota: { total: 100, used: 42, percentage: 2, unit: 'calls' },
    dedicated_resource_packages: [{ id: 'pkg-1', name: 'Pkg', total: 100, used: 42, percentage: 2, unit: 'calls' }],
  })
  const pkg = usage.dedicatedPackages[0]
  assert.strictEqual(pkg.percentage, usage.userQuota.percentage, 'percentage must agree across both normalizers')
  assert.strictEqual(pkg.used, usage.userQuota.used, 'used must agree across both normalizers')
  assert.strictEqual(pkg.remaining, usage.userQuota.remaining, 'remaining must agree across both normalizers')
  assert.strictEqual(pkg.unit, usage.userQuota.unit, 'unit must agree across both normalizers')
  assert.strictEqual(pkg.percentage, 0.02, 'both must read 2 as 2%, not as the fraction 2')
})

test('a package without an id is dropped, and a malformed one never throws', async () => {
  // The package normalizer has one rule the bucket one does not (an id is
  // required — the panel keys rows by it), so it cannot simply delegate
  // wholesale; and like the bucket it must survive junk rather than throw.
  const usage = await usageFrom({
    user_quota: { total: 100, used: 1 },
    dedicated_resource_packages: [
      { name: 'no id', total: 100, used: 1 },
      { id: 'ok', total: 100, used: 1 },
      null,
      'not an object',
      [],
      { id: 'zero total', total: 0 },
    ],
  })
  assert.deepStrictEqual(
    usage.dedicatedPackages.map((entry) => entry.id),
    ['ok'],
    'only packages with an id and a usable total survive',
  )
})
