/**
 * Tests for protocol-drift triage — the plugin's answer to "Qoder changed".
 *
 * Run: node --test test/protocol-drift.test.js
 *
 * WHY THIS FILE EXISTS
 *
 * This plugin clones a private protocol with no version negotiation and no
 * contract (`COSY_VERSION '1.1.38'`, `CLIENT_TYPE '5'`,
 * `session_type 'qodercli'`, `Cosy-Data-Policy: disagree`). PLAN P1-4 called
 * that the root risk of the whole category, and the concrete failure was
 * specific: a changed envelope arrives as a **successful HTTP 200**, so
 * `fetchModels` read it as "zero models" — indistinguishable from an account
 * that genuinely has none — while the rejection-shaped variants were absorbed
 * by the plugin's own two-minute queue budget, so the user watched a long wait
 * instead of learning that the plugin needs an update.
 *
 * The three states are now kept apart, and the boundary between them is a fact
 * about the wire that was MEASURED rather than guessed
 * (`probe/model-shape.mjs`, both regions, real credentials):
 *
 * - the envelope is an object keyed by product surface, each value an ARRAY;
 * - `chat` is present on both editions;
 * - a sibling group may be **absent** entirely (the global edition has no
 *   `developer` group) — so "not every group I saw is here" is NOT drift;
 * - an empty surface is expressed as `[]` (`byok_teams` came back length 0) —
 *   so `chat: []` is a trustworthy "no models", not drift.
 *
 * Keying the shape on anything looser than `chat` being an array would either
 * wipe a live catalog on a routine global-edition reply, or keep reading a
 * renamed group as an empty account. Both are the original bug wearing a fix.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { readModelCatalogShape, MACHINE_OS, queueWaitFor } from '../src/host/upstream.ts'
import { ProtocolShapeChangedError, isProtocolShapeChangedError } from '../src/host/errors.ts'

const CN = { id: 'qoder-cn', displayName: 'Qoder CN' }
const GLOBAL = { id: 'qoder', displayName: 'Qoder' }

/** A row as upstream sends it; only `key` and `display_name` are required. */
const row = (key) => ({ key, display_name: key, enable: true, is_vl: false, price_factor: 0.01 })

// --- the real envelopes, as probed -----------------------------------------

test('the CN envelope shape is accepted', () => {
  // probe/model-shape.mjs: 11 groups, chat = 14 rows, byok_* present but empty.
  const data = {
    chat: [row('A'), row('B')],
    developer: [row('A')],
    assistant: [row('A')],
    inline: [],
    quest: [],
    qwork: [],
    experts: [],
    qwake: [],
    app: [],
    byok_teams: [],
    byok_enterprise: [],
  }
  assert.deepStrictEqual(readModelCatalogShape(data, CN), data.chat)
})

test('the global envelope shape is accepted, including its missing developer group', () => {
  // The asymmetry that a naive "all groups must be present" check would reject.
  // Treating this as drift would take the global edition's catalog down on a
  // routine reply — the exact kind of self-inflicted outage issue 10 is about.
  const data = {
    chat: [row('A')],
    assistant: [row('A')],
    inline: [],
    quest: [],
    nap: [],
    qwork: [],
    experts: [],
    qwake: [],
    app: [],
    byok_teams: [],
    byok_enterprise: [],
  }
  assert.deepStrictEqual(readModelCatalogShape(data, GLOBAL), data.chat)
})

test('an empty chat group is an answer, not drift', () => {
  // Measured: upstream writes an absent surface as `[]`. So `chat: []` is
  // "this account has no models here" — the one case issue 04 exists to commit
  // to disk. Reading it as drift would keep serving a stale roster forever,
  // which is the freeze the empty-catalog fix just removed.
  assert.deepStrictEqual(readModelCatalogShape({ chat: [] }, CN), [])
  assert.deepStrictEqual(readModelCatalogShape({ chat: [], byok_teams: [] }, GLOBAL), [])
})

// --- the drift shapes ------------------------------------------------------

test('a renamed or regrouped envelope is reported as drift, naming what did arrive', () => {
  // The detail is what makes this actionable: "it is called `models` now" is a
  // five-second fix for the maintainer; "no chat group" alone is a hunt.
  let thrown
  try {
    readModelCatalogShape({ models: [row('A')], agents: [] }, CN)
  } catch (error) {
    thrown = error
  }
  assert.ok(thrown instanceof ProtocolShapeChangedError, `expected drift, got ${thrown}`)
  assert.strictEqual(isProtocolShapeChangedError(thrown), true)
  assert.match(thrown.detail, /models/, 'the arriving group names must reach the message')
  assert.match(thrown.message, /needs an update/i, 'the user-facing text must say what to do')
})

test('a chat group that is no longer an array is drift', () => {
  // A wrapper object or a null: upstream would have to be returning something
  // new here, and `Object.values` on it would quietly yield models that were
  // never in a list.
  for (const value of [null, { A: row('A') }, 'chat', 42]) {
    assert.throws(
      () => readModelCatalogShape({ chat: value }, CN),
      (error) => isProtocolShapeChangedError(error),
      `chat: ${JSON.stringify(value)}`,
    )
  }
})

test('a body that is not an envelope at all is drift, not an empty catalog', () => {
  // An array (a bare list of models, say), a string, a number, or null. The old
  // `data?.chat` read turned all of these into "no models" and the last good
  // catalog into a permanent fixture.
  for (const data of [null, undefined, 42, 'ok', [{ key: 'A' }]]) {
    assert.throws(
      () => readModelCatalogShape(data, CN),
      (error) => isProtocolShapeChangedError(error),
      JSON.stringify(data ?? null),
    )
  }
})

test('drift names the region so a two-region profile says which one broke', () => {
  assert.throws(
    () => readModelCatalogShape({ chat: 'nope' }, GLOBAL),
    /Qoder\b/,
  )
})

// --- it must not be waited out ---------------------------------------------

test('a protocol change is not queued and retried', () => {
  // The queue ladder is the mechanism that turned "the plugin is broken" into
  // "the user watches a spinner for two minutes". `retryable: false` is what
  // keeps the failure immediate; without it, waiting is the one thing that
  // cannot help.
  const error = new ProtocolShapeChangedError('no `chat` group')
  assert.strictEqual(error.retryable, false)
  assert.strictEqual(queueWaitFor(error, 0, 0), undefined, 'must not be slept on, ever')
  // Even with a generous budget left, a shape is not something time can fix.
  assert.strictEqual(queueWaitFor(error, 0, 1), undefined)
  assert.strictEqual(queueWaitFor(error, 120_000, 3), undefined)
})

test('a genuine queue rejection still waits, so the fix did not disable the ladder', () => {
  // The counterpart assertion. If the flag had been set on Error.prototype or on
  // the wrong class, every real queue would stop waiting and turn into a hard
  // failure — trading one silent wrong answer for another.
  const queued = { retryable: true }
  assert.ok(queueWaitFor(queued, 0, 0) > 0, 'a queue must still produce a wait')
})

// --- the platform assumption ------------------------------------------------

test('MACHINE_OS names the real platform, including darwin', () => {
  // The darwin arm was the gap: a macOS host announced `x86_64_linux`, and the
  // whole suite had zero references to this constant, so nobody could tell
  // whether the gateway cared.
  const expected = {
    win32: { arm64: 'aarch64_windows', x64: 'x86_64_windows' },
    darwin: { arm64: 'aarch64_darwin', x64: 'x86_64_darwin' },
    linux: { arm64: 'aarch64_linux', x64: 'x86_64_linux' },
  }[process.platform]?.[process.arch]
  assert.strictEqual(
    MACHINE_OS,
    expected,
    `this host is ${process.platform}/${process.arch}; the gateway was told something else`,
  )
  // The spelling itself is the contract, and it is no longer a claim about
  // darwin that nobody checked: probe/machineos-probe.mjs measured 200 with an
  // identical catalog for all four linux/darwin values on both regions.
  assert.match(MACHINE_OS, /^(aarch64|x86_64)_(windows|darwin|linux)$/)
  assert.ok(
    MACHINE_OS.includes(process.platform === 'win32' ? 'windows' : process.platform),
    'a macOS host must not claim to be linux',
  )
})
