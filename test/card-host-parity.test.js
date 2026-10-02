/**
 * Do the card and the host ever compute a different number for the same row?
 *
 * Run: node --test test/card-host-parity.test.js
 *
 * PLAN P1-3 asked for this and it is worth being precise about what the risk
 * actually is. The card and the picker render the SAME facts in two places, so
 * every rule they share is duplicated by construction. Duplication is only a
 * problem when the two copies can disagree — and "can disagree" is not a vague
 * worry here, because the two implementations already differ:
 *
 *   host  `contextWindowIsReal`  → a label exists only when upstream published
 *                                  BOTH a non-empty `contextOptions` AND a
 *                                  positive `defaultContextWindow`
 *   card  `windowLabelOf`        → a label exists whenever `contextOptions` is
 *                                  non-empty, falling back to the widest
 *                                  offered window when the default is 0
 *
 * So for an entry with options but `defaultContextWindow === 0`, the card shows
 * a window size and the picker shows none. That state is reachable: a model
 * whose `context_config` lists windows but marks none as default.
 *
 * The fix is not to keep two implementations in step by hand. It is for the
 * card to READ the label the host already computes and ships
 * (`contextWindowLabel`), and to stop deriving one. The parity tests below are
 * what make that safe to do — they pin the states, so a future divergence on any
 * OTHER shared rule is caught here rather than by a user comparing two screens.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { normalizeEntry, projectModelRow } from '../src/host/catalog-entry.ts'
import {
  resolveContextWindow,
  contextWindowLabelFor,
  contextWindowIsReal,
  formatContextWindow,
} from '../src/host/pi-model.ts'
// The card's window-label rule, imported from the browser-free decision layer
// rather than re-transcribed. `windowLabelOf` was moved out of the React bundle
// into src/client/card-model.ts, so this parity test can assert the REAL card
// rule against the host's. The bundle-text assertions further below still guard
// the shipped artifact itself (a second copy of the arithmetic must not return).
import { windowLabelOf } from '../src/client/card-model.ts'
import { isOffPeakActive, offPeakRemaining, effectiveRate } from '../src/host/offpeak.ts'

const RATES = { rateNow: effectiveRate, offPeakActive: isOffPeakActive, offPeakRemaining }
const REGION = { id: 'qoder-cn', displayName: 'Qoder CN' }
const AT = new Date('2026-09-26T12:00:00+08:00')

/** The shipped card, read for the "no second implementation" assertions. */
const BUNDLE = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

/**
 * The card's rule, transcribed from `src/client/card.tsx` AFTER the fix.
 *
 * The old transcription is kept below as `OLD_cardWindowLabelOf` because the
 * divergence it found is a measured fact, not a story: the card used to show a
 * size wherever `contextOptions` was non-empty, while the host shows one only
 * when a default was actually marked.
 */
function cardWindowLabelOf(model, preferMax) {
  return windowLabelOf(model, preferMax)
}

const format = (tokens) => {
  const n = Number(tokens)
  if (!Number.isFinite(n) || n <= 0) return ''
  if (n >= 1000000) return `${Math.round(n / 1000000)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}K`
  return String(n)
}

/** The rule the card used to have, kept only to assert that it is gone. */
function OLD_cardWindowLabelOf(model, preferMax) {
  const options = Array.isArray(model.contextOptions) ? model.contextOptions.filter((n) => Number(n) > 0) : []
  if (options.length === 0) return ''
  const widest = Math.max(...options)
  const tokens = preferMax
    ? widest
    : Number(model.defaultContextWindow) > 0
      ? Number(model.defaultContextWindow)
      : widest
  return format(tokens)
}

/** Build a projected row, as the card receives it. */
function rowOf(catalogEntry, preferMax = false) {
  return projectModelRow(normalizeEntry(catalogEntry), REGION, AT, RATES, preferMax)
}

// --- the states a catalog can hold ----------------------------------------

const CASES = [
  {
    label: 'a normal entry with a default window',
    entry: { key: 'A', name: 'A', defaultContextWindow: 128000, contextOptions: [128000, 200000] },
  },
  {
    label: 'options but no default marked — the divergent state',
    entry: { key: 'B', name: 'B', defaultContextWindow: 0, contextOptions: [128000, 200000] },
  },
  {
    label: 'no offered windows at all',
    entry: { key: 'C', name: 'C', defaultContextWindow: 0, contextOptions: [], maxInputTokens: 32000 },
  },
  {
    label: 'a single 1M window',
    entry: { key: 'D', name: 'D', defaultContextWindow: 1000000, contextOptions: [1000000] },
  },
  {
    label: 'a default larger than every option, which is malformed but reachable',
    entry: { key: 'E', name: 'E', defaultContextWindow: 1000000, contextOptions: [128000] },
  },
]

test('the card and the host disagreed here, and no longer do', () => {
  // The measurement this file exists for, kept in both directions: the old rule
  // is asserted to still disagree (so the bug cannot silently become "we were
  // wrong about the bug"), and the new one is asserted to agree.
  const row = rowOf(CASES[1].entry)
  assert.strictEqual(
    contextWindowIsReal(normalizeEntry(CASES[1].entry)),
    false,
    'the host withholds a label when no default was marked',
  )
  assert.strictEqual(row.contextWindowLabel, '', 'so the host row carries no label')
  assert.strictEqual(
    OLD_cardWindowLabelOf(row, false),
    '200K',
    'the old card rule invented a label from the widest option — this is the divergence',
  )
  assert.strictEqual(
    cardWindowLabelOf(row, false),
    '',
    'and the card now agrees with the host',
  )
})

test('card and host agree on every state a catalog can hold', () => {
  // The standing guarantee, for both values of the toggle: whatever the card
  // would render equals what the host computed. This is the check that has to
  // hold for any shared rule added later, which is why it is a loop over states
  // rather than a single case.
  for (const { label, entry } of CASES) {
    for (const preferMax of [false, true]) {
      const row = rowOf(entry, preferMax)
      const hostLabel = projectModelRow(
        normalizeEntry(entry),
        REGION,
        AT,
        RATES,
        preferMax,
      ).contextWindowLabel
      assert.strictEqual(
        cardWindowLabelOf(row, preferMax),
        hostLabel,
        `${label} (preferMax=${preferMax}): the card must render what the host computed`,
      )
    }
  }
})

test('the host decides the label, from upstream-published values only', () => {
  for (const { label, entry } of CASES) {
    const normalized = normalizeEntry(entry)
    const expected = contextWindowIsReal(normalized)
      ? formatContextWindow(resolveContextWindow(normalized, false))
      : ''
    assert.strictEqual(
      contextWindowLabelFor(normalized, false),
      expected,
      `${label}: the label must be the resolved window, or nothing at all`,
    )
  }
})

test('the label follows the maximum-context switch, in both places it is computed', () => {
  const entry = normalizeEntry(CASES[0].entry)
  assert.strictEqual(contextWindowLabelFor(entry, false), '128K')
  assert.strictEqual(contextWindowLabelFor(entry, true), '200K')
  // And the row the card receives carries the switched value, so a card that
  // reads the field cannot disagree with the picker after a toggle.
  const row = rowOf(CASES[0].entry, true)
  assert.strictEqual(row.contextWindowLabel, '200K')
  assert.strictEqual(row.contextWindow, resolveContextWindow(normalizeEntry(CASES[0].entry), true))
})

test('a fallback number is never presented as an offered window', () => {
  // `resolveContextWindow` falls back to `max_input_tokens` and then to a
  // built-in constant. Those are real numbers the request uses, but they are
  // not windows Qoder offered, so a LABEL must not claim otherwise. This is the
  // case the card's `options.length === 0` guard gets right and the host gets
  // right for a different reason.
  const fallback = normalizeEntry(CASES[2].entry)
  assert.strictEqual(contextWindowIsReal(fallback), false)
  assert.strictEqual(contextWindowLabelFor(fallback, true), '')
  assert.ok(resolveContextWindow(fallback, true) > 0, 'the wire value still exists — it is just not a choice')
})

test('the shipped row carries both the label and the raw ingredients', () => {
  // The card needs the raw `contextOptions` for its per-row switch tooltip, and
  // the label for display. Sending one without the other is what left the card
  // computing its own — so both halves are asserted, not just the label.
  const row = rowOf(CASES[0].entry)
  assert.deepStrictEqual(row.contextOptions, [128000, 200000])
  assert.strictEqual(row.defaultContextWindow, 128000)
  assert.strictEqual(row.contextWindowLabel, '128K')
  assert.strictEqual(row.contextWindow, 128000)
})

test('the shipped bundle no longer carries a second copy of the arithmetic', () => {
  // PLAN P1-3's second acceptance criterion: "产物中不再出现第二份窗口算术".
  // The old rule read as a nested ternary picking between the widest and the
  // default, and that shape is what made the divergence possible in the first
  // place — the two copies differed by exactly the fallback branch. Asserting
  // on the ABSENCE of that shape is what stops a future edit from quietly
  // reintroducing a second implementation while the parity tests still pass
  // (they test the rule, not the text).
  const bundle = BUNDLE
  assert.doesNotMatch(
    bundle,
    /preferMax \? widest :/,
    'the card is computing a window again — read contextWindowLabel from the host instead',
  )
  assert.doesNotMatch(
    bundle,
    /Number\(model\.defaultContextWindow\) > 0 \? Number\(model\.defaultContextWindow\) : widest/,
    'the old default-or-widest fallback is back in the bundle',
  )
  // And what replaced it must actually read the host's field, or the tests above
  // would pass on a transcription that ships as something else.
  const source = extractFromBundle('windowLabelOf')
  assert.ok(source !== null, 'could not extract `windowLabelOf` from lib/client.js')
  assert.match(
    source,
    /contextWindowLabel/,
    'windowLabelOf must read the host-computed label',
  )
  assert.match(
    source,
    /defaultContextWindow\) > 0/,
    'and it must keep the host rule that a default has to exist before labelling',
  )
})

/** Pull one function out of the bundle by name, walking braces. */
function extractFromBundle(name) {
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
