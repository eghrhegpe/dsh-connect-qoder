/**
 * The per-attempt deadline bounds the HANDSHAKE, never the answer.
 *
 * Run: node --test test/attempt-deadline.test.js
 *
 * WHY THIS FILE EXISTS
 *
 * `openAttempt` (src/host/upstream/sse.ts) bounds each attempt with
 * `ATTEMPT_TIMEOUT_MS` so a gateway that never returns response headers is
 * charged to the queue budget and retried. Its comment already said the
 * deadline must NOT stay armed for the whole stream — but it was an
 * `AbortSignal.timeout` handed to `fetch`, and `fetch` keeps that signal
 * attached to the response body. Nothing disarmed it once headers were in.
 *
 * So every answer still streaming 60 s after its request went out was cut
 * mid-stream with `TimeoutError: The operation was aborted due to timeout`.
 * Measured on a real DSH session (DeepSeek-Flash, reasoning effort `max`):
 * 57 failed attempts, all `TIMEOUT`, every one receiving its first frame
 * within 1.0–3.2 s and aborted 60.0–60.2 s after it was sent, while the
 * slowest step that survived took 59.8 s. The
 * cut lands after output was forwarded, so the plugin cannot retry it; the
 * host retries the whole step from scratch and long-thinking turns time out
 * over and over — at any context size.
 *
 * The cases below pin both halves of the contract:
 *
 *  1. headers that never arrive still time out, and the attempt is retried
 *     (the job the deadline exists for);
 *  2. once headers are in, the deadline passing does not touch the stream.
 *
 * The deadline is driven through `mock.timers`, so neither case waits a real
 * minute. That is also what makes case 1 fail against the old code: an
 * `AbortSignal.timeout` does not run on `setTimeout`, so mocked time never
 * fires it. The stub body errors when its fetch signal aborts, which is what
 * undici does to a real response body.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { streamChat } from '../src/host/upstream.ts'
import { ATTEMPT_TIMEOUT_MS, QUEUE_WAIT_MAX_SLEEP_MS } from '../src/host/upstream/retry.ts'

/** @type {import('../src/host/domain.ts').Region} */
const REGION = {
  id: 'qoder',
  mode: 'global',
  displayName: 'Qoder',
  appNames: ['Qoder'],
  baseUrl: 'https://gateway.example/',
  openApiUrl: 'https://openapi.example/',
  centerUrl: 'https://center.example/',
  manageUrl: 'https://manage.example/',
  downloadUrl: 'https://download.example/',
  patEnvNames: [],
}
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

/**
 * One answer frame, as the gateway sends it.
 * @param {string} text
 */
function frame(text) {
  return `data: ${JSON.stringify({ body: { choices: [{ index: 0, delta: { content: text } }] } })}\n`
}

/**
 * The text of the answer, in the order the frames carried it.
 * @param {any[]} chunks
 */
function textOf(chunks) {
  return chunks
    .map((chunk) => chunk?.choices?.[0]?.delta?.content ?? '')
    .join('')
}

/**
 * @param {typeof globalThis.fetch} handler
 */
function stubFetch(handler) {
  const original = globalThis.fetch
  globalThis.fetch = handler
  return () => {
    globalThis.fetch = original
  }
}

/**
 * An SSE response that stays open, and — like undici — errors its body with
 * the signal's reason when the signal `fetch` was given aborts.
 * @param {AbortSignal} signal
 * @param {string[]} chunks
 */
function liveResponse(signal, chunks) {
  /** @type {ReadableStreamDefaultController<Uint8Array> | undefined} */
  let controller
  const stream = new ReadableStream({
    start(c) {
      controller = c
    },
  })
  const open = controller
  for (const chunk of chunks) open?.enqueue(new TextEncoder().encode(chunk))
  signal.addEventListener('abort', () => {
    try {
      open?.error(signal.reason)
    } catch {
      // Already closed.
    }
  })
  return {
    response: new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    /** @param {string} chunk */
    push: (chunk) => open?.enqueue(new TextEncoder().encode(chunk)),
    close: () => open?.close(),
  }
}

/**
 * Pull a chat generator to settlement, keeping the chunks and the thrown error.
 * @param {AsyncIterator<any>} iterator
 */
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
  return { chunks, error }
}

/** Let pending promise callbacks run; `setImmediate` is not mocked. */
function settle() {
  return new Promise((resolve) => setImmediate(resolve))
}

test('headers that never arrive still time out, and the attempt is retried', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  /** @type {AbortSignal[]} */
  const signals = []
  const restore = stubFetch(async (_url, init) => {
    const signal = /** @type {AbortSignal} */ (init?.signal)
    signals.push(signal)
    if (signals.length === 1) {
      // A gateway that accepted the connection and never answers: only the
      // deadline can end this attempt.
      return new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason))
      })
    }
    const body = liveResponse(signal, [frame('ok')])
    body.close()
    return body.response
  })
  try {
    const result = drain(streamChat(REGION, CREDENTIAL, REQUEST))
    let settled = false
    result.then(() => {
      settled = true
    })
    await settle()
    t.mock.timers.tick(ATTEMPT_TIMEOUT_MS)
    await settle()
    assert.equal(signals[0]?.aborted, true, 'an attempt with no response headers must hit its deadline')
    assert.equal(signals[0]?.reason?.name, 'TimeoutError')
    // The deadline is charged as a queue rejection, so the turn sleeps and retries.
    for (let i = 0; i < 10 && !settled; i++) {
      t.mock.timers.tick(QUEUE_WAIT_MAX_SLEEP_MS)
      await settle()
    }
    const { chunks, error } = await result
    assert.equal(error, undefined, `the retried attempt must succeed: ${error}`)
    assert.equal(signals.length, 2, 'the stuck attempt must be retried exactly once')
    assert.equal(textOf(chunks), 'ok')
  } finally {
    restore()
  }
})

test('an answer still streaming when the deadline passes is not cut', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  /** @type {AbortSignal | undefined} */
  let fetchSignal
  /** @type {ReturnType<typeof liveResponse> | undefined} */
  let body
  const restore = stubFetch(async (_url, init) => {
    fetchSignal = /** @type {AbortSignal} */ (init?.signal)
    body = liveResponse(fetchSignal, [frame('hi')])
    return body.response
  })
  try {
    const iterator = streamChat(REGION, CREDENTIAL, REQUEST)
    const first = await iterator.next()
    assert.equal(textOf([first.value]), 'hi', 'the first frame must be forwarded')

    // A long-thinking answer: still streaming well past the attempt deadline.
    t.mock.timers.tick(ATTEMPT_TIMEOUT_MS * 2)
    await settle()
    assert.equal(fetchSignal?.aborted, false, 'the deadline must be disarmed once headers are in')

    body?.push(frame(' there'))
    body?.close()
    const { chunks, error } = await drain(iterator)
    assert.equal(error, undefined, `the turn must not fail: ${error}`)
    assert.equal(textOf(chunks), ' there', 'the rest of the answer must arrive')
  } finally {
    restore()
  }
})
