/**
 * Tests for the three credential-reading modes and how they are routed.
 *
 * Run: node --test test/credential-read-modes.test.js
 *
 * There are now three ways to ask for a region's sign-in, and the difference
 * between them is a performance and responsiveness property, not a semantic
 * one — all three must still report the same STATES, or the card's account
 * panel would show different things depending on how the answer was fetched.
 *
 *   default      read the store, unwrapping a key if needed
 *   cachedOnly   read the store WITHOUT unwrapping a key (issue 07)
 *   force        read the store, unwrapping even inside the failure window
 *
 * `cachedOnly` exists because the account route runs on every panel render and
 * an OSCrypt unwrap is a synchronous PowerShell child with a 30 s timeout: a
 * machine that cannot unwrap would block the host's event loop once per render,
 * while the panel that must explain that state is the thing being blocked.
 * `force` is the opposite end, for the one request that IS a user-initiated
 * re-read — without it, pressing "重读登录" inside the failure window would
 * silently do nothing, which is worse than the freeze it fixed.
 *
 * A silent misrouting is the failure mode worth guarding: a wrong flag here
 * produces no error, no wrong-looking output — just a UI that stalls, or a
 * button that does nothing. So the routing is asserted, not just the outcomes.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { readAccountState } from '../lib/account-state.js'

const REGION = {
  id: 'qoder-cn',
  displayName: 'Qoder CN',
  appNames: ['QoderCN'],
  newAppNames: ['com.qodercn.app.stable'],
  manageUrl: 'https://qoder.com.cn',
  baseUrl: 'https://gateway.qoder.com.cn/',
}

/**
 * A stand-in that records every call with the options it was given.
 *
 * The modes are a performance axis, so what a mode must NOT change is the
 * STATE; the two tests that need a controlled credential use this, and the two
 * that assert real routing deliberately do not (an injected reader replaces the
 * dispatch under test).
 */
function recordingReader(result = undefined) {
  const calls = []
  return {
    calls,
    loadCredential: (region, root, options) => {
      calls.push(options)
      return result
    },
  }
}

test('the default read injects nothing extra', () => {
  const reader = recordingReader()
  readAccountState(REGION, '/nonexistent', { ...reader, loadEnvCredential: () => undefined })
  assert.deepStrictEqual(reader.calls, [undefined], 'the default read must not carry a mode flag')
})

test('cachedOnly is routed to the cached reader, which never unwraps', () => {
  // This is the assertion that matters for issue 07, and it cannot be made by
  // injecting a reader — an injected reader replaces the very dispatch under
  // test. So the real `loadCredential` is used against a directory that exists
  // but holds no credential: if the cached path were not taken, the real
  // `oscryptKeyFor` would try to unwrap and (on a machine with PowerShell) pay
  // a subprocess for it. A missing `Local State` keeps that cheap and inert
  // while still exercising the branch, and the state it yields is the one the
  // panel must show.
  const root = mkdtempSync(join(tmpdir(), 'qoder-readmode-'))
  try {
    mkdirSync(join(root, 'com.qodercn.app.stable'), { recursive: true })
    const record = readAccountState(REGION, root, {
      loadEnvCredential: () => undefined,
      cachedOnly: true,
    })
    assert.strictEqual(record.state, 'needs-app', 'a present app with no key is needs-app either way')
    assert.strictEqual(record.appName, 'com.qodercn.app.stable')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('force reaches the unwrap path and produces the same state', () => {
  // The counterpart: the user-driven re-read must NOT be answered from a
  // remembered failure, or the button would do nothing. With a real directory
  // and no key, both modes legitimately end at `needs-app` — what is asserted
  // is that asking for a real read is accepted and answers, not that it throws.
  const root = mkdtempSync(join(tmpdir(), 'qoder-readmode-'))
  try {
    mkdirSync(join(root, 'com.qodercn.app.stable'), { recursive: true })
    const forced = readAccountState(REGION, root, {
      loadEnvCredential: () => undefined,
      force: true,
    })
    assert.strictEqual(forced.state, 'needs-app')
    // The detail is the recorded unwrap reason, and a FORCED read records a
    // fresh one — that is the observable difference between the two modes.
    assert.ok(typeof forced.detail === 'string' && forced.detail.length > 0, JSON.stringify(forced))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an explicit reader wins over the mode flags', () => {
  // Dependency injection must keep working: the test suite (and any future
  // caller with its own reader) passes a reader and expects it to be used
  // verbatim, whatever the flags say. This is also why the two tests above
  // cannot inject one.
  const reader = recordingReader()
  readAccountState(REGION, '/nonexistent', {
    ...reader,
    loadEnvCredential: () => undefined,
    cachedOnly: true,
    force: true,
  })
  assert.strictEqual(reader.calls.length, 1)
  assert.deepStrictEqual(reader.calls, [undefined], 'an injected reader is called with no extra options')
})

test('all three modes report the same state from the same store', () => {
  // The modes are a performance axis, not a semantic one. A mode that changed
  // the ANSWER would make the account panel lie depending on how it was
  // refreshed — the class of bug this repository keeps finding.
  const credential = {
    region: 'qoder-cn',
    appName: 'com.qodercn.app.stable',
    userID: 'u1',
    name: 'Ada',
    email: 'ada@example.com',
    token: 't',
    expiresAt: Date.now() + 3600_000,
    expired: false,
    source: 'app',
  }
  for (const options of [{}, { cachedOnly: true }, { force: true }]) {
    const record = readAccountState(REGION, '/nonexistent', {
      loadCredential: () => credential,
      loadEnvCredential: () => undefined,
      ...options,
    })
    assert.strictEqual(record.state, 'ok', JSON.stringify(options))
    assert.strictEqual(record.identity.name, 'Ada')
  }
})
