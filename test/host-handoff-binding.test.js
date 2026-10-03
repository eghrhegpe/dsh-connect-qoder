/**
 * Guard the `llm` hand-off in the shipped host bundle against a `this`-loss
 * regression.
 *
 * Run: node --test test/host-handoff-binding.test.js
 *
 * WHY THIS FILE EXISTS
 *
 * Both `ctx.llm.registerAdapter` and `ctx.llm.registerConfigurableProviders`
 * are `this`-bound host methods: `registerAdapter` opens with
 * `this.ctx.effect(…)`, so the receiver is not optional. The activation wiring
 * therefore must NOT hand them over as bare extracted references —
 * `registerAdapter: ctx.llm.registerAdapter` — because calling that later as
 * `deps.registerAdapter(…)` makes `this` the deps object, `this.ctx` is
 * `undefined`, and the throw `Cannot read properties of undefined (reading
 * 'effect')` fails provider registration. In the 0.2 line that failure also
 * short-circuits `activate()` before the card routes mount, so every
 * `/plugins/dsh-connect-qoder/*` card route answers 404.
 *
 * `src/host/domain.ts` types both methods with an explicit
 * `this: HostContext['llm']`, which makes the detached form a `tsc` error. That
 * type guard is real but it is not enough on its own: it runs only under
 * `npm run typecheck`, and the regression is exactly the one that shipped in
 * `lib/` while the sources were already correct — the built artifact was stale.
 * So this file asserts against the SHIPPED bundle, not the sources, for the
 * same reason `client-bundle.test.js` reads `lib/client.js`: a green source tree
 * with a red runtime is the failure mode this exists to catch.
 *
 * The bundle is not imported — it is a Node entry with side effects. The two
 * hand-off lines are located in its text and asserted textually.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const BUNDLE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'index.js'),
  'utf8',
)

test('the host bundle hands `llm` methods over as bound calls, not bare references', () => {
  // The detached forms are what broke activation. Their presence means the
  // wiring was reverted (or the artifact went stale), and the card routes go
  // 404 again.
  for (const detached of [
    'registerAdapter: ctx.llm.registerAdapter',
    'registerConfigurableProviders: ctx.llm.registerConfigurableProviders',
  ]) {
    assert.ok(
      !BUNDLE.includes(detached),
      `lib/index.js hands "${detached}" to the deps object detached; ` +
        'the host method is `this`-bound and this throws at activation (card routes 404)',
    )
  }

  // The bound forms are what activate() actually passes. Asserting their
  // presence keeps this a positive gate too: deleting the wiring entirely
  // (a different way to lose the routes) is just as much a regression.
  for (const bound of [
    'registerAdapter: (providerIds, adapter) => ctx.llm.registerAdapter(providerIds, adapter)',
    'registerConfigurableProviders: (rows) => ctx.llm.registerConfigurableProviders(rows)',
  ]) {
    assert.ok(
      BUNDLE.includes(bound),
      `lib/index.js does not contain the bound hand-off "${bound}"; ` +
        'provider registration loses its receiver',
    )
  }
})