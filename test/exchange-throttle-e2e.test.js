/**
 * End-to-end test for the PAT exchange throttle, against a live fake platform.
 *
 * Run: node --test test/exchange-throttle-e2e.test.js
 *
 * This is the sibling plugin's 429 e2e, on our exchange endpoint. The point of
 * doing it end to end rather than by unit test alone is the standard both fixes
 * set for themselves: "did the poll re-probe?" is answered by the FAKE's
 * request counter, not by the plugin's word. Every earlier credential-cache
 * test trusts `exchangePat` to be what it says it is; here the real one runs,
 * over real `fetch`, against a real HTTP server, with the real `FileThrottleStore`
 * behind it. Two properties only this wiring can prove, and they are the reason
 * the gate exists:
 *
 *   - the platform's own `Retry-After` window rides out through the real
 *     `exchangePat` error into the throttle, so a poll inside it is refused
 *     locally and never reaches the fake;
 *   - a DELIBERATE re-read (the card's "重读登录", i.e. `invalidate`) clears the
 *     gate and the next exchange reaches the fake again — so a user who fixed
 *     the credential is not stuck behind a lockout that no longer applies.
 *
 * The fake answers account `e2e-throttle` with the platform's real rate-limit
 * envelope (a 429 plus `retry-after: 120`); a fake that only ever succeeded
 * could not exercise the wait honouring, so a run would pass while a real
 * lockout was still being extended by every poll.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { CredentialCache } from '../src/host/credential-cache.ts'
import { FileThrottleStore } from '../src/host/throttle-store.ts'
import { exchangePat } from '../src/host/upstream.ts'

// The exchange endpoint is `${region.openApiUrl}/api/v1/jobToken/exchange`; the
// fake IS that origin, so the real `exchangePat` builds a URL that lands here.
const REGION = {
  id: 'qoder-cn',
  mode: 'cn',
  displayName: 'Qoder CN',
  appNames: [],
  baseUrl: 'http://127.0.0.1:0/',
  openApiUrl: 'http://127.0.0.1:0',
  centerUrl: 'http://127.0.0.1:0',
  manageUrl: '',
  downloadUrl: '',
  patEnvNames: [],
}

/** Counters the assertions read, so "did it probe?" is answerable, not assumed. */
const log = { exchange: 0, throttled: 0 }

/**
 * The fake platform. It scripts one account:
 *   - `e2e-throttle` → a real 429 envelope with `retry-after: 120`;
 *   - anything else  → a job token, so a post-clear retry can succeed.
 */
function startFake() {
  const server = createServer(async (req, res) => {
    if (!req.url?.endsWith('/api/v1/jobToken/exchange')) {
      res.writeHead(404, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ error: 'not_found' }))
    }
    log.exchange += 1
    let pat = ''
    try {
      const raw = await new Promise((resolve, reject) => {
        let body = ''
        req.on('data', (c) => {
          body += c
        })
        req.on('end', () => resolve(body))
        req.on('error', reject)
      })
      pat = String(JSON.parse(raw).personal_access_token ?? '')
    } catch {
      // A malformed body still counts as a probe; the throttle test uses well-
      // formed bodies, so this is only defensive.
    }

    const json = (status, value, headers = {}) => {
      const payload = JSON.stringify(value)
      res.writeHead(status, { 'content-type': 'application/json', ...headers })
      res.end(payload)
    }

    if (pat === 'e2e-throttle') {
      // The platform's real rate-limit envelope: a 429 whose HTTP header states
      // the window. The gate's contract is to carry THIS number into
      // `retryAfterSeconds` and then refuse to re-probe while it stands.
      log.throttled += 1
      return json(429, { message: 'TooManyRequests', detail: 'exchange attempts too frequent, retry after 120s' }, { 'retry-after': '120' })
    }
    return json(200, { token: 'job-token', refresh_token: 'r', expires_at: 1_800_000_000 })
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })
}

let fake
let port
let dir

before(async () => {
  fake = await startFake()
  port = fake.port
  dir = mkdtempSync(join(tmpdir(), 'qoder-e2e-throttle-'))
})

after(() => {
  log.exchange = 0
  log.throttled = 0
  if (fake) fake.server.close()
  rmSync(dir, { recursive: true, force: true })
})

/** A region pointing at the live fake. */
const fakeRegion = () => ({ ...REGION, openApiUrl: `http://127.0.0.1:${port}` })

/** A cache wired to the real exchangePat and a real file-backed throttle. */
function cacheOver(pat) {
  const path = join(dir, `throttle-${Math.random().toString(36).slice(2)}.json`)
  const cache = new CredentialCache({
    loadApp: () => undefined,
    loadEnv: () => ({ source: 'env-pat', token: pat, userID: '', expiresAt: 0 }),
    exchangePat: async (credential) => exchangePat(fakeRegion(), credential.token),
    throttleStore: new FileThrottleStore({ path }),
  })
  return cache
}

test('the real exchange carries the platform window into the gate, which then refuses to re-probe', async () => {
  const callsBefore = log.exchange
  const cache = cacheOver('e2e-throttle')

  // First attempt: reaches the fake, gets the 429, and the window lands on the
  // thrown error the gate reads.
  await assert.rejects(
    () => cache.resolve(),
    (error) => {
      assert.strictEqual(error.status, 429, 'the real exchangePat tags the HTTP status')
      assert.strictEqual(error.retryAfterSeconds, 120, 'the real exchangePat reads retry-after:120 off the response')
      return true
    },
  )
  assert.strictEqual(log.exchange, callsBefore + 1, 'the first refusal reached the fake')

  // The gate is now in force. A poll (the catalog timer, the panel re-read)
  // must be refused LOCALLY — the fake's counter is the evidence.
  await assert.rejects(
    () => cache.resolve(),
    (error) => {
      assert.match(error.message, /waiting out a rate-limit window/, 'refused by the gate, not the platform')
      return true
    },
  )
  assert.strictEqual(log.exchange, callsBefore + 1, 'the poll never re-probed the fake — this is the whole fix')

  // A deliberate re-read ("重读登录") releases the gate: the next resolve on the
  // SAME cache and SAME account must reach the fake again — the counter is the
  // proof, mirroring the sibling's "a deliberate resubmit reached IAM." The fake
  // still 429s this account, so a fresh window is set, but the attempt itself
  // is what confirms the gate stepped aside for the user's explicit action.
  cache.invalidate()
  await assert.rejects(() => cache.resolve(), /HTTP 429/)
  assert.strictEqual(log.exchange, callsBefore + 2, 'the deliberate re-read reached the fake again')
  assert.strictEqual(cache.throttle.kind, 'rate-limit', 'and a fresh window now stands')
})
