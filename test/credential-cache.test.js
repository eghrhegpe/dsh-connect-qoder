/**
 * Tests for the credential cache — the mechanism behind this plugin's claim
 * that a re-sign-in needs no DSH restart.
 *
 * Run: node --test test/credential-cache.test.js
 *
 * This file exists because the two halves of that behaviour were tested while
 * the connection between them was not. `isStaleCredentialError` and
 * `isCredentialUsable` each had assertions, but the flag that turns a sign-in
 * rejection into a re-read lived inside `RegionRuntime`, which cannot be
 * imported — lib/index.js pulls in the Cordis peer dependencies. Two tested
 * parts and one untested wire is still no test: a change that dropped the
 * `invalidate` call, or set the flag without clearing the cache, would have
 * passed everything else in this directory.
 *
 * The store is a closure over a mutable value, so a test can simulate the user
 * re-signing in the desktop app and then assert the next request picks it up.
 * No real credential files, no network, and no fake timers: `resolve()` is
 * driven explicitly.
 *
 * One line is deliberately not asserted: `this.cached = undefined` in the
 * "no credential found" branch. `isCredentialUsable(undefined)` is already
 * false, so leaving a stale value in that slot produces the same observable
 * behaviour — the next resolve re-reads either way. Removing the line was
 * measured to leave this file green, and the two paths are not distinguishable
 * from outside. See docs/KNOWN_GAPS.md.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { CredentialCache } from '../lib/credential-cache.js'
import { isStaleCredentialError } from '../lib/errors.js'

/**
 * A stand-in for the Qoder app's credential store.
 *
 * `value` is what the "app" currently holds; setting it simulates the user
 * re-opening the app and signing in again, which is the whole scenario.
 */
function makeStore(initial) {
  const store = { value: initial, reads: 0 }
  return {
    store,
    load: () => {
      store.reads += 1
      return store.value
    },
  }
}

const appCredential = (token, expired = false) => ({ source: 'app', token, expired, userID: 'u' })
const patCredential = (token) => ({ source: 'env-pat', token, userID: '', expiresAt: 0 })

/** A cache over a mutable app store, with no PAT fallback. */
function cacheOver(initial, options = {}) {
  const { store, load } = makeStore(initial)
  const cache = new CredentialCache({
    loadApp: load,
    loadEnv: () => options.pat,
    exchangePat: options.exchangePat,
  })
  return { cache, store }
}

test('a fresh read loads the credential and a second one is served from cache', async () => {
  const { cache, store } = cacheOver(appCredential('token-1'))
  const first = await cache.resolve()
  assert.strictEqual(first.token, 'token-1')
  assert.strictEqual(store.reads, 1)

  const second = await cache.resolve()
  assert.strictEqual(second.token, 'token-1')
  assert.strictEqual(store.reads, 1, 'a usable cached credential must not be re-read')
})

test('a sign-in rejection forces a re-read, so a re-sign-in is picked up', async () => {
  // The scenario the plugin exists for: the app is signed in, the gateway
  // rejects the token, the user re-opens the app and signs in again — and the
  // next request must work without a DSH restart.
  //
  // Note the cached credential here is NOT marked `expired`. That is the case
  // the invalidation exists for: the app's store still says the token is good
  // (its expiry was computed when it was read), but the gateway has already
  // rejected it. Only the rejection tells us, and only invalidation acts on it.
  // An `expired: true` credential would be re-read anyway, which is a
  // different and already-covered path.
  const { cache, store } = cacheOver(appCredential('rejected-but-not-yet-expired'))

  const before = await cache.resolve()
  assert.strictEqual(before.token, 'rejected-but-not-yet-expired')

  // The user re-signs in the app, which rewrites its store.
  store.value = appCredential('fresh-token')

  // Nothing has told the cache yet — this is the pre-fix behaviour, and it is
  // exactly what "every request 401s until DSH is restarted" looks like.
  const stillStale = await cache.resolve()
  assert.strictEqual(stillStale.token, 'rejected-but-not-yet-expired', 'without invalidate the stale value is reused')
  assert.strictEqual(store.reads, 1, 'and the store is not re-read')

  // The shim reports the sign-in failure.
  cache.invalidate()

  const after = await cache.resolve()
  assert.strictEqual(after.token, 'fresh-token', 'invalidate must force a re-read')
  assert.strictEqual(store.reads, 2, 'exactly one extra read, not a re-read per request')
})

test('invalidate clears the cache exactly once, not on every later resolve', async () => {
  const { cache, store } = cacheOver(appCredential('t1'))
  await cache.resolve()
  cache.invalidate()
  await cache.resolve()
  assert.strictEqual(store.reads, 2)
  // The flag is consumed: further resolves must not keep re-reading, or a
  // region with a persistently failing sign-in would hit the app store on
  // every single request.
  await cache.resolve()
  await cache.resolve()
  assert.strictEqual(store.reads, 2, 'invalidate must be one-shot')
})

test('a re-read that still finds nothing signed in reports undefined', async () => {
  // The user can sign OUT as well as in. The re-read must be able to conclude
  // "no credential" rather than resurrecting the stale cache.
  const { cache, store } = cacheOver(appCredential('t1'))
  await cache.resolve()
  store.value = undefined
  cache.invalidate()
  assert.strictEqual(await cache.resolve(), undefined)
  // And it must not cache that absence as a usable value.
  assert.strictEqual(await cache.resolve(), undefined)
})

test('an expired cached credential is re-read without any invalidation', async () => {
  // The `expired` flag is computed when the app store is read, so a token that
  // expired afterwards is only visible by reading again.
  const { cache, store } = cacheOver(appCredential('t1', true))
  await cache.resolve()
  await cache.resolve()
  assert.strictEqual(store.reads, 2, 'an expired credential must not be served from cache')
})

test('a PAT is exchanged once and then reused until it expires', async () => {
  let exchanges = 0
  const { cache, store } = cacheOver(undefined, {
    pat: patCredential('personal-token'),
    exchangePat: async () => {
      exchanges += 1
      return { token: 'job-token', refreshToken: 'refresh', expiresAt: Date.now() + 60_000 }
    },
  })

  const first = await cache.resolve()
  assert.strictEqual(first.token, 'job-token', 'the raw PAT must not be used on the wire')
  assert.strictEqual(first.source, 'env-pat')
  assert.strictEqual(exchanges, 1)

  await cache.resolve()
  await cache.resolve()
  assert.strictEqual(exchanges, 1, 'a live job token must not be re-exchanged')
  assert.strictEqual(store.reads, 1, 'and must not re-read the app store')
})

test('an expired job token is exchanged again', async () => {
  let exchanges = 0
  const { cache } = cacheOver(undefined, {
    pat: patCredential('personal-token'),
    exchangePat: async () => {
      exchanges += 1
      // Already expired, so the next resolve must treat it as spent.
      return { token: `job-${exchanges}`, refreshToken: 'r', expiresAt: Date.now() - 1 }
    },
  })
  await cache.resolve()
  await cache.resolve()
  assert.strictEqual(exchanges, 2, 'an expired job token must be replaced')
})

test('an app credential wins over a PAT', async () => {
  // The app is the primary source; the PAT is only a fallback for a machine
  // with no desktop sign-in.
  const { cache, store } = cacheOver(appCredential('from-app'), { pat: patCredential('from-pat') })
  const resolved = await cache.resolve()
  assert.strictEqual(resolved.token, 'from-app')
  assert.strictEqual(store.reads, 1)
})

test('a PAT with no exchange available is still used rather than dropped', async () => {
  // Degrading to the raw PAT is better than reporting "not signed in": the
  // gateway is the one that can decide whether the token works.
  const { cache } = cacheOver(undefined, { pat: patCredential('personal-token') })
  const resolved = await cache.resolve()
  assert.strictEqual(resolved.token, 'personal-token')
})

test('the cache is cleared on the first resolve after invalidation, and only that one', async () => {
  // Two separate things have to hold, and this asserts both together because
  // each was previously invisible: the cached value must be DROPPED (otherwise
  // the re-read is pointless), and the flag must be CONSUMED (otherwise every
  // later request re-reads the app store). A mutation that only clears the flag
  // or only clears the cache leaves this test red.
  const { cache, store } = cacheOver(appCredential('v1'))
  await cache.resolve()
  store.value = appCredential('v2')

  cache.invalidate()
  assert.strictEqual((await cache.resolve()).token, 'v2', 'the cached value must be dropped')
  assert.strictEqual(store.reads, 2)

  store.value = appCredential('v3')
  const third = await cache.resolve()
  assert.strictEqual(third.token, 'v2', 'a later resolve must serve the cache, not re-read')
  assert.strictEqual(store.reads, 2, 'the flag must be consumed exactly once')
})

test('resolve with no sign-in anywhere does not cache the absence as usable', async () => {
  // If `undefined` were left in the cache slot without clearing it, the next
  // resolve would have to consult the store again to notice a sign-in that
  // appeared since — and, worse, a stale entry left behind by an earlier
  // successful read would be served as though nothing had happened.
  const { cache, store } = cacheOver(undefined)
  assert.strictEqual(await cache.resolve(), undefined)

  // The user signs in afterwards.
  store.value = appCredential('later')
  const resolved = await cache.resolve()
  assert.strictEqual(resolved.token, 'later', 'a new sign-in must be picked up')
})

test('a full chain: shim error -> predicate -> invalidate -> re-read', async () => {
  // The end-to-end version of the test above, using the real predicate the shim
  // calls. Before this chain was extracted, the two ends were asserted in
  // different files and the middle — the invalidate call — was asserted nowhere.
  const { cache, store } = cacheOver(appCredential('rejected'))
  await cache.resolve()

  // The shim classifies a gateway rejection.
  const gatewayError = Object.assign(new Error('Qoder CN sign-in is no longer valid'), {
    signInExpired: true,
  })
  if (isStaleCredentialError(gatewayError)) cache.invalidate()

  // The user re-signs in.
  store.value = appCredential('recovered')

  const resolved = await cache.resolve()
  assert.strictEqual(resolved.token, 'recovered')
  assert.strictEqual(store.reads, 2)
})

test('a non sign-in failure must not invalidate the cache', async () => {
  // The dangerous direction: invalidating on a queue rejection would force a
  // pointless re-read of the app store on every queued turn, and would paper
  // over a real sign-in problem.
  const { cache, store } = cacheOver(appCredential('t1'))
  await cache.resolve()
  const queueError = Object.assign(new Error('Qoder is busy — the request was queued'), {
    retryable: true,
  })
  if (isStaleCredentialError(queueError)) cache.invalidate()
  await cache.resolve()
  assert.strictEqual(store.reads, 1, 'a queue rejection must not cause a re-read')
})
