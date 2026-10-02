/**
 * Tests for `src/client/controller.ts` — the card's editable-state machine.
 *
 * THIS IS THE FILE THAT JUSTIFIES THE REFACTOR. Before `controller.ts` existed,
 * these rules lived inside `QoderPluginCard`, a React component no Node test
 * could import without a browser. They are exactly the rules a user depends on
 * — does this edit count as unsaved? does a refused write show a failure? does
 * a refresh clobber edits I have not saved? — and they are now testable here,
 * with no jsdom, no React, and no `fetch`. The DOM harness
 * (`test/card-dom.test.js`) is left to prove the JSX still renders them; this
 * file proves they are right.
 *
 * Imports the `.ts` source directly (Node type-stripping), not the built bundle,
 * on purpose: this layer is asserted at the source, and `test/client-bundle.*`
 * keeps the shipped artifact honest about matching it.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { QoderCardController, enabledIdsFor, imageModeOf, initialEditableState, HIDE_ALL_MODELS } from '../src/client/controller.ts'

/** A roster for one region, so tests read clearly. */
function roster(entries) {
  return entries.map(([id, region, name]) => ({ id, region, name }))
}

/** An empty saved document, as a fresh install would have it. */
function blank() {
  return { imageOverrides: {}, maxWindow: false, enabledIds: {} }
}

/** A controller over a small two-region roster, no edits made. */
function fresh(extra = {}) {
  const controller = new QoderCardController(blank())
  controller.setModels(roster(extra.models ?? [
    ['qwen3-max', 'qoder-cn', 'Qwen3 Max'],
    ['deepseek-v3', 'qoder-cn', 'DeepSeek V3'],
    ['gpt-5', 'qoder', 'GPT-5'],
  ]))
  return controller
}

test('a fresh card is not dirty and shows everything ticked', () => {
  const controller = fresh()
  const state = controller.getSnapshot()
  assert.equal(state.dirty, false)
  // The host stores `[]` as "no filter", so a card with no saved allow-list
  // renders every row ticked — that is the convention `enabledIdsFor` encodes.
  assert.equal(state.visibleTicked, 2)
  assert.equal(state.regionAllTicked, true)
  assert.equal(state.lastSave, undefined)
})

test('`seedSaved` is what makes an edit dirty, and only then', () => {
  const controller = fresh()
  controller.setModels([{ id: 'm', region: 'qoder-cn' }])
  // Nothing seeded yet: the saved document is blank, so ticking reads as dirty.
  controller.toggleModel('qoder-cn', 'm')
  assert.equal(controller.getSnapshot().dirty, true)
  // Seeding mirrors saved onto staged, so the same value stops being an edit.
  controller.seedSaved({ imageOverrides: {}, maxWindow: false, enabledIds: { 'qoder-cn': [] } })
  assert.equal(controller.getSnapshot().dirty, false)
})

test('a save that succeeds promotes staged to saved and reports ok', async () => {
  const controller = fresh()
  controller.setMaxWindow(true)
  assert.equal(controller.getSnapshot().dirty, true)
  await controller.save(async () => {})
  const state = controller.getSnapshot()
  assert.equal(state.dirty, false)
  assert.deepEqual(state.lastSave, { ok: true })
})

test('a refused write surfaces a failure and keeps the edits', async () => {
  const controller = fresh()
  controller.setMode('qwen3-max', 'on')
  await controller.save(async () => {
    throw new Error('disk full')
  })
  const state = controller.getSnapshot()
  assert.equal(state.dirty, true, 'a failed save must not pretend the edit landed')
  assert.equal(state.lastSave?.ok, false)
  assert.equal(state.lastSave?.reason, 'disk full')
})

test('`discard` returns every field to the last saved document', () => {
  const controller = fresh()
  controller.seedSaved({ imageOverrides: { qwen3: 'on' }, maxWindow: true, enabledIds: { 'qoder-cn': ['qwen3-max'] } })
  controller.setMode('qwen3-max', 'off')
  controller.setMaxWindow(false)
  controller.toggleModel('qoder-cn', 'deepseek-v3')
  controller.discard()
  const state = controller.getSnapshot()
  assert.equal(state.dirty, false)
  assert.equal(state.imageOverrides.qwen3, 'on')
  assert.equal(state.maxWindow, true)
})

test('`setMode("auto")` removes the override so the saved doc stays minimal', () => {
  const controller = fresh()
  controller.seedSaved({ imageOverrides: { m: 'off' }, maxWindow: false, enabledIds: {} })
  controller.setMode('m', 'auto')
  assert.deepEqual(controller.getSnapshot().imageOverrides, {})
})

test('the roster feeds the region-scoped view', () => {
  const controller = fresh()
  const state = controller.getSnapshot()
  assert.deepEqual(state.regionModels.map((m) => m.id), ['qwen3-max', 'deepseek-v3'])
  controller.setActiveRegion('qoder')
  assert.deepEqual(controller.getSnapshot().regionModels.map((m) => m.id), ['gpt-5'])
})

test('`setRegionAll` writes the sentinel for hide-all and the empty list for show-all', () => {
  const controller = fresh()
  // The button passes `regionAllTicked`, so `true` is "everything is ticked —
  // flip to hide all"; `false` is "something is unticked — flip to show all".
  controller.setRegionAll('qoder-cn', true)
  assert.deepEqual(controller.getSnapshot().enabledIds['qoder-cn'], [HIDE_ALL_MODELS])
  controller.setRegionAll('qoder-cn', false)
  assert.deepEqual(controller.getSnapshot().enabledIds['qoder-cn'], [])
})

test('the name filter narrows the view and never the saved document', () => {
  const controller = fresh()
  controller.setQuery('qwen')
  const state = controller.getSnapshot()
  assert.deepEqual(state.visibleModels.map((m) => m.id), ['qwen3-max'])
  assert.equal(state.dirty, false, 'the filter is view-only')
  assert.deepEqual(state.enabledIds, {}, 'the filter must not touch what is saved')
})

test('`visibleTicked` counts only rows the active region can address', () => {
  const controller = fresh()
  // A row with no region is present in the roster but unaddressable.
  controller.setModels([
    { id: 'a', region: 'qoder-cn', name: 'A' },
    { id: 'b', region: 'qoder-cn', name: 'B' },
    { id: 'orphan', name: 'Orphan' },
  ])
  controller.toggleModel('qoder-cn', 'a')
  assert.equal(controller.getSnapshot().visibleTicked, 1)
})

test('re-subscribing then unsubscribing does not leak listeners', () => {
  const controller = fresh()
  let calls = 0
  const off = controller.subscribe(() => {
    calls += 1
  })
  controller.setMaxWindow(true)
  assert.equal(calls, 1)
  off()
  controller.setMaxWindow(false)
  assert.equal(calls, 1, 'an unsubscribed listener must not fire')
})

test('`getSnapshot` is referentially stable until a mutation', () => {
  const controller = fresh()
  const before = controller.getSnapshot()
  assert.equal(controller.getSnapshot(), before, 'two reads with no change must be the same object')
  controller.setMaxWindow(true)
  assert.notEqual(controller.getSnapshot(), before)
})

test('a save while one is already in flight is ignored', async () => {
  const controller = fresh()
  controller.setMaxWindow(true)
  let releases = 0
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  // Persist answers each of the three fields once the gate is opened; before
  // that it holds, so the first save is provably still in flight.
  const holding = async () => {
    releases += 1
    await gate
  }
  const inFlight = controller.save(holding)
  // The second save lands while `saving` is already true, so it must no-op.
  await controller.save(holding)
  assert.equal(releases, 1)
  release()
  await inFlight
  assert.equal(releases, 3, 'all three fields of the first save were written; the second was ignored')
  assert.equal(controller.getSnapshot().dirty, false)
})

test('`initialEditableState` degrades a malformed answer to blanks', () => {
  assert.deepEqual(initialEditableState(null), { imageOverrides: {}, maxWindow: false, enabledIds: {} })
  assert.deepEqual(initialEditableState('garbage'), { imageOverrides: {}, maxWindow: false, enabledIds: {} })
  assert.equal(initialEditableState({ useMaximumContextWindow: true }).maxWindow, true)
})

test('`enabledIdsFor` reads an empty list as "every model"', () => {
  const models = roster([['a', 'qoder-cn'], ['b', 'qoder-cn']])
  assert.deepEqual([...enabledIdsFor(models, [])], ['a', 'b'])
  assert.deepEqual([...enabledIdsFor(models, ['b'])], ['b'])
  assert.deepEqual([...enabledIdsFor(models, undefined)], ['a', 'b'])
})

test('`imageModeOf` falls back to auto for anything it does not recognise', () => {
  assert.equal(imageModeOf({ m: 'on' }, 'm'), 'on')
  assert.equal(imageModeOf({ m: 'off' }, 'm'), 'off')
  assert.equal(imageModeOf({ m: 'weird' }, 'm'), 'auto')
  assert.equal(imageModeOf(undefined, 'm'), 'auto')
  assert.equal(imageModeOf({}, 'm'), 'auto')
})