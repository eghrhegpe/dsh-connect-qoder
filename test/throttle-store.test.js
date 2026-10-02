/**
 * Round-trip tests for the on-disk exchange throttle.
 *
 * Run: node --test test/throttle-store.test.js
 *
 * The throttle gate lives in CredentialCache; this store is only what lets a
 * platform-stated rate-limit window survive a DSH restart. Two properties are
 * load-bearing and are checked against a real temporary directory rather than a
 * mock, because the whole design is a filesystem claim:
 *
 *   - a live future window is read back by a NEW store over the same path (that
 *     is the "survives a restart" guarantee — forget it and the first poll
 *     re-probes a lockout still in force);
 *   - the write is atomic (temp file + rename), so a crash never leaves a
 *     half-written JSON the next read would choke on and silently drop a window.
 *
 * The persistence POLICY is asserted too, not just the mechanics: a parked
 * dead-credential refusal is deliberately NOT written (a restart is that
 * refusal's one release), and a window that closed while the process was down
 * is dropped on read rather than honoured past its deadline.
 */
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FileThrottleStore, THROTTLE_FORMAT_VERSION } from '../src/host/throttle-store.ts'

const created = []

/** A fresh temporary directory, removed after the test. */
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'qoder-throttle-'))
  created.push(dir)
  return dir
}

afterEach(() => {
  while (created.length > 0) {
    rmSync(created.pop(), { recursive: true, force: true })
  }
})

/** A fixed wall clock, so "live" and "expired" windows are exact. */
const NOW = 1_700_000_000_000
const clock = () => NOW

test('a live rate-limit window round-trips through a new store over the same path', () => {
  const path = join(tempDir(), 'throttle.json')
  const first = new FileThrottleStore({ path, now: clock })
  assert.strictEqual(first.read(), null, 'no file means no throttle')

  first.write({ kind: 'rate-limit', parked: false, until: NOW + 120_000, attempt: 1 })

  // A second store is the stand-in for a restart: same file, fresh memory.
  const second = new FileThrottleStore({ path, now: clock })
  const held = second.read()
  assert.ok(held !== null, 'a restart must still see the window')
  assert.strictEqual(held.kind, 'rate-limit')
  assert.strictEqual(held.parked, false)
  assert.strictEqual(held.until, NOW + 120_000)
  assert.strictEqual(held.attempt, 1)
})

test('the written file carries only the throttle fields, never a token', () => {
  const path = join(tempDir(), 'throttle.json')
  const store = new FileThrottleStore({ path, now: clock })
  store.write({ kind: 'rate-limit', parked: false, until: NOW + 60_000, attempt: 2 })
  const parsed = JSON.parse(readFileSync(path, 'utf8'))
  assert.deepStrictEqual(
    Object.keys(parsed).sort(),
    ['attempt', 'kind', 'parked', 'until', 'version'],
    'the record is display state only; a secret must never land here',
  )
  assert.strictEqual(parsed.version, THROTTLE_FORMAT_VERSION)
})

test('a window that closed while the process was down is dropped on read', () => {
  const path = join(tempDir(), 'throttle.json')
  const store = new FileThrottleStore({ path, now: clock })
  // Write it while it is live, then read it back with the clock past the
  // deadline — the situation a restart after the lockout has expired lands in.
  store.write({ kind: 'rate-limit', parked: false, until: NOW + 5_000, attempt: 1 })
  const later = new FileThrottleStore({ path, now: () => NOW + 6_000 })
  assert.strictEqual(later.read(), null, 'an expired window is not a reason to refuse')
})

test('a parked refusal is not persisted — a restart is its one release', () => {
  const path = join(tempDir(), 'throttle.json')
  const store = new FileThrottleStore({ path, now: clock })
  store.write({ kind: 'dead-credential', parked: true, until: null, attempt: 3 })
  assert.ok(!existsSync(path), 'a parked refusal must not be written at all')
  assert.strictEqual(store.read(), null)
})

test('a non-future rate-limit window is not written', () => {
  const path = join(tempDir(), 'throttle.json')
  const store = new FileThrottleStore({ path, now: clock })
  // Degenerate inputs that no live process would produce, but a stale caller
  // could: an already-closed or open-ended window has nothing to honour.
  store.write({ kind: 'rate-limit', parked: false, until: NOW - 1, attempt: 1 })
  assert.ok(!existsSync(path), 'a closed window is pointless to persist')
})

test('a damaged or foreign-version file reads as absent', () => {
  const dir = tempDir()
  const path = join(dir, 'throttle.json')
  writeFileSync(path, 'not json at all', 'utf8')
  assert.strictEqual(new FileThrottleStore({ path, now: clock }).read(), null, 'a half-written file is ignored')

  writeFileSync(path, JSON.stringify({ version: 999, parked: false, until: NOW + 60_000 }), 'utf8')
  assert.strictEqual(new FileThrottleStore({ path, now: clock }).read(), null, 'a foreign version is discarded')
})

test('a parked record smuggled onto disk is not restored as a live window', () => {
  // read() is the boundary that enforces the policy: even if a parked record
  // reached disk some other way, a restart must not wake into a dead-end gate.
  const path = join(tempDir(), 'throttle.json')
  writeFileSync(path, JSON.stringify({ version: THROTTLE_FORMAT_VERSION, kind: 'dead-credential', parked: true, until: null, attempt: 1 }), 'utf8')
  assert.strictEqual(new FileThrottleStore({ path, now: clock }).read(), null)
})

test('clear removes the persisted window so the next resolve may retry', () => {
  const path = join(tempDir(), 'throttle.json')
  const store = new FileThrottleStore({ path, now: clock })
  store.write({ kind: 'rate-limit', parked: false, until: NOW + 60_000, attempt: 1 })
  assert.ok(existsSync(path))
  store.clear()
  assert.ok(!existsSync(path))
  assert.strictEqual(store.read(), null)
  // A clear of an absent file is a no-op, not an error.
  store.clear()
})

test('a failed write is logged and leaves no half-written target', () => {
  const dir = tempDir()
  // A path whose parent cannot be created as a directory (it IS a file) makes
  // mkdir throw inside write().
  const blocker = join(dir, 'blocker')
  writeFileSync(blocker, 'x', 'utf8')
  const warnings = []
  const store = new FileThrottleStore({
    path: join(blocker, 'throttle.json'),
    now: clock,
    logger: { warn: (msg, err) => warnings.push([msg, err]) },
  })
  assert.doesNotThrow(() => store.write({ kind: 'rate-limit', parked: false, until: NOW + 60_000, attempt: 1 }))
  assert.strictEqual(warnings.length, 1, 'a degraded write is at least noticed')
  // And the failure path cleans its temp file: nothing was ever written, so no
  // orphan is left to the next save.
  assert.ok(!existsSync(join(blocker, 'throttle.json.tmp')))
})
