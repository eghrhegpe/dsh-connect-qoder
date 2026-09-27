/**
 * Tests for the model route's response body.
 *
 * Run: node --test test/model-route.test.js
 *
 * The route itself is I/O — a method check, an origin check, an optional
 * upstream refresh — but the body it answers is a pure function of the started
 * regions, the settings and the clock, and that is what this covers.
 *
 * The volatile-reference cases are the ones that earned their place. Resolving
 * the settings source unwraps the *source*; a field inside a resolved document
 * can still be a `{ get() }` shell, and `typeof shell === 'object'` is true — so
 * the obvious `?? {}` guard passes the shell through and the card renders "no
 * overrides set" for a user who has them.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildModelRowsPayload, normalizeEntry, projectModelRow } from '../lib/catalog-entry.js'
import { offPeakActive, offPeakRemaining, rateNow } from '../lib/offpeak.js'

const RATES = { rateNow, offPeakActive, offPeakRemaining }
const NOW = new Date('2026-09-26T23:30:00+08:00')

const entryFor = (overrides = {}) =>
  normalizeEntry({
    key: 'A',
    name: 'Model A',
    priceFactor: 0.03,
    ...overrides,
  })

/** A started region stand-in: just the catalog and the region identity. */
function runtimeOf(regionId, entries) {
  return {
    runtime: {
      region: { id: regionId, displayName: regionId },
      catalog: { current: () => entries },
    },
  }
}

const build = (runtimes, settings = {}, now = NOW) =>
  buildModelRowsPayload({ runtimes, settings, now, projectRow: projectModelRow, rates: RATES })

test('every started region contributes its models', () => {
  const payload = build([
    runtimeOf('qoder-cn', [entryFor({ key: 'A', name: 'CN A' })]),
    runtimeOf('qoder', [entryFor({ key: 'B', name: 'Global B' }), entryFor({ key: 'C', name: 'Global C' })]),
  ])
  assert.strictEqual(payload.models.length, 3)
  assert.deepStrictEqual(
    payload.models.map((m) => m.id).sort(),
    ['CN A'.replace(/\s/g, ''), 'GlobalB'.replace(/\s/g, ''), 'GlobalC'.replace(/\s/g, '')].sort(),
  )
  // Each row carries its own region, so the card can group them.
  assert.deepStrictEqual(
    [...new Set(payload.models.map((m) => m.region))].sort(),
    ['qoder', 'qoder-cn'],
  )
})

test('a region with an empty catalog contributes nothing and does not fail', () => {
  const payload = build([
    runtimeOf('qoder-cn', []),
    runtimeOf('qoder', [entryFor({ key: 'B', name: 'B' })]),
  ])
  assert.strictEqual(payload.models.length, 1)
  assert.strictEqual(payload.models[0].region, 'qoder')
})

test('a switched-off region contributes nothing, and the sibling is untouched', () => {
  // The per-region provider switch: an explicit `false` hides the whole region
  // from the card's model list, exactly as the adapter hides it from the
  // picker. The other region's rows are unaffected, and a missing map (no
  // switch ever saved) offers everything — the fresh-install default.
  const runtimes = [
    runtimeOf('qoder-cn', [entryFor({ key: 'A', name: 'CN A' })]),
    runtimeOf('qoder', [entryFor({ key: 'B', name: 'Global B' })]),
  ]
  const off = build(runtimes, { enabledRegions: { 'qoder-cn': false } })
  assert.deepStrictEqual(
    off.models.map((m) => m.region),
    ['qoder'],
    'the disabled region contributes no rows',
  )
  const onAgain = build(runtimes, { enabledRegions: { 'qoder-cn': true, qoder: false } })
  assert.deepStrictEqual(
    onAgain.models.map((m) => m.id).sort(),
    ['CNA'],
    're-checking one side offers it back, with the other side now off',
  )
  const neverSaved = build(runtimes)
  assert.strictEqual(neverSaved.models.length, 2, 'an absent switch offers every region')
})

test('no regions at all yields an empty list, not a crash', () => {
  // The route is mounted before the regions are known to have started, so
  // "none yet" is a state it can be asked in.
  const payload = build([])
  assert.deepStrictEqual(payload.models, [])
})

test('the rates are resolved against the injected clock', () => {
  // The card ticks on its own, so a render at 23:30 and one at noon must
  // report different numbers for the same catalog.
  const entry = entryFor({
    priceFactor: 0.03,
    promotion: {
      active: true,
      windowStart: '22:00',
      windowEnd: '08:00',
      timezone: 'Asia/Shanghai',
      discountFactor: 0.4,
      beforePromotionPriceFactor: 0.025,
    },
  })
  const atNight = build([runtimeOf('qoder-cn', [entry])], {}, new Date('2026-09-26T23:30:00+08:00'))
  const atNoon = build([runtimeOf('qoder-cn', [entry])], {}, new Date('2026-09-26T12:00:00+08:00'))
  assert.ok(Math.abs(atNight.models[0].effectiveRate - 0.01) < 1e-9, 'inside the window: discounted')
  assert.strictEqual(atNoon.models[0].effectiveRate, 0.025, 'outside: the before rate')
  assert.strictEqual(atNight.models[0].offPeakActive, true)
  assert.strictEqual(atNoon.models[0].offPeakActive, false)
})

test('the payload carries no credential of any kind', () => {
  // This route is reachable by the settings page. It serves metadata only; a
  // token reaching it would put the account's credential in a browser-visible
  // response.
  const payload = build([runtimeOf('qoder-cn', [entryFor()])], {
    imageOverrides: { A: 'off' },
    enabledModelIds: { 'qoder-cn': ['A'] },
    useMaximumContextWindow: true,
  })
  const serialised = JSON.stringify(payload)
  for (const forbidden of ['token', 'secret', 'Authorization', 'userID', 'refreshToken', 'machineID']) {
    assert.ok(!serialised.includes(forbidden), `the payload must not mention ${forbidden}`)
  }
})

// --- the settings the card echoes back ----------------------------------

test('the settings are echoed so the card can show the saved state', () => {
  const payload = build([runtimeOf('qoder-cn', [entryFor()])], {
    imageOverrides: { A: 'off' },
    enabledModelIds: { 'qoder-cn': ['A', 'B'] },
    useMaximumContextWindow: true,
  })
  assert.deepStrictEqual(payload.imageOverrides, { A: 'off' })
  assert.deepStrictEqual(payload.enabledModelIds, { 'qoder-cn': ['A', 'B'] })
  assert.strictEqual(payload.useMaximumContextWindow, true)
})

test('a volatile settings field is unwrapped, not sent as a shell', () => {
  // The bug this file exists for. `typeof { get() {} } === 'object'`, so the
  // naive guard passes it straight through and the card receives an object with
  // nothing in it.
  const payload = build([runtimeOf('qoder-cn', [entryFor()])], {
    imageOverrides: { get: () => ({ A: 'off' }) },
    enabledModelIds: { get: () => ({ 'qoder-cn': ['A'] }) },
    useMaximumContextWindow: { get: () => true },
  })
  assert.deepStrictEqual(payload.imageOverrides, { A: 'off' }, 'the shell must not reach the card')
  assert.deepStrictEqual(payload.enabledModelIds, { 'qoder-cn': ['A'] })
  assert.strictEqual(payload.useMaximumContextWindow, true)
})

test('a volatile field that resolves to nothing falls back, it does not leak a shell', () => {
  const payload = build([runtimeOf('qoder-cn', [entryFor()])], {
    imageOverrides: { get: () => undefined },
    enabledModelIds: { get: () => null },
    useMaximumContextWindow: { get: () => false },
  })
  assert.deepStrictEqual(payload.imageOverrides, {})
  assert.deepStrictEqual(payload.enabledModelIds, {})
  assert.strictEqual(payload.useMaximumContextWindow, false)
})

test('a primitive setting falls back to an empty object', () => {
  // A hand-edited settings file could hold a string here. Sending it through
  // would make the card iterate a string's characters as a collection.
  for (const value of ['nonsense', 42, true]) {
    const payload = build([runtimeOf('qoder-cn', [entryFor()])], {
      imageOverrides: value,
      enabledModelIds: value,
    })
    assert.deepStrictEqual(payload.imageOverrides, {}, `imageOverrides ${String(value)}`)
    assert.deepStrictEqual(payload.enabledModelIds, {}, `enabledModelIds ${String(value)}`)
  }
})

test('an array setting is passed through, which is harmless for the card', () => {
  // `typeof [] === 'object'`, so the guard accepts it. That is deliberate
  // enough to pin: the card only ever reads these as maps
  // (`Object.entries(overrides)[modelId]`), and an array yields no entry for a
  // model id, which reads as "no override" — the same answer an empty object
  // gives. The assertion is here so a future change that starts rejecting
  // arrays has to say so here rather than silently.
  const payload = build([runtimeOf('qoder-cn', [entryFor()])], {
    imageOverrides: ['a', 'b'],
    enabledModelIds: ['c'],
  })
  assert.deepStrictEqual(payload.imageOverrides, ['a', 'b'])
  assert.deepStrictEqual(payload.enabledModelIds, ['c'])
  // And the card's lookup against them finds nothing, which is the intent.
  assert.strictEqual(Object.entries(payload.imageOverrides)['Model A'], undefined)
})

test('a truthy non-boolean does not switch the maximum-context setting on', () => {
  for (const value of ['true', 1, {}, []]) {
    const payload = build([runtimeOf('qoder-cn', [entryFor()])], { useMaximumContextWindow: value })
    assert.strictEqual(payload.useMaximumContextWindow, false, String(value))
  }
})

test('missing settings are served as the defaults, not omitted', () => {
  // The card reads these unconditionally; an absent key would make it compare
  // against undefined and treat the user as having unsaved edits forever.
  const payload = build([runtimeOf('qoder-cn', [entryFor()])])
  assert.deepStrictEqual(payload.imageOverrides, {})
  assert.deepStrictEqual(payload.enabledModelIds, {})
  assert.strictEqual(payload.useMaximumContextWindow, false)
})

test('the payload reports when it was rendered', () => {
  const at = new Date('2026-09-26T23:30:00+08:00')
  assert.strictEqual(build([runtimeOf('qoder-cn', [])], {}, at).refreshedAt, at.getTime())
})
