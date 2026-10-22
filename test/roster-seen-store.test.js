/**
 * Tests for the per-region roster history (`src/host/roster-seen-store.ts`).
 *
 * Run: node --test test/roster-seen-store.test.js
 *
 * This file exists because every rule in the store is a rule about a LIE the
 * marker could tell:
 *
 *  - the first write must announce NOTHING, or every existing user is told the
 *    whole roster is brand new on the release that adds the marker;
 *  - an id that leaves the roster must be forgotten, or a model retired and
 *    later re-listed stays silent forever;
 *  - a file from a NEWER build must not be overwritten, or a downgrade resets
 *    history the newer build is still using;
 *  - a roster past the cap must write nothing, or evicting a live id makes it
 *    look unseen next round and it re-announces — oscillation;
 *  - a clock that jumped back must not extend a window indefinitely.
 *
 * Each of those is one test below. The window arithmetic is exercised with an
 * injected clock rather than `Date.now()`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  RosterSeenStore,
  ROSTER_NEW_WINDOW_MS,
  ROSTER_SEEN_MAX_IDS,
  ROSTER_SEEN_VERSION,
  normalizeRosterSeen,
} from '../src/host/roster-seen-store.ts'

const T0 = 1_700_000_000_000

/**
 * A store over a throwaway directory; the caller removes it.
 *
 * @param {string} dir
 * @param {string} [file]
 */
function storeIn(dir, file = 'seen.json') {
  return new RosterSeenStore({ path: join(dir, file) })
}

/**
 * @param {import('node:test').TestContext} t
 */
function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'qoder-roster-seen-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

/* ------------------------------------------------------------------ */
/* The first write is a SEED, not an announcement                      */
/* ------------------------------------------------------------------ */

test('the first ever write seeds the roster and announces nothing', (t) => {
  const dir = tempDir(t)
  const store = storeIn(dir)
  assert.equal(store.isSet(), false, 'a store with no file has no history yet')

  const result = store.note(['A', 'B', 'C'], T0)
  assert.deepEqual(result.newIds, [], 'a seeding write must not call the whole roster new')
  assert.equal(store.isSet(), true)

  // Seeded ids are stamped one window back, so they read as expired rather than
  // as fresh: the next read inside the window says nothing either.
  assert.deepEqual(store.fresh(T0), [])
  assert.deepEqual(store.fresh(T0 + ROSTER_NEW_WINDOW_MS - 1), [])
  assert.deepEqual(store.note(['A', 'B', 'C'], T0 + 1000).newIds, [])
})

test('a model added after the seed is announced, and only it', (t) => {
  const dir = tempDir(t)
  const store = storeIn(dir)
  store.note(['A', 'B'], T0)

  const result = store.note(['A', 'B', 'C'], T0 + 60_000)
  assert.deepEqual(result.newIds, ['C'])
  assert.deepEqual(store.fresh(T0 + 60_000), ['C'])
  // Idempotent: a second poll inside the window still names it, so the marker
  // does not blink between two five-minute reads.
  assert.deepEqual(store.note(['A', 'B', 'C'], T0 + 120_000).newIds, ['C'])
})

test('a first sighting expires after the window', (t) => {
  const dir = tempDir(t)
  const store = storeIn(dir)
  store.note(['A'], T0)
  store.note(['A', 'B'], T0 + 1000)
  assert.deepEqual(store.fresh(T0 + 1000 + ROSTER_NEW_WINDOW_MS - 1), ['B'], 'inside the window')
  assert.deepEqual(store.fresh(T0 + 1000 + ROSTER_NEW_WINDOW_MS), [], 'at the boundary it is no longer new')
  assert.deepEqual(store.note(['A', 'B'], T0 + 1000 + ROSTER_NEW_WINDOW_MS + 1).newIds, [])
})

test('an id that leaves the roster is dropped, so a re-listing is new again', (t) => {
  const dir = tempDir(t)
  const store = storeIn(dir)
  store.note(['A', 'B'], T0)
  // B retires.
  assert.deepEqual(store.note(['A'], T0 + 1000).newIds, [])
  // B comes back: a re-listing is a change the user may want to see, so it is
  // announced again rather than remembered as "seen long ago".
  assert.deepEqual(store.note(['A', 'B'], T0 + 2000).newIds, ['B'])
})

/* ------------------------------------------------------------------ */
/* Refusals and guards                                                 */
/* ------------------------------------------------------------------ */

test('a file from a newer build is refused, not overwritten', (t) => {
  const dir = tempDir(t)
  const path = join(dir, 'seen.json')
  const original = JSON.stringify({ version: 99, seen: { A: T0 } })
  writeFileSync(path, original, 'utf8')

  const store = storeIn(dir)
  assert.equal(store.refused, true, 'an unknown version must be flagged, not parsed as empty history')
  assert.deepEqual(store.note(['A', 'B'], T0 + 1000).newIds, [])
  assert.equal(readFileSync(path, 'utf8'), original, 'the newer build’s file must be left byte-identical')
})

test('a file that does not parse is rebuilt rather than refused forever', (t) => {
  const dir = tempDir(t)
  const path = join(dir, 'seen.json')
  writeFileSync(path, '{"version": 1, "seen": {', 'utf8')

  const store = storeIn(dir)
  assert.equal(store.refused, false, 'garbage has no owner, so it must not disable the marker for good')
  // The rebuild is a seed: nothing is announced, and the file is replaced.
  assert.deepEqual(store.note(['A', 'B'], T0).newIds, [])
  const rewritten = JSON.parse(readFileSync(path, 'utf8'))
  assert.equal(rewritten.version, ROSTER_SEEN_VERSION)
  assert.deepEqual(store.note(['A', 'B', 'C'], T0 + 1000).newIds, ['C'])
})

test('a roster past the cap writes nothing and announces nothing', (t) => {
  const dir = tempDir(t)
  const path = join(dir, 'seen.json')
  const store = storeIn(dir)
  store.note(['A'], T0)
  const before = readFileSync(path, 'utf8')

  const oversized = Array.from({ length: ROSTER_SEEN_MAX_IDS + 1 }, (_, index) => `M${index}`)
  assert.deepEqual(store.note(oversized, T0 + 1000).newIds, [], 'shape drift must not be reported as new models')
  assert.equal(readFileSync(path, 'utf8'), before, 'shape drift must not rewrite the history')
  // And the guard does not poison the store: the next normal roster works.
  assert.deepEqual(store.note(['A', 'B'], T0 + 2000).newIds, ['B'])
})

test('an empty roster is a no-op, not a wipe', (t) => {
  const dir = tempDir(t)
  const store = storeIn(dir)
  store.note(['A'], T0)
  assert.deepEqual(store.note([], T0 + 1000).newIds, [])
  // The history survived the empty answer, so A does not re-announce.
  assert.deepEqual(store.note(['A'], T0 + 2000).newIds, [])
})

test('a stamp in the future is clamped on the next write, not trusted', (t) => {
  const dir = tempDir(t)
  const path = join(dir, 'seen.json')
  writeFileSync(path, JSON.stringify({ version: ROSTER_SEEN_VERSION, seen: { A: T0 + ROSTER_NEW_WINDOW_MS * 10 } }), 'utf8')

  const store = storeIn(dir)
  // A future stamp reads as "just now" — a clock that jumped back must not park
  // a marker in the far future where it never expires.
  assert.deepEqual(store.fresh(T0), ['A'])
  // The next write clamps it to that write's clock, so the window restarts there
  // and the bogus stamp cannot outlive one window past the last write.
  assert.deepEqual(store.note(['A'], T0 + ROSTER_NEW_WINDOW_MS).newIds, ['A'])
  assert.deepEqual(store.fresh(T0 + 2 * ROSTER_NEW_WINDOW_MS), [], 'it expires one window after the clamping write')
})

test('history survives a restart', (t) => {
  const dir = tempDir(t)
  const first = storeIn(dir)
  first.note(['A'], T0)
  first.note(['A', 'B'], T0 + 1000)

  const second = storeIn(dir)
  assert.deepEqual(second.fresh(T0 + 2000), ['B'], 'a restart must not re-announce the whole roster')
  // One window after B's first sighting it stops being new, so the later roster
  // answers only C — the restart did not reset B's clock.
  assert.deepEqual(second.note(['A', 'B', 'C'], T0 + 1000 + ROSTER_NEW_WINDOW_MS).newIds, ['C'])
})

test('normalizeRosterSeen keeps only usable entries', () => {
  assert.deepEqual(normalizeRosterSeen({ A: T0, B: 0, C: -1, D: 'x', '': T0 }), { A: T0 })
  assert.deepEqual(normalizeRosterSeen(null), {})
  assert.deepEqual(normalizeRosterSeen(['nope']), {}, 'an array is a shape this build does not read')
  assert.deepEqual(normalizeRosterSeen({ A: Number.NaN }), {})
})

test('the persisted file is the documented shape', (t) => {
  const dir = tempDir(t)
  const path = join(dir, 'seen.json')
  const store = storeIn(dir)
  store.note(['A'], T0)
  const parsed = JSON.parse(readFileSync(path, 'utf8'))
  assert.equal(parsed.version, ROSTER_SEEN_VERSION)
  assert.equal(typeof parsed.updatedAt, 'string')
  assert.equal(typeof parsed.seen.A, 'number')
  assert.ok(existsSync(path))
})
