/**
 * Tests for src/host/account-state.ts: the four per-region sign-in states.
 *
 * Run: node --test test/account-state.test.js
 *
 * The states are the card's answer to "why does this region show no models":
 *
 * - `ok`         a credential is readable and not expired
 * - `expired`    the app store says the access token has lapsed
 * - `needs-app`  an app directory exists but yields no credential
 * - `signed-out` nothing is installed and no PAT is set
 *
 * Every decision depends on the store readers and the recorded unwrap cause,
 * so all of those are injected: the module's *defaults* are exercised once
 * (case 9), but the state machine itself is asserted against controlled inputs
 * rather than against whatever happens to be signed in on the test machine.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { readAccountState, ACCOUNT_STATES } from '../src/host/account-state.ts'

/** A region shaped like the real descriptors, with one directory per layout. */
const REGION = {
  id: 'qoder-cn',
  displayName: 'Qoder CN',
  appNames: ['QoderCN', 'Qoder CN'],
  newAppNames: ['com.qodercn.app.stable'],
  manageUrl: 'https://qoder.com.cn',
  downloadUrl: 'https://qoder.com.cn/download',
  baseUrl: 'https://gateway.qoder.com.cn/',
}

const appCred = {
  region: 'qoder-cn',
  appName: 'com.qodercn.app.stable',
  userID: 'u1',
  name: 'Ada',
  email: 'ada@example.com',
  token: 'dt-secret-must-not-leak',
  refreshToken: 'drt-secret-must-not-leak',
  refreshTokenExpiresAt: 0,
  expiresAt: Date.now() + 3600_000,
  expired: false,
  userType: '',
  userTag: '',
  machineID: 'm1',
  source: 'app',
  plan: undefined,
  usage: undefined,
}

const envCred = {
  ...appCred,
  appName: 'QODERCN_PAT',
  name: '',
  email: '',
  expiresAt: 0,
  source: 'env-pat',
}

/**
 * One app directory that `readAccountState` can probe, cleaned up on exit.
 *
 * Async because the reader is: `run` is awaited, so the directory is removed
 * AFTER the verdict is produced. A synchronous `run()` here would return before
 * the reader had answered, and the cleanup would pull the directory out from
 * under it.
 */
async function withDir(root, dirName, run) {
  const dir = join(root, dirName)
  // A plain `mkdirSync`, not `mkdtempSync`: the reader probes by exact
  // directory name, and the temp helper would append random characters and
  // the probe would miss it.
  mkdirSync(dir)
  try {
    await run()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('a readable app credential is `ok`, with its local identity', async () => {
  const record = await readAccountState(REGION, '/nonexistent/appdata', {
    loadCredential: () => appCred,
    loadEnvCredential: () => undefined,
  })
  assert.strictEqual(record.state, 'ok')
  assert.strictEqual(record.source, 'app')
  assert.strictEqual(record.appName, 'com.qodercn.app.stable')
  assert.strictEqual(record.identity.name, 'Ada')
  assert.strictEqual(record.identity.email, 'ada@example.com')
  assert.ok(record.identity.expiresAt > 0)
  assert.strictEqual(record.detail, undefined)
})

test('an env PAT is `ok` too — the PAT itself never expires locally', async () => {
  const record = await readAccountState(REGION, '/nonexistent/appdata', {
    loadCredential: () => undefined,
    loadEnvCredential: () => envCred,
  })
  assert.strictEqual(record.state, 'ok')
  assert.strictEqual(record.source, 'env-pat')
  // A PAT carries no local identity: empty name/email, and no expiry to show.
  assert.strictEqual(record.identity.name, '')
  assert.strictEqual(record.identity.expiresAt, undefined)
})

test('an expired app credential is `expired`, not `ok`', async () => {
  const record = await readAccountState(REGION, '/nonexistent/appdata', {
    loadCredential: () => ({ ...appCred, expired: true, expiresAt: Date.now() - 1000 }),
    loadEnvCredential: () => undefined,
  })
  assert.strictEqual(record.state, 'expired')
  assert.strictEqual(record.source, 'app')
})

test('the app credential wins when both an app sign-in and a PAT exist', async () => {
  const record = await readAccountState(REGION, '/nonexistent/appdata', {
    loadCredential: () => appCred,
    loadEnvCredential: () => envCred,
  })
  assert.strictEqual(record.state, 'ok')
  assert.strictEqual(record.source, 'app')
})

test('a present app directory with a recorded unwrap cause is `needs-app` and says why', async () => {
  const root = mkdtempSync(join(tmpdir(), 'qoder-account-'))
  try {
    await withDir(root, 'com.qodercn.app.stable', async () => {
      const record = await readAccountState(REGION, root, {
        loadCredential: () => undefined,
        loadEnvCredential: () => undefined,
        describeUnwrapFailure: (dirPath) =>
          join(root, 'com.qodercn.app.stable') === dirPath ? 'PowerShell exited 1' : undefined,
      })
      assert.strictEqual(record.state, 'needs-app')
      assert.strictEqual(record.appName, 'com.qodercn.app.stable')
      assert.strictEqual(record.detail, 'PowerShell exited 1')
      assert.strictEqual(record.identity, undefined)
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a present app directory without a recorded cause is `needs-app` with the generic detail', async () => {
  const root = mkdtempSync(join(tmpdir(), 'qoder-account-'))
  try {
    await withDir(root, 'QoderCN', async () => {
      const record = await readAccountState(REGION, root, {
        loadCredential: () => undefined,
        loadEnvCredential: () => undefined,
        describeUnwrapFailure: () => undefined,
      })
      assert.strictEqual(record.state, 'needs-app')
      assert.strictEqual(record.appName, 'QoderCN')
      assert.strictEqual(record.detail, 'the app is present but holds no sign-in')
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('neither app directory nor PAT is `signed-out`', async () => {
  const root = mkdtempSync(join(tmpdir(), 'qoder-account-'))
  try {
    const record = await readAccountState(REGION, root, {
      loadCredential: () => undefined,
      loadEnvCredential: () => undefined,
    })
    assert.strictEqual(record.state, 'signed-out')
    assert.strictEqual(record.source, undefined)
    assert.strictEqual(record.appName, undefined)
    assert.strictEqual(record.identity, undefined)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the record carries no credential material of any kind', async () => {
  // The card is a browser surface. The credential record the reader hands back
  // holds the token and its refresh half; the state record must not.
  const serialised = JSON.stringify({
    ok: await readAccountState(REGION, '/nonexistent/appdata', {
      loadCredential: () => appCred,
      loadEnvCredential: () => undefined,
    }),
    expired: await readAccountState(REGION, '/nonexistent/appdata', {
      loadCredential: () => ({ ...appCred, expired: true }),
      loadEnvCredential: () => undefined,
    }),
  })
  for (const forbidden of ['dt-secret-must-not-leak', 'drt-secret-must-not-leak', 'refreshToken', 'machineID', 'Authorization']) {
    assert.ok(!serialised.includes(forbidden), `the record must not mention ${forbidden}`)
  }
})

test('the default readers are wired to the real credential layer', async () => {
  // A directory that cannot exist: the real `loadCredential` probes `%APPDATA%`
  // names, finds none, and returns undefined. With the env reader also
  // injecting "absent", only one answer is possible.
  const record = await readAccountState(REGION, '/nonexistent/appdata', {
    loadEnvCredential: () => undefined,
  })
  assert.strictEqual(record.state, 'signed-out', JSON.stringify(record))
})

test('the state vocabulary is exactly the four states', async () => {
  // The card maps `state` straight onto copy keys; a fifth value would render
  // as a raw `account.state.x` string. Pin the set.
  assert.deepStrictEqual([...ACCOUNT_STATES].sort(), ['expired', 'needs-app', 'ok', 'signed-out'])
})
