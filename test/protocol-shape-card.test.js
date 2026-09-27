/**
 * Guard the card's refresh verdict against regressions in the shipped bundle.
 *
 * Run: node --test test/protocol-shape-card.test.js
 *
 * WHY THIS FILE EXISTS
 *
 * Issue 10's third acceptance criterion is a card-level requirement: when the
 * host reports a protocol shape change, the next action the card offers must
 * NOT be "sign in again". That wording lived only in a JSX expression, so it
 * had the same problem as the off-peak gate this repository already had to
 * re-guard: it was untested, and a reworded or dropped branch would ship green.
 *
 * So the decision is a pure function, `refreshNoticeKey`, extracted from the
 * card, and it is read out of the SHIPPED bundle here — the same technique
 * `test/client-bundle.test.js` uses for `offPeakState`, and for the same
 * reason: a hand-written copy in the test file would assert against itself.
 * Deleting or inverting the function in `lib/client.js` turns this file red.
 *
 * The card renders three states and the host sends the inputs:
 *   - no failures           → the "已更新（time）" stamp, rows are current;
 *   - a transient failure   → the stamp, marked stale, retry is the next move;
 *   - protocol-shape-changed → "update the plugin", and no timestamp at all.
 *
 * The last one is the point: a plugin that reads an envelope it does not know
 * cannot be fixed by a login, and a time next to that message implies the rows
 * on screen are current when they are not.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const BUNDLE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'client.js'),
  'utf8',
)

/** Pull one function out of the bundle by name, walking braces. */
function extract(name) {
  const header = new RegExp(`function ${name}\\([^)]*\\) \\{`).exec(BUNDLE)
  if (header === null) return null
  let depth = 0
  for (let i = BUNDLE.indexOf('{', header.index); i < BUNDLE.length; i++) {
    if (BUNDLE[i] === '{') depth++
    else if (BUNDLE[i] === '}') {
      depth--
      if (depth === 0) return BUNDLE.slice(header.index, i + 1)
    }
  }
  return null
}

const source = extract('refreshNoticeKey')
assert.ok(source !== null, 'could not extract `refreshNoticeKey` from lib/client.js — rebuild it from src/client/')
// eslint-disable-next-line no-new-func
const refreshNoticeKey = new Function(`${source}; return refreshNoticeKey;`)()

test('a healthy payload shows the honest "updated" stamp and nothing else', () => {
  assert.strictEqual(refreshNoticeKey({ refreshedAt: 1, refreshFailures: [] }), null)
  // A host from before this change sends no `refreshFailures` at all; that must
  // read as healthy, not as a failure with an empty reason.
  assert.strictEqual(refreshNoticeKey({ refreshedAt: 1 }), null)
  assert.strictEqual(refreshNoticeKey(undefined), null)
})

test('a transient failure marks the stamp stale rather than replacing it', () => {
  // The rows on screen are real — they are the last good upstream answer — so
  // the user should still see when they were fetched, and should be told to
  // retry. Hiding the time would make a real roster look like a fabrication.
  for (const reason of ['fetch', 'credential', 'no-credential']) {
    assert.strictEqual(
      refreshNoticeKey({ refreshedAt: 1, refreshFailures: [{ reason }] }),
      'transient',
      reason,
    )
  }
})

test('a protocol shape change is its own verdict, never a transient one', () => {
  // The whole point of issue 10: this is the failure that cannot be waited out
  // or signed past, so it must not be rendered as something the user retries.
  assert.strictEqual(
    refreshNoticeKey({
      refreshedAt: 1,
      refreshFailures: [{ region: 'qoder-cn', reason: 'protocol-shape-changed' }],
    }),
    'protocol-shape-changed',
  )
})

test('a protocol change wins over a transient failure in the same payload', () => {
  // Two regions, one of each: CN hit a shape change, the global edition merely
  // 500-ed. The actionable one is the protocol change, so that is what shows.
  assert.strictEqual(
    refreshNoticeKey({
      refreshFailures: [
        { region: 'qoder', reason: 'fetch' },
        { region: 'qoder-cn', reason: 'protocol-shape-changed' },
      ],
    }),
    'protocol-shape-changed',
  )
})

test('a malformed failures field cannot crash the card', () => {
  // The route is the untrusted input here — a hand-edited payload, an older
  // host, a proxy. Every one of these must fold to a verdict, never throw,
  // because a throw here is a card that never renders at all.
  for (const value of [null, 0, '', 'x', {}, [null, 1, 'x'], [{ reason: 1 }], { refreshFailures: {} }]) {
    const verdict = refreshNoticeKey({ refreshedAt: 1, refreshFailures: value })
    assert.ok(
      verdict === null || verdict === 'transient' || verdict === 'protocol-shape-changed',
      `${JSON.stringify(value)} → ${JSON.stringify(verdict)}`,
    )
  }
})

test('the card copy for a protocol change points at a plugin update, not a login', () => {
  // The wording is part of the contract, so it is asserted as text: the strings
  // ship in the bundle, and a rewording that sends the user to re-authenticate
  // is the regression issue 10 named.
  for (const key of ['row.protocolChanged', 'row.refreshStale', 'row.refreshFailed', 'row.refreshed']) {
    assert.ok(BUNDLE.includes(key), `the card lost the ${key} string`)
  }
  const strings = [...BUNDLE.matchAll(/"row\.protocolChanged":\s*"([^"]*)"/g)].map((m) => m[1])
  assert.ok(strings.length >= 2, `expected a zh and an en string, found ${strings.length}`)
  for (const text of strings) {
    assert.match(text, /插件|plugin/i, `copy does not mention the plugin: ${text}`)
    // The words that would send the user down the wrong path. "Sign in again
    // will not help" is deliberately allowed — it names the action in order to
    // rule it out — so the check is for it being presented AS the next step.
    assert.doesNotMatch(
      text,
      /请(先)?重新登录。$|Please (re)?sign in\.?$/,
      `copy must not END by telling the user to sign in: ${text}`,
    )
  }
})
