/**
 * The loopback shim.
 *
 * `PiAiAdapter` drives providers through pi-ai's OpenAI-completions API, but
 * Qoder needs COSY signing, a permuted body encoding, and its own SSE envelope.
 * Rather than teach pi-ai those three things, this module runs a private HTTP
 * server on `127.0.0.1` that *speaks* OpenAI and translates to Qoder on the way
 * out — the same shape the Trae and WorkBuddy bundles use.
 *
 * The server is bound to an ephemeral loopback port and requires a per-process
 * random bearer token, so nothing outside this process can use it as a proxy.
 * The real Qoder token never reaches pi-ai: it stays on this side of the shim.
 *
 * @module dsh-connect-qoder/shim
 */
import { createServer } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { streamChat, toQoderMessages, toQoderTools } from './upstream.js'
import { filterByEnabled } from './catalog-entry.js'
import { isStaleCredentialError } from './errors.js'

/** Reject anything that is not addressed to the loopback interface. */
function hostIsLoopback(host) {
  if (typeof host !== 'string') return false
  const name = host.startsWith('[') ? host.slice(1, host.indexOf(']')) : host.split(':')[0]
  return name === '127.0.0.1' || name === 'localhost' || name === '::1'
}

/** Reject any request that claims a non-loopback origin. */
function originIsLoopback(origin) {
  if (origin === undefined) return true
  if (typeof origin !== 'string') return false
  try {
    const host = new URL(origin).hostname
    return host === '127.0.0.1' || host === 'localhost' || host === '::1'
  } catch {
    return false
  }
}

/** Write one OpenAI-shaped error body. */
function writeError(res, status, code, message, extraHeaders = undefined) {
  const payload = JSON.stringify({ error: { message, type: code, code } })
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    ...(extraHeaders ?? {}),
  })
  res.end(payload)
}

/**
 * The `Retry-After` a retryable failure should advertise, or `undefined`.
 *
 * The gateway's queue hint (`error.retryAfterSeconds`, set by `QueueRejection`)
 * is honoured as given, clamped to {@link RETRY_AFTER_MAX_SECONDS}. The host
 * parses an HTTP `Retry-After` and waits it out, capped at 20 000 ms — so a
 * hint larger than that would be believed-but-clamped anyway, and advertising
 * the clamped number keeps both sides sleeping the same amount. A hint of zero
 * or a non-numeric one answers `undefined`, because "retry immediately" is what
 * the caller already does on any 503.
 */
const RETRY_AFTER_MAX_SECONDS = 20

function retryAfterHeader(error) {
  const seconds = Number(error?.retryAfterSeconds)
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined
  const clamped = Math.min(Math.max(Math.ceil(seconds), 1), RETRY_AFTER_MAX_SECONDS)
  return { 'Retry-After': String(clamped) }
}

/** Write one JSON body. */
function writeJson(res, status, value) {
  const payload = JSON.stringify(value)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
  res.end(payload)
}

/**
 * Read a request body fully, refusing anything past the cap.
 *
 * The shim serves one in-process client, but an unbounded reader is still an
 * OOM handle on the whole host: one run-away request (or a future, wider
 * exposure) could accumulate gigabytes before `JSON.parse` ever sees the
 * string. Chat bodies are small in practice, so the cap is generous, and a
 * breach answers with a 413 instead of growing.
 */
const MAX_BODY_BYTES = 20 * 1024 * 1024

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let total = 0
    let settled = false
    req.on('data', (chunk) => {
      if (settled) return
      total += chunk.length
      if (total > MAX_BODY_BYTES) {
        // Stop accumulating and answer with 413; the socket's remaining bytes
        // are left to Node, which closes the connection after a 4xx whose
        // body was never consumed.
        settled = true
        reject(Object.assign(new Error('request body exceeds the 20 MiB limit'), { name: 'BodyTooLargeError' }))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (settled) return
      settled = true
      resolve(Buffer.concat(chunks))
    })
    req.on('error', (error) => {
      if (settled) return
      settled = true
      reject(error)
    })
  })
}

/**
 * Start the shim.
 *
 * @param options.resolveCredential - async `() => credential`, called per
 *   request so a re-sign-in is picked up without a restart.
 * @param options.resolveModels - `() => model[]`, the live catalog.
 * @param options.resolveEnabledIds - `() => string[]`, the models the user has
 *   enabled for this region. Read per request so a change in settings reaches
 *   the picker on the next listing without restarting anything.
 * @param options.invalidateCredential - optional `() => void`, called when the
 *   upstream rejects a request with a sign-in failure; the next
 *   `resolveCredential` re-reads the app's store so a fresh sign-in is
 *   picked up without a DSH restart.
 * @param options.logger - optional logger for upstream failures.
 * @returns `{ ready, baseUrl, token, close }`.
 */
export function createQoderShim(options) {
  const {
    resolveCredential,
    resolveModels,
    resolveUpstreamKey,
    resolveAlwaysThinking,
    resolveEnabledIds,
    invalidateCredential,
    region,
    logger,
    // The upstream call, injectable so a test can force a queue rejection (or
    // any other failure) without reaching the real gateway. Everything else the
    // shim does is observable over HTTP, but no test can ask Qoder to be busy
    // on demand — and a 503 that carried no `Retry-After` was exactly the kind
    // of regression that would ship unnoticed.
    runChat = streamChat,
  } = options
  const SHARED_SECRET = randomBytes(32).toString('base64url')

  /** Constant-time bearer check. */
  function bearerOk(req) {
    const header = req.headers.authorization
    if (typeof header !== 'string') return false
    const match = /^Bearer\s+(.+)$/i.exec(header.trim())
    if (match === null) return false
    const presented = Buffer.from(match[1])
    const expected = Buffer.from(SHARED_SECRET)
    if (presented.length !== expected.length) return false
    return timingSafeEqual(presented, expected)
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((error) => {
      if (!res.headersSent) writeError(res, 500, 'internal', String(error))
      else res.end()
    })
  })

  const ready = new Promise((resolve, reject) => {
    server.once('listening', () => resolve())
    server.once('error', reject)
  })
  server.listen(0, '127.0.0.1')

  const baseUrl = () => {
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('qoder shim has no listening address')
    return `http://127.0.0.1:${address.port}`
  }

  async function handle(req, res) {
    if (!hostIsLoopback(req.headers.host)) {
      writeError(res, 403, 'host_not_allowed', 'Host header must name the loopback interface')
      return
    }
    if (!originIsLoopback(req.headers.origin)) {
      writeError(res, 403, 'origin_not_allowed', 'Origin must be a loopback origin')
      return
    }
    if (!bearerOk(req)) {
      writeError(res, 401, 'unauthorized', 'missing or invalid Authorization bearer')
      return
    }
    const url = req.url ?? '/'
    if (req.method === 'GET' && (url === '/healthz' || url === '/healthz/')) {
      writeJson(res, 200, { ok: true })
      return
    }
    if (req.method === 'GET' && (url === '/v1/models' || url === '/v1/models/')) {
      // The picker's discovery reads this endpoint, so it must narrow the
      // catalog exactly the way the adapter does. Returning the raw catalog here
      // is what let unchecked models keep appearing in the selector: the
      // adapter hid them, this listing did not.
      const enabled =
        typeof resolveEnabledIds === 'function' ? resolveEnabledIds() : undefined
      const data = filterByEnabled(resolveModels(), enabled).map((model) => ({
        id: model.id,
        object: 'model',
        created: 0,
        owned_by: region.id,
      }))
      writeJson(res, 200, { object: 'list', data })
      return
    }
    if (req.method === 'POST' && (url === '/v1/chat/completions' || url === '/v1/chat/completions/')) {
      await chatCompletions(req, res)
      return
    }
    writeError(res, 404, 'not_found', `no such route: ${req.method} ${url}`)
  }

  async function chatCompletions(req, res) {
    let credential
    try {
      credential = await resolveCredential()
    } catch (error) {
      writeError(res, 401, 'not_signed_in', String(error))
      return
    }
    // A falsy check rather than `=== undefined`: a resolver that answers with
    // `null` used to walk straight past this guard and reach `authHeaders`,
    // which then threw on `credential.userID` and surfaced as a 502
    // "upstream_error" — telling the user the provider failed when the truth is
    // that the region was never signed in. Both `undefined` and `null` mean the
    // same thing here, so both must land on the 401.
    if (!credential) {
      writeError(res, 401, 'not_signed_in', `${region.displayName} is not signed in on this machine`)
      return
    }

    let body
    try {
      body = JSON.parse((await readBody(req)).toString('utf8'))
    } catch (error) {
      if (error?.name === 'BodyTooLargeError') {
        writeError(res, 413, 'payload_too_large', 'request body exceeds the 20 MiB limit')
        return
      }
      writeError(res, 400, 'invalid_request', `body is not JSON: ${String(error)}`)
      return
    }

    const controller = new AbortController()
    req.on('close', () => controller.abort())

    const enableThinking = resolveThinking(body)
    const displayModel = body.model
    // The catalog is the authority on whether this model tolerates
    // `enable_thinking: false`; the injected resolver only overrides it.
    const catalogEntry = resolveModels().find((model) => model.id === displayModel)
    const alwaysThinking = resolveAlwaysThinking?.(displayModel) ?? catalogEntry?.alwaysThinking === true
    const request = {
      // DSH sends the user-facing model id; the wire needs Qoder's own key.
      model: resolveUpstreamKey(body.model) ?? body.model,
      messages: toQoderMessages(body.messages ?? []),
      tools: toQoderTools(body.tools),
      maxTokens: typeof body.max_tokens === 'number' ? body.max_tokens : undefined,
      enableThinking,
      alwaysThinking,
      reasoningEffort: enableThinking ? body.reasoning_effort : undefined,
      sessionId: typeof body.user === 'string' ? body.user : undefined,
    }

    const wantStream = body.stream !== false
    let iterator
    try {
      iterator = runChat(region, credential, request, controller.signal)
      // Pull the first chunk before committing to a status code, so an auth or
      // quota failure surfaces as an HTTP error rather than a broken stream.
      var first = await iterator.next()
    } catch (error) {
      logger?.warn?.(`dsh-connect-qoder: ${region.displayName} upstream failed`, error)
      // Queueing is transient, so it must not look like a rejection. DSH
      // retries a 503 (RATE_LIMIT/SERVER); it refuses to retry a 403, and the
      // UI renders a 403 as "the provider rejected this request" — which is
      // both untrue for a queued request and not actionable by the user.
      // A sign-in rejection means the cached credential is stale; force the
      // next resolveCredential to re-read the app's store so a re-sign-in is
      // picked up without a DSH restart. The error carries `signInExpired`
      // when the upstream classifies the failure as sign-in-expired.
      const signInStale = isStaleCredentialError(error)
      if (signInStale) {
        invalidateCredential?.()
      }
      if (error?.retryable === true) {
        // The queue hint travels as a header as well as in the body: the host
        // honours an HTTP `Retry-After` (capped at 20 s), and the plugin's own
        // queue wait may already be spent — handing the number over costs
        // nothing and lets the host's retry land inside the queue window
        // instead of on a blind backoff.
        writeError(res, 503, 'rate_limit', String(error?.message ?? error), retryAfterHeader(error))
        return
      }
      writeError(res, 502, 'upstream_error', String(error?.message ?? error))
      return
    }

    if (!wantStream) {
      const content = []
      const toolCalls = new Map()
      let finish = 'stop'
      let usage
      for (let step = first; !step.done; step = await iterator.next()) {
        // The usage frame carries no choice, so it is collected separately.
        if (step.value?.usage !== undefined && step.value.usage !== null) usage = step.value.usage
        absorb(step.value, content, toolCalls, (f) => { finish = f })
      }
      const message = { role: 'assistant', content: content.join('') }
      if (toolCalls.size > 0) message.tool_calls = [...toolCalls.values()]
      writeJson(res, 200, {
        id: `chatcmpl-${randomBytes(8).toString('hex')}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: displayModel,
        choices: [{ index: 0, message, finish_reason: finish }],
        // Present only when upstream reported it; an absent field is better than
        // a fabricated zero, which would read as "this turn cost nothing".
        ...(usage !== undefined ? { usage } : {}),
      })
      return
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    const id = `chatcmpl-${randomBytes(8).toString('hex')}`
    const created = Math.floor(Date.now() / 1000)
    let sentRole = false
    try {
      for (let step = first; !step.done; step = await iterator.next()) {
        const chunk = step.value

        // Token accounting arrives in its OWN frame, with `choices: []` and a
        // top-level `usage` — the same shape OpenAI uses for
        // `stream_options.include_usage`. It must be forwarded before the choice
        // check below, which would otherwise drop it: an empty `choices` array is
        // truthy, so `choices[0]` is simply `undefined`.
        //
        // pi-ai reads `chunk.usage` from the top level and turns it into the
        // session's token counts, so losing this frame is exactly why Qoder turns
        // reported no tokens. Qoder's usage block also carries `credits` and
        // `prompt_tokens_details.cached_tokens`, which pi-ai understands.
        if (chunk?.usage !== undefined && chunk.usage !== null) {
          writeSse(res, {
            id,
            object: 'chat.completion.chunk',
            created,
            model: displayModel,
            choices: [],
            usage: chunk.usage,
          })
        }

        const choice = chunk?.choices?.[0]
        if (choice === undefined) continue
        const delta = choice.delta ?? choice.message ?? {}
        const out = { role: 'assistant' }
        if (typeof delta.content === 'string' && delta.content.length > 0) out.content = delta.content
        // pi-ai reads reasoning from any of these fields.
        const reasoning = delta.reasoning_content ?? delta.reasoning
        if (typeof reasoning === 'string' && reasoning.length > 0) out.reasoning_content = reasoning
        if (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) out.tool_calls = delta.tool_calls
        const finish = choice.finish_reason
        if (!sentRole) {
          sentRole = true
        } else if (Object.keys(out).length === 1 && finish === undefined) {
          continue
        }
        writeSse(res, {
          id,
          object: 'chat.completion.chunk',
          created,
          model: displayModel,
          choices: [{ index: 0, delta: out, finish_reason: finish ?? null }],
        })
      }
    } catch (error) {
      // Never end a broken stream with [DONE]: that tells the client the
      // response finished normally, so a half-written answer is shown as a
      // complete turn. Emitting the failure lets DSH retry or report it.
      logger?.warn?.(`dsh-connect-qoder: ${region.displayName} stream broke`, error)
      const retryable = error?.retryable === true
      const kind = retryable ? 'rate_limit' : 'upstream_error'
      const message = String(error?.message ?? error)
      // A sign-in rejection means the cached credential is stale; force the
      // next resolveCredential to re-read the app's store so a re-sign-in is
      // picked up without a DSH restart. The error carries `signInExpired`
      // when the upstream classifies the failure as sign-in-expired.
      if (isStaleCredentialError(error)) {
        invalidateCredential?.()
      }

      if (retryable) {
        logger?.warn?.(
          `dsh-connect-qoder: ${region.displayName} queued by Qoder; reporting 503 so DSH retries: ${message}`,
        )
      }
      // The response has already started, so the failure travels in-band as a
      // `data:` frame in the OpenAI shape that pi-ai's parser inspects, not as a
      // status-code change. We deliberately do NOT emit a non-standard
      // `event: error` line: OpenAI SSE carries no event types, and a strict
      // parser would drop or mis-handle it. The error object alone is enough.
      res.write(`data: ${JSON.stringify({ error: { message, type: kind, code: kind } })}\n\n`)
      res.write('data: [DONE]\n\n')
      res.end()
      return
    }
    res.write('data: [DONE]\n\n')
    res.end()
  }

  /** Decide whether the caller asked for reasoning output. */
  function resolveThinking(body) {
    if (typeof body.reasoning_effort === 'string' && body.reasoning_effort.length > 0) {
      return body.reasoning_effort !== 'off' && body.reasoning_effort !== 'none'
    }
    // pi-ai sends `reasoning_effort` only for models it believes reason; a
    // model with a thinking level map but no explicit request still wants
    // thinking enabled, which shows up as `thinking` on the body.
    if (body.thinking !== undefined) return body.thinking !== false && body.thinking !== 'off'
    return false
  }

  let closed = false
  let closedPromise
  return {
    ready,
    baseUrl,
    token: () => SHARED_SECRET,
    // Idempotent close: a second call (e.g. effect cleanup running twice
    // under React strict mode, or dispose + unmount racing) returns the
    // same settled promise instead of calling server.close() again, which
    // would emit an 'error' event and reject the caller.
    close: () => {
      if (closed) return closedPromise
      closed = true
      closedPromise = new Promise((resolve, reject) => {
        server.closeAllConnections()
        server.close((err) => {
          if (err && err.code !== 'ERR_SERVER_NOT_RUNNING') reject(err)
          else resolve()
        })
      })
      return closedPromise
    },
  }
}

/** Accumulate one non-streaming chunk into the final message. */
function absorb(chunk, content, toolCalls, setFinish) {
  const choice = chunk?.choices?.[0]
  if (choice === undefined) return
  const delta = choice.delta ?? choice.message ?? {}
  if (typeof delta.content === 'string') content.push(delta.content)
  if (Array.isArray(delta.tool_calls)) {
    for (const call of delta.tool_calls) {
      const index = call.index ?? 0
      const current = toolCalls.get(index) ?? { id: '', type: 'function', function: { name: '', arguments: '' } }
      if (call.id) current.id = call.id
      if (call.function?.name) current.function.name = call.function.name
      if (call.function?.arguments) current.function.arguments += call.function.arguments
      toolCalls.set(index, current)
    }
  }
  if (choice.finish_reason) setFinish(choice.finish_reason)
}

/** Write one SSE frame. */
function writeSse(res, value) {
  res.write(`data: ${JSON.stringify(value)}\n\n`)
}
