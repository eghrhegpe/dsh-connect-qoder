/**
 * Tests for the decision to publish a region as a provider.
 *
 * Run: node --test test/region-gate.test.js
 *
 * A region is offered to DSH only when it can actually answer. Publishing one
 * whose sign-in is missing or expired puts a dead route in the model picker:
 * the user selects it, the gateway answers 403, and the UI blames their
 * account for a channel this plugin should never have offered.
 *
 * The decision lived inside `startRegion` (lib/index.js), which no test can
 * import. What makes it worth pinning is not the boolean — it is that the
 * THREE refusals are different, carry different log levels, and each points at
 * a different user action:
 *
 * - no sign-in at all is the normal state of a fresh install (info, "sign in");
 * - an expired token needs the app opened to renew (warn, with that instruction);
 * - an unreadable one is a DPAPI/unwrap failure the user must investigate
 *   (warn, plus the error object).
 *
 * Collapsing them into one boolean is the tempting simplification, and it would
 * leave an operator with a log that says "not registered" and nothing about
 * which of the three happened.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { regionPublishDecision, unreadableSignInDecision } from '../lib/region-gate.js'

const REGION = { id: 'qoder-cn', displayName: 'Qoder CN' }

const usable = { token: 't', userID: 'u', expired: false }

test('a usable credential publishes the region', () => {
  assert.deepStrictEqual(regionPublishDecision(usable, REGION), { ok: true })
  // The shape carries no message on the happy path, so a caller cannot log an
  // empty refusal by mistake.
  assert.strictEqual(regionPublishDecision(usable, REGION).message, undefined)
})

test('no sign-in is refused at info — it is the normal fresh-install state', () => {
  for (const credential of [undefined, null]) {
    const decision = regionPublishDecision(credential, REGION)
    assert.strictEqual(decision.ok, false)
    assert.strictEqual(decision.level, 'info', 'a fresh install must not log a warning')
    assert.match(decision.message, /no local sign-in/)
  }
})

test('an expired token is refused at warn, with the instruction to renew it', () => {
  const decision = regionPublishDecision({ ...usable, expired: true }, REGION)
  assert.strictEqual(decision.ok, false)
  assert.strictEqual(decision.level, 'warn', 'this one the user must act on')
  // The message has to name the ACTION, not just the state: the whole value of
  // this log line is that it tells an operator what to do next.
  assert.match(decision.message, /expired/)
  assert.match(decision.message, /renew it/)
  assert.match(decision.message, /Qoder CN/, 'the message names the region')
})

test('only an explicit `true` reads as expired', () => {
  // Same rule as the per-region switch, for the same reason: a malformed field
  // must not refuse to publish a region that would otherwise work, and an
  // over-strict check is invisible until a user with a working sign-in finds
  // their provider missing.
  for (const expired of [false, undefined, null, 0, '', 'true', 1, {}]) {
    assert.strictEqual(
      regionPublishDecision({ ...usable, expired }, REGION).ok,
      true,
      `expired=${JSON.stringify(expired)}`,
    )
  }
})

test('the three refusals are distinguishable from the message alone', () => {
  // An operator reads the log, not this module. The three lines must not
  // collapse into one, because they lead to three different fixes.
  const messages = new Set([
    regionPublishDecision(undefined, REGION).message,
    regionPublishDecision({ ...usable, expired: true }, REGION).message,
    unreadableSignInDecision(REGION).message,
  ])
  assert.strictEqual(messages.size, 3, `expected 3 distinct messages, got ${[...messages].join(' | ')}`)
})

test('an unreadable sign-in is a warn and carries the region', () => {
  const refusal = unreadableSignInDecision(REGION)
  assert.strictEqual(refusal.level, 'warn')
  assert.match(refusal.message, /unusable/)
  assert.match(refusal.message, /Qoder CN/)
  // No credential is involved here, so there must be no field for one to
  // accidentally be threaded through.
  assert.strictEqual(refusal.credential, undefined)
})

test('every message is prefixed so it is attributable in a shared log', () => {
  const all = [
    regionPublishDecision(undefined, REGION),
    regionPublishDecision({ ...usable, expired: true }, REGION),
    unreadableSignInDecision(REGION),
  ]
  for (const decision of all) {
    assert.match(decision.message, /^dsh-connect-qoder: /, decision.message)
  }
})
