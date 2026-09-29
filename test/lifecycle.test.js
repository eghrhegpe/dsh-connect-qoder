/**
 * Tests for what a fiber undoes on dispose.
 *
 * Run: node --test test/lifecycle.test.js
 *
 * Every `webServer.register` call in this plugin used to throw its return value
 * away, and whether that leaks depends on a question a plugin cannot answer
 * from its own checkout: does `@deepseek-ai/dsh-host-webserver` reclaim a
 * registration with its fiber, or does it need an explicit release? The package
 * ships inside the host's `app.asar`, which is not readable here, so the answer
 * is genuinely unknown (docs/issues/13).
 *
 * The fix is not to guess. The registrations are collected and released if — and
 * only if — `register` returned something callable, which is correct under both
 * host behaviours and degrades to today's behaviour if the shape ever changes.
 * What is worth pinning is that the handling is total: a non-function return
 * from one registration must not stop the others being collected, and a release
 * that throws must not strand the ones after it.
 *
 * The cost of being wrong the other way is concrete: a leaked route keeps its
 * handler, and through it a whole runtime, reachable after the plugin is
 * disabled — a POST would then start a shim and a refresh interval that nothing
 * will ever clean up.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { rememberRouteRelease, releaseRoutes } from '../lib/lifecycle.js'

test('a release handed back by the host is remembered and called', () => {
  const sink = []
  let released = 0
  const release = () => {
    released += 1
  }
  assert.strictEqual(rememberRouteRelease(sink, release), release)
  assert.deepStrictEqual(sink, [release])
  assert.strictEqual(releaseRoutes(sink), 1)
  assert.strictEqual(released, 1, 'the host must actually be told to drop the route')
})

test('a registration that returned nothing is not treated as a release', () => {
  // This is the branch a fiber-scoped host takes: `register` returns undefined
  // because there is nothing to release. Calling it would be a TypeError during
  // dispose, which is the worst place to introduce one.
  const sink = []
  for (const returned of [undefined, null, {}, 'released', 0, false, []]) {
    assert.strictEqual(rememberRouteRelease(sink, returned), undefined, String(returned))
  }
  assert.deepStrictEqual(sink, [], 'nothing to release, nothing collected')
  assert.strictEqual(releaseRoutes(sink), 0)
})

test('releases run in registration order', () => {
  // Order is not cosmetic: a host that unregisters by prefix wants the reverse
  // of insertion, but there is no contract to satisfy, and deterministic order
  // is what makes a failing release diagnosable.
  const order = []
  const sink = []
  rememberRouteRelease(sink, () => order.push('first'))
  rememberRouteRelease(sink, () => order.push('second'))
  rememberRouteRelease(sink, () => order.push('third'))
  releaseRoutes(sink)
  assert.deepStrictEqual(order, ['first', 'second', 'third'])
})

test('a release that throws does not strand the ones after it', () => {
  // The releases hold the ports. A throw in the middle must not leave the rest
  // registered, and disposal must never throw: it runs on the way out, where a
  // failure surfaces as a broken fiber cleanup the user cannot act on.
  const order = []
  const sink = []
  rememberRouteRelease(sink, () => {
    order.push('ok')
  })
  rememberRouteRelease(sink, () => {
    order.push('throwing')
    throw new Error('host already reclaimed this route')
  })
  rememberRouteRelease(sink, () => order.push('still released'))
  let released
  assert.doesNotThrow(() => {
    released = releaseRoutes(sink)
  })
  assert.deepStrictEqual(order, ['ok', 'throwing', 'still released'])
  assert.strictEqual(released, 2, 'the throwing one is not counted as released')
})

test('releasing twice is harmless', () => {
  // Disposal can run twice (a fiber teardown racing an explicit disable), and
  // the sink is emptied, so the second pass is a no-op rather than a second
  // release the host might reject.
  const sink = []
  let calls = 0
  rememberRouteRelease(sink, () => {
    calls += 1
  })
  assert.strictEqual(releaseRoutes(sink), 1)
  assert.strictEqual(releaseRoutes(sink), 0)
  assert.strictEqual(calls, 1)
})

test('an absent sink is not a crash', () => {
  // Defensive: a caller that never registered routes still runs its cleanup.
  assert.strictEqual(releaseRoutes(undefined), 0)
  assert.strictEqual(releaseRoutes(null), 0)
})

test('every route registration in the plugin is collected', () => {
  // lib/index.js cannot be imported, so this is the wiring assertion: a new
  // route that forgets the wrapper would be a silent leak, and there are seven
  // registration sites to keep in step.
  const source = readFileSync(
    new URL('../lib/index.js', import.meta.url),
    'utf8',
  ).replaceAll('\r\n', '\n')
  const registrations = source.match(/webCtx\.webServer\.register\(\{/g) ?? []
  assert.ok(registrations.length > 0, 'no route registrations found — the pattern changed')
  for (const match of source.matchAll(/webCtx\.webServer\.register\(\{/g)) {
    const before = source.slice(Math.max(0, match.index - 60), match.index)
    assert.match(
      before,
      /rememberRouteRelease\(routeReleases, $/,
      'a webServer.register is not wrapped in rememberRouteRelease — its release would be dropped',
    )
  }
  // And the cleanup must actually drain the sink.
  assert.match(
    source,
    /releaseRoutes\(routeReleases\)/,
    'the fiber cleanup must release the collected route registrations',
  )
})
