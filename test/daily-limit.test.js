/**
 * Tests for the daily billing limit as its own kind of failure.
 *
 * Run: node --test test/daily-limit.test.js
 *
 * WHAT HAPPENED
 *
 * A user sent a request and got:
 *
 *   失败原因：502: {"message":"Qoder upstream error 110: Billing daily count exceeded",
 *              "type":"upstream_error","code":"upstream_error"}
 *   重试延迟：7350毫秒
 *
 * Two things in that are wrong, and they are the same mistake seen twice. The
 * gateway classified a SPENT DAILY ALLOWANCE as a queue — the payload carries
 * the queue markers and a `Retry-After` of 7350 seconds, which is about two
 * hours — and the plugin believed it. So the user was told a request would be
 * retried, for something no amount of retrying can change: the counter resets
 * at the day boundary rather than draining. And the status was `502`, which
 * reads as "Qoder broke" when the truth is "you have used today's requests".
 *
 * WHERE THE BOUNDARY IS DRAWN
 *
 * The classifier checks `110` BEFORE the queue-marker fallback, and the reason
 * is the whole test: this payload HAS the markers. A rule that matched markers
 * first would classify it as a queue no matter what the code said, and the
 * multi-hour hint would be honoured as a retry delay.
 *
 * WHAT IS ASSERTED HERE, AND WHAT IS NOT
 *
 * The envelope is taken from that user report rather than from a live probe:
 * `probe/daily-limit-probe.mjs` could not produce it, because the accounts on
 * this machine still had allowance and a real request came back with content.
 * That is stated in the probe too. So the SHAPE below is a specification, and
 * what these tests pin is the plugin's reaction to it — which is the part that
 * was wrong and the part a future edit could repeat.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { classifyUpstreamError } from '../lib/errors.js'
import { queueWaitFor } from '../lib/upstream.js'

/**
 * The frame as it arrives, at the nesting the gateway actually uses.
 *
 * `message` is itself a JSON STRING holding another document, which holds the
 * queue descriptor with the multi-hour hint — the shape `queueSeconds` walks.
 * Reproducing the nesting matters: a flat `{ code: 110, … }` would be a
 * different test, and would not exercise the part that misclassified it.
 */
const DAILY_LIMIT_FRAME = {
  code: '502',
  message: JSON.stringify({
    code: '110',
    message: JSON.stringify({
      error: { code: 110, message: 'Billing daily count exceeded' },
      isQueued: false,
      retryAfterSeconds: 7350,
      serviceAvailable: false,
    }),
  }),
}

const detail = DAILY_LIMIT_FRAME.message

test('a spent daily allowance is its own kind, not a queue', () => {
  const verdict = classifyUpstreamError(DAILY_LIMIT_FRAME, '502', detail)
  assert.strictEqual(verdict.kind, 'daily-limit')
  assert.notStrictEqual(verdict.kind, 'rate-limit', 'this is the exact misclassification that was fixed')
})

test('the check runs BEFORE the queue-marker fallback, because the payload HAS the markers', () => {
  // Stated as its own test because it is the fragile part: a reordering — or a
  // refactor that moves the marker check up for "efficiency" — silently
  // reinstates the original behaviour, and the payload below still contains
  // every marker the fallback looks for.
  const payload = JSON.stringify({
    isQueued: false,
    queueType: 'DAILY_LIMIT',
    retryAfterSeconds: 7350,
    serviceAvailable: false,
  })
  assert.ok(
    payload.includes('"queueType"') && payload.includes('"retryAfterSeconds"') &&
      payload.includes('"isQueued"') && payload.includes('"serviceAvailable"'),
    'the fixture must carry all four queue markers, or it proves nothing',
  )
  const verdict = classifyUpstreamError({ code: '110' }, '110', `Billing daily count exceeded ${payload}`)
  assert.strictEqual(verdict.kind, 'daily-limit', 'the markers must not win')
})

test('the reset hint is carried through, because it is all the user can plan around', () => {
  // Discarding the number leaves the UI with nothing but "try later", which is
  // the state the report came from. The hint is what becomes "resets at HH:MM".
  const verdict = classifyUpstreamError(DAILY_LIMIT_FRAME, '502', detail)
  assert.strictEqual(verdict.retryAfterSeconds, 7350)
})

test('a payload with no hint reports zero rather than guessing', () => {
  const verdict = classifyUpstreamError({ code: '110' }, '110', 'Billing daily count exceeded')
  assert.strictEqual(verdict.kind, 'daily-limit')
  assert.strictEqual(verdict.retryAfterSeconds, 0, 'no hint is "we do not know when", not an estimate')
})

test('the limit is recognised by code alone, and by message alone', () => {
  // Three ways in, because the gateway has been seen spelling it differently
  // across surfaces: a bare code, a quoted code, and the message without one.
  assert.strictEqual(classifyUpstreamError({}, '110', '').kind, 'daily-limit')
  assert.strictEqual(classifyUpstreamError({}, '"110"', '').kind, 'daily-limit')
  assert.strictEqual(
    classifyUpstreamError({}, '', 'Billing daily count exceeded').kind,
    'daily-limit',
  )
  // And the daily limit is not confused with the two codes that mean something
  // else, which is the failure that sent the user to their account instead.
  assert.strictEqual(classifyUpstreamError({}, '105', 'Login expired').kind, 'sign-in-expired')
  assert.strictEqual(
    classifyUpstreamError({}, '10605', JSON.stringify({ isQueued: true, retryAfterSeconds: 2 })).kind,
    'rate-limit',
  )
})

test('a real queue is still a queue — the new branch must not swallow it', () => {
  // The counterpart, because a fix that turns every retryable failure into a
  // hard failure would trade one wrong answer for another. A `10605` with the
  // same markers and a small hint is the case that must still be waited out.
  const payload = JSON.stringify({ isQueued: true, retryAfterSeconds: 2, serviceAvailable: true })
  const verdict = classifyUpstreamError({}, '10605', payload)
  assert.strictEqual(verdict.kind, 'rate-limit')
  assert.strictEqual(verdict.retryAfterSeconds, 2)
})

test('the daily limit is never waited out, however much budget is left', () => {
  // The property that would have prevented the original symptom entirely: even
  // a caller with a fresh budget and a hint in hand gets no sleep, because the
  // answer does not improve with time inside a session.
  const rejection = { retryable: false, dailyLimit: true, retryAfterSeconds: 7350 }
  assert.strictEqual(queueWaitFor(rejection, 0, 1), undefined)
  assert.strictEqual(queueWaitFor(rejection, 0, 5), undefined)
  // The contrast: a genuine queue with the same hint DOES sleep, so the
  // assertion above is about the kind and not about the helper being broken.
  assert.ok(queueWaitFor({ retryable: true, retryAfterSeconds: 7350 }, 0, 1) > 0)
})
