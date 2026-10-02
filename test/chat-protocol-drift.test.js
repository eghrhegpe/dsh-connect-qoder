/**
 * The CHAT side of protocol-drift triage — the endpoint most likely to see a
 * changed wire first, by call volume.
 *
 * Run: node --test test/chat-protocol-drift.test.js
 *
 * WHY THIS FILE EXISTS
 *
 * The model-list drift was triaged on the catalog path (`fetchModels` →
 * `ProtocolShapeChangedError` → the card's "update the plugin" copy), and the
 * suite pinned that in `test/protocol-drift.test.js`. The chat path had none:
 * a changed envelope arrived as ordinary frames this build did not parse,
 * every one of them silently skipped, and the turn ended with a bare
 * "empty response" — the plugin stayed out of date while the user watched
 * their agent fail a turn after a turn with no diagnosis anywhere. KNOWN_GAPS
 * registered this exact gap ("chat 端点是最常打的一个，先分诊它").
 *
 * The fix is two shapes, kept apart because their answers differ:
 *
 * 1. **A 200 that claims a document content-type** (`json|html|xml`) — the
 *    endpoint answered with something other than the SSE stream (an SSO/HTML
 *    page, a JSON error document, a non-streaming answer to `stream: true`).
 *    Triaged BEFORE any frame is read, so the answer is a drift verdict, not
 *    a mystery. An absent header or an event-stream one passes untouched.
 * 2. **A whole stream this build cannot read** — the gateway accepted the
 *    request and streamed data payloads, and not one of them parses as an
 *    envelope, a chunk, or a named failure. The verdict carries the FIRST
 *    unreadable frame, because that is what a maintainer can diff against the
 *    wire ("it is called `payload2` now" is a five-second fix; "something
 *    moved" is a hunt).
 *
 * A stream that carried NO data payloads at all is a different fact — an
 * empty answer, not a plugin defect — and keeps the ordinary
 * "empty response" error. The split is what keeps the triage from
 * mislabeling the one case that is not drift.
 *
 * The stub drives `streamChat` through `globalThis.fetch`, the way
 * `userinfo-headers.test.js` does: no gateway, no install, deterministic.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { streamChat } = await import('../src/host/upstream.ts')
const { isProtocolShapeChangedError } = await import('../src/host/errors.ts')

const REGION = { id: 'qoder', displayName: 'Qoder', baseUrl: 'https://gateway.example' }
const CREDENTIAL = { userID: 'u-test', token: 'tok-test', name: 'n', email: 'e@x', machineID: 'm' }
const REQUEST = {
  model: 'model-key',
  messages: [{ role: 'user', content: 'hi' }],
  tools: [],
  maxTokens: undefined,
  enableThinking: false,
  alwaysThinking: false,
  reasoningEffort: undefined,
  sessionId: 's-test',
}

/** One SSE response: each line is enqueued, then the stream closes. */
function sseResponse(lines, contentType = 'text/event-stream') {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(lines.join('\n')))
      controller.close()
    },
  })
  return new Response(stream, { status: 200, headers: { 'Content-Type': contentType } })
}

/** Pull a chat generator to settlement, keeping the chunks and the thrown error. */
async function drain(iterator) {
  const chunks = []
  let error
  for (;;) {
    let step
    try {
      step = await iterator.next()
    } catch (thrown) {
      error = thrown
      break
    }
    if (step.done) break
    chunks.push(step.value)
  }
  try {
    await iterator.return?.()
  } catch {
    // Already settled by the error path.
  }
  return { chunks, error }
}

function stubFetch(handler) {
  const original = globalThis.fetch
  globalThis.fetch = handler
  return () => {
    globalThis.fetch = original
  }
}

test('a stream every frame of which is unreadable is reported as drift, keeping the first frame', async () => {
  const restore = stubFetch(async () =>
    sseResponse([
      'data: {"unknown_envelope":{"nested":true}}',
      'data: {"another_wrapper":2}',
      'data: [DONE]',
    ]),
  )
  const { error } = await drain(streamChat(REGION, CREDENTIAL, REQUEST))
  restore()
  assert.ok(error, 'the turn must fail, not silently end empty')
  assert.strictEqual(isProtocolShapeChangedError(error), true, `expected drift, got ${error}`)
  assert.match(error.message, /needs an update/i, 'the user-facing text must say what to do')
  assert.match(error.detail, /2 frame\(s\)/, 'the count of unreadable frames reaches the message')
  assert.match(error.detail, /unknown_envelope/, 'the first arriving frame must reach the message')
  assert.match(error.detail, /Qoder\b/, 'the region name says which one broke')
})

test('a 200 claiming a document content-type is drift before any frame is read', async () => {
  // The body lines are deliberately stream-shaped: the verdict must fire on
  // the header, not on what the frame reader would have found.
  const restore = stubFetch(
    async () =>
      new Response('{"unexpected":"document"}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  )
  const { error } = await drain(streamChat(REGION, CREDENTIAL, REQUEST))
  restore()
  assert.ok(isProtocolShapeChangedError(error), `expected drift, got ${error}`)
  assert.match(error.detail, /application\/json/, 'the arriving content type is the evidence')
  assert.match(error.detail, /text\/event-stream/, 'and the one that was expected')
})

test('an event-stream 200 with an unreadable doubly-wrapped body is still drift', async () => {
  // The measured envelope is a JSON `body` INSIDE the SSE frame; a drift that
  // changes the inner encoding is the case the frame probe exists for.
  const restore = stubFetch(
    async () => sseResponse(['data: {"body":"not-json-any-more"}', 'data: [DONE]']),
  )
  const { error } = await drain(streamChat(REGION, CREDENTIAL, REQUEST))
  restore()
  assert.ok(isProtocolShapeChangedError(error), `expected drift, got ${error}`)
  assert.match(error.detail, /not-json-any-more/, 'the broken inner payload reaches the message')
})

test('a stream with no data payloads at all is an empty answer, not drift', async () => {
  // An SSE comment line is not a data payload: the gateway can stream silence.
  // That fact says nothing about the wire, so it keeps the ordinary error and
  // must NOT be dressed up as "the plugin is out of date".
  const restore = stubFetch(async () => sseResponse([': keepalive']))
  const { error } = await drain(streamChat(REGION, CREDENTIAL, REQUEST))
  restore()
  assert.ok(error, 'an empty answer still fails the turn')
  assert.strictEqual(isProtocolShapeChangedError(error), false, `must stay an empty-answer error, got ${error}`)
  assert.match(String(error.message), /empty response/)
})

test('a healthy stream resolves, and unreadable frames in a healthy turn do not taint it', async () => {
  // The probe counts skipped frames but the verdict only fires when a whole
  // stream yielded nothing. A turn that yields chunks — even with a stray
  // unrecognized frame alongside — is a normal turn and must not be reported
  // as drift.
  const restore = stubFetch(
    async () =>
      sseResponse([
        'data: {"ping":true}',
        'data: {"choices":[{"delta":{"content":"hello"}}]}',
        'data: {"choices":[],"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3,"credits":0.1}}',
        'data: [DONE]',
      ]),
  )
  const { chunks, error } = await drain(streamChat(REGION, CREDENTIAL, REQUEST))
  restore()
  assert.strictEqual(error, undefined, 'a turn with usable frames must not fail')
  assert.strictEqual(chunks.length, 2, 'the content frame and the usage frame')
  assert.strictEqual(chunks[0].choices[0].delta.content, 'hello')
  assert.strictEqual(chunks[1].usage?.total_tokens, 3)
})
