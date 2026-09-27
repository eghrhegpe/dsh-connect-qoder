/**
 * Pin `fetchUserInfo` to the shared OpenAPI header set.
 *
 * Run: node --test test/userinfo-headers.test.js
 *
 * WHY THIS FILE EXISTS
 *
 * Every other OpenAPI call this plugin makes goes through the shared
 * `openApiHeaders` helper — the exact header set the real Qoder client sends
 * (`Cosy-ClientType`, `User-Agent`, plus the Bearer token) — while
 * `fetchUserInfo` hand-rolled its own, slimmer headers, so the confirm route
 * presented a different client identity than every other call. This test
 * keeps it on the shared path: an edit that reverts `fetchUserInfo` to a bare
 * Bearer goes red here.
 *
 * It is a consistency pin, NOT the fix for the 400 the card once showed on
 * 在线确认. That 400 came from the account route dereferencing a runtime
 * entry's nonexistent `region` field before the call was ever made (see the
 * stopped-region check in lib/index.js). A probe of
 * `openapi.qoder.com.cn/api/v1/userinfo` with a real CN credential answers
 * 200 for a bare `Authorization: Bearer` too, so this header set is not what
 * the CN endpoint gates on.
 *
 * The test cannot reach the real gateway (that needs a live sign-in), so it
 * stubs `globalThis.fetch`, captures the request, and asserts on the headers —
 * the one thing that distinguishes the two shapes. The response stub answers a
 * 200 with a minimal body so the call resolves and the header check is the only
 * thing under test.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { fetchUserInfo } from '../lib/upstream.js'

const CN_REGION = {
  id: 'qoder-cn',
  displayName: 'Qoder CN',
  openApiUrl: 'https://openapi.qoder.com.cn',
}
const CREDENTIAL = {
  userID: 'u-test',
  token: 'tok-test',
  name: 'n',
  email: 'e@x',
  machineID: 'm',
}

test('fetchUserInfo sends the real-client header set, not a bare Bearer', async () => {
  let captured
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    captured = { url: String(url), init }
    return new Response(
      JSON.stringify({ data: { id: 'u-test', name: 'n', email: 'e@x' } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }
  try {
    const info = await fetchUserInfo(CN_REGION, CREDENTIAL)
    // The call must resolve against the stub body, proving the flow ran.
    assert.strictEqual(info.userID, 'u-test')

    assert.strictEqual(captured.url, `${CN_REGION.openApiUrl}/api/v1/userinfo`)
    const headers = captured.init.headers

    // The client-identifying headers every OpenAPI call sends through
    // openApiHeaders; a bare-Bearer edit drops exactly these two.
    assert.strictEqual(headers.Authorization, `Bearer ${CREDENTIAL.token}`)
    assert.strictEqual(headers['Cosy-ClientType'], '10', 'missing Cosy-ClientType — the shared header set lost it')
    assert.strictEqual(headers['User-Agent'], 'Qoder', 'missing User-Agent — the shared header set lost it')
  } finally {
    globalThis.fetch = original
  }
})
