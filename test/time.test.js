/**
 * Tests for the shared upstream timestamp coercion.
 *
 * Run: node --test test/time.test.js
 *
 * The reason this module exists at all: `upstream.js` and `claim.js` used to
 * each carry a copy of this coercion, and the copies disagreed — one accepted
 * RFC 3339 strings, the other did not, and they drew the seconds/milliseconds
 * line at different thresholds. That split is exactly how the claim endpoint's
 * `"expiresAt":"2026-10-26T03:38:29.310161Z"` string went unparsed until a
 * real POST surfaced it. One definition, one behaviour — and these assertions
 * lock the three shapes the upstream actually emits (seconds, milliseconds,
 * RFC 3339) plus the invalid inputs that must yield `undefined`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { toEpochMs } from '../src/host/time.ts'

test('second-precision integers are scaled to milliseconds', () => {
  // 2026-09-25T10:00:00Z, as the campaign window publishes it.
  assert.strictEqual(toEpochMs(1790388000), 1790388000 * 1000)
})

test('millisecond-precision integers pass through unchanged', () => {
  const ms = 1790388000000
  assert.strictEqual(toEpochMs(ms), ms)
})

test('RFC 3339 strings are parsed', () => {
  // The exact shape the claim endpoint returns for expiresAt.
  const value = '2026-10-26T03:38:29.310161Z'
  assert.strictEqual(toEpochMs(value), Date.parse(value))
})

test('null and undefined yield undefined', () => {
  assert.strictEqual(toEpochMs(null), undefined)
  assert.strictEqual(toEpochMs(undefined), undefined)
})

test('non-finite and non-positive numbers yield undefined', () => {
  assert.strictEqual(toEpochMs(NaN), undefined)
  assert.strictEqual(toEpochMs(0), undefined)
  assert.strictEqual(toEpochMs(-1), undefined)
})

test('unparseable strings yield undefined', () => {
  assert.strictEqual(toEpochMs('not-a-time'), undefined)
})

test('non-string, non-number values yield undefined', () => {
  assert.strictEqual(toEpochMs({}), undefined)
  assert.strictEqual(toEpochMs([]), undefined)
})
