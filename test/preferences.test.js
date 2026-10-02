/**
 * Tests for the settings readers the adapter and the card route share.
 *
 * Run: node --test test/preferences.test.js
 *
 * These three settings are read on every model build and on every card render,
 * so their resolution is on a hot path — and it was inlined in `activate`, which
 * cannot be imported. Two of the three are read through a 0.1.7 volatile
 * `{ get() }` shell, which is the shape that quietly returns the wrapper
 * instead of the value if you forget to unwrap.
 *
 * The prototype-chain cases are here because a bare `dict[key]` lookup reads the
 * prototype chain, and a model id or region id arrives from a settings document
 * rather than from code. They happen to be harmless today — the prototype's
 * values are functions, and every reader here filters for strings — but that is
 * a coincidence of the current filter, not a property of the code. The
 * `Object.hasOwn` guards are therefore defensive rather than observable: removing
 * them was measured to leave this file green, because `Array.isArray` and the
 * mode whitelist reject the prototype's values anyway. They are kept because the
 * guarantee should not depend on what `Object.prototype` happens to hold — see
 * docs/KNOWN_GAPS.md.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  enabledIdsFor,
  imageModeFor,
  preferMaximumContext,
  regionEnabledFor,
  resolvePreferences,
} from '../src/host/preferences.ts'
import { unwrapVolatile } from '../src/host/volatile.ts'

/** A 0.1.7 volatile field: a `{ get() }` shell rather than a value. */
const ref = (value) => ({ get: () => value })

// --- unwrapping ----------------------------------------------------------

test('a volatile reference is unwrapped and everything else passes through', () => {
  assert.deepStrictEqual(unwrapVolatile(ref({ a: 1 })), { a: 1 })
  assert.strictEqual(unwrapVolatile(ref(true)), true)
  assert.strictEqual(unwrapVolatile(ref(false)), false)
  assert.strictEqual(unwrapVolatile(ref(0)), 0)
  assert.strictEqual(unwrapVolatile(ref('')), '')
  assert.strictEqual(unwrapVolatile(ref(null)), null)
  // Non-references.
  assert.strictEqual(unwrapVolatile(undefined), undefined)
  assert.strictEqual(unwrapVolatile(null), null)
  assert.strictEqual(unwrapVolatile(false), false)
  assert.strictEqual(unwrapVolatile(0), 0)
  const plain = { a: 1 }
  assert.strictEqual(unwrapVolatile(plain), plain, 'a plain object is returned as-is')
  // An object with a non-callable `get` is not a reference.
  assert.deepStrictEqual(unwrapVolatile({ get: 1 }), { get: 1 })
  // A function has no `get`, so it is not treated as one.
  const fn = () => {}
  assert.strictEqual(unwrapVolatile(fn), fn)
})

// --- source resolution ---------------------------------------------------

test('a plain object source is merged over the snapshot', () => {
  const snapshot = { a: 1, b: 2 }
  assert.deepStrictEqual(resolvePreferences(snapshot, { b: 3, c: 4 }), { a: 1, b: 3, c: 4 })
})

test('a function source is called, and a reference to a document is unwrapped', () => {
  // The three shapes the two host generations hand over.
  assert.deepStrictEqual(resolvePreferences({ a: 1 }, () => ({ a: 2 })), { a: 2 })
  assert.deepStrictEqual(resolvePreferences({ a: 1 }, ref({ a: 3 })), { a: 3 })
  assert.deepStrictEqual(resolvePreferences({ a: 1 }, () => ref({ a: 4 })), { a: 4 })
})

test('a source that resolves to nothing falls back to the snapshot', () => {
  // A half-finished hand-off must not blank the card.
  for (const source of [undefined, null, () => undefined, () => null, ref(undefined), ref(null)]) {
    assert.deepStrictEqual(resolvePreferences({ a: 1 }, source), { a: 1 }, `source ${String(source)}`)
  }
})

test('a non-plain-object source is ignored rather than spread in', () => {
  // An array or a Date is an object; spreading one would add keys nobody asked
  // for — an array would become `{0: …, 1: …}` and look like a config.
  const snapshot = { a: 1 }
  for (const source of [[1, 2, 3], new Date(0), 'string', 42, true]) {
    assert.deepStrictEqual(resolvePreferences(snapshot, source), snapshot, `source ${String(source)}`)
  }
})

test('a source that throws propagates rather than blanking the card', () => {
  // Silently returning the snapshot would hide a broken hand-off; the caller
  // has a try/catch that reports it.
  assert.throws(
    () => resolvePreferences({ a: 1 }, () => { throw new Error('host went away') }),
    /host went away/,
  )
})

// --- enabled models -----------------------------------------------------

test('an empty allow-list means no filter, not nothing', () => {
  // A fresh install has saved nothing and must still see every model.
  assert.deepStrictEqual(enabledIdsFor({}, 'qoder-cn'), [])
  assert.deepStrictEqual(enabledIdsFor({ enabledModelIds: {} }, 'qoder-cn'), [])
  assert.deepStrictEqual(enabledIdsFor({ enabledModelIds: ref({}) }, 'qoder-cn'), [])
})

test('a region allow-list is read as-is', () => {
  const preferences = { enabledModelIds: { 'qoder-cn': ['A', 'B'], qoder: ['C'] } }
  assert.deepStrictEqual(enabledIdsFor(preferences, 'qoder-cn'), ['A', 'B'])
  assert.deepStrictEqual(enabledIdsFor(preferences, 'qoder'), ['C'])
  assert.deepStrictEqual(enabledIdsFor(preferences, 'qoder-extra'), [])
})

test('the allow-list is read through a volatile reference', () => {
  const preferences = { enabledModelIds: ref({ 'qoder-cn': ['A'] }) }
  assert.deepStrictEqual(enabledIdsFor(preferences, 'qoder-cn'), ['A'])
})

test('junk inside the allow-list is discarded', () => {
  const preferences = { enabledModelIds: { 'qoder-cn': ['A', '', 7, null, 'B'] } }
  assert.deepStrictEqual(enabledIdsFor(preferences, 'qoder-cn'), ['A', 'B'])
})

test('a non-object or non-array allow-list yields no filter', () => {
  for (const value of [null, undefined, 'string', 42, { 'qoder-cn': 'not-an-array' }, { 'qoder-cn': { a: 1 } }]) {
    assert.deepStrictEqual(enabledIdsFor({ enabledModelIds: value }, 'qoder-cn'), [], String(value))
  }
})

test('a prototype property is not a region allow-list', () => {
  // `byRegion['constructor']` yields a function, not undefined, so a bare
  // lookup reads the prototype chain. It is filtered today only because a
  // function is not an array.
  for (const key of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']) {
    assert.deepStrictEqual(
      enabledIdsFor({ enabledModelIds: { 'qoder-cn': ['A'] } }, key),
      [],
      `${key} must not resolve to an allow-list`,
    )
  }
})

// --- image mode ---------------------------------------------------------

test('image mode defaults to auto', () => {
  assert.strictEqual(imageModeFor({}, 'ModelA'), 'auto')
  assert.strictEqual(imageModeFor({ imageOverrides: {} }, 'ModelA'), 'auto')
  assert.strictEqual(imageModeFor({ imageOverrides: ref({}) }, 'ModelA'), 'auto')
})

test('a saved override is honoured', () => {
  const preferences = { imageOverrides: { ModelA: 'off', ModelB: 'on' } }
  assert.strictEqual(imageModeFor(preferences, 'ModelA'), 'off')
  assert.strictEqual(imageModeFor(preferences, 'ModelB'), 'on')
  // Through a volatile reference.
  assert.strictEqual(imageModeFor({ imageOverrides: ref(preferences.imageOverrides) }, 'ModelA'), 'off')
})

test('an unrecognised stored value degrades to auto, never to off', () => {
  // Defaulting to off would silently drop image input for every model after a
  // settings format change — the failure mode with no visible symptom until a
  // model refuses an image.
  for (const stored of ['nonsense', '', true, 1, null, {}, ['on'], undefined]) {
    assert.strictEqual(
      imageModeFor({ imageOverrides: { ModelA: stored } }, 'ModelA'),
      'auto',
      `stored ${JSON.stringify(stored)} must degrade to auto`,
    )
  }
})

test('auto stored explicitly is still auto', () => {
  // The card never writes it, but a hand-edited settings file might.
  assert.strictEqual(imageModeFor({ imageOverrides: { ModelA: 'auto' } }, 'ModelA'), 'auto')
})

test('a prototype property is not an image override', () => {
  for (const key of ['constructor', 'toString', 'valueOf', '__proto__', 'hasOwnProperty']) {
    assert.strictEqual(
      imageModeFor({ imageOverrides: { ModelA: 'off' } }, key),
      'auto',
      `${key} must not resolve to an image mode`,
    )
  }
})

// --- maximum context ----------------------------------------------------

test('the maximum-context switch is true only when exactly true', () => {
  assert.strictEqual(preferMaximumContext({ useMaximumContextWindow: true }), true)
  // Everything else is off: a truthy string from a hand-edited file must not
  // silently switch the behaviour on.
  for (const value of ['true', 1, 'yes', {}, [], 0, null, undefined, false]) {
    assert.strictEqual(preferMaximumContext({ useMaximumContextWindow: value }), false, String(value))
  }
  assert.strictEqual(preferMaximumContext({}), false)
  assert.strictEqual(preferMaximumContext(undefined), false)
})

test('the maximum-context switch is read through a volatile reference', () => {
  assert.strictEqual(preferMaximumContext({ useMaximumContextWindow: ref(true) }), true)
  assert.strictEqual(preferMaximumContext({ useMaximumContextWindow: ref(false) }), false)
})

test('the readers tolerate a missing preferences object', () => {
  // `current()` can return a partial document; none of these may throw on a
  // card render.
  assert.doesNotThrow(() => enabledIdsFor(undefined, 'qoder-cn'))
  assert.doesNotThrow(() => imageModeFor(undefined, 'ModelA'))
  assert.doesNotThrow(() => preferMaximumContext(undefined))
  assert.doesNotThrow(() => regionEnabledFor(undefined, 'qoder-cn'))
})

// --- per-region provider switch ------------------------------------------

test('a region is offered by default; only an explicit false disables it', () => {
  // The switch is opt-out: a fresh install has saved nothing and offers every
  // readable region. Both "no field at all" and "no key for this region" read
  // as offered.
  assert.strictEqual(regionEnabledFor({}, 'qoder-cn'), true)
  assert.strictEqual(regionEnabledFor({ enabledRegions: {} }, 'qoder-cn'), true)
  assert.strictEqual(regionEnabledFor({ enabledRegions: { qoder: false } }, 'qoder-cn'), true)
  assert.strictEqual(regionEnabledFor({ enabledRegions: ref({ qoder: false }) }, 'qoder-cn'), true)
  // An explicit false is the only disabling value; true and stored-truthy junk
  // all read as offered.
  assert.strictEqual(regionEnabledFor({ enabledRegions: { 'qoder-cn': false } }, 'qoder-cn'), false)
  assert.strictEqual(regionEnabledFor({ enabledRegions: { 'qoder-cn': true } }, 'qoder-cn'), true)
  assert.strictEqual(regionEnabledFor({ enabledRegions: { 'qoder-cn': 'yes' } }, 'qoder-cn'), true)
})

test('the region switch is read through a volatile reference', () => {
  assert.strictEqual(regionEnabledFor({ enabledRegions: ref({ 'qoder-cn': false }) }, 'qoder-cn'), false)
  assert.strictEqual(regionEnabledFor({ enabledRegions: ref({ 'qoder-cn': true }) }, 'qoder-cn'), true)
})

test('a non-map region switch degrades to offered', () => {
  // A hand-edited settings file can hold anything; a non-object map means "no
  // switch was ever saved", which is the offered default rather than a fault.
  for (const value of [null, undefined, 'off', 0, [], false]) {
    assert.strictEqual(regionEnabledFor({ enabledRegions: value }, 'qoder-cn'), true, String(value))
  }
})

test('a prototype property is not a region switch', () => {
  // `map['constructor']` would read the prototype chain; only own keys count,
  // so an inherited member can never read as an explicit `false`.
  for (const key of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']) {
    assert.strictEqual(regionEnabledFor({ enabledRegions: {} }, key), true, `${key} must read as offered`)
  }
})
