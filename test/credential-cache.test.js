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
 * imported — src/host/index.ts pulls in the Cordis peer dependencies. Two tested
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

import { CredentialCache } from '../src/host/credential-cache.ts'
import { isStaleCredentialError } from '../src/host/errors.ts'

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

// === the exchange throttle ==================================================
//
// The PAT exchange is this plugin's sign-in: every catalog refresh, panel
// re-read, and chat turn funnels through resolve(), and for an env PAT that
// means a POST to the exchange endpoint whenever the job token is not live.
// A platform refusal without a local gate is therefore re-probed on a
// schedule — which is how one transient lockout becomes a permanent one. The
// sibling plugin (dsh-connect-sensenova-token-plan) shipped this gate for its
// IAM login and documented the property this block asserts: the exchange
// COUNTER is the evidence that no re-probe happened, not the cache's word.
//
// The cache is built over an injected `now` so windows are exact, and the
// exchange stub throws errors shaped like `exchangePat`'s real ones — the
// fields (`status`, `retryAfterSeconds`) are exactly what upstream.ts attaches.

/** A cache wired for the throttle: env PAT only, scripted exchange, fixed clock. */
function throttleOver(exchangePat, { now = () => 1_000_000, throttleStore } = {}) {
  const state = { calls: 0 }
  const cache = new CredentialCache({
    loadApp: () => {
      state.appReads = (state.appReads ?? 0) + 1
      return undefined
    },
    loadEnv: () => ({ source: 'env-pat', token: 'pat-1', userID: '', expiresAt: 0 }),
    exchangePat: async (credential) => {
      state.calls += 1
      return exchangePat(credential, state.calls)
    },
    throttleStore,
    now,
  })
  return { cache, state }
}

const exchangeFail = (status, retryAfterSeconds) => {
  const error = new Error(`Qoder PAT exchange failed: HTTP ${status}`)
  error.status = status
  if (retryAfterSeconds !== undefined) error.retryAfterSeconds = retryAfterSeconds
  return error
}

test('a rate-limited exchange honours the platform window and refuses to re-probe on the next poll', async () => {
  // The exact symptom from the sibling's fix, on our exchange endpoint: a 429
  // that states "wait 120 s", followed by the poll loop this plugin runs for
  // its catalog and panel. Without the gate the second resolve() posts again.
  let t = 1_000_000
  const { cache, state } = throttleOver(
    async (credential, call) => {
      if (call === 1) throw exchangeFail(429, 120)
      return { token: 'job-token', refreshToken: 'r', expiresAt: t + 600_000 }
    },
    { now: () => t },
  )

  // The first refusal reaches the platform — no throttle existed yet.
  await assert.rejects(() => cache.resolve(), /HTTP 429/)
  assert.strictEqual(state.calls, 1)

  // A poll inside the stated window must NOT reach the platform. The call
  // counter is the whole point of this assertion.
  t += 30_000
  await assert.rejects(
    () => cache.resolve(),
    (error) => {
      assert.match(error.message, /waiting out a rate-limit window/, 'the gate speaks its own reason')
      // The platform-stated window rides out through the error, the shape the
      // shim's retryAfterHeader already turns into `Retry-After`.
      assert.strictEqual(error.retryAfterSeconds, 90, 'the remaining wait is what a poll reports')
      return true
    },
  )
  assert.strictEqual(state.calls, 1, 'the poll was refused locally and never re-probed the platform')

  // One step past the deadline, the gate allows exactly one attempt.
  t += 90_001
  const resolved = await cache.resolve()
  assert.strictEqual(resolved.token, 'job-token')
  assert.strictEqual(state.calls, 2)

  // A success clears the gate: a much later refusal starts its backoff fresh.
  assert.strictEqual(cache.throttle, null)
})

test('a second refusal at the deadline doubles the wait instead of resuming a fast re-probe', async () => {
  // The ladder this repo's own queue logic learned the hard way: if an elapsed
  // window reset the counter, a platform locked out in 60 s steps would be
  // poked in 60 s steps forever.
  let t = 0
  const { cache, state } = throttleOver(
    async (credential, call) => {
      // No stated window: the backoff is the cache's own invention.
      throw exchangeFail(429)
    },
    { now: () => t },
  )

  await assert.rejects(() => cache.resolve())
  assert.strictEqual(cache.throttle.until, 60_000, 'the first unstated refusal waits one minute')

  // Refused again at the deadline: the attempt counter carried through, so the
  // second wait is double the first.
  t = 60_000
  await assert.rejects(() => cache.resolve())
  assert.strictEqual(state.calls, 2)
  assert.strictEqual(cache.throttle.attempt, 2)
  assert.strictEqual(cache.throttle.until, 180_000, '60s wait from t=60s: doubled, not reset')

  // And inside THAT window, the re-probe stops again.
  t = 61_000
  await assert.rejects(() => cache.resolve())
  assert.strictEqual(state.calls, 2, 'still one call, still gated')
})

test('a refused credential parks and is released only by a deliberate re-read', async () => {
  // A 401/403 is not a lockout with a deadline — the token will not become
  // valid by waiting. Re-exchanging it on every poll is the same runaway with
  // a different start date, so the refusal parks indefinitely.
  let t = 0
  const { cache, state } = throttleOver(
    async (credential, call) => {
      if (call === 1) throw exchangeFail(401)
      return { token: 'fresh-job-token', refreshToken: 'r', expiresAt: t + 600_000 }
    },
    { now: () => t },
  )

  await assert.rejects(() => cache.resolve(), /HTTP 401/)
  assert.strictEqual(cache.throttle.parked, true)

  // Any later time, any number of polls: the park holds and the platform is
  // never re-probed.
  t += 24 * 60 * 60 * 1000
  await assert.rejects(
    () => cache.resolve(),
    (error) => {
      assert.match(error.message, /needs to be re-entered/)
      assert.strictEqual(error.retryAfterSeconds, undefined, 'a park has no countdown')
      return true
    },
  )
  assert.strictEqual(state.calls, 1)

  // The deliberate re-read — what the card's "重读登录" button does — is the
  // one release. The next exchange is allowed and succeeds.
  cache.invalidate()
  const resolved = await cache.resolve()
  assert.strictEqual(resolved.token, 'fresh-job-token')
  assert.strictEqual(state.calls, 2)
})

test('a transient exchange failure (5xx, no status) is not gated', async () => {
  // The gate exists for the two states a poll loop can turn permanent. A 503
  // from a hiccupping gateway is not one of them: refusing the next minute of
  // resolves for one dropped response would make the plugin worse than it was.
  const { cache, state } = throttleOver(async () => {
    throw exchangeFail(503)
  })
  await assert.rejects(() => cache.resolve())
  assert.strictEqual(cache.throttle, null)
  await assert.rejects(() => cache.resolve())
  assert.strictEqual(state.calls, 2, 'a transient failure must leave the next poll free to retry')
})

test('the throttle is read from the persisted store, so a restart keeps honouring the wait', async () => {
  // The file-backed store is `throttle-store.test.js`'s subject; what belongs
  // to THIS file is the wiring claim: a cache that starts with a window on
  // disk refuses its first resolve without ever calling the exchange. That is
  // the exact property a restart breaks, and the whole reason the store exists.
  const persisted = { kind: 'rate-limit', parked: false, until: 100_000, attempt: 1 }
  const { cache, state } = throttleOver(
    async () => ({ token: 'job', refreshToken: 'r', expiresAt: 200_000 }),
    { now: () => 50_000, throttleStore: { read: () => persisted, write: () => {}, clear: () => {} } },
  )
  await assert.rejects(
    () => cache.resolve(),
    (error) => {
      assert.strictEqual(error.retryAfterSeconds, 50)
      return true
    },
  )
  assert.strictEqual(state.calls, 0, 'the restored window was honoured without a platform call')
})

test('the throttle is written to the store for a live window and cleared on a deliberate re-read', async () => {
  // Asserts both ends of the persistence seam from the cache side: only a
  // future rate-limit window is written, and `invalidate` → resolve clears
  // the persisted record — otherwise a restart would resurrect a wait for a
  // credential the user has just fixed.
  const writes = []
  let cleared = 0
  const store = {
    read: () => null,
    write: (held) => writes.push({ ...held }),
    clear: () => {
      cleared += 1
    },
  }
  const { cache } = throttleOver(
    async () => {
      throw exchangeFail(429, 120)
    },
    { throttleStore: store },
  )
  await assert.rejects(() => cache.resolve())
  assert.strictEqual(writes.length, 1, 'the refusal was persisted')
  assert.strictEqual(writes[0].kind, 'rate-limit')
  assert.strictEqual(writes[0].until, 1_000_000 + 120_000)

  cache.invalidate()
  await assert.rejects(() => cache.resolve())
  assert.ok(cleared >= 1, 'a deliberate re-read must clear the persisted window')
})

