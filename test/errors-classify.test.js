/**
 * Contract tests for the upstream error classifier.
 *
 * Run: node --test test/errors-classify.test.js
 *
 * `classifyUpstreamError` had no coverage, even though it is the gatekeeper for
 * the distinction the whole retry design rests on. Getting it wrong is
 * expensive in both directions: calling a queue a sign-in failure sends the user
 * to re-authenticate for what is a busy server, while calling a sign-in failure
 * a queue makes the harness retry a request that can never succeed.
 *
 * The file's own comment states three rules, and each is asserted below:
 *   1. an exact `10605` decides first, regardless of what the body says;
 *   2. a sign-in signal decides next, and is never shadowed by queue markers;
 *   3. the marker heuristic is a fallback that needs TWO co-occurring markers,
 *      so an auth error that happens to carry a `retryAfterSeconds` field is
 *      not misread as a queue.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { classifyUpstreamError } from '../lib/errors.js'

test('an exact 10605 is a queue, whatever the body contains', () => {
  // Rule 1. The code decides, not the text — a gateway that mislabels the body
  // must not change the verdict.
  for (const detail of [
    '',
    '{"retryAfterSeconds":7}',
    'Login expired',
    'TOKEN_EXPIRE',
    'not json at all',
  ]) {
    const result = classifyUpstreamError({}, '10605', detail)
    assert.strictEqual(result.kind, 'rate-limit', `10605 with detail ${JSON.stringify(detail)}`)
  }
})

test('10605 is recognised as a number as well as a string', () => {
  // A gateway that stopped quoting the code sends a bare JSON number. The
  // classifier normalises before comparing; a strict string match would let this
  // fall through to the generic branch and be treated as a hard rejection.
  assert.strictEqual(classifyUpstreamError({}, 10605, '').kind, 'rate-limit')
})

test('a queue reports the wait the gateway asked for', () => {
  const detail = '{"isQueued":true,"retryAfterSeconds":12,"serviceAvailable":false}'
  const result = classifyUpstreamError({}, '10605', detail)
  assert.strictEqual(result.retryAfterSeconds, 12)
})

test('10605 carries its descriptor through the doubly-encoded real shape', () => {
  // The real shape, quoted from this module's own header comment:
  //   { code: "403", message: "{\"code\":\"10605\",
  //      \"message\":\"{\\\"isQueued\\\":false,\\\"retryAfterSeconds\\\":2,...}\"}" }
  // After the unwrap layer, `detail` is the inner JSON document, whose
  // `message` is itself a JSON string. Both layers have to be parsed.
  //
  // This failed when first written. `queueSeconds` used to try
  // `JSON.parse(`"${text}"`)` for text not starting with `{`, on the assumption
  // it was a bare string fragment — but any such text contains its own quotes,
  // so the interpolated literal was never valid JSON, the throw was swallowed,
  // and the gateway's own wait hint came back as 0 for every real queue.
  const detail = JSON.stringify({
    code: '10605',
    message: JSON.stringify({ isQueued: false, retryAfterSeconds: 2, serviceAvailable: true }),
  })
  const result = classifyUpstreamError({}, '10605', detail)
  assert.strictEqual(result.kind, 'rate-limit')
  assert.strictEqual(
    result.retryAfterSeconds,
    2,
    'the gateway own retryAfterSeconds must survive the double encoding',
  )
})

test('10605 with a plain object descriptor reports its wait', () => {
  const result = classifyUpstreamError({}, '10605', '{"isQueued":true,"retryAfterSeconds":7}')
  assert.strictEqual(result.retryAfterSeconds, 7)
})

test('105 is a sign-in expiry, whatever the body contains', () => {
  for (const detail of ['', '{"retryAfterSeconds":3,"isQueued":true}', 'anything']) {
    const result = classifyUpstreamError({}, '105', detail)
    assert.strictEqual(
      result.kind,
      'sign-in-expired',
      `105 with detail ${JSON.stringify(detail)} must not be read as a queue`,
    )
  }
})

test('the sign-in wording is recognised without the 105 code', () => {
  // Some gateways report the failure only in prose.
  for (const detail of [
    'Login expired',
    'TOKEN_EXPIRE',
    'the token is not active',
    'TOKEN_Expire (case-insensitive)',
  ]) {
    assert.strictEqual(classifyUpstreamError({}, '', detail).kind, 'sign-in-expired')
    assert.strictEqual(classifyUpstreamError({}, '403', detail).kind, 'sign-in-expired')
  }
})

test('a sign-in failure carrying ONE queue marker is still a sign-in failure', () => {
  // Rule 3, and the most valuable assertion in this file. An auth error that
  // happens to include a `retryAfterSeconds` field is common, and reading that
  // single field as a queue would make the plugin wait out a queue that does not
  // exist — for two minutes — instead of telling the user to sign in again.
  const result = classifyUpstreamError({}, '', 'TOKEN_EXPIRE {"retryAfterSeconds":30}')
  assert.strictEqual(result.kind, 'sign-in-expired')
  assert.strictEqual(result.retryAfterSeconds, undefined, 'a sign-in failure must not report a wait')
})

test('two co-occurring queue markers are enough when no code matched', () => {
  // Rule 3, the fallback path.
  const detail = '{"isQueued":true,"retryAfterSeconds":4,"queueType":"chat"}'
  const result = classifyUpstreamError({}, '403', detail)
  assert.strictEqual(result.kind, 'rate-limit')
  assert.strictEqual(result.retryAfterSeconds, 4)
})

test('a lone marker is not enough to call it a queue', () => {
  assert.strictEqual(classifyUpstreamError({}, '403', '{"retryAfterSeconds":9}').kind, 'upstream')
  assert.strictEqual(classifyUpstreamError({}, '403', '{"isQueued":false}').kind, 'upstream')
  assert.strictEqual(classifyUpstreamError({}, '403', '{"serviceAvailable":true}').kind, 'upstream')
})

test('10605 outranks sign-in wording when both are present', () => {
  // Rule 1 beats rule 2. The exact code is the more specific signal, and a
  // queued request can quote auth-flavoured text in its body. Verified by
  // mutation: reordering these two branches turns this test red.
  const result = classifyUpstreamError({}, '10605', 'Login expired {"retryAfterSeconds":2}')
  assert.strictEqual(result.kind, 'rate-limit')
})

test('an unrecognised failure is reported as a plain upstream error', () => {
  // The default must not invent a verdict: an unknown failure is a hard error,
  // and retrying it as a queue would loop for two minutes on something that
  // will never clear.
  for (const detail of ['', 'boom', '{"error":"internal"}', '<html>502</html>']) {
    const result = classifyUpstreamError({}, '500', detail)
    assert.strictEqual(result.kind, 'upstream', `detail ${JSON.stringify(detail)}`)
    assert.strictEqual(result.retryAfterSeconds, undefined)
  }
})

test('the gateway hint survives a descriptor nested several layers deep', () => {
  // Depth is not cosmetic: the documented shape needs two parses and one
  // property hop, and anything that stops early returns 0. That silently
  // changes upstream behaviour — `queueWaitFor` treats 0 as "no hint" and falls
  // back to its own ladder, so a queue the server said would clear in 2s is
  // polled on a 1s-then-escalating schedule instead.
  const descriptor = { isQueued: true, retryAfterSeconds: 2, serviceAvailable: true }
  const twoDeep = JSON.stringify({ code: '10605', message: JSON.stringify(descriptor) })
  const threeDeep = JSON.stringify({ code: '403', message: JSON.stringify({ code: '10605', message: JSON.stringify(descriptor) }) })
  assert.strictEqual(classifyUpstreamError({}, '10605', twoDeep).retryAfterSeconds, 2)
  assert.strictEqual(classifyUpstreamError({}, '10605', threeDeep).retryAfterSeconds, 2)
  // And a hint that is present but not a positive number is treated as absent,
  // rather than being passed on as a 0-second wait.
  const zeroed = JSON.stringify({ retryAfterSeconds: 0 })
  assert.strictEqual(classifyUpstreamError({}, '10605', zeroed).retryAfterSeconds, 0)
})

test('a queue with an unparseable body is still a queue, with no wait', () => {
  // Losing the retry hint is recoverable; losing the retryability is not. This
  // is the whole point of the catch in `queueSeconds`.
  const result = classifyUpstreamError({}, '10605', 'not json { broken')
  assert.strictEqual(result.kind, 'rate-limit')
  assert.strictEqual(result.retryAfterSeconds, 0)
})

test('nullish inputs do not throw', () => {
  // The call sites are catch blocks, where `code` and `detail` are frequently
  // absent. A throw here would replace a real upstream failure with a
  // classifier crash.
  assert.doesNotThrow(() => classifyUpstreamError(undefined, undefined, undefined))
  assert.doesNotThrow(() => classifyUpstreamError(null, null, null))
  assert.strictEqual(classifyUpstreamError(undefined, undefined, undefined).kind, 'upstream')
})
