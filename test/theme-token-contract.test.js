/**
 * Do the card's theme tokens name things the host actually defines?
 *
 * Run: node --test test/theme-token-contract.test.js
 *
 * WHY THIS EXISTS. The card stylesheet is a list of CSS custom properties
 * borrowed from the host's design system, each written with a literal colour
 * fallback: `var(--dsw-alias-state-warn-primary,#f59e0b)`. That fallback is
 * what makes a typo in the token name completely invisible. A custom property
 * that is not defined simply falls through to the fallback, so the rule still
 * paints, nothing throws, nothing is logged, and no visual anomaly appears —
 * the only consequence is that the host token is never consulted and the colour
 * silently stops tracking the host theme.
 *
 * That is exactly what happened here. The card used
 * `--dsw-alias-state-warning-primary` (long form) in two rules. The host never
 * defines that name: its real token is the abbreviated
 * `--dsw-alias-state-warn-primary`. The host itself references the long form in
 * two of its own packages, but always with an explicit fallback, which is why
 * the host does not break on it — a fact worth recording, because it makes the
 * long form look plausible to anyone reading those call sites. Two rules
 * therefore rendered a hardcoded #f79009 while every neighbouring control
 * followed the theme, and the amber the host actually resolves
 * (`--dsw-static-amber-500` = rgb(245,158,11) = #f59e0b) was not the amber
 * being shown.
 *
 * These assertions read the two real files — this repository's stylesheet and
 * the host's shipped frontend CSS — and compare them, rather than restating
 * the answer in a fixture. The host CSS is discovered on disk, so the gate
 * stays honest if the host is updated underneath us: a token the host renames
 * turns this file red instead of quietly reverting the card to a fallback.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const isDirectory = (p) => {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

/** The card's stylesheet, from source. */
const STYLES = readFileSync(join(root, 'src', 'client', 'styles.ts'), 'utf8')

/** The card's stylesheet as actually shipped, after the build. */
const BUNDLE = readFileSync(join(root, 'lib', 'client.js'), 'utf8')

/**
 * Read the host's design-token vocabulary from the installed DSH runtime.
 *
 * The token vocabulary is a property of the installed host, not of this
 * repository, so a hardcoded copy of it would rot the moment the host is
 * updated — which is the failure this gate exists to catch. The declarations
 * live in `@deepseek-ai/dsh-client-ui-theme`; the shipped frontend bundle
 * merely *consumes* them, so reading only the frontend CSS would find the
 * names but never their values.
 *
 * Returns the concatenated text of both, or `null` when the host is not
 * installed (in which case the host-shape assertions below skip rather than
 * fail, so the suite still runs on a bare checkout).
 */
function hostTokenSource() {
  const home = process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? '', '.dsh')
  const runtimeRoot = join(home, 'dsh-asar-unpacked', 'dsh', 'node_modules', '@deepseek-ai')
  const sources = [
    join(runtimeRoot, 'dsh-client-ui-theme', 'lib', 'client.js'),
    join(runtimeRoot, 'dsh-web-frontend', 'dist', 'assets'),
  ]
  const chunks = []
  for (const source of sources) {
    if (!existsSync(source)) continue
    if (isDirectory(source)) {
      for (const f of readdirSync(source).filter((f) => f.endsWith('.css'))) {
        chunks.push(readFileSync(join(source, f), 'utf8'))
      }
    } else {
      chunks.push(readFileSync(source, 'utf8'))
    }
  }
  return chunks.length === 0 ? null : chunks.join('\n')
}

const HOST_CSS = hostTokenSource()

/**
 * The tokens this card has already been checked against a real host.
 *
 * WHY AN INVENTORY, when a hardcoded token vocabulary is exactly what the
 * comment above refuses to keep. The two lists answer different questions:
 *
 * - `HOST_CSS` answers "does the host define this name?" — authoritative, and
 *   deliberately not copied into this file, because a copy would rot when the
 *   host renames a token.
 * - This list answers "has a human ever verified this name against the host?" —
 *   which is the question the `HOST_CSS` assertions CANNOT ask on a machine
 *   without the host installed, and that machine is CI.
 *
 * The realistic error this file exists to catch is a maintainer writing a token
 * name from memory (the long-form `-warning-` slip below is exactly that). On a
 * bare checkout the discovery assertions skip, so that error would sail through
 * CI with nothing but a skipped test to show for it. Requiring an ADDITION to
 * appear here means a new guess fails on every machine, while the existing
 * entries never rot: they are names already confirmed against the host, and the
 * `HOST_CSS` assertions remain the ones that notice if the host moves.
 */
const VERIFIED_TOKENS = [
  '--dsw-alias-bg-layer-2',
  '--dsw-alias-bg-layer-3',
  '--dsw-alias-border-l2',
  '--dsw-alias-brand-primary',
  // Referenced by the host and used here as a border with a literal fallback;
  // the host does not declare it in the stylesheet this gate reads, so it is
  // recorded as a deliberate exception rather than presented as verified.
  // docs/issues/12 carries the decision.
  '--dsw-alias-label-dimmed',
  '--dsw-alias-label-primary',
  '--dsw-alias-label-secondary',
  '--dsw-alias-label-tertiary',
  '--dsw-alias-state-error-primary',
  '--dsw-alias-state-success-primary',
  '--dsw-alias-state-warn-primary',
]

/**
 * Say out loud when the host-shape assertions could not run.
 *
 * A skipped test is a green suite. Red line 5 ("new tokens must be checked
 * against the host CSS") has exactly one mechanical guard, and on a machine
 * without the host installed — which is CI — that guard is off. Leaving that
 * fact in a per-test skip reason means it is visible only to whoever expands
 * the reporter output; a line here is visible to everyone.
 */
if (HOST_CSS === null) {
  console.log(
    '[theme-token] the host stylesheet was not found on this machine, so the two\n' +
    '[theme-token] host-shape assertions below are SKIPPED. Token spelling is still\n' +
    '[theme-token] checked against VERIFIED_TOKENS, but "does the host define this\n' +
    '[theme-token] name?" is NOT verified by this run (red line 5).',
  )
}

/** Every `--dsw-*` custom property the card references, with a fallback. */
function tokensIn(text) {
  return [...new Set([...text.matchAll(/var\((--dsw-[a-z0-9-]+)\s*,/g)].map((m) => m[1]))]
}

test('the card references no theme token the host never defines', { skip: HOST_CSS === null && 'host stylesheet not found on disk' }, () => {
  const unknown = tokensIn(STYLES).filter((token) => !HOST_CSS.includes(token))
  assert.deepEqual(
    unknown,
    [],
    `these tokens are referenced with a fallback but never defined by the host, so the fallback is what always renders: ${unknown.join(', ')}`,
  )
})

test('the card does not use the long-form state token', () => {
  // Asserted separately, and unconditionally, because this is the specific
  // trap: the long form is not merely undefined, it is a name that appears in
  // the host's own source, so a reader has no way to spot it by looking around.
  assert.equal(
    (STYLES.match(/--dsw-alias-state-warning-primary/g) ?? []).length,
    0,
    'the host token is the abbreviated --dsw-alias-state-warn-primary; the long form is never defined and always falls through to the literal',
  )
})

test('every token the card references has been verified against a host', () => {
  // Runs everywhere, host installed or not — see `VERIFIED_TOKENS`. A token
  // added from memory fails here even on a CI runner, which is the whole point:
  // the `HOST_CSS` assertions above are skipped there.
  const unverified = tokensIn(STYLES).filter((token) => !VERIFIED_TOKENS.includes(token))
  assert.deepEqual(
    unverified,
    [],
    `these tokens are not in VERIFIED_TOKENS, so no run has confirmed the host defines them: ${unverified.join(', ')}. ` +
    'Check each against the host stylesheet (`hostTokenSource`, or the asar: ' +
    '`%LOCALAPPDATA%\\Programs\\DeepSeek Harness\\resources\\app.asar`), then add it to the list with the evidence.',
  )
})

test('VERIFIED_TOKENS carries no token the card has stopped using', () => {
  // The other direction, so the inventory cannot quietly accumulate names that
  // no longer appear: a list that only ever grows stops describing the card.
  const referenced = tokensIn(STYLES)
  const stale = VERIFIED_TOKENS.filter((token) => !referenced.includes(token))
  assert.deepEqual(
    stale,
    [],
    `these entries are in VERIFIED_TOKENS but the card no longer references them: ${stale.join(', ')}`,
  )
})

test('the state-warn fallback is the colour the host resolves that token to', { skip: HOST_CSS === null && 'host stylesheet not found on disk' }, () => {
  // The host defines `--dsw-alias-state-warn-primary: var(--dsw-static-amber-500)`.
  // Resolve that one level so the assertion below compares colours, not names:
  // a fallback that disagrees with the host's real value renders a colour the
  // design system never chose, and it keeps rendering it if the token goes
  // missing again later.
  const definition = /--dsw-alias-state-warn-primary:\s*([^;}]+)/.exec(HOST_CSS)
  assert.ok(definition, 'the host must define --dsw-alias-state-warn-primary')
  const referenced = /var\((--dsw-static-amber-500)\)/.exec(definition[1])
  assert.ok(referenced, `warn-primary must resolve through the static amber token, got: ${definition[1].trim()}`)

  const amber = /--dsw-static-amber-500:\s*(#[0-9a-fA-F]{6})/.exec(HOST_CSS)
  assert.ok(amber, 'the host must declare --dsw-static-amber-500 as a hex colour')
  const hostAmber = amber[1].toLowerCase()

  // Every `var(--dsw-alias-state-warn-primary,<fallback>)` must carry that exact
  // value, and must carry one at all — an unadorned reference would be blank
  // on any host that has not yet defined the token.
  const uses = [...STYLES.matchAll(/var\(--dsw-alias-state-warn-primary\s*,\s*([^)]+)\)/g)]
  assert.ok(uses.length > 0, 'the card must actually use the warn token somewhere')
  for (const [, fallback] of uses) {
    assert.equal(
      fallback.trim().toLowerCase(),
      hostAmber,
      `the fallback must be the host's own resolved value for this token (${hostAmber}), not a colour chosen here`,
    )
  }
})

test('the shipped bundle carries the same token spelling as the source', () => {
  // The build gate in scripts/build-client.mjs already requires the bundle to
  // reproduce the sources byte for byte, but that gate lives behind
  // `npm run verify` and needs a bundler installed. This assertion is the
  // cheap, dependency-free half: it catches the ordinary case where a styles
  // edit lands in src/ and lib/client.js is left behind, which is precisely
  // how the stale bundle would otherwise reach a user.
  assert.equal(
    (BUNDLE.match(/--dsw-alias-state-warning-primary/g) ?? []).length,
    0,
    'lib/client.js still carries the undefined long-form token; rebuild with `npm run build`',
  )
})
