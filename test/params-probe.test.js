/**
 * Offline assertions for the LIVE parameter-contract probe.
 *
 * Run: node --test test/params-probe.test.js
 *
 * The probe (`scripts/probe-params.mjs`) is the ONLY thing that asks the real
 * Qoder platform whether the `parameters` the chat route sends are still the
 * ones it accepts — but the probe needs credentials and network, so its CASE
 * MATRIX and its VERDICT LOGIC must be checked offline, or the part that
 * decides "accept vs reject vs not-a-verdict" would be tested only by eyeball.
 *
 * This file pins exactly that, with no network:
 *   - `buildParamCases` generates the right matrix for each catalog shape
 *     (reasoning+levels → advertised & bogus & pinned; always-thinking → the
 *     1210 off case; non-reasoning → no contract cases);
 *   - `classifyOutcome` keeps a parameter rejection apart from a queue / daily
 *     limit / stale sign-in / wire move, because conflating them is precisely
 *     the "teach readers to ignore reds" trap the live-contract discipline
 *     forbids.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

const { buildParamCases, classifyOutcome } = await import('../scripts/probe-params.mjs')

/** A fake reasoning model with two advertised levels and thinking that can be turned off. */
const REASONING_LEVELS = {
  key: 'k-reason',
  name: 'Reason',
  isReasoning: true,
  alwaysThinking: false,
  effortLevels: ['low', 'high'],
  priceFactor: 1.5,
}

const ALWAYS_THINKING = {
  key: 'k-always',
  name: 'Always',
  isReasoning: true,
  alwaysThinking: true,
  effortLevels: ['medium', 'max'],
  priceFactor: 2,
}

const NON_REASONING = {
  key: 'k-plain',
  name: 'Plain',
  isReasoning: false,
  alwaysThinking: false,
  effortLevels: [],
  priceFactor: 0,
}

test('a reasoning model with levels yields advertised + bogus + pinned cases', () => {
  const cases = buildParamCases(REASONING_LEVELS)
  const labels = cases.map((c) => c.label)
  assert.ok(labels.some((l) => l.includes('advertised') && l.includes('low')), 'advertised low case present')
  assert.ok(labels.some((l) => l.includes('bogus')), 'bogus level case present')
  assert.ok(labels.some((l) => l.includes('pinned')), 'pinned max_tokens case present')
  assert.ok(!labels.some((l) => l.includes('always-thinking')), 'no 1210 case for a disable-able model')

  // The advertised case must actually carry the advertised level and think-on.
  const advertised = cases.find((c) => c.label.includes('advertised'))
  assert.strictEqual(advertised.enableThinking, true)
  assert.strictEqual(advertised.reasoningEffort, 'low')
  // The bogus case must carry a string the catalog never lists.
  const bogus = cases.find((c) => c.label.includes('bogus'))
  assert.strictEqual(bogus.reasoningEffort, 'not-a-real-effort')
  // The pinned case carries the platform ceiling and thinks on.
  const pinned = cases.find((c) => c.label.includes('pinned'))
  assert.strictEqual(pinned.enableThinking, true)
  assert.ok(typeof pinned.maxTokens === 'number' && pinned.maxTokens > 0, 'pinned carries a positive ceiling')
})

test('an always-thinking model additionally yields the 1210 off case', () => {
  const cases = buildParamCases(ALWAYS_THINKING)
  const off = cases.find((c) => c.label.includes('always-thinking'))
  assert.ok(off, 'the 1210 rule case is generated for an always-thinking model')
  assert.strictEqual(off.enableThinking, false, 'it sends enable_thinking:false')
  assert.strictEqual(off.alwaysThinking, true, 'and marks the model always-thinking')
  // It must still carry the advertised + bogus + pinned trio.
  assert.ok(cases.some((c) => c.label.includes('advertised') && c.label.includes('medium')))
  assert.ok(cases.some((c) => c.label.includes('bogus')))
  assert.ok(cases.some((c) => c.label.includes('pinned')))
})

test('a non-reasoning model yields no contract cases', () => {
  // The probe only has parameter verdicts to assert for reasoning models
  // (effort levels + the thinking-on ceiling). A plain model contributes none,
  // and the probe must skip rather than assert nonsense against it.
  assert.deepStrictEqual(buildParamCases(NON_REASONING), [])
})

test('classifyOutcome: a completed stream is accepted', () => {
  assert.deepStrictEqual(classifyOutcome(undefined), { kind: 'accepted' })
})

test('classifyOutcome: a protocol-shape change is its own red', () => {
  const error = new Error('wire moved')
  error.protocolShapeChanged = true
  assert.deepStrictEqual(classifyOutcome(error), { kind: 'shape-changed', message: 'wire moved' })
})

test('classifyOutcome: a queue rejection is a non-verdict, not a parameter refusal', () => {
  // 10605 arrives as a retryable Error carrying `retryable: true` — exactly
  // the rhythm answer that must NOT be read as "level unsupported".
  const error = new Error('queued')
  error.retryable = true
  assert.deepStrictEqual(classifyOutcome(error), { kind: 'non-verdict', message: 'queued' })
})

test('classifyOutcome: a spent daily allowance is a non-verdict', () => {
  const error = new Error('daily limit')
  error.dailyLimit = true
  assert.deepStrictEqual(classifyOutcome(error), { kind: 'non-verdict', message: 'daily limit' })
})

test('classifyOutcome: a stale sign-in is a non-verdict', () => {
  const error = new Error('sign-in expired')
  error.signInExpired = true
  assert.deepStrictEqual(classifyOutcome(error), { kind: 'non-verdict', message: 'sign-in expired' })
})

test('classifyOutcome: any other error is a parameter rejection (e.g. 1210)', () => {
  // A `provider_error` 1210 ("该模型始终思考，不支持关闭思考") reaches here as
  // a plain Error with no retry/sign-in flags — it is the real "this parameter
  // combination is refused" answer the probe must count as red.
  const error = new Error('provider_error 1210: 该模型始终思考，不支持关闭思考')
  assert.deepStrictEqual(classifyOutcome(error), {
    kind: 'param-rejected',
    message: 'provider_error 1210: 该模型始终思考，不支持关闭思考',
  })
})
