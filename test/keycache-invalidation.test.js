/**
 * Tests for the OSCrypt key cache's invalidation rule.
 *
 * Run: node --test test/keycache-invalidation.test.js
 *
 * The bug this file exists for (issue 08) was a permanent, self-inflicted
 * `needs-app`: the cache was keyed by app directory alone, so a Qoder reinstall
 * or profile reset — which rewrites `Local State` with a fresh
 * `os_crypt.encrypted_key` — left the running process decrypting with the OLD
 * key. Every read then failed, nothing in the code could ever retry, and the
 * region stayed "unreadable" until DSH was restarted. There was no upper bound
 * on how long: the lifetime of the process.
 *
 * The rule is tested through `cachedKeyFor` rather than by launching PowerShell,
 * because the DPAPI unwrap needs a live Windows app and would make this file
 * either skip on CI or too slow to run often — which is exactly how the original
 * unbounded cache survived. What is asserted here is the decision the unwrap
 * makes on every call, and the decision is the whole fix.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { cachedKeyFor } from '../lib/credentials.js'

const KEY = Buffer.alloc(32, 0x41)

test('an unchanged Local State reuses the key, so the unwrap does not rerun', () => {
  // The point of the cache: a PowerShell child costing up to 30 s must not be
  // paid on every credential resolution.
  const entry = { key: KEY, identity: '1700000000000:512' }
  assert.strictEqual(cachedKeyFor(entry, '1700000000000:512'), KEY)
})

test('a rewritten Local State retires the key (issue 08)', () => {
  // The reinstall case. mtime changes, so the cached key — which decrypts the
  // OLD encrypted_key — is refused and a fresh unwrap runs against the new one.
  const entry = { key: KEY, identity: '1700000000000:512' }
  assert.strictEqual(cachedKeyFor(entry, '1700000001000:512'), undefined)
  // A different size alone is enough, and a different mtime alone is enough:
  // either proves the file is not the one this key came from.
  assert.strictEqual(cachedKeyFor(entry, '1700000000000:520'), undefined)
})

test('a deleted Local State retires the key rather than letting it outlive the store', () => {
  // An app being uninstalled under a running host is rare, but if the store is
  // gone the cached key can decrypt nothing — and holding it is pure exposure.
  const entry = { key: KEY, identity: '1700000000000:512' }
  assert.strictEqual(cachedKeyFor(entry, undefined), undefined)
})

test('a legacy entry is never trusted', () => {
  // Defensive against a stale in-memory shape: a hot reload of an older module
  // can leave a bare Buffer in the map. The subtle one is `{ key }` with NO
  // identity against a MISSING file — `undefined === undefined` would match and
  // hand out a key whose provenance nothing records, so presence is required on
  // both sides rather than just equality.
  assert.strictEqual(cachedKeyFor({ key: KEY }, undefined), undefined)
  assert.strictEqual(cachedKeyFor({ key: KEY }, '1700000000000:512'), undefined)
  assert.strictEqual(cachedKeyFor(KEY, '1700000000000:512'), undefined)
})

test('an empty cache is a miss, not an error', () => {
  assert.strictEqual(cachedKeyFor(undefined, '1700000000000:512'), undefined)
  assert.strictEqual(cachedKeyFor(null, undefined), undefined)
})
