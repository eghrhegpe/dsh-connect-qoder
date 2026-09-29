/**
 * Tests for the unwrap-failure window that caps how often a broken machine
 * pays for a blocking subprocess (issue 07).
 *
 * Run: node --test test/unwrap-failure-window.test.js
 *
 * The unwrap is `execFileSync` with a 30 s timeout, reached from the card's
 * account route on every render. The original rule — "a failure is never
 * cached" — was chosen so a transient fault could not pin a region as unusable
 * for the life of the process, and it is right about that. It was wrong about
 * the cost: an app whose `Local State` cannot be unwrapped is precisely the
 * state the account panel exists to explain, so opening the panel, switching
 * tabs and re-opening it each paid a synchronous subprocess, blocking the whole
 * host event loop for up to 30 s per render.
 *
 * So the failure is remembered for a short window. The two properties that make
 * that safe are asserted here, and both are the ones a future edit is most
 * likely to break:
 *
 * - the window EXPIRES, so a user who fixed the machine and retried is not told
 *   "unreadable" for a minute;
 * - a rewritten `Local State` ends the window EARLY, so the retry lands when the
 *   user re-signed-in rather than up to a minute later — the same
 *   "bind the answer to the file it came from" rule the key cache uses.
 *
 * And the one that is NOT a property: the recorded reason stays readable inside
 * the window. Suppressing the retry must not blank the explanation.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { failureStillBlocks, UNWRAP_FAILURE_TTL_MS } from '../lib/credentials.js'

const IDENTITY = '1700000000000:512'
const AT = 1_700_000_000_000

test('a fresh failure suppresses another attempt', () => {
  const entry = { reason: 'PowerShell exited 1', at: AT, identity: IDENTITY }
  assert.strictEqual(failureStillBlocks(entry, IDENTITY, AT), true)
})

test('the window expires, so a fixed machine is retried', () => {
  const entry = { reason: 'PowerShell exited 1', at: AT, identity: IDENTITY }
  assert.strictEqual(failureStillBlocks(entry, IDENTITY, AT + UNWRAP_FAILURE_TTL_MS - 1), true)
  assert.strictEqual(
    failureStillBlocks(entry, IDENTITY, AT + UNWRAP_FAILURE_TTL_MS),
    false,
    'at the TTL the attempt must be allowed again — a user who re-signed-in and clicked retry waits at most this',
  )
  assert.strictEqual(failureStillBlocks(entry, IDENTITY, AT + UNWRAP_FAILURE_TTL_MS * 10), false)
})

test('a rewritten Local State ends the window early', () => {
  // Re-signing-in rewrites the app's state file, and that is precisely when the
  // user expects a retry. Making them wait out the window would look like the
  // plugin ignoring them.
  const entry = { reason: 'PowerShell exited 1', at: Date.now(), identity: IDENTITY }
  assert.strictEqual(failureStillBlocks(entry, '1700000099000:512'), false)
  // Including when the file went away entirely.
  assert.strictEqual(failureStillBlocks(entry, undefined), false)
})

test('no recorded failure never blocks', () => {
  assert.strictEqual(failureStillBlocks(undefined, IDENTITY, AT), false)
  assert.strictEqual(failureStillBlocks(null, IDENTITY, AT), false)
  // And with no file there is nothing to block on either — a directory that was
  // never attempted must not read as "recently failed".
  assert.strictEqual(failureStillBlocks(undefined, undefined, AT), false)
})

test('an entry with no identity is judged on age alone', () => {
  // Backward compatibility with an entry written before identities were
  // recorded: there is nothing to compare, so the age rule stands by itself
  // rather than the entry being trusted forever or discarded instantly.
  const entry = { reason: 'boom', at: AT }
  assert.strictEqual(failureStillBlocks(entry, IDENTITY, AT), true)
  assert.strictEqual(failureStillBlocks(entry, IDENTITY, AT + UNWRAP_FAILURE_TTL_MS), false)
})

test('the window is a real duration, not zero or unbounded', () => {
  // Guards the two degenerate settings a careless edit would produce: 0 blocks
  // nothing (the original bug back), and Infinity blocks forever (the failure
  // is pinned, which is what the original rule was written to prevent).
  assert.ok(UNWRAP_FAILURE_TTL_MS > 0, 'a zero window suppresses nothing')
  assert.ok(UNWRAP_FAILURE_TTL_MS <= 5 * 60 * 1000, 'the window must stay short enough to feel responsive')
  assert.ok(Number.isFinite(UNWRAP_FAILURE_TTL_MS), 'an infinite window pins the failure forever')
})
