/**
 * Unit tests for the umid machine-identity block's effect on
 * `openApiHeaders` in `src/host/upstream.ts`.
 *
 * The international campaigns endpoint serves the daily CLAIM_BENEFIT round
 * only to requests carrying the desktop app's umid values; when the block
 * cannot be read (no Qoder install, a CI runner, a CN-only machine) the
 * header set must fall back to the bare client identity. These tests stub
 * the binary-read seam so every branch is reachable without a real install
 * or a Windows platform, and are deterministic on any machine.
 *
 * The seam is `__dshQoderUmidProbe`: a global function the module consults
 * when present. When it is a function it stands in for the binary read; when
 * it is not a function the module runs the real `execFileSync` path
 * (production). The module's per-process cache is reset between tests by
 * `__dshQoderUmidCacheReset` so a stale answer cannot mask a branch.
 *
 * Run: node --test test/umid-headers.test.js
 */
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const { openApiHeaders, __dshQoderUmidCacheReset, __dshQoderUmidState } = await import('../src/host/upstream.ts')

beforeEach(() => {
  globalThis.__dshQoderUmidProbe = null
  __dshQoderUmidCacheReset()
})

const REGION = { id: 'qoder', displayName: 'Qoder', openApiUrl: 'https://openapi.qoder.sh' }
const CREDENTIAL = { token: 'tok', appName: 'com.qoder.app.stable', source: 'app' }

test('a read that yields no block leaves the bare client identity in place', () => {
  globalThis.__dshQoderUmidProbe = () => null
  const headers = openApiHeaders(CREDENTIAL, REGION)
  assert.equal(headers.Authorization, `Bearer ${CREDENTIAL.token}`)
  assert.equal(headers['Cosy-ClientType'], '10')
  assert.equal(headers['User-Agent'], 'Qoder')
  assert.ok(!('Cosy-MachineToken' in headers), 'no umid block when the read answers null')
  assert.ok(!('Cosy-MachineCode' in headers))
  assert.ok(!('Cosy-MachineType' in headers))
})

test('a valid read merges the umid block onto the client identity', () => {
  globalThis.__dshQoderUmidProbe = () => ({ machineToken: 'tk', machineType: 'tp', machineCode: 'cd' })
  const headers = openApiHeaders(CREDENTIAL, REGION)
  assert.equal(headers['Cosy-MachineToken'], 'tk')
  assert.equal(headers['Cosy-MachineType'], 'tp')
  assert.equal(headers['Cosy-MachineCode'], 'cd')
  // The block is additive: the base identity is still there.
  assert.equal(headers['Cosy-ClientType'], '10')
})

test('an undefined read answer degrades to the bare set', () => {
  globalThis.__dshQoderUmidProbe = () => undefined
  const headers = openApiHeaders(CREDENTIAL, REGION)
  assert.ok(!('Cosy-MachineToken' in headers))
  assert.ok(!('Cosy-MachineCode' in headers))
})

test('a malformed answer (missing machineCode) degrades rather than surfacing partially', () => {
  globalThis.__dshQoderUmidProbe = () => ({ machineToken: 'tk', machineType: 'tp' })
  const headers = openApiHeaders(CREDENTIAL, REGION)
  assert.ok(!('Cosy-MachineCode' in headers), 'a partial block must not surface partially')
  assert.ok(!('Cosy-MachineToken' in headers))
  assert.ok(!('Cosy-MachineType' in headers))
})

test('a read that throws degrades to the bare set instead of propagating', () => {
  globalThis.__dshQoderUmidProbe = () => {
    throw new Error('binary failed')
  }
  const headers = openApiHeaders(CREDENTIAL, REGION)
  assert.equal(headers['Cosy-ClientType'], '10')
  assert.ok(!('Cosy-MachineToken' in headers))
})

test('the read is cached: a second call does not re-run it', () => {
  let runs = 0
  globalThis.__dshQoderUmidProbe = () => {
    runs += 1
    return { machineToken: 'tk', machineType: 'tp', machineCode: 'cd' }
  }
  openApiHeaders(CREDENTIAL, REGION)
  openApiHeaders(CREDENTIAL, REGION)
  assert.equal(runs, 1, 'the umid read must happen once per process, not once per request')
})

test('the cache is independent of the region argument', () => {
  let runs = 0
  globalThis.__dshQoderUmidProbe = () => {
    runs += 1
    return { machineToken: 'tk', machineType: 'tp', machineCode: 'cd' }
  }
  const cnRegion = { id: 'qoder-cn', openApiUrl: 'https://openapi.qoder.com.cn' }
  openApiHeaders(CREDENTIAL, cnRegion)
  openApiHeaders(CREDENTIAL, REGION)
  assert.equal(runs, 1, 'the block is machine-scoped, so a region change must not re-read it')
})

// --- the observability seam the activation warn reads ------------------------

test('__dshQoderUmidState reports availability when the read yields a block', () => {
  globalThis.__dshQoderUmidProbe = () => ({ machineToken: 'tk', machineType: 'tp', machineCode: 'cd' })
  const state = __dshQoderUmidState()
  assert.equal(state.available, true, 'a complete block is the available answer')
  assert.equal('reason' in state, false, 'availability carries no reason')
})

test('__dshQoderUmidState reports the degradation with a reason the log can name', () => {
  globalThis.__dshQoderUmidProbe = () => null
  const state = __dshQoderUmidState()
  assert.equal(state.available, false, 'a null read is the unavailable answer')
  assert.equal(typeof state.reason, 'string', 'the reason must exist for the warn to use')
  assert.match(state.reason, /umid/)
})

test('__dshQoderUmidState reflects the cached read, not a re-run', () => {
  let runs = 0
  globalThis.__dshQoderUmidProbe = () => {
    runs += 1
    return { machineToken: 'tk', machineType: 'tp', machineCode: 'cd' }
  }
  assert.equal(__dshQoderUmidState().available, true)
  assert.equal(__dshQoderUmidState().available, true)
  assert.equal(runs, 1, 'the state seam must not re-run the read past the per-process cache')
})
