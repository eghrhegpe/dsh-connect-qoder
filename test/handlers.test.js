/**
 * Execute the seven card route handlers against fake request/response pairs.
 *
 * Run: node --test test/handlers.test.js
 *
 * WHY THIS FILE EXISTS
 *
 * `src/host/index.ts` cannot be imported by a test (it pulls in the Cordis peer
 * dependencies), which is the registered gap docs/KNOWN_GAPS.md item 2（`RegionRuntime` 本身与 `activate` 的 Cordis 接线）:
 * every route's business decisions — which status an unknown region answers
 * with, what a refused save looks like, how a sign-in rejection is classified —
 * used to be unpinnable. `test/routes.ts` already executes the two gates every
 * route passes; this file is the second half: it executes the HANDLERS
 * themselves (now living in `src/host/handlers.ts`, dependency-free), so the
 * whole request→verdict chain is asserted against real code rather than
 * pattern-matched.
 *
 * What is stubbed: the HTTP transport (fake `req`/`res`), the runtime surface
 * (`resolveCredential` / `refreshCatalog` / `readUsage` / …), and the upstream
 * calls that would need the network (`claim` / `confirmUserInfo` — both
 * injectable seams with real defaults). What is NOT stubbed: the gates, the
 * payload builders, the settings verdict, the error classifier — the handlers
 * run those for real.
 *
 * This is what docs/PLAN.md §5 (P2-1) asks for: at least six routes with direct
 * assertions over method / authorization / error codes, and `handlers.ts`
 * entering the coverage denominator.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import {
  modelsHandler,
  saveHandler,
  usageHandler,
  checkinHandler,
  claimTodayFor,
  accountHandler,
  reloadHandler,
  confirmHandler,
} from '../src/host/handlers.ts'
import { REGIONS } from '../src/host/credentials.ts'

const CN = REGIONS.find((r) => r.id === 'qoder-cn')
assert.ok(CN !== undefined, 'REGIONS lost the CN edition')
const GLOBAL = REGIONS.find((r) => r.id === 'qoder')
assert.ok(GLOBAL !== undefined, 'REGIONS lost the global edition')

/** A fake request: an EventEmitter so body readers can be fed after subscribing. */
function fakeReq({ method = 'GET', url = '/', origin, host = '127.0.0.1:19387' } = {}) {
  const req = new EventEmitter()
  req.method = method
  req.url = url
  req.headers = { ...(origin === undefined ? {} : { origin }), host }
  req.destroy = () => { req.destroyed = true }
  return req
}

/** A fake response capturing the status, headers, and bodies sent. */
function fakeRes(req) {
  const bodies = []
  const out = { status: null, headers: null }
  const res = {
    req,
    writeHead: (status, headers) => {
      out.status = status
      out.headers = headers
    },
    end: (payload) => {
      if (payload !== undefined) bodies.push(payload)
    },
  }
  return { res, out, bodies }
}

/** The JSON of the last body the fake response sent. */
function lastJson({ bodies }) {
  assert.ok(bodies.length > 0, 'the handler sent no body')
  return JSON.parse(bodies.at(-1))
}

/** A request whose JSON body is fed AFTER the handler subscribed its readers. */
function post(req, body) {
  const buffer = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))
  req.emit('data', buffer)
  req.emit('end')
  return req
}

/** A logger that does not exist: the handlers call levels defensively. */
const quiet = { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} }

/** One started runtime, recording which lifecycle calls happened. */
function stubRuntime({ region = CN, credential, readUsage, resolveCredential, refreshCatalog } = {}) {
  const runtime = {
    region,
    resolveCredential: resolveCredential ?? (async () => credential),
    invalidateCredential: () => { runtime.invalidated = true },
    refreshCatalog: refreshCatalog ?? (async () => { runtime.refreshed = true }),
    readUsage: readUsage ?? (async () => ({ available: true, userQuota: { used: 1, total: 100 }, addOnQuota: { used: 0, total: 1000 } })),
    invalidateUsage: () => { runtime.usageInvalidated = true },
    catalog: { current: () => [], fetchedAt: 1750000000000 },
    refreshFailed: undefined,
    invalidated: false,
    refreshed: false,
    usageInvalidated: false,
  }
  return runtime
}

const fakeRates = { rateNow: () => 1, offPeakActive: () => false, offPeakRemaining: () => undefined }

// ---------------------------------------------------------------------------
// /models
// ---------------------------------------------------------------------------

test('models: a GET serves the roster and never refreshes without refresh=1', async () => {
  const runtime = stubRuntime()
  const req = fakeReq({ url: '/plugins/dsh-connect-qoder/models' })
  const { res, out, bodies } = fakeRes(req)
  await modelsHandler(req, res, { started: [{ region: CN, runtime }], currentSettings: () => ({}), logger: quiet, rates: fakeRates })
  assert.equal(out.status, 200)
  assert.equal(runtime.refreshed, false, 'a plain GET must not hit upstream')
  const body = lastJson({ bodies })
  assert.ok(Array.isArray(body.models), 'the roster must be an array')
  assert.ok('refreshedAt' in body, 'the payload must carry the honest fetch time')
})

test('models: refresh=1 re-reads every started region, and a failing one does not blank the card', async () => {
  let calls = 0
  const ok = stubRuntime()
  const failing = stubRuntime({ refreshCatalog: async () => { throw new Error('boom') } })
  const req = fakeReq({ url: '/plugins/dsh-connect-qoder/models?refresh=1' })
  const { res, out } = fakeRes(req)
  await modelsHandler(req, res, {
    started: [{ region: CN, runtime: ok }, { region: GLOBAL, runtime: failing }],
    currentSettings: () => ({}),
    logger: { warn: (msg, error) => { calls++; assert.match(String(error), /boom/) } },
    rates: fakeRates,
  })
  assert.equal(out.status, 200, 'a refresh failure must still answer with the last good catalog')
  assert.equal(ok.refreshed, true)
  assert.equal(calls, 1, 'the failure must be named in the log, not swallowed')
})

test('models: a non-GET is refused with a 405 carrying Allow', async () => {
  const req = fakeReq({ method: 'POST', url: '/plugins/dsh-connect-qoder/models' })
  const { res, out } = fakeRes(req)
  await modelsHandler(req, res, { started: [], currentSettings: () => ({}), logger: quiet, rates: fakeRates })
  assert.equal(out.status, 405)
  assert.match(String(out.headers.Allow), /GET/, 'the 405 must advertise what would work')
})

test('models: a cross-origin request is refused with a 403', async () => {
  const req = fakeReq({ url: '/plugins/dsh-connect-qoder/models', origin: 'http://evil.example' })
  const { res, out } = fakeRes(req)
  await modelsHandler(req, res, { started: [], currentSettings: () => ({}), logger: quiet, rates: fakeRates })
  assert.equal(out.status, 403)
})

test('models: a same-loopback-but-different-port origin is refused, not trusted by host name alone', async () => {
  // The hole `routes.ts` closed (issue 12): an Origin whose host NAME is
  // loopback but whose PORT differs from the request's Host must not pass.
  const req = fakeReq({ url: '/plugins/dsh-connect-qoder/models', origin: 'http://127.0.0.1:9999', host: '127.0.0.1:19387' })
  const { res, out } = fakeRes(req)
  await modelsHandler(req, res, { started: [], currentSettings: () => ({}), logger: quiet, rates: fakeRates })
  assert.equal(out.status, 403)
})

// ---------------------------------------------------------------------------
// /__save
// ---------------------------------------------------------------------------

test('save: a settings-absent host answers 503 with a readable body, not a 404', async () => {
  // docs/issues/06: the false-"已保存" this closed. The route must be able to
  // say "the settings service is not here" as a status the client can read.
  const req = fakeReq({ method: 'POST', url: '/plugins/dsh-connect-qoder/__save' })
  const { res, out, bodies } = fakeRes(req)
  const pending = saveHandler(req, res, {
    getSettings: () => undefined,
    settingsNs: 'llm-qoder',
    fallbackNs: 'dsh-connect-qoder',
    refreshPicker: () => { throw new Error('must not refresh on a refused save') },
  })
  post(req, { field: 'useMaximumContextWindow', value: true })
  await pending
  assert.equal(out.status, 503)
  assert.ok(String(lastJson({ bodies }).error).length > 0, 'the 503 must carry a readable reason')
})

test('save: a valid field writes through and refreshes the picker', async () => {
  const doc = {}
  const settings = {
    describe: () => [{ ns: 'llm-qoder', value: doc }],
    mutate: async (_ns, ops) => { for (const op of ops) doc[op.path[0]] = op.value },
  }
  let picked = false
  const req = fakeReq({ method: 'POST', url: '/plugins/dsh-connect-qoder/__save' })
  const { res, out, bodies } = fakeRes(req)
  const pending = saveHandler(req, res, {
    getSettings: () => settings,
    settingsNs: 'llm-qoder',
    fallbackNs: 'dsh-connect-qoder',
    refreshPicker: () => { picked = true },
  })
  post(req, { field: 'useMaximumContextWindow', value: true })
  await pending
  assert.equal(out.status, 200)
  assert.equal(lastJson({ bodies }).ok, true, 'a landed save must answer ok')
  assert.equal(picked, true, 'a landed save must refresh the picker')
  assert.equal(doc.useMaximumContextWindow, true)
})

test('save: a malformed JSON body is a 500 with the parse reason, not a bare crash', async () => {
  const req = fakeReq({ method: 'POST', url: '/plugins/dsh-connect-qoder/__save' })
  const { res, out, bodies } = fakeRes(req)
  const pending = saveHandler(req, res, {
    getSettings: () => undefined,
    settingsNs: 'llm-qoder',
    fallbackNs: 'dsh-connect-qoder',
    refreshPicker: () => {},
  })
  post(req, '{not json')
  await pending
  assert.equal(out.status, 500)
  const body = lastJson({ bodies })
  assert.ok(body.errorName !== undefined, 'the 500 must name the error')
  assert.ok(String(body.error).length > 0, 'the 500 must carry the parse message')
})

test('save: a non-POST is refused with 405', async () => {
  const req = fakeReq({ method: 'GET', url: '/plugins/dsh-connect-qoder/__save' })
  const { res, out } = fakeRes(req)
  await saveHandler(req, res, { getSettings: () => undefined, settingsNs: 'x', fallbackNs: 'y', refreshPicker: () => {} })
  assert.equal(out.status, 405)
})

// ---------------------------------------------------------------------------
// /usage
// ---------------------------------------------------------------------------

test('usage: a GET reports one region per started runtime', async () => {
  const req = fakeReq({ url: '/plugins/dsh-connect-qoder/usage' })
  const { res, out, bodies } = fakeRes(req)
  await usageHandler(req, res, {
    started: [{ region: CN, runtime: stubRuntime({ readUsage: async () => ({ available: true, userQuota: { used: 2, total: 100 } }) }) }],
    logger: quiet,
  })
  assert.equal(out.status, 200)
  const { regions } = lastJson({ bodies })
  assert.equal(regions.length, 1)
  assert.equal(regions[0].region, 'qoder-cn')
  assert.equal(regions[0].available, true)
})

test('usage: a failing region is reported unavailable, the panel still answers 200', async () => {
  const req = fakeReq({ url: '/plugins/dsh-connect-qoder/usage' })
  const { res, out, bodies } = fakeRes(req)
  await usageHandler(req, res, {
    started: [{ region: CN, runtime: stubRuntime({ readUsage: async () => { throw new Error('upstream down') } }) }],
    logger: quiet,
  })
  assert.equal(out.status, 200, 'one dead sign-in must not fail the whole panel')
  assert.equal(lastJson({ bodies }).regions[0].available, false)
})

test('usage: an unavailable machine identity is reported so the card can explain itself', async () => {
  // Upstream gates the international edition's campaigns endpoint on the desktop
  // app's umid machine identity; without it no claimable round is served and the
  // check-in card is legitimately absent. "Absent" read as "nothing to claim",
  // so the reason travels with the usage read.
  const req = fakeReq({ url: '/plugins/dsh-connect-qoder/usage' })
  const { res, out, bodies } = fakeRes(req)
  await usageHandler(req, res, {
    started: [{ region: CN, runtime: stubRuntime({ readUsage: async () => ({ available: true }) }) }],
    logger: quiet,
    umidState: () => ({ available: false, reason: 'no matching version root' }),
  })
  assert.equal(out.status, 200)
  const body = lastJson({ bodies })
  assert.equal(body.checkin.umidAvailable, false)
  assert.equal(body.checkin.reason, 'no matching version root', 'the host reason is carried verbatim')
})

test('usage: a working machine identity is not reported at all', async () => {
  const req = fakeReq({ url: '/plugins/dsh-connect-qoder/usage' })
  const { res, out, bodies } = fakeRes(req)
  await usageHandler(req, res, {
    started: [{ region: CN, runtime: stubRuntime({ readUsage: async () => ({ available: true }) }) }],
    logger: quiet,
    umidState: () => ({ available: true }),
  })
  assert.equal(out.status, 200)
  assert.equal(lastJson({ bodies }).checkin, undefined, 'a healthy machine must not raise a warning')
})

test('usage: an unavailable machine identity STILL carries a reason', async () => {
  // The reason is the entire message. A bare `umidAvailable: false` would reach
  // the card as a warning that explains nothing — the blank this fixes.
  const req = fakeReq({ url: '/plugins/dsh-connect-qoder/usage' })
  const { res, out, bodies } = fakeRes(req)
  await usageHandler(req, res, {
    started: [{ region: CN, runtime: stubRuntime({ readUsage: async () => ({ available: true }) }) }],
    logger: quiet,
    umidState: () => ({ available: false }),
  })
  assert.equal(out.status, 200)
  assert.ok(String(lastJson({ bodies }).checkin.reason).length > 0)
})

test('usage: a host that sends no umid seam gets the field omitted, not faked', async () => {
  // `umidState` is optional so the route keeps working against a host that
  // predates it. Inventing a reason there would be a lie; omitting it is the
  // old, correct behaviour.
  const req = fakeReq({ url: '/plugins/dsh-connect-qoder/usage' })
  const { res, out, bodies } = fakeRes(req)
  await usageHandler(req, res, {
    started: [{ region: CN, runtime: stubRuntime({ readUsage: async () => ({ available: true }) }) }],
    logger: quiet,
  })
  assert.equal(out.status, 200)
  assert.equal(lastJson({ bodies }).checkin, undefined)
})

// ---------------------------------------------------------------------------
// /checkin + the claim orchestration
// ---------------------------------------------------------------------------

test('checkin: an unknown region is a 404', async () => {
  const req = fakeReq({ method: 'POST', url: '/plugins/dsh-connect-qoder/checkin?region=nope' })
  const { res, out, bodies } = fakeRes(req)
  await checkinHandler(req, res, {
    started: [{ region: CN, runtime: stubRuntime() }],
    logger: quiet,
    claim: async () => { throw new Error('must not claim for an unknown region') },
  })
  assert.equal(out.status, 404)
  assert.equal(lastJson({ bodies }).error, 'unknown-region')
})

test('checkin: a successful claim answers 200 with the outcome', async () => {
  const outcome = { region: 'qoder-cn', claimed: true, replayed: false, alreadyClaimed: false, checkin: { active: true } }
  const req = fakeReq({ method: 'POST', url: '/plugins/dsh-connect-qoder/checkin?region=qoder-cn' })
  const { res, out, bodies } = fakeRes(req)
  await checkinHandler(req, res, {
    started: [{ region: CN, runtime: stubRuntime() }],
    logger: quiet,
    claim: async () => outcome,
  })
  assert.equal(out.status, 200)
  assert.deepEqual(lastJson({ bodies }), outcome)
})

test('checkin: a failed claim answers 502 naming the reason', async () => {
  const req = fakeReq({ method: 'POST', url: '/plugins/dsh-connect-qoder/checkin?region=qoder-cn' })
  const { res, out, bodies } = fakeRes(req)
  await checkinHandler(req, res, {
    started: [{ region: CN, runtime: stubRuntime() }],
    logger: quiet,
    claim: async () => { throw new Error('round ended minutes ago') },
  })
  assert.equal(out.status, 502)
  assert.match(String(lastJson({ bodies }).error), /round ended minutes ago/)
})

test('checkin: no runtime means no usable sign-in — the claim refuses before any network call', async () => {
  // The default claim is the REAL orchestration (claimTodayFor): resolveCredential
  // answering undefined must throw before io.readCampaigns is ever reached.
  const req = fakeReq({ method: 'POST', url: '/plugins/dsh-connect-qoder/checkin?region=qoder-cn' })
  const { res, out, bodies } = fakeRes(req)
  await checkinHandler(req, res, {
    started: [{ region: CN, runtime: stubRuntime({ credential: undefined }) }],
    logger: quiet,
  })
  assert.equal(out.status, 502)
  assert.match(String(lastJson({ bodies }).error), /no usable sign-in/)
})

/** A claimable round whose window covers "now", so the default clock passes it. */
function freshRound(claimStatus) {
  const nowS = Math.floor(Date.now() / 1000)
  return {
    campaignId: 'campaign-test-1',
    campaignKey: 'act-test',
    actionType: 'CLAIM_BENEFIT',
    startAt: nowS - 3600,
    endAt: nowS + 3600,
    claimStatus,
    benefit: { kind: 'CREDITS', amount: 100 },
  }
}
const payloadWith = (round) => ({ claimable: true, campaigns: [round] })

test('claimTodayFor: a round already claimed today answers replayed and posts nothing', async () => {
  const runtime = stubRuntime({ credential: { token: 't' } })
  const io = {
    readCampaigns: async () => payloadWith(freshRound('CLAIMED')),
    claimCampaign: async () => { throw new Error('a claimed round must never be posted at') },
  }
  const outcome = await claimTodayFor(runtime, io)
  assert.equal(outcome.claimed, false)
  assert.equal(outcome.replayed, true)
  assert.equal(outcome.alreadyClaimed, true)
  assert.equal(runtime.usageInvalidated, false, 'a replayed round grants nothing, so the usage cache stays')
})

test('claimTodayFor: a fresh grant claims, invalidates the usage cache, and reads back', async () => {
  const runtime = stubRuntime({ credential: { token: 't' } })
  const claimed = payloadWith(freshRound('CLAIMABLE'))
  const io = {
    readCampaigns: async () => claimed,
    claimCampaign: async () => ({ status: 'CLAIMED', replayed: false, benefit: { kind: 'CREDITS', amount: 100 } }),
  }
  const outcome = await claimTodayFor(runtime, io)
  assert.equal(outcome.claimed, true)
  assert.equal(outcome.replayed, false)
  assert.equal(outcome.alreadyClaimed, false)
  assert.equal(outcome.region, 'qoder-cn')
  assert.equal(runtime.usageInvalidated, true, 'the Credits landed in the add-on quota this panel renders')
})

test('claimTodayFor: no open round is a refusal, not a silent nothing', async () => {
  const runtime = stubRuntime({ credential: { token: 't' } })
  await assert.rejects(
    claimTodayFor(runtime, { readCampaigns: async () => ({ campaigns: [] }), claimCampaign: async () => ({}) }),
    /not running a check-in/,
  )
})

test('claimTodayFor: an upstream that does not confirm is a refusal', async () => {
  const runtime = stubRuntime({ credential: { token: 't' } })
  await assert.rejects(
    claimTodayFor(runtime, {
      readCampaigns: async () => payloadWith(freshRound('CLAIMABLE')),
      claimCampaign: async () => ({ status: 'FAILED' }),
    }),
    /did not confirm/,
  )
})

// ---------------------------------------------------------------------------
// /account
// ---------------------------------------------------------------------------

test('account: a GET answers the shared payload', async () => {
  const req = fakeReq({ url: '/plugins/dsh-connect-qoder/account' })
  const { res, out, bodies } = fakeRes(req)
  await accountHandler(req, res, { payload: async () => ({ regions: [{ region: 'qoder-cn', state: 'ok' }] }), logger: quiet })
  assert.equal(out.status, 200)
  assert.equal(lastJson({ bodies }).regions[0].state, 'ok')
})

test('account: a payload failure is a 500 naming the step, not a bodyless 400', async () => {
  const req = fakeReq({ url: '/plugins/dsh-connect-qoder/account' })
  const { res, out, bodies } = fakeRes(req)
  const seen = []
  await accountHandler(req, res, {
    payload: async () => { throw new Error('store unwrap failed') },
    logger: { error: (msg, error) => { seen.push(String(error)) } },
  })
  assert.equal(out.status, 500)
  assert.ok(seen.length === 1, 'the failure must reach the error log')
  assert.ok(String(lastJson({ bodies }).detail).includes('store unwrap failed'))
})

test('account: a non-GET is refused with 405', async () => {
  const req = fakeReq({ method: 'POST', url: '/plugins/dsh-connect-qoder/account' })
  const { res, out } = fakeRes(req)
  await accountHandler(req, res, { payload: async () => ({}), logger: quiet })
  assert.equal(out.status, 405)
})

// ---------------------------------------------------------------------------
// /account/reload
// ---------------------------------------------------------------------------

test('reload: re-reads the named region and asks for the forced payload', async () => {
  const runtime = stubRuntime()
  const req = fakeReq({ method: 'POST', url: '/plugins/dsh-connect-qoder/account/reload' })
  const { res, out, bodies } = fakeRes(req)
  const calls = []
  const pending = reloadHandler(req, res, {
    regions: REGIONS,
    started: [{ region: CN, runtime }],
    startStoppedRegions: async (wanted) => { calls.push(['start', wanted]) },
    payload: async (options) => { calls.push(['payload', options]); return { regions: [] } },
    logger: quiet,
  })
  post(req, { region: 'qoder-cn' })
  await pending
  assert.equal(out.status, 200)
  assert.equal(runtime.invalidated, true, 're-read must drop the cached credential')
  assert.equal(runtime.refreshed, true, 're-read must force a catalog refresh')
  assert.deepEqual(calls, [['start', 'qoder-cn'], ['payload', { force: true }]], 'the reload must start stopped regions and ask for the forced read')
})

test('reload: a failing region start does not take the route down', async () => {
  const req = fakeReq({ method: 'POST', url: '/plugins/dsh-connect-qoder/account/reload' })
  const { res, out, bodies } = fakeRes(req)
  const seen = []
  const pending = reloadHandler(req, res, {
    regions: REGIONS,
    started: [],
    startStoppedRegions: async () => { throw new Error('shim failed to listen') },
    payload: async () => ({ regions: [] }),
    logger: { error: (msg, error) => { seen.push(String(error)) } },
  })
  post(req, {})
  await pending
  assert.equal(out.status, 200, 'a refused region start must still answer the fresh account states')
  assert.ok(seen.length === 1, 'the failure must be logged, not swallowed')
})

test('reload: a malformed body is a 400 with a reason', async () => {
  const req = fakeReq({ method: 'POST', url: '/plugins/dsh-connect-qoder/account/reload' })
  const { res, out, bodies } = fakeRes(req)
  const pending = reloadHandler(req, res, {
    regions: REGIONS,
    started: [],
    startStoppedRegions: async () => {},
    payload: async () => ({}),
    logger: quiet,
  })
  post(req, 'not json')
  await pending
  assert.equal(out.status, 400)
  assert.ok(String(lastJson({ bodies }).error).length > 0)
})

test('reload: a GET is refused with 405', async () => {
  const req = fakeReq({ method: 'GET', url: '/plugins/dsh-connect-qoder/account/reload' })
  const { res, out } = fakeRes(req)
  await reloadHandler(req, res, { regions: REGIONS, started: [], startStoppedRegions: async () => {}, payload: async () => ({}), logger: quiet })
  assert.equal(out.status, 405)
})

// ---------------------------------------------------------------------------
// /account/confirm
// ---------------------------------------------------------------------------

test('confirm: an unknown region is a 400', async () => {
  const req = fakeReq({ method: 'POST', url: '/plugins/dsh-connect-qoder/account/confirm' })
  const { res, out, bodies } = fakeRes(req)
  const pending = confirmHandler(req, res, { regions: REGIONS, started: [] })
  post(req, { region: 'nope' })
  await pending
  assert.equal(out.status, 400)
  assert.equal(lastJson({ bodies }).error, 'unknown region')
})

test('confirm: a credential resolution failure is "unavailable" with the reason, not a crash', async () => {
  const runtime = stubRuntime({ resolveCredential: async () => { throw new Error('PAT exchange throttled') } })
  const req = fakeReq({ method: 'POST', url: '/plugins/dsh-connect-qoder/account/confirm' })
  const { res, out, bodies } = fakeRes(req)
  const pending = confirmHandler(req, res, { regions: REGIONS, started: [{ region: CN, runtime }] })
  post(req, { region: 'qoder-cn' })
  await pending
  assert.equal(out.status, 200)
  const body = lastJson({ bodies })
  assert.equal(body.available, false)
  assert.ok(String(body.detail).includes('PAT exchange throttled'))
})

test('confirm: no credential is "unavailable", plainly', async () => {
  const runtime = stubRuntime({ credential: undefined })
  const req = fakeReq({ method: 'POST', url: '/plugins/dsh-connect-qoder/account/confirm' })
  const { res, out, bodies } = fakeRes(req)
  const pending = confirmHandler(req, res, { regions: REGIONS, started: [{ region: CN, runtime }] })
  post(req, { region: 'qoder-cn' })
  await pending
  assert.equal(out.status, 200)
  assert.equal(lastJson({ bodies }).available, false)
})

test('confirm: a live sign-in confirms with identity only', async () => {
  const runtime = stubRuntime({ credential: { token: 't' } })
  const req = fakeReq({ method: 'POST', url: '/plugins/dsh-connect-qoder/account/confirm' })
  const { res, out, bodies } = fakeRes(req)
  const pending = confirmHandler(req, res, {
    regions: REGIONS,
    started: [{ region: CN, runtime }],
    confirmUserInfo: async () => ({ name: 'alice', email: 'alice@example.com' }),
  })
  post(req, { region: 'qoder-cn' })
  await pending
  const body = lastJson({ bodies })
  assert.equal(out.status, 200)
  assert.equal(body.available, true)
  assert.equal(body.confirmed, true)
  assert.deepEqual(body.identity, { name: 'alice', email: 'alice@example.com' })
})

test('confirm: a sign-in rejection names itself and invalidates the cached credential', async () => {
  const runtime = stubRuntime({ credential: { token: 't' } })
  const req = fakeReq({ method: 'POST', url: '/plugins/dsh-connect-qoder/account/confirm' })
  const { res, out, bodies } = fakeRes(req)
  const pending = confirmHandler(req, res, {
    regions: REGIONS,
    started: [{ region: CN, runtime }],
    confirmUserInfo: async () => { throw new Error('Login expired') },
  })
  post(req, { region: 'qoder-cn' })
  await pending
  const body = lastJson({ bodies })
  assert.equal(out.status, 200)
  assert.equal(body.confirmed, false)
  assert.equal(body.kind, 'sign-in-expired', 'a dead sign-in must be named, not blurred into "unavailable"')
  assert.equal(runtime.invalidated, true, 'the re-read after a re-sign-in must pick up the fresh store')
})

test('confirm: any other failure is "unavailable", not "sign in again"', async () => {
  const runtime = stubRuntime({ credential: { token: 't' } })
  const req = fakeReq({ method: 'POST', url: '/plugins/dsh-connect-qoder/account/confirm' })
  const { res, out, bodies } = fakeRes(req)
  const pending = confirmHandler(req, res, {
    regions: REGIONS,
    started: [{ region: CN, runtime }],
    confirmUserInfo: async () => { throw new Error('socket hang up') },
  })
  post(req, { region: 'qoder-cn' })
  await pending
  const body = lastJson({ bodies })
  assert.equal(body.confirmed, false)
  assert.equal(body.kind, 'unavailable')
  assert.equal(runtime.invalidated, false, 'a transport failure is not a sign-in verdict')
})

test('confirm: a GET is refused with 405', async () => {
  const req = fakeReq({ method: 'GET', url: '/plugins/dsh-connect-qoder/account/confirm' })
  const { res, out } = fakeRes(req)
  await confirmHandler(req, res, { regions: REGIONS, started: [] })
  assert.equal(out.status, 405)
})

test('confirm: a region with no running runtime is read through the ASYNC unwrapper', async () => {
  // The recovery path: a sign-in that never produced a runtime (expired, or the
  // plugin started before sign-in). This branch used to call the SYNCHRONOUS
  // `loadCredential`, which spawns PowerShell and blocks the event loop for as
  // long as it takes — freezing the whole plugin because a browser button was
  // pressed. It now resolves through `loadCredentialAsync`.
  //
  // The injected reader is what makes that assertable without decrypting
  // anything on the machine running the suite.
  const reads = []
  const req = fakeReq({ method: 'POST', url: '/plugins/dsh-connect-qoder/account/confirm' })
  const { res, out, bodies } = fakeRes(req)
  const pending = confirmHandler(req, res, {
    regions: REGIONS,
    started: [],
    readCredential: async (region) => { reads.push(region.id); return { token: 't' } },
    confirmUserInfo: async () => ({ name: 'alice', email: 'alice@example.com' }),
  })
  post(req, { region: 'qoder-cn' })
  await pending
  assert.equal(out.status, 200)
  assert.deepEqual(reads, ['qoder-cn'], 'the stopped region is read exactly once')
  assert.equal(lastJson({ bodies }).confirmed, true, 'a region can come back without a restart')
})

test('confirm: a throwing read for a stopped region is "unavailable" with the reason', async () => {
  // The same posture as a runtime's own resolve failure, and the reason the
  // 200-with-detail answer exists at all: a bare catch-all 400 would tell the
  // user nothing about which step failed.
  const req = fakeReq({ method: 'POST', url: '/plugins/dsh-connect-qoder/account/confirm' })
  const { res, out, bodies } = fakeRes(req)
  const pending = confirmHandler(req, res, {
    regions: REGIONS,
    started: [],
    readCredential: async () => { throw new Error('OSCrypt key material unavailable') },
  })
  post(req, { region: 'qoder-cn' })
  await pending
  assert.equal(out.status, 200)
  const body = lastJson({ bodies })
  assert.equal(body.available, false)
  assert.ok(String(body.detail).includes('OSCrypt key material unavailable'))
})

test('confirm: a stopped region with no sign-in anywhere is "unavailable", plainly', async () => {
  const req = fakeReq({ method: 'POST', url: '/plugins/dsh-connect-qoder/account/confirm' })
  const { res, out, bodies } = fakeRes(req)
  const pending = confirmHandler(req, res, {
    regions: REGIONS,
    started: [],
    readCredential: async () => undefined,
  })
  post(req, { region: 'qoder-cn' })
  await pending
  assert.equal(out.status, 200)
  assert.equal(lastJson({ bodies }).available, false)
})

test('no route reads a credential through the SYNCHRONOUS unwrapper', () => {
  // Structural, for the same reason `test/async-unwrap.test.js` pins the two
  // unwrap entries: the behavioural tests above inject a reader, so they cannot
  // tell an async read from a sync one that happens to return the same object.
  // The sync unwrapper spawns PowerShell and blocks the event loop for as long
  // as it takes (up to 30 s per candidate) — inside a route handler that freezes
  // the whole plugin, including every other open card. It belongs to the
  // startup sweep and the `probe/` script, which have no latency budget.
  const source = readFileSync(new URL('../src/host/handlers.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(
    source,
    /\bloadCredential\(/,
    'a route must reach the credential through loadCredentialAsync, never the blocking loadCredential',
  )
  assert.match(source, /loadCredentialAsync\(/)
})

// ---------------------------------------------------------------------------
// The branch tails the happy paths above never reach
// ---------------------------------------------------------------------------

test('usage: a read that resolves undefined is "unavailable", not an empty quota', async () => {
  // `readUsage` answering `undefined` is its own answer (issue 16's
  // false-"已更新" shape: a missing reading must not render as a zeroed one).
  const req = fakeReq({ url: '/plugins/dsh-connect-qoder/usage' })
  const { res, out, bodies } = fakeRes(req)
  await usageHandler(req, res, {
    started: [{ region: CN, runtime: stubRuntime({ readUsage: async () => undefined }) }],
    logger: quiet,
  })
  assert.equal(out.status, 200)
  assert.equal(lastJson({ bodies }).regions[0].available, false)
})

test('claimTodayFor: a campaign record with no id refuses to post an empty one', async () => {
  // Upstream changed the protocol: `claimableCampaignOf` picked a round whose
  // `campaignId` vanished. Posting an empty id would be a blind guess — this
  // names the change instead (the same discipline as
  // `ProtocolShapeChangedError`).
  const runtime = stubRuntime({ credential: { token: 't' } })
  const noId = payloadWith({ ...freshRound('CLAIMABLE'), campaignId: undefined })
  await assert.rejects(
    claimTodayFor(runtime, { readCampaigns: async () => noId, claimCampaign: async () => ({ status: 'CLAIMED' }) }),
    /no campaign id/,
  )
})

test('claimTodayFor: an unreadable read-back still answers the confirmed claim', async () => {
  // The claim landed; only the second, confirmatory read failed. The derived
  // `todayCheckedIn: true` is the most honest answer — throwing here would
  // tell the user the Credits were NOT granted after they were.
  const runtime = stubRuntime({ credential: { token: 't' } })
  let reads = 0
  const io = {
    readCampaigns: async () => {
      reads++
      if (reads === 1) return payloadWith(freshRound('CLAIMABLE'))
      throw new Error('the read-back went dark')
    },
    claimCampaign: async () => ({ status: 'CLAIMED', replayed: false, benefit: { kind: 'CREDITS', amount: 100 } }),
  }
  const outcome = await claimTodayFor(runtime, io)
  assert.equal(outcome.claimed, true, 'a landed claim must not be retracted by a failed second read')
  assert.equal(reads, 2, 'the read-back was really attempted (and really failed)')
})

test('reload: with no region named, every started region is re-read', async () => {
  // `{}` (or any non-string region) means "every region" — the invalidate loop
  // must visit each runtime, not skip past an undefined `wanted`.
  const first = stubRuntime({ region: CN })
  const second = stubRuntime({ region: GLOBAL })
  const req = fakeReq({ method: 'POST', url: '/plugins/dsh-connect-qoder/account/reload' })
  const { res, out } = fakeRes(req)
  const pending = reloadHandler(req, res, {
    regions: REGIONS,
    started: [{ region: CN, runtime: first }, { region: GLOBAL, runtime: second }],
    startStoppedRegions: async () => {},
    payload: async () => ({ regions: [] }),
    logger: quiet,
  })
  post(req, {})
  await pending
  assert.equal(out.status, 200)
  assert.equal(first.invalidated, true)
  assert.equal(second.invalidated, true)
})

test('reload: naming one region leaves the other region caches alone', async () => {
  // The two-region isolation red line in miniature: re-reading one sign-in
  // must not invalidate the other region's credential cache.
  const cn = stubRuntime({ region: CN })
  const req = fakeReq({ method: 'POST', url: '/plugins/dsh-connect-qoder/account/reload' })
  const { res, out } = fakeRes(req)
  const calls = []
  const pending = reloadHandler(req, res, {
    regions: REGIONS,
    started: [{ region: CN, runtime: cn }],
    startStoppedRegions: async (wanted) => { calls.push(wanted) },
    payload: async () => ({ regions: [] }),
    logger: quiet,
  })
  post(req, { region: 'qoder' })
  await pending
  assert.equal(out.status, 200)
  assert.equal(cn.invalidated, false, 'the other region is not touched')
  assert.deepEqual(calls, ['qoder'], 'the named-but-stopped region is still started')
})
