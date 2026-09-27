/**
 * Test the credential re-read pattern behind `RegionRuntime` (lib/index.js):
 * a cached app credential whose token expires at runtime must be re-read, or
 * every request 401s until DSH restarts.
 *
 * The fix marks the cache invalid when the shim reports a sign-in failure
 * (`isStaleCredentialError`, in lib/errors.js), and the re-read is gated by
 * `isCredentialUsable` (in lib/credentials.js).
 *
 * SCOPE — read this before trusting a green run.
 *
 * Both files were originally re-implemented inside this test. That version
 * could not fail: rewording, or outright breaking, the detection regex in
 * lib/shim.js left the test green, because the test was asserting against its
 * own copy. That was verified by mutation, not assumed. Both predicates now
 * live in dependency-free modules and are imported for real; a mutation that
 * breaks either one turns this file red.
 *
 * What is still NOT covered here: `RegionRuntime` itself, and the
 * `credentialInvalid` flag that connects the two predicates. That class lives
 * in lib/index.js, which imports peer dependencies this checkout does not
 * install, so the wiring between "the shim saw a sign-in error" and "the next
 * request re-reads the store" remains unasserted.
 *
 * Run: node --test test/credential-invalidation.test.js
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { isStaleCredentialError } from '../lib/errors.js'
import { isCredentialUsable } from '../lib/credentials.js'

test('isCredentialUsable gates the cache on the source-specific expiry rule', () => {
  // This is the rule `RegionRuntime.resolveCredential` uses to decide whether a
  // cached credential may be served. It used to be re-implemented in this file,
  // where a change to the real rule could not make this fail.
  const now = 1_700_000_000_000

  // An app credential expires by the flag its own store computed.
  assert.strictEqual(isCredentialUsable({ source: 'app', expired: false }, now), true)
  assert.strictEqual(isCredentialUsable({ source: 'app', expired: true }, now), false)
  // No flag at all means not known to be expired — the safe reading, and what
  // the old `!this.exchanged.expired` did.
  assert.strictEqual(isCredentialUsable({ source: 'app' }, now), true)

  // An env PAT expires by the wall clock on the job token it was exchanged for.
  assert.strictEqual(isCredentialUsable({ source: 'env-pat', expiresAt: now + 1000 }, now), true)
  assert.strictEqual(isCredentialUsable({ source: 'env-pat', expiresAt: now }, now), false)
  assert.strictEqual(isCredentialUsable({ source: 'env-pat', expiresAt: now - 1 }, now), false)
  // An env PAT is never judged by an `expired` flag: the raw token does not
  // expire, only the exchange does. A record carrying both must follow the
  // clock, or a stale job token would be served forever.
  assert.strictEqual(
    isCredentialUsable({ source: 'env-pat', expired: false, expiresAt: now - 1 }, now),
    false,
    'an env PAT must expire on the exchange clock, not on an expired flag',
  )

  // Nothing cached is never usable.
  assert.strictEqual(isCredentialUsable(undefined, now), false)
  assert.strictEqual(isCredentialUsable(null, now), false)
})

test('isStaleCredentialError recognises a sign-in failure', () => {
  // The flag the upstream classifier sets (lib/upstream.js sets this on a
  // `sign-in-expired` classification), and the message shapes the real errors
  // carry. The long form is the one `failureMessage` produces.
  const signInErrors = [
    Object.assign(
      new Error('Qoder CN sign-in is no longer valid — open the Qoder CN app to sign in again, then restart DSH'),
      { signInExpired: true },
    ),
    new Error('Qoder sign-in is no longer valid — open the Qoder app to sign in again, then restart DSH'),
    new Error('sign-in-expired: HTTP 401: token expired'),
    // The flag alone must be enough, whatever the message says.
    Object.assign(new Error('something opaque'), { signInExpired: true }),
  ]
  for (const error of signInErrors) {
    assert.strictEqual(
      isStaleCredentialError(error),
      true,
      `should be treated as a stale credential: ${error.message}`,
    )
  }
})

test('isStaleCredentialError does not fire on other failures', () => {
  // The false-positive direction is the dangerous one: invalidating on a
  // transient queue rejection would force a needless re-read of the app store
  // on every queued turn, and could mask a real sign-in problem.
  const otherErrors = [
    new Error('Qoder is busy — the request was queued (retry in ~2s)'),
    Object.assign(new Error('Qoder is busy — the request was queued (retry in ~2s)'), {
      retryable: true,
    }),
    new Error('Qoder CN was refused by Qoder — check that this account can use this model (HTTP 403: ...)'),
    new Error('request body exceeds the 20 MiB limit'),
    new Error(''),
  ]
  for (const error of otherErrors) {
    assert.strictEqual(
      isStaleCredentialError(error),
      false,
      `must not be treated as a stale credential: ${error.message}`,
    )
  }
  // A nullish error must not throw — the call sites are catch blocks.
  assert.strictEqual(isStaleCredentialError(undefined), false)
  assert.strictEqual(isStaleCredentialError(null), false)
})
