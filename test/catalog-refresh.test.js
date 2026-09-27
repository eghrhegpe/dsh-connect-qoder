/**
 * Tests for what a catalog refresh commits, and what it keeps.
 *
 * Run: node --test test/catalog-refresh.test.js
 *
 * This file is the guard for issue 04 ("成功但空" 冻结) and for the three
 * outcomes a refresh can have, which used to be two. The original code was
 *
 * ```js
 * if (entries.length > 0) { this.catalog.replace(entries); this.invalidate?.() }
 * ```
 *
 * so an upstream catalog of zero models took the same path as a thrown fetch:
 * nothing happened, the previous roster was served forever, and the refresh
 * button — the only thing a user could reach for — had no code path that could
 * change anything. Nothing warned, nothing was logged as a failure, and the
 * card went on displaying models the account no longer has.
 *
 * The rules asserted here are the opposite of that, and each one is paired with
 * the mutation that must break it: putting the length guard back turns
 * "an empty catalog is committed" red, and deleting the `invalidate` call turns
 * "the picker is re-advertised" red.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { applyCatalogOutcome, REFRESH_FAILURE_REASONS } from '../lib/catalog-refresh.js'
import { normalizeEntry } from '../lib/catalog-entry.js'
import { ProtocolShapeChangedError, isProtocolShapeChangedError } from '../lib/errors.js'

/** A catalog stand-in that records what was committed and when. */
function makeCatalog(initial = [], now = 1_000) {
  const catalog = {
    entries: initial,
    fetchedAt: 500,
    replacements: [],
    replace(entries, at = now) {
      this.entries = entries
      this.fetchedAt = at
      this.replacements.push(entries)
    },
  }
  return catalog
}

/** A runtime stand-in exposing only what the outcome applier touches. */
function makeRuntime({ entries = [], now = 1_000, invalidate } = {}) {
  const runtime = { catalog: makeCatalog(entries, now), invalidations: 0 }
  if (invalidate !== false) {
    runtime.invalidate = () => {
      runtime.invalidations += 1
    }
  }
  return runtime
}

const ENTRY = normalizeEntry({ key: 'A', name: 'Model A', priceFactor: 0.01 })

// --- the three outcomes ----------------------------------------------------

test('an empty catalog is committed: this is the freeze (issue 04)', () => {
  const runtime = makeRuntime({ entries: [ENTRY], now: 2_000 })
  const result = applyCatalogOutcome(runtime, { ok: true, entries: [] })

  assert.strictEqual(result.committed, true, 'zero models is an answer, not a failure')
  assert.deepStrictEqual(runtime.catalog.entries, [], 'the stale roster must not survive an empty answer')
  assert.deepStrictEqual(runtime.catalog.replacements, [[]], 'replace() was called with the empty list')
})

test('an empty catalog advances fetchedAt, so it does not look like a stale one', () => {
  // The TTL is what schedules the next fetch and what the card's "last fetched"
  // reads. If an empty answer left `fetchedAt` alone, the store would instantly
  // look due for another refresh — and the card would show an age that keeps
  // growing for a state that is not changing.
  const runtime = makeRuntime({ entries: [ENTRY] })
  assert.strictEqual(runtime.catalog.fetchedAt, 500)
  applyCatalogOutcome(runtime, { ok: true, entries: [] })
  assert.strictEqual(runtime.catalog.fetchedAt, 1_000)
})

test('an empty catalog still re-advertises the provider, so the picker can hide it', () => {
  // This is the branch the old guard skipped along with the replace: DSH hides a
  // model group by being told the provider has none, and `llm/adapters-updated`
  // is how it is told. Skipping it here is how a retired model keeps being
  // offered while the card says it is gone.
  const runtime = makeRuntime({ entries: [ENTRY] })
  applyCatalogOutcome(runtime, { ok: true, entries: [] })
  assert.strictEqual(runtime.invalidations, 1)
})

test('a non-empty catalog is committed the same way', () => {
  const runtime = makeRuntime({ entries: [] })
  const result = applyCatalogOutcome(runtime, { ok: true, entries: [ENTRY] })
  assert.strictEqual(result.committed, true)
  assert.deepStrictEqual(runtime.catalog.entries, [ENTRY])
  assert.strictEqual(runtime.invalidations, 1)
  assert.strictEqual(runtime.refreshFailed, undefined)
})

test('a thrown fetch keeps the previous catalog and its timestamp', () => {
  const runtime = makeRuntime({ entries: [ENTRY] })
  const result = applyCatalogOutcome(runtime, { ok: false, reason: 'fetch', error: new Error('HTTP 500') })

  assert.strictEqual(result.committed, false, 'a failure must not claim to have refreshed')
  assert.deepStrictEqual(runtime.catalog.entries, [ENTRY], 'the last good roster stands')
  assert.deepStrictEqual(runtime.catalog.replacements, [], 'and nothing was written to it')
  assert.strictEqual(runtime.catalog.fetchedAt, 500, 'its age does not move')
  assert.strictEqual(runtime.invalidations, 0)
})

test('an unresolvable credential keeps the catalog too', () => {
  // Three reasons that all keep the previous rows but mean different things to
  // the reader: no credential yet is a setup state, a credential error is local,
  // and a fetch error is upstream.
  for (const reason of ['credential', 'no-credential', 'fetch']) {
    const runtime = makeRuntime({ entries: [ENTRY] })
    applyCatalogOutcome(runtime, { ok: false, reason, error: new Error('x') })
    assert.deepStrictEqual(runtime.catalog.entries, [ENTRY], reason)
    assert.strictEqual(runtime.refreshFailed.reason, reason)
  }
})

test('a protocol shape change keeps the catalog and is labelled as such', () => {
  // Issue 10. The plugin cannot fix an envelope it no longer recognises by
  // re-reading the same endpoint, so this is the one failure that must NOT be
  // presented as a transient one: the user's next action is to update the
  // plugin, not to sign in or wait.
  const runtime = makeRuntime({ entries: [ENTRY] })
  const error = new ProtocolShapeChangedError('no `chat` group; groups present: models')
  applyCatalogOutcome(runtime, { ok: false, reason: 'protocol-shape-changed', error })

  assert.deepStrictEqual(runtime.catalog.entries, [ENTRY], 'the old rows are still the best known answer')
  assert.strictEqual(runtime.refreshFailed.reason, 'protocol-shape-changed')
  assert.strictEqual(isProtocolShapeChangedError(runtime.refreshFailed.error), true)
})

test('a successful refresh clears an earlier failure', () => {
  // Otherwise a transient hiccup would brand the account "needs an update"
  // forever, which is the mirror image of the original bug: one honest failure
  // becomes a permanent, wrong accusation.
  const runtime = makeRuntime({ entries: [ENTRY] })
  applyCatalogOutcome(runtime, { ok: false, reason: 'fetch', error: new Error('boom') })
  assert.ok(runtime.refreshFailed !== undefined)
  applyCatalogOutcome(runtime, { ok: true, entries: [ENTRY] })
  assert.strictEqual(runtime.refreshFailed, undefined, 'a good answer must clear the failure marker')
})

test('a runtime with no invalidate hook does not throw', () => {
  // `invalidate` is optional (`this.invalidate?.()` in the original) because a
  // runtime can exist before the activation tail wires it. An optional call
  // that is written as a required one would take down every refresh.
  const runtime = { catalog: makeCatalog([ENTRY]) }
  assert.doesNotThrow(() => applyCatalogOutcome(runtime, { ok: true, entries: [] }))
  assert.deepStrictEqual(runtime.catalog.entries, [])
})

test('the failure reason is always a known one', () => {
  // The card maps reasons to copy. A reason invented by a future edit would
  // render as an empty string, so an unrecognised one falls back to the generic
  // bucket rather than travelling onward.
  const runtime = makeRuntime()
  applyCatalogOutcome(runtime, { ok: false, reason: 'something-new', error: undefined })
  assert.strictEqual(runtime.refreshFailed.reason, 'something-new')

  const missing = makeRuntime()
  applyCatalogOutcome(missing, { ok: false })
  assert.strictEqual(missing.refreshFailed.reason, 'fetch')
  assert.ok(REFRESH_FAILURE_REASONS.includes(missing.refreshFailed.reason))
})

test('the applier reports which previous failure it displaced', () => {
  // So a caller can log "recovered" rather than only ever logging the current
  // state — a transition is the interesting event when the verdict changes.
  const runtime = makeRuntime()
  const first = applyCatalogOutcome(runtime, { ok: false, reason: 'fetch', error: undefined })
  assert.strictEqual(first.previousFailure, undefined)
  const second = applyCatalogOutcome(runtime, { ok: false, reason: 'fetch', error: undefined })
  assert.strictEqual(second.previousFailure.reason, 'fetch')
  const recovered = applyCatalogOutcome(runtime, { ok: true, entries: [] })
  assert.strictEqual(recovered.previousFailure.reason, 'fetch', 'the caller can now see it cleared')
})
