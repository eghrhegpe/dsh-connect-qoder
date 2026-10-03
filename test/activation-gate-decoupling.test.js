/**
 * Guard the activation gate: a failed provider registration must not unwind the
 * activation that mounts the card routes.
 *
 * Run: node --test test/activation-gate-decoupling.test.js
 *
 * WHY THIS FILE EXISTS
 *
 * `src/host/index.ts` cannot be imported by a test (it pulls in the Cordis peer
 * dependencies at module scope) — the registered gap docs/KNOWN_GAPS.md item
 * 2（`RegionRuntime` 本身与 `activate` 的 Cordis 接线）. So, like
 * `test/save-route-wiring.test.js` and `test/account-route-wiring.test.js`, the
 * wiring is asserted as source text.
 *
 * The defect this pins is docs/issues/20. `activate()` used to read:
 *
 *     const initial = publishRegions()
 *     if (initial.ok !== true) {
 *       await Promise.allSettled(started.map(({ shim }) => shim.close()))
 *       ctx.logger.error?.('dsh-connect-qoder: provider registration failed', initial.error)
 *       return                       // <-- skipped every card route below
 *     }
 *
 * Every card route registers after that block, so one failed `llm` registration
 * presented to the user as seven 404s with nothing anywhere saying why — the
 * exact "failure that does not speak" red line 1 forbids. The fix records the
 * error and carries on.
 *
 * This is a text guard because the failure mode is an ORDERING property that no
 * handler-level unit test can see: `handlers.ts` and `publish-regions.ts` are
 * both fully green whether or not `activate()` returns past the routes. The
 * handlers are exercised for real elsewhere; what only this file can catch is
 * the unwinding statement reappearing.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const HOST = readFileSync(join(root, 'src', 'host', 'index.ts'), 'utf8')

/** The body of the `if (initial.ok !== true) { … }` block, brace-balanced. */
function providerRegistrationFailureBlock() {
  const call = HOST.indexOf('const initial = publishRegions()')
  assert.notStrictEqual(call, -1, 'src/host/index.ts no longer calls publishRegions() into `initial`')

  const gate = HOST.indexOf('if (initial.ok !== true)', call)
  assert.notStrictEqual(gate, -1, 'the provider-registration outcome is no longer inspected')

  const open = HOST.indexOf('{', gate)
  assert.notStrictEqual(open, -1, 'the provider-registration branch has no body')

  let depth = 0
  for (let i = open; i < HOST.length; i += 1) {
    const char = HOST[i]
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return { body: HOST.slice(open + 1, i), call, gate }
    }
  }
  assert.fail('the provider-registration branch is not brace-balanced')
}

test('a failed provider registration does not unwind activation', () => {
  const { body } = providerRegistrationFailureBlock()

  // The regression verbatim: a bare `return` here skips every card route
  // registered below it, turning a diagnosable activation failure into 404s.
  // `throw` is refused for the same reason — it unwinds just as hard, and
  // `apply()` swallows it into a log line the user never sees.
  assert.ok(
    !/\breturn\b/.test(body),
    'the provider-registration failure branch returns again; every card route ' +
      'below it would be skipped and the failure would be invisible (issue 20)',
  )
  assert.ok(
    !/\bthrow\b/.test(body),
    'the provider-registration failure branch throws; that unwinds activation and ' +
      'skips the card routes just as a return would (issue 20)',
  )
})

test('a failed provider registration is recorded for the status route', () => {
  const { body } = providerRegistrationFailureBlock()

  // Recording is what makes the failure visible. Without an assignment the
  // branch would be a silent catch, which is the same defect with extra steps.
  assert.match(
    body,
    /providerRegistrationError\s*=/,
    'the provider-registration failure is no longer recorded; nothing can report it',
  )
  // And it is still logged, because the log line is the full-error record while
  // the route deliberately publishes only a short shape string.
  assert.match(body, /logger\.error\?\.\(/, 'the provider-registration failure is no longer logged')
})

test('every card route is mounted after the provider-registration attempt', () => {
  const { call } = providerRegistrationFailureBlock()
  const paths = [
    'QODER_STATUS_PATH',
    'QODER_MODELS_PATH',
    'QODER_SAVE_PATH',
    'QODER_USAGE_PATH',
    'QODER_CHECKIN_PATH',
    'QODER_ACCOUNT_PATH',
  ]
  for (const path of paths) {
    const at = HOST.indexOf(`path: ${path}`)
    assert.notStrictEqual(at, -1, `src/host/index.ts no longer registers ${path}`)
    assert.ok(
      at > call,
      `${path} is registered BEFORE the provider-registration attempt; the ordering ` +
        'this file guards has changed and the guard needs revisiting',
    )
  }
})

test('the status route reports the recorded error, and only the status route', () => {
  const at = HOST.indexOf('path: QODER_STATUS_PATH')
  assert.notStrictEqual(at, -1, 'src/host/index.ts no longer registers the status route')

  // The route must be handed the recorded failure; handing it a literal `false`
  // would make it answer "healthy" forever, which is worse than no route.
  const after = HOST.slice(at, at + 600)
  assert.match(
    after,
    /providerRegistrationError/,
    'the status route no longer receives the recorded provider-registration error',
  )
  assert.match(after, /statusHandler/, 'the status route no longer calls statusHandler')
})
