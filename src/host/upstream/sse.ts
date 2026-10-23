/**
 * sse — moved verbatim from `src/host/upstream.ts` during the protocol split
 * (docs/issues/22-upstream-split.md); only imports and exports were tidied. The
 * protocol facts live in the header of `crypto.ts`.
 */

import crypto from 'node:crypto'
import { encodeBody } from './crypto.ts'
import { authHeaders } from './cosy-sign.ts'
import { chatUrl } from './endpoints.ts'
import { ATTEMPT_TIMEOUT_MS, sleep, queueWaitFor } from './retry.ts'
import type { QoderMessage } from './messages.ts'
import { classifyUpstreamError, describeThrown, errorMessage, parseRetryAfterSeconds, ProtocolShapeChangedError, redactSecrets, SignInExpiredError, thrownFlag } from '../errors.ts'
import type { ChatTurnRequest, QoderCredential, Region, UpstreamChunk } from '../domain.ts'

/**
 * Classify one error frame into `{ kind, retryAfterSeconds, code, detail }`.
 *
 * Shared by the HTTP-status path and the in-band frame path so both agree on
 * what a given payload means. A frame that carries no failure at all — no error
 * code and no explicit `success: false` — returns `undefined`, which is how the
 * frame reader tells a status frame apart from a chunk.
 *
 * @param chunk - one decoded frame, or a synthetic `{ code, message }` built
 *   from a non-2xx HTTP reply.
 * @param fallbackCode - code to assume when the payload names none (the HTTP
 *   status, on the transport path).
 */
function readFailure(chunk: unknown, fallbackCode = ''):
  | { kind: string; retryAfterSeconds: number; code: string; detail: string }
  | undefined {
  if (chunk === null || typeof chunk !== 'object' || Array.isArray(chunk)) return undefined
  // A frame is only a failure if it carries identifying detail. Bare status or
  // keepalive frames (`{ success: true }`, `{ success: false }` with no code
  // and no message, plain arrays, etc.) must not kill the stream.
  const frame = chunk as Record<string, unknown>
  const hasCode = frame.code != null || frame.errorCode != null
  const hasMessage =
    (typeof frame.message === 'string' && frame.message.length > 0) ||
    (typeof frame.errorMessage === 'string' && frame.errorMessage.length > 0)
  if (!hasCode && !hasMessage) {
    // No identifying fields at all. A `fallbackCode` (HTTP status) still
    // identifies the failure on the transport path; without it, this is not
    // an error frame.
    if (fallbackCode === '') return undefined
  }
  const { code, detail } = unwrapFailure(frame)
  const effective = code !== '' ? code : fallbackCode
  const kind = classifyUpstreamError(chunk, effective, detail)
  return { kind: kind.kind, retryAfterSeconds: kind.retryAfterSeconds ?? 0, code: effective, detail }
}
/**
 * The shape probe a chat turn hands to its frame reader.
 *
 * The doubly-wrapped SSE protocol is measured, not contracted, so the one
 * evidence that a turn's wire has moved is the frame itself: a `data:` payload
 * this build cannot read as an envelope, a chunk, or a named failure. A
 * healthy turn yields chunks and never consults the probe, so counting the
 * unreadable frames costs nothing; the verdict (in `streamChat`'s retry loop)
 * fires only when a WHOLE attempt stream carried frames and not one of them
 * was usable — the chat-side twin of the model-list freeze the catalog path
 * already triages (`protocol-shape-changed`).
 */
interface ChatShapeProbe {
  /** Data payloads the gateway streamed that this build does not read. */
  skipped: number
  /**
   * The first unreadable payload, as received — the evidence the verdict names.
   *
   * Present-but-`undefined` until a frame is noted, not absent: the probe is
   * built with the key spelled out, so `'sample' in probe` is true from the
   * start. `exactOptionalPropertyTypes` makes that distinction part of the
   * type, which is why this reads `| undefined` rather than a bare `?`.
   */
  sample?: string | undefined
}

/** Note one unreadable frame on the turn's probe; the first is the one kept. */
function noteUnreadableFrame(probe: ChatShapeProbe, payload: string): void {
  probe.skipped += 1
  if (probe.sample === undefined) probe.sample = payload.slice(0, 300)
}

/**
 * One chat turn, streamed.
 *
 * Yields plain objects in the OpenAI chunk vocabulary
 * (`{ choices: [{ delta, finish_reason }] }`) so the caller can forward them
 * without knowing about Qoder's envelope.
 *
 * @param region - the region descriptor.
 * @param credential - `{ userID, token, name, email, machineID }`.
 * @param request - `{ model, messages, tools, maxTokens, enableThinking, alwaysThinking, reasoningEffort, sessionId }`.
 *   `alwaysThinking` marks a model that rejects `enable_thinking: false`; for
 *   those the flag is omitted entirely rather than sent as `false`.
 * @yields OpenAI-shaped chat completion chunks.
 */
export async function* streamChat(
  region: Region,
  credential: QoderCredential,
  request: ChatTurnRequest,
  signal?: AbortSignal,
): AsyncGenerator<UpstreamChunk> {
  const model = request.model
  const recordID = crypto.randomUUID()
  const messages = request.messages as QoderMessage[]
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')
  const lastText = typeof lastUser?.content === 'string' ? lastUser.content : ''

  // A model that always thinks answers `enable_thinking: false` with a
  // `provider_error` (1210) instead of a completion, so the flag is left off
  // for those and thinking is only ever requested positively.
  //
  // `max_tokens` is forwarded only when the caller actually specifies one. The
  // caller is the harness, and it now passes the declared `PROBED_MAX_TOKENS`
  // ceiling (see `pi-model.ts`) through as `request.maxTokens`. Forwarding is
  // the whole job: an over-small value is harmful because reasoning and the
  // answer share this budget upstream, so we never invent or lower it here —
  // and an absent value sends NO key rather than a made-up default.
  // Mixed value types by design (booleans and numbers, and only the keys the
  // caller actually asked for), so the honest type is a record of unknowns.
  // The three assignments below are what prove each value is the right one.
  const parameters: Record<string, unknown> = {}
  // Bound first: `Number.isSafeInteger` is not a type predicate, so testing
  // `request.maxTokens` directly leaves it `number | undefined` inside the
  // branch. Testing the local narrows it, and the comment above is why an
  // absent value must send NO key rather than a default.
  const maxTokens = request.maxTokens
  if (maxTokens !== undefined && Number.isSafeInteger(maxTokens) && maxTokens > 0) {
    parameters.max_tokens = maxTokens
  }
  if (request.enableThinking === true) {
    parameters.enable_thinking = true
    if (typeof request.reasoningEffort === 'string' && request.reasoningEffort.length > 0) {
      parameters.reasoning_effort = request.reasoningEffort
    }
  } else if (request.alwaysThinking !== true) {
    parameters.enable_thinking = false
  }

  // The literal is annotated rather than inferred: every `null` and every `[]`
  // below is a REQUIRED field the gateway expects to see present, and inference
  // widens them to `any`/`never[]` precisely because their emptiness is the
  // point. `image_urls: null` is not "no images" vs "images" — the key has to
  // be there as null, and a future edit that drops it should be a type error.
  const body: {
    image_urls: null
    messages: unknown
    tools: unknown
    chat_context: {
      chatPrompt: string
      imageUrls: null
      extra: { context: unknown[]; modelConfig: { key: unknown; is_reasoning: boolean }; originalContent: string }
      features: unknown[]
      text: string
    }
    [field: string]: unknown
  } = {
    request_id: crypto.randomUUID(),
    request_set_id: recordID,
    chat_record_id: recordID,
    session_id: request.sessionId ?? `dsh-${crypto.randomUUID()}`,
    stream: true,
    chat_task: 'FREE_INPUT',
    is_reply: true,
    is_retry: false,
    source: 1,
    version: '3',
    session_type: 'qodercli',
    agent_id: 'agent_common',
    task_id: 'common',
    code_language: '',
    chat_prompt: '',
    image_urls: null,
    aliyun_user_type: '',
    // The upstream ignores a top-level `system` field; a leading role:system
    // message is what it actually honours.
    system: '',
    messages: request.messages,
    tools: request.tools ?? [],
    parameters,
    chat_context: {
      chatPrompt: '',
      imageUrls: null,
      extra: {
        context: [],
        modelConfig: { key: model, is_reasoning: request.enableThinking === true },
        originalContent: lastText,
      },
      features: [],
      text: lastText,
    },
    model_config: { key: model, source: 'system', is_reasoning: request.enableThinking === true },
    business: {
      product: 'cli',
      version: '1.0.0',
      type: 'agent',
      stage: 'start',
      id: crypto.randomUUID(),
      name: lastText.slice(0, 30),
      begin_at: Date.now(),
    },
  }

  const url = chatUrl(region)
  const bodyBytes = encodeBody(Buffer.from(JSON.stringify(body)))

  // The turn's shape probe: shared across the attempts of this loop, because
  // the verdict is reached only when a WHOLE stream carried frames and none of
  // them was usable (see ChatShapeProbe).
  const shapeProbe: ChatShapeProbe = { skipped: 0, sample: undefined }

  /**
   * Open one attempt and hand back its frame stream.
   *
   * Nothing is yielded until the first frame arrives, so a queue rejection
   * raised here is still safe to retry: the caller has seen no output yet.
   */
  async function* readFrames(response: Response, probe: ChatShapeProbe): AsyncGenerator<UpstreamChunk> {
    // A response with no body is not a stream that ended — it is an answer this
    // transport cannot read, and `getReader()` on `null` would throw a
    // TypeError that the caller would classify as an ordinary fetch failure.
    // Naming it here keeps the retry path and the error message honest; the
    // caller's `try` already covers it, since a generator body does not run
    // until the first `next()`.
    const body = response.body
    if (body === null) {
      throw new Error(`dsh-connect-qoder: response ${response.status} carried no body to stream`)
    }
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let streamDone = false
    let endOfStream = false
    try {
      while (!streamDone) {
        const { done, value } = await reader.read()
        if (done) {
          // The stream ENDED: flush the decoder and hand the residual buffer
          // to the SAME line path below. A last frame that arrives without a
          // trailing newline used to be dropped here, and the drop was silent:
          // the user saw a complete-looking answer that was missing its last
          // sentence, and nothing anywhere said so. Flushing the decoder too
          // releases a multi-byte character that was cut between the last two
          // chunks (it would otherwise be replaced by nothing at all).
          endOfStream = true
          buffer += decoder.decode()
          if (buffer.trim() !== '') buffer += '\n'
        } else {
          buffer += decoder.decode(value, { stream: true })
        }
        let newline
        while ((newline = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newline).trim()
          buffer = buffer.slice(newline + 1)
          if (!line.startsWith('data:')) continue
          const payload = line.slice(5).trim()
          if (payload.length === 0) continue
          if (payload === '[DONE]') { streamDone = true; break }

          // The frame is an envelope whose `body` is itself JSON — but a few
          // frames carry the chunk inline, so both shapes are accepted. Every
          // data payload this build ends up not reading is noted on the probe
          // rather than dropped: the verdict at the end of a stream that
          // yielded nothing is the drift triage (see ChatShapeProbe).
          let envelope
          try {
            envelope = JSON.parse(payload)
          } catch {
            noteUnreadableFrame(probe, payload)
            continue
          }
          let chunk = envelope
          if (typeof envelope?.body === 'string') {
            try {
              chunk = JSON.parse(envelope.body)
            } catch {
              noteUnreadableFrame(probe, payload)
              continue
            }
          } else if (envelope?.body !== undefined && typeof envelope.body === 'object') {
            chunk = envelope.body
          }
          // A token-accounting frame carries `choices: []` (or omits the field)
          // and a top-level `usage`. It must be forwarded, not treated as a
          // failure: the shim turns it into the counts DSH records per turn.
          if (chunk?.choices !== undefined || (chunk?.usage !== undefined && chunk.usage !== null)) {
            yield chunk
            continue
          }

          // A failure arrives as an ordinary 200 frame carrying an error object
          // rather than a chunk. Silently dropping it would present the user
          // with an empty assistant turn, so it is raised instead. A frame that
          // is none of chunk, usage, or a NAMED failure — a renamed field, a
          // new wrapper — is noted like the unparseable ones: the verdict that
          // fires when the whole stream is like this says the wire moved.
          const failure = readFailure(chunk)
          if (failure === undefined) {
            noteUnreadableFrame(probe, payload)
            continue
          }
          // Checked before the queue branch on purpose: a spent daily allowance
          // arrives WITH queue markers and a multi-hour Retry-After, so anything
          // that classified on the marker fallback first would turn it into a
          // long sleep. It must not be retried at all.
          if (failure.kind === 'daily-limit') throw new DailyLimitRejection(failure.detail, failure.retryAfterSeconds)
          if (failure.kind === 'rate-limit') {
            // Retryable: the caller waits it out and re-sends, so this is not
            // reported as a rejection.
            throw new QueueRejection(failure.retryAfterSeconds, failure.detail)
          }
          const message = failureMessage(failure, region)
          // The flag is on the class, not hung on a bare `Error` through an
          // `any` local: `isStaleCredentialError` reads it, and this way the
          // reader and this throw cannot drift apart.
          if (failure.kind === 'sign-in-expired') throw new SignInExpiredError(message)
          throw new Error(message)
        }
        // The end of the body is the end of the turn: the residual buffer was
        // handed to the line path above, so there is nothing left to wait for.
        if (endOfStream) break
      }
    } finally {
      // On a retryable rejection the body is abandoned mid-stream; cancelling
      // releases the socket now instead of leaving it to the garbage collector,
      // which matters because the retry loop may open several of these.
      try {
        await reader.cancel()
      } catch {
        // Already closed or errored — nothing left to release.
      }
    }
  }

  /** Send one request. Throws for terminal failures, returns the open stream. */
  async function openAttempt() {
    let response
    // Build headers outside the try so that a programming error (e.g.
    // `credential` is undefined) throws directly rather than being caught
    // and misclassified as a transient network failure.
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Accept-Encoding': 'identity',
      'X-Model-Key': String(model),
      'X-Model-Source': 'system',
      ...authHeaders(bodyBytes, url, credential),
    }
    // Bound this attempt on its own, and still honour the caller's abort. The
    // returned response body outlives this scope, so the deadline must NOT stay
    // armed for the whole stream — only the handshake up to response headers.
    //
    // That is why the deadline is a timer this function owns and clears in the
    // `finally` below, not an `AbortSignal.timeout`. `fetch` keeps the signal
    // it was given attached to the response body, and nothing clears an
    // `AbortSignal.timeout` once `fetch` settles: it stayed armed for the whole
    // stream and cut every answer still streaming when it fired —
    // `TimeoutError: The operation was aborted due to timeout`, mid-stream,
    // after output had already been forwarded, where the attempt can no longer
    // be retried without duplicating it. A long-thinking turn that streams
    // past the deadline is healthy; a stalled body is the adapter's idle
    // watchdog's job, not this one's.
    const deadline = new AbortController()
    const timer = setTimeout(() => {
      deadline.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))
    }, ATTEMPT_TIMEOUT_MS)
    const attemptSignal = signal === undefined ? deadline.signal : AbortSignal.any([signal, deadline.signal])
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        // `Buffer` is a `Uint8Array` and `fetch` accepts binary bodies at
        // runtime, but `BodyInit` in the DOM/Node lib types does not list it —
        // it is spelled as the `URLSearchParams` / `Blob` / `ReadableStream`
        // union. The bytes handed over are exactly the encoded body
        // `authHeaders` just signed, and the signature is computed over THESE
        // bytes, so re-encoding or re-copying them here would break the
        // pairing. One cast at the type boundary, with no runtime effect.
        body: bodyBytes as unknown as BodyInit,
        redirect: 'error',
        signal: attemptSignal,
      })
    } catch (error) {
      // A caller abort is the user's own doing and must surface unchanged.
      if (signal?.aborted) throw error
      // A deadline that fired is a stuck attempt, not a code bug. It is
      // retryable for the same reason a reset socket is: nothing was received,
      // so no output is duplicated by trying again.
      if (deadline.signal.aborted) {
        throw new QueueRejection(
          0,
          `no response headers within ${Math.round(ATTEMPT_TIMEOUT_MS / 1000)}s`,
        )
      }
      // Network-level failures (ECONNRESET, DNS, proxy timeout, undici socket
      // errors) are transient and safe to retry before the first frame. The
      // caller's `queueWaitFor` will apply the escalation ladder.
      // `cause` is an undici `Error` wrapping the socket failure, and its `code`
      // is where the real diagnosis lives; `error.code` is the fallback for a
      // throw that carried no cause. Both reads are narrowed rather than
      // assumed, so a non-object throw answers `undefined` for each and falls
      // through to the `message` test below instead of matching a code by luck.
      const cause = thrownFlag(error, 'cause')
      const code = thrownFlag(cause, 'code') ?? thrownFlag(error, 'code') ?? ''
      if (
        code === 'ECONNRESET' || code === 'ECONNREFUSED' || code === 'EPIPE' ||
        code === 'ENOTFOUND' || code === 'UND_ERR_SOCKET' ||
        code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'UND_ERR_HEADERS_TIMEOUT' ||
        String(thrownFlag(error, 'message') ?? '').includes('fetch failed')
      ) {
        // Prefer the cause's own message — it names the socket failure — and
        // fall back to the wrapper's when the throw carried no usable cause.
        const detail = errorMessage(cause) !== '' ? errorMessage(cause) : describeThrown(error)
        throw new QueueRejection(0, `network: ${detail}`)
      }
      // A bare `TypeError` used to land in that list, on the theory that undici
      // wraps transport failures in one. It does not: `TypeError` is also what a
      // malformed URL or an illegal header value throws, so a plain coding bug
      // was retried as though the network were flaky — silently, for the whole
      // budget. Only the transport-shaped ones are retried now; everything else
      // propagates and is reported as itself.
      throw error
    } finally {
      // Headers are in (or the attempt is over): disarm the deadline before the
      // body is read, so it can never fire into a live stream.
      clearTimeout(timer)
    }

    if (!response.ok) {
      // Redact BEFORE the slice: the body is copied into the error messages
      // below, and a credential riding its tail would otherwise be cut in half
      // and slip past every shape rule.
      const text = redactSecrets(await response.text()).slice(0, 500)

      // A non-2xx reply carries the same nested envelope as an in-band error
      // frame, so it is unwrapped the same way: the outer status is often a
      // bare 403 whose real meaning (`10605`, queued) lives two JSON strings
      // deeper. It is unwrapped BEFORE the transient-status branch below,
      // because the status is not a reliable signal for the terminal verdicts a
      // body can carry — see the daily-limit check.
      const failure = readFailure({ code: String(response.status), message: text }, String(response.status))

      // A spent daily allowance is checked ahead of the transient branch, at
      // every status, for the same reason the frame path checks it ahead of its
      // queue branch: it carries queue markers and a multi-hour hint, and it
      // must not become a sleep. Reading the status FIRST is what let the newer
      // gateway's `429` + `daily_limit_exceeded` reply run the escalation ladder
      // for its full two-minute budget and twelve attempts, then hand DSH a
      // `rate_limit` it retried five more times (docs/issues/23-upstream-429-daily-limit.md);
      // the failure does not become less final by arriving under a 429.
      if (failure !== undefined && failure.kind === 'daily-limit') {
        throw new DailyLimitRejection(failure.detail, failure.retryAfterSeconds)
      }

      // Transient HTTP failures (429, 5xx) are safe to retry before the first
      // frame: the caller has seen no output yet. Honour a `Retry-After` hint
      // when present; otherwise let the escalation ladder in `queueWaitFor`
      // take over.
      if (response.status === 429 || response.status >= 500) {
        // `parseRetryAfterSeconds` in `errors.ts` is the one parser for this
        // header across the plugin (a numeric delta, a numeric string, or an
        // HTTP-date; `undefined` = the platform said nothing). It was duplicated
        // here until the issue-22 split; the two copies agreed by accident.
        const retryAfter = parseRetryAfterSeconds(response.headers.get('retry-after')) ?? 0
        throw new QueueRejection(retryAfter, `HTTP ${response.status} — ${text}`)
      }

      if (failure === undefined) {
        throw new Error(`Qoder chat failed: HTTP ${response.status} ${response.statusText} — ${text}`)
      }
      if (failure.kind === 'rate-limit') throw new QueueRejection(failure.retryAfterSeconds, failure.detail)
      const message = failureMessage(failure, region, response.status, response.statusText)
      // Same reasoning as the frame path above.
      if (failure.kind === 'sign-in-expired') throw new SignInExpiredError(message)
      throw new Error(message)
    }
    // A 200 that claims a document content-type is the endpoint answering with
    // something other than the SSE stream: an SSO/HTML page, a JSON error
    // document, a non-streaming answer to a `stream: true` request. Left to
    // the frame reader, every one of those surfaces as an "empty response"
    // that names nothing about why. The check stays narrow on purpose — only
    // the content types the documented drift modes arrive as are triaged; an
    // absent header or an event-stream one passes untouched, and the frame
    // probe below is the second half of the same verdict.
    const contentType = response.headers.get('content-type') ?? ''
    if (/json|html|xml/i.test(contentType)) {
      throw new ProtocolShapeChangedError(
        `chat answered \`200 ${contentType}\` where \`text/event-stream\` was expected`,
      )
    }
    if (response.body === null) throw new Error('Qoder chat returned no body')
    return response
  }

  // Qoder queues rather than rejecting, and tells us how long to wait. That wait
  // belongs here, not in DSH's retry loop: DSH's policy is fixed (5 attempts,
  // 500 ms doubling to 10 s, ignoring the hint) and its budget is often shorter
  // than the queue. Waiting internally also keeps the turn alive, so the user
  // does not have to send the message again and restart it.
  let waitedMs = 0
  for (let attempt = 1; ; attempt++) {
    let stream
    let first
    // Everything this attempt costs — the handshake, the first frame, and any
    // retry delay — is charged to the budget, not just the delay. Counting only
    // the sleep is what made the budget decorative: a slow-but-progressing
    // attempt could spend unbounded time without ever exhausting it.
    const attemptStartedAt = Date.now()
    try {
      stream = readFrames(await openAttempt(), shapeProbe)
      // Pull the first frame before committing to a response, so a queue
      // rejection surfaces here rather than mid-stream where it could not be
      // retried without duplicating output.
      first = await stream.next()
    } catch (error) {
      waitedMs += Date.now() - attemptStartedAt
      const queueWaitMs = queueWaitFor(error, waitedMs, attempt)
      if (queueWaitMs === undefined) throw error
      // The caller aborted while we were deciding, so stop rather than sleep.
      if (signal?.aborted) throw error
      await sleep(queueWaitMs, signal)
      waitedMs += queueWaitMs
      continue
    }
    waitedMs += Date.now() - attemptStartedAt

    if (first.done === true) {
      // The gateway accepted the request but yielded no usable frame. Two
      // shapes are kept apart, because their answers differ: a stream that
      // carried frames this build does not parse says the WIRE moved — a
      // renamed envelope, a new wrapper, an error shape this code does not
      // name — and that is the drift verdict the card's "update the plugin"
      // copy exists for; a stream that carried no data payloads at all is an
      // empty answer, not a defect of this build. Before the split, both
      // cases read as "empty response" and a changed protocol kept the turn
      // failing silently — the chat-side twin of the model-list freeze the
      // catalog path triages as `protocol-shape-changed`.
      if (shapeProbe.skipped > 0) {
        throw new ProtocolShapeChangedError(
          `${region.displayName} chat stream: ${shapeProbe.skipped} frame(s) this build does not parse; first: ${shapeProbe.sample ?? '(none kept)'}`,
        )
      }
      throw new Error(`${region.displayName} returned an empty response`)
    }

    // Once the first chunk is out the turn is committed — there is no going
    // back — so the remaining frames are forwarded as they arrive. The `finally`
    // covers the case where the consumer stops early (the shim aborts on client
    // disconnect): without it the upstream socket would stay open until the
    // gateway closed it on its own.
    try {
      yield first.value
      for (;;) {
        const step = await stream.next()
        if (step.done === true) break
        yield step.value
      }
    } finally {
      await stream.return(undefined).catch(() => {})
    }
    return
  }
}

/**
 * A queue rejection that can be waited out.
 *
 * `retryable` is what the shim reads to decide between a retryable status and a
 * hard failure, so this stays a plain `Error` carrying the same flags the shim
 * already understood.
 */
class QueueRejection extends Error {
  /** Always true: waiting can clear a queue. */
  retryable: boolean
  /** Seconds to wait before retrying. */
  retryAfterSeconds: number
  /** The upstream detail, in a form a human can act on. */
  upstreamDetail: unknown

  constructor(retryAfterSeconds: number, detail: unknown) {
    super(
      `Qoder is busy — the request was queued` +
        `${retryAfterSeconds > 0 ? ` (retry in ~${retryAfterSeconds}s)` : ''}`,
    )
    this.name = 'QueueRejection'
    this.retryable = true
    this.retryAfterSeconds = retryAfterSeconds
    this.upstreamDetail = detail
  }
}

/**
 * The account's daily billing allowance is spent. NOT a queue: the counter resets
 * at the day boundary rather than draining, so `retryable: false` stops this
 * plugin's own queue ladder; the host's retries need two locks — this route's
 * policy (src/host/route-retry-policy.ts, docs/issues/24-terminal-failure-status-codes.md)
 * does not retry the verdict, and the message says "daily quota exhausted", the wording the host's quota predicate reads. */
class DailyLimitRejection extends Error {
  /** Always false: waiting within the session cannot fix a daily limit. */
  retryable: boolean
  /** Marks this as a daily-limit (not queue) failure. */
  dailyLimit: boolean
  /** Seconds until the counter resets (from the gateway, else 0). */
  retryAfterSeconds: number
  /** The upstream detail, in a form a human can act on. */
  upstreamDetail: unknown

  constructor(detail: unknown, retryAfterSeconds = 0) {
    super(
      // "daily quota exhausted" is a host-classifier contract, not decoration:
      // see the class doc. Keep the two words adjacent — the host's predicate is
      // `(?:quota|usage limit)[\s_-]+(?:exceeded|exhausted|reached)`.
      `Qoder's daily request allowance for this account is used up (daily quota exhausted)` +
        `${retryAfterSeconds > 0 ? ` — it resets in about ${Math.round(retryAfterSeconds / 3600)}h` : ''}. ` +
        'Waiting within the session will not help; the off-peak price (22:00–08:00 Asia/Shanghai) ' +
        'and the daily check-in both still work.',
    )
    this.name = 'DailyLimitRejection'
    this.retryable = false
    this.dailyLimit = true
    // Kept for the UI to show "resets at HH:MM" rather than a raw count.
    this.retryAfterSeconds = retryAfterSeconds
    this.upstreamDetail = detail
  }
}

/**
 * Build the readable sentence for a non-queue failure.
 *
 * Both parameters are the real shapes rather than `any`: `failure` is exactly
 * what {@link readFailure} returns (the only producer), and `region` is the
 * plugin's own `Region`. The `any` here meant the five field reads below —
 * including `failure.detail.length`, which throws on a non-string — were never
 * checked against the object that actually flows in.
 */
function failureMessage(
  failure: { kind: string; code: string; detail: string },
  region: Region,
  status?: number,
  statusText?: string,
) {
  if (failure.kind === 'sign-in-expired') {
    return (
      `${region.displayName} sign-in is no longer valid — open the ${region.displayName} app ` +
      `to sign in again, then restart DSH` +
      `${status !== undefined ? ` (HTTP ${status}: ${failure.detail})` : ` (upstream ${failure.code || 'error'}: ${failure.detail})`}`
    )
  }
  if (status === 401 || status === 403) {
    return (
      `${region.displayName} was refused by Qoder — check that this account can use this model ` +
      `(HTTP ${status}: ${failure.detail})`
    )
  }
  if (status !== undefined) {
    return `Qoder chat failed: HTTP ${status} ${statusText ?? ''} — ${failure.detail}`
  }
  return `Qoder upstream error${failure.code !== '' ? ` ${failure.code}` : ''}${failure.detail.length > 0 ? `: ${failure.detail}` : ''}`
}

/**
 * Parse a string that is expected to hold a JSON object, else `undefined`.
 */
function tryJsonObject(text: string): Record<string, unknown> | undefined {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{')) return undefined
  try {
    const parsed = JSON.parse(trimmed)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

/** Whether a value is a plain (non-array) object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Unwrap the gateway's failure envelope to its deepest level.
 *
 * Qoder nests the real complaint instead of stating it once: an outer
 * transport code wraps a `message` that is itself a JSON *string*, which wraps
 * another code and message, and the queue descriptor sits at the bottom —
 *
 * ```
 * { code: "403",
 *   message: "{\"code\":\"10605\",
 *              \"message\":\"{\\\"isQueued\\\":false,\\\"retryAfterSeconds\\\":2,...}\"}" }
 * ```
 *
 * Reading only the first level therefore reports a bare `403` and hides both
 * the true code (`10605`) and the retry hint. The whole chain is walked here so
 * the deepest code — the one that names the actual problem — wins.
 *
 * @returns `{ code, detail }`, the most specific code and the most informative
 *   detail text found.
 */
function unwrapFailure(chunk: Record<string, unknown>): { code: string; detail: string } {
  let code = ''
  let detail = ''
  let node: Record<string, unknown> = chunk
  let descended = false

  for (let depth = 0; depth < 8; depth++) {
    if (!isPlainObject(node)) break
    const levelCode = node.errorCode ?? node.code
    // Both spellings occur in the wild: a quoted `"10605"` and a bare JSON
    // number. Normalising numbers keeps the code usable for the exact matches
    // downstream instead of silently falling through to `''`.
    if (typeof levelCode === 'string' && levelCode.length > 0) code = levelCode
    else if (typeof levelCode === 'number' && Number.isFinite(levelCode)) code = String(levelCode)
    const message = node.message ?? node.errorMessage
    if (typeof message === 'string' && message.length > 0) detail = message

    // The next level sits under `details`/`error`, or inside a `message`
    // string that is itself a JSON document.
    const nested = isPlainObject(node.details) ? node.details : isPlainObject(node.error) ? node.error : undefined
    const next = nested ?? (typeof message === 'string' ? tryJsonObject(message) : undefined)
    if (next === undefined) break
    node = next
    descended = true
  }

  // When the walk bottoms out on a payload object (the queue descriptor), that
  // object is far more useful than the JSON string that carried it.
  if (descended && isPlainObject(node) && typeof node.message !== 'string') {
    detail = JSON.stringify(node)
  }
  return { code, detail }
}
