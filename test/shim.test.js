/**
 * Smoke tests for the loopback shim.
 *
 * Run: node --test test/shim.test.js
 *
 * src/host/shim.ts is the translation layer — it is the only thing standing between
 * pi-ai's OpenAI expectations and Qoder's protocol — and it had no coverage at
 * all. That matters more here than elsewhere because most of its invariants are
 * things a request can simply fail to satisfy without any error surfacing: a
 * model left out of `GET /v1/models` never appears in the picker, a `[DONE]`
 * sent after a broken stream makes a half-written answer look complete, and a
 * usage frame dropped because it has no choices makes every turn report zero
 * tokens.
 *
 * These tests start the real server on a real ephemeral port and speak HTTP to
 * it. Nothing here is mocked except the upstream call itself, which is
 * injected — so the assertions are about observable behaviour rather than about
 * the shape of an internal call.
 */
import { test, after, before } from 'node:test'
import assert from 'node:assert/strict'
import { connect } from 'node:net'

import { createQoderShim, defaultEffortFor } from '../src/host/shim.ts'

const REGION = { id: 'qoder-cn', displayName: 'Qoder CN' }

/**
 * Send a hand-written HTTP request and return the raw response text.
 *
 * `fetch` refuses to set `Host` — it is a forbidden header name — so any test
 * that needs to control it has to speak the protocol directly. This is kept to
 * the one case that needs it rather than pulling a dependency in.
 */
function rawRequest(port, requestText) {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => socket.end(requestText))
    let received = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk) => {
      received += chunk
    })
    socket.on('end', () => resolve(received))
    socket.on('error', reject)
  })
}

/** A catalog with three models, used to exercise the filter. */
const CATALOG = [
  { id: 'ModelA', key: 'a', alwaysThinking: false, isReasoning: true },
  { id: 'ModelB', key: 'b', alwaysThinking: false, isReasoning: true },
  { id: 'ModelC', key: 'c', alwaysThinking: true, isReasoning: true },
  { id: 'ModelD', key: 'd', alwaysThinking: false, isReasoning: false },
]

/**
 * Start a shim with a scripted upstream.
 *
 * @param options.enabledIds - what the user enabled for this region.
 * @param options.credential - omit for a signed-in stub; pass `null` or
 *   `undefined` explicitly to simulate a region that is not signed in. The
 *   distinction is carried by a separate flag, because a destructuring default
 *   cannot tell "omitted" from "explicitly undefined".
 */
async function startShim({ stream, enabledIds = [], credential, signedOut = false, runChat, resolveModels, resolveAlwaysThinking } = {}) {
  const seen = { requests: [], invalidations: 0, models: [] }
  // `signedOut` is a separate flag because a destructuring default cannot tell
  // "omitted" from "explicitly undefined", and both mean something different
  // here: the first is a signed-in stub, the second is a missing credential.
  const resolved = signedOut ? credential : { token: 't' }
  const models = resolveModels ?? (() => CATALOG)
  const alwaysThinking = resolveAlwaysThinking ?? ((id) => CATALOG.find((m) => m.id === id)?.alwaysThinking === true)
  const shim = createQoderShim({
    region: REGION,
    resolveCredential: async () => resolved,
    resolveModels: models,
    resolveEnabledIds: () => enabledIds,
    resolveUpstreamKey: (id) => CATALOG.find((m) => m.id === id)?.key,
    resolveAlwaysThinking: alwaysThinking,
    invalidateCredential: () => {
      seen.invalidations += 1
    },
    logger: { warn() {} },
    ...(runChat === undefined
      ? {}
      : { runChat: (region, credential, request) => {
          seen.lastRequest = request
          return runChat(region, credential, request)
        } }),
  })
  await shim.ready
  seen.shim = shim
  seen.base = shim.baseUrl()
  seen.token = shim.token()
  return seen
}

/** Perform a request against the shim, returning status and parsed body. */
async function call(base, pathname, { method = 'GET', token, headers = {}, body } = {}) {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: {
      ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
      ...headers,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body,
  })
  const text = await response.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = undefined
  }
  return { status: response.status, json, text, headers: Object.fromEntries(response.headers) }
}

let shim

before(async () => {
  shim = await startShim()
})

after(async () => {
  await shim?.shim?.close()
})

test('a request without a bearer token is rejected', async () => {
  const { status, json } = await call(shim.base, '/v1/models')
  assert.strictEqual(status, 401)
  assert.strictEqual(json.error.code, 'unauthorized')
})

test('a request with a wrong bearer token is rejected', async () => {
  const { status } = await call(shim.base, '/v1/models', { token: 'not-the-token' })
  assert.strictEqual(status, 401)
})

test('a non-loopback Host header is refused', async () => {
  // The bearer check alone would not stop a rebound DNS name pointed at
  // loopback, so the Host header is checked too. `fetch` treats Host as a
  // forbidden header and silently drops it, so this speaks HTTP over a raw
  // socket — which is the only way to actually send the header under test.
  const { port } = new URL(shim.base)
  const raw = await rawRequest(Number(port), [
    'GET /v1/models HTTP/1.1',
    'Host: attacker.example',
    `Authorization: Bearer ${shim.token}`,
    'Connection: close',
    '',
    '',
  ].join('\r\n'))
  assert.match(raw, /^HTTP\/1\.1 403/, `expected 403, got: ${raw.split('\r\n')[0]}`)
  assert.match(raw, /host_not_allowed/)
})

test('a rebound name that still resolves to loopback is refused on Host', async () => {
  // The specific attack the Host check exists for: an attacker-controlled name
  // resolving to 127.0.0.1 would otherwise pass an origin-only check.
  const { port } = new URL(shim.base)
  const raw = await rawRequest(Number(port), [
    'GET /v1/models HTTP/1.1',
    'Host: qoder.attacker.example:1234',
    `Authorization: Bearer ${shim.token}`,
    'Connection: close',
    '',
    '',
  ].join('\r\n'))
  assert.match(raw, /^HTTP\/1\.1 403/)
})

test('a legitimate loopback Host is accepted', async () => {
  // The mirror of the check above: a real request must not be refused by it.
  const { port } = new URL(shim.base)
  const raw = await rawRequest(Number(port), [
    'GET /v1/models HTTP/1.1',
    `Host: 127.0.0.1:${port}`,
    `Authorization: Bearer ${shim.token}`,
    'Connection: close',
    '',
    '',
  ].join('\r\n'))
  assert.match(raw, /^HTTP\/1\.1 200/)
})

test('a non-loopback Origin is refused', async () => {
  const { status, json } = await call(shim.base, '/v1/models', {
    token: shim.token,
    headers: { Origin: 'https://evil.example' },
  })
  assert.strictEqual(status, 403)
  assert.strictEqual(json.error.code, 'origin_not_allowed')
})

test('an unknown route is a 404, and still requires the bearer', async () => {
  const anonymous = await call(shim.base, '/nope')
  assert.strictEqual(anonymous.status, 401, 'an unknown route must not bypass authentication')
  const authenticated = await call(shim.base, '/nope', { token: shim.token })
  assert.strictEqual(authenticated.status, 404)
})

test('GET /v1/models is served to an authenticated caller', async () => {
  const { status, json } = await call(shim.base, '/v1/models', { token: shim.token })
  assert.strictEqual(status, 200)
  assert.strictEqual(json.object, 'list')
  assert.strictEqual(json.data.length, CATALOG.length)
  assert.strictEqual(json.data[0].id, 'ModelA')
  assert.strictEqual(json.data[0].owned_by, REGION.id)
  // No per-token cost is knowable for a subscription quota; inventing a zero
  // would read as "this model is free".
  assert.strictEqual(json.data[0].created, 0)
})

test('GET /v1/models honours the enabled filter, and an empty list means no filter', async () => {
  // The picker's discovery reads this endpoint, so if it disagrees with the
  // adapter a model can stay hidden from one surface and visible on the other.
  const narrowed = await startShim({ enabledIds: ['ModelA', 'ModelC'] })
  try {
    const { json } = await call(narrowed.base, '/v1/models', { token: narrowed.token })
    assert.deepStrictEqual(
      json.data.map((m) => m.id).sort(),
      ['ModelA', 'ModelC'],
    )
  } finally {
    await narrowed.shim.close()
  }

  // A fresh install has saved nothing, so every model must still be offered.
  const fresh = await startShim({ enabledIds: [] })
  try {
    const { json } = await call(fresh.base, '/v1/models', { token: fresh.token })
    assert.strictEqual(json.data.length, CATALOG.length, 'an empty allow-list must mean "no filter"')
  } finally {
    await fresh.shim.close()
  }
})

test('a malformed allow-list is treated as no filter, never as a crash', async () => {
  // The allow-list comes out of a settings document that a user or an older
  // version can shape freely. Anything that is not an array of non-empty
  // strings must degrade to "show everything" — the same rule a fresh install
  // gets — rather than throwing or hiding every model.
  const cases = [null, undefined, 'not-an-array', 42, {}, ['', null, 7, 'ModelB']]
  for (const enabled of cases) {
    const instance = await startShim({ enabledIds: enabled })
    try {
      const { status, json } = await call(instance.base, '/v1/models', { token: instance.token })
      assert.strictEqual(status, 200, `allow-list ${JSON.stringify(enabled)} must not break the route`)
      assert.ok(
        json.data.length > 0,
        `allow-list ${JSON.stringify(enabled)} must not hide every model`,
      )
      if (Array.isArray(enabled)) {
        assert.deepStrictEqual(json.data.map((m) => m.id), ['ModelB'])
      }
    } finally {
      await instance.shim.close()
    }
  }

  // An allow-list of nothing but junk is "no usable selection", which is the
  // fresh-install state, not "hide everything". Getting this backwards would
  // leave a user whose settings file was truncated with an empty picker and no
  // obvious way back.
  const junk = await startShim({ enabledIds: ['', '   '.trim(), 0, false] })
  try {
    const { json } = await call(junk.base, '/v1/models', { token: junk.token })
    assert.strictEqual(json.data.length, CATALOG.length, 'a junk-only allow-list must show every model')
  } finally {
    await junk.shim.close()
  }
})

test('the healthz route is authenticated like everything else', async () => {
  const anonymous = await call(shim.base, '/healthz')
  assert.strictEqual(anonymous.status, 401)
  const authenticated = await call(shim.base, '/healthz', { token: shim.token })
  assert.strictEqual(authenticated.status, 200)
  assert.strictEqual(authenticated.json.ok, true)
})

test('a chat request without a credential is a 401 that names the region', async () => {
  // Both spellings of "no credential" must land here. The guard used to be
  // `credential === undefined`, so a resolver answering `null` walked past it
  // and reached `authHeaders`, which threw on `credential.userID` and surfaced
  // as a 502 `upstream_error` — blaming the provider for a region that was
  // simply never signed in.
  for (const [label, credential] of [['undefined', undefined], ['null', null]]) {
    const unsigned = await startShim({ signedOut: true, credential })
    try {
      const { status, json } = await call(unsigned.base, '/v1/chat/completions', {
        method: 'POST',
        token: unsigned.token,
        body: JSON.stringify({ model: 'ModelA', messages: [] }),
      })
      assert.strictEqual(status, 401, `a ${label} credential must be a 401`)
      assert.strictEqual(json.error.code, 'not_signed_in')
      assert.match(json.error.message, /Qoder CN/)
    } finally {
      await unsigned.shim.close()
    }
  }
})

test('a body that is not JSON is a 400, not a crash', async () => {
  const { status, json } = await call(shim.base, '/v1/chat/completions', {
    method: 'POST',
    token: shim.token,
    body: 'this is not json',
  })
  assert.strictEqual(status, 400)
  assert.strictEqual(json.error.code, 'invalid_request')
})

test('a wrong method on a known route is a 404 rather than a confusing error', async () => {
  const { status } = await call(shim.base, '/v1/models', { method: 'POST', token: shim.token })
  assert.strictEqual(status, 404)
})

test('close() is idempotent', async () => {
  // The effect cleanup can run twice under React strict mode, and a second
  // server.close() emits an error event that would reject an un-awaited caller.
  const once = await startShim()
  const first = once.shim.close()
  const second = once.shim.close()
  assert.strictEqual(first, second, 'a second close must return the same promise')
  await first
  await second
})

test('the base URL and token are per instance', async () => {
  // Two regions run side by side; sharing a port or a secret between them
  // would let one region's traffic answer for the other.
  const other = await startShim()
  try {
    assert.notStrictEqual(other.base, shim.base)
    assert.notStrictEqual(other.token, shim.token)
    // A token from one shim must not authenticate against the other.
    const { status } = await call(other.base, '/v1/models', { token: shim.token })
    assert.strictEqual(status, 401)
  } finally {
    await other.shim.close()
  }
})

/** An upstream whose very first pull fails, before any status is committed. */
function upstreamFails(error) {
  return () => {
    throw error
  }
}

/** POST one chat completion, returning status, body and response headers. */
async function postChat(instance, extra = {}) {
  return call(instance.base, '/v1/chat/completions', {
    method: 'POST',
    token: instance.token,
    body: JSON.stringify({ model: 'ModelA', messages: [], ...extra }),
  })
}

test('a queued upstream answers 503 carrying the gateway Retry-After hint', async () => {
  // The gateway's queue hint used to die at the shim: the 503 was right but
  // headerless, so the host — which DOES parse an HTTP Retry-After, capped at
  // 20 s — fell back to a blind backoff instead of the window Qoder asked for.
  // The number must survive the translation, clamped to what the host will
  // believe.
  const queued = await startShim({
    runChat: upstreamFails(Object.assign(new Error('Qoder is busy'), { retryable: true, retryAfterSeconds: 47 })),
  })
  try {
    const { status, json, headers } = await postChat(queued)
    assert.strictEqual(status, 503)
    assert.strictEqual(json.error.code, 'rate_limit')
    assert.strictEqual(headers['retry-after'], '20', 'a hint past the host cap must advertise the cap')
  } finally {
    await queued.shim.close()
  }
})

test('a short queue hint is forwarded verbatim, and a hintless one is omitted', async () => {
  const cases = [
    { retryAfterSeconds: 3, expected: '3' },
    { retryAfterSeconds: 0.4, expected: '1', why: 'a sub-second hint must not round to 0' },
    { retryAfterSeconds: undefined, expected: undefined },
  ]
  for (const { retryAfterSeconds, expected } of cases) {
    const error = Object.assign(new Error('queued'), { retryable: true, retryAfterSeconds })
    const instance = await startShim({ runChat: upstreamFails(error) })
    try {
      const { status, headers } = await postChat(instance)
      assert.strictEqual(status, 503)
      assert.strictEqual(
        headers['retry-after'],
        expected,
        `retryAfterSeconds=${String(retryAfterSeconds)} must yield Retry-After ${String(expected)}`,
      )
    } finally {
      await instance.shim.close()
    }
  }
})

test('a hard upstream failure is a 502 and advertises no retry delay', async () => {
  // Only a *retryable* failure may tell the host when to come back; putting a
  // Retry-After on a hard failure would schedule a retry that cannot succeed.
  const broken = await startShim({
    runChat: upstreamFails(Object.assign(new Error('gateway exploded'), { retryAfterSeconds: 30 })),
  })
  try {
    const { status, json, headers } = await postChat(broken)
    assert.strictEqual(status, 502)
    assert.strictEqual(json.error.code, 'upstream_error')
    assert.strictEqual(headers['retry-after'], undefined)
  } finally {
    await broken.shim.close()
  }
})

// --- thinking defaults ------------------------------------------------------
//
// The default-thinking behaviour the picker's "Default" resolves to. DSH's
// unselected dispatch sends NO `reasoning_effort` (the thinking map no longer
// spells `off` out, so there is no value for the default to send), and the
// shim decides from the model's own reasoning nature what that means.

/** A runChat stub that records the request and yields one complete message. */
function recordRequests() {
  const requests = []
  const runChat = async function* (region, credential, request) {
    requests.push(request)
    yield {
      id: 'x',
      object: 'chat.completion.chunk',
      created: 0,
      model: request.model,
      choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: null }],
    }
    yield {
      id: 'x',
      object: 'chat.completion.chunk',
      created: 0,
      model: request.model,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    }
  }
  return { requests, runChat }
}

/** POST one chat completion and return the request the upstream saw last. */
async function lastUpstreamRequest(instance, body) {
  const { status } = await call(instance.base, '/v1/chat/completions', {
    method: 'POST',
    token: instance.token,
    body: JSON.stringify({ model: 'ModelA', messages: [{ role: 'user', content: 'hi' }], ...body }),
  })
  assert.strictEqual(status, 200, 'the recorded request must be a valid one')
  return instance.lastRequest
}

test('an unselected effort (no reasoning_effort at all) thinks for a reasoning model', async () => {
  // The DSH picker's "Default": no effort reached the wire. Before this
  // behaviour the shim answered such a request with `enableThinking: false` —
  // so a bare model selection read as "thinking disabled", while the sibling
  // connectors (WorkBuddy, Trae) let the gateway default apply and thought.
  // The catalog entry here has NO effortLevels on purpose: it is the off-only
  // shape (Qwen 3.7 family) that cannot advertise a level. Even so, the default
  // must enable thinking — it just cannot pin a level the catalog never offered.
  const { runChat } = recordRequests()
  const instance = await startShim({
    resolveModels: () => [{ id: 'ModelA', key: 'a', alwaysThinking: false, isReasoning: true }],
    resolveAlwaysThinking: () => false,
    runChat,
  })
  try {
    const request = await lastUpstreamRequest(instance, {})
    assert.strictEqual(request.enableThinking, true, 'no effort at all must still enable thinking')
    assert.strictEqual(request.reasoningEffort, undefined, 'a level must never be invented for a model that advertises none')
  } finally {
    await instance.shim.close()
  }
})

// The default is not "let the gateway decide" — the gateway's no-effort state
// is thinking-OFF for the Qwen 3.8 family, which is exactly what the unselected
// selection must not mean. So a reasoning model that advertises levels gets a
// concrete level pinned; the pin is always one its catalog offers.

test('an unselected effort on a model that offers levels pins the default to a concrete level', async () => {
  const { runChat } = recordRequests()
  const instance = await startShim({
    resolveModels: () => [
      { id: 'ModelA', key: 'a', alwaysThinking: false, isReasoning: true, effortLevels: ['low', 'medium', 'xhigh'] },
    ],
    resolveAlwaysThinking: () => false,
    runChat,
  })
  try {
    const request = await lastUpstreamRequest(instance, {})
    assert.strictEqual(request.enableThinking, true)
    assert.strictEqual(request.reasoningEffort, 'low', 'the pinned default must reach the upstream call')
  } finally {
    await instance.shim.close()
  }
})

test('an explicit level wins over the pinned default', async () => {
  const { runChat } = recordRequests()
  const instance = await startShim({
    resolveModels: () => [
      { id: 'ModelA', key: 'a', alwaysThinking: false, isReasoning: true, effortLevels: ['low', 'medium', 'xhigh'] },
    ],
    resolveAlwaysThinking: () => false,
    runChat,
  })
  try {
    const request = await lastUpstreamRequest(instance, { reasoning_effort: 'xhigh' })
    assert.strictEqual(request.enableThinking, true)
    assert.strictEqual(request.reasoningEffort, 'xhigh', 'an explicit picker choice must not be overridden by the pin')
  } finally {
    await instance.shim.close()
  }
})

test('the pin chooses per the model own advertised levels, never one it lacks', () => {
  assert.strictEqual(defaultEffortFor({ effortLevels: ['low', 'medium', 'xhigh'] }, false), 'low', 'the target when the model offers it')
  assert.strictEqual(defaultEffortFor({ effortLevels: ['high', 'max'] }, false), 'high', 'the cheapest offered when the target is not among them')
  assert.strictEqual(defaultEffortFor({ effortLevels: ['xhigh'] }, false), 'xhigh', 'even a lone costly level beats the gateway off-state')
  assert.strictEqual(defaultEffortFor({ effortLevels: [] }, false), undefined, 'no advertised level: nothing to pin')
  assert.strictEqual(defaultEffortFor({}, false), undefined, 'an unknown model gets no invented level')
  assert.strictEqual(defaultEffortFor({ effortLevels: ['low', 'high'] }, true), undefined, 'always-thinking models stay positive-only')
})

test('an unselected effort on a non-reasoning model still sends enable_thinking off', async () => {
  const { runChat } = recordRequests()
  const instance = await startShim({
    resolveModels: () => [
      { id: 'ModelA', key: 'a', alwaysThinking: false, isReasoning: false },
      { id: 'ModelB', key: 'b', alwaysThinking: false, isReasoning: true },
      { id: 'ModelC', key: 'c', alwaysThinking: true, isReasoning: true },
      { id: 'ModelD', key: 'd', alwaysThinking: false, isReasoning: false },
    ],
    resolveAlwaysThinking: (id) => CATALOG.find((m) => m.id === id)?.alwaysThinking === true,
    runChat,
  })
  try {
    const request = await lastUpstreamRequest(instance, {})
    assert.strictEqual(request.enableThinking, false, 'a model that cannot think must not be told to')
  } finally {
    await instance.shim.close()
  }
})
// The two explicit dispatches are unchanged by the default: `off`/`none`
// must still turn thinking off (that is the picker's "Off" entry working),
// and a concrete level must both enable thinking and ride through to the
// upstream `reasoning_effort`.
test('an explicit off still disables thinking, and an explicit level still enables it', async () => {
  const { runChat } = recordRequests()
  const instance = await startShim({
    resolveModels: () => [
      { id: 'ModelA', key: 'a', alwaysThinking: false, isReasoning: true },
      { id: 'ModelB', key: 'b', alwaysThinking: false, isReasoning: true },
      { id: 'ModelC', key: 'c', alwaysThinking: true, isReasoning: true },
      { id: 'ModelD', key: 'd', alwaysThinking: false, isReasoning: false },
    ],
    resolveAlwaysThinking: (id) => CATALOG.find((m) => m.id === id)?.alwaysThinking === true,
    runChat,
  })
  try {
    const off = await lastUpstreamRequest(instance, { reasoning_effort: 'off' })
    assert.strictEqual(off.enableThinking, false, 'an explicit off must still be honoured')
    const high = await lastUpstreamRequest(instance, { reasoning_effort: 'high' })
    assert.strictEqual(high.enableThinking, true)
    assert.strictEqual(high.reasoningEffort, 'high', 'the chosen level must reach the upstream call')
  } finally {
    await instance.shim.close()
  }
})
