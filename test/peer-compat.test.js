/**
 * The eight @deepseek-ai/dsh-* peer ranges must admit every host the plugin
 * is expected to run against, and must still refuse the NEXT generation.
 *
 * WHY HERE AND LIKE THIS
 *
 * DSH decides this itself at boot, in dsh-app-boot/lib/index.js:
 *
 *   semver.satisfies(runtimeVersion, requirement, { includePrerelease: true })
 *
 * Every @deepseek-ai/dsh-* peer that FAILS is collected and surfaces as the
 * `incompatible-version` management failure — the plugin row goes red and the
 * host refuses to touch it. Nothing in this repository noticed when the
 * desktop app moved to 0.2.0-rc.1: the eight ranges still said `<0.2`, and a
 * pre-release runtime is not a 0.1.x runtime.
 *
 * THIS FILE HAS NO semver DEPENDENCY, DELIBERATELY
 *
 * `node --test test/*.test.js` must run on a bare checkout with nothing
 * installed (see README). So instead of importing semver, this test carries
 * golden values the host itself produced and a comparator that understands
 * ONLY the range dialect this manifest actually uses: one or two comparators
 * of the form `>=X.Y.Z[-pre]` or `<X.Y.Z[-pre]`, ANDed by whitespace.
 *
 * Anything richer (^, ~, *, ||, x-ranges) throws instead of guessing. A
 * comparator that silently answers "true" for a range it cannot parse is how
 * a fake green gate gets built, and this repositories problem has exactly
 * been "the test was green because it tested its own copy".
 *
 * The golden verdicts below were produced with semver 7.8.5 using the host's
 * own options. If you change a range and this file goes red, verify against
 * the host rather than editing an expectation to agree with your edit.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url))

/**
 * Versions the plugin must keep working on, and why each one is here.
 *
 * As of 0.5.0 the plugin targets the 0.2 host line only: the 0.1.x compat
 * seams (the `installSection`/`setSource` branch, the `asVolatile` no-op,
 * the `settingsScope` client probe) are cut, so the range floor moves up
 * with them. The floor is `0.2.0-rc.0` rather than `0.2.0` because the
 * host judges ranges with `includePrerelease: true` and a stable-`0.2.0`
 * floor would reject the rc builds the field runs on — a prerelease sorts
 * BELOW its stable version.
 */
const ADMIT = [
  { version: '0.2.0-rc.0', why: 'the declared floor' },
  { version: '0.2.0-rc.2', why: 'the desktop build this checkout runs against' },
  { version: '0.2.0', why: '0.2.0 stable, once the rc lands' },
  { version: '0.2.7', why: 'later patches inside the same minor' },
]

/** Versions the range must still refuse. */
const REFUSE = [
  { version: '0.1.7', why: 'the 0.1.x line the 0.5.0 cut dropped: its ABI is no longer probed' },
  { version: '0.3.0', why: 'next minor: API changes are untested there' },
  { version: '1.0.0', why: 'next major' },
]

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(version)
  assert.ok(match, `unparseable version: ${version}`)
  return { major: +match[1], minor: +match[2], patch: +match[3], pre: match[4]?.split('.') ?? [] }
}

/** Standard semver ordering, including the "no prerelease sorts higher" rule. */
function compareVersions(left, right) {
  const a = parseVersion(left)
  const b = parseVersion(right)
  for (const field of ['major', 'minor', 'patch']) {
    if (a[field] !== b[field]) return a[field] < b[field] ? -1 : 1
  }
  if (a.pre.length === 0 && b.pre.length === 0) return 0
  if (a.pre.length === 0) return 1
  if (b.pre.length === 0) return -1
  return comparePrerelease(a.pre, b.pre)
}

/** Semver 11.4: numeric identifiers always rank below alphanumeric ones. */
function comparePrerelease(a, b) {
  const shared = Math.max(a.length, b.length)
  for (let i = 0; i < shared; i += 1) {
    if (a[i] === undefined) return -1
    if (b[i] === undefined) return 1
    const numericA = /^\d+$/.test(a[i])
    const numericB = /^\d+$/.test(b[i])
    if (numericA !== numericB) return numericA ? -1 : 1
    if (numericA) {
      if (+a[i] !== +b[i]) return +a[i] < +b[i] ? -1 : 1
    } else if (a[i] !== b[i]) {
      return a[i] < b[i] ? -1 : 1
    }
  }
  return 0
}

/**
 * What `semver.satisfies(runtime, range, { includePrerelease: true })` answers,
 * for the one range dialect this manifest uses: `>=` and `<` comparators ANDed
 * by whitespace. Anything else throws — guessing would build a green gate that
 * does not actually agree with the host.
 *
 * One subtlety carries most of the weight: a partial upper bound desugars with
 * a `-0` floor. `new semver.Range('<0.2').range` is `<0.2.0-0`, which excludes
 * every 0.2.0 pre-release — that is exactly why the old `<0.2` refused
 * 0.2.0-rc.1 instead of admitting it.
 */
function satisfies(version, range) {
  for (const ch of ['^', '~', '*', '||', 'x', 'X']) {
    assert.ok(!range.includes(ch), `range uses syntax this helper refuses to guess at: ${range}`)
  }
  const comparators = range.trim().split(/\s+/).filter(Boolean)
  assert.ok(comparators.length > 0, `empty range: ${range}`)
  for (const comparator of comparators) {
    const match = /^(>=|<)(\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?)$/.exec(comparator)
    assert.ok(match, `cannot parse comparator: ${comparator} (in ${range})`)
    const operator = match[1]
    let operand = match[2]
    if (/^\d+\.\d+$/.test(operand)) {
      assert.equal(operator, '<', `only the < operator is allowed to carry a partial bound, got ${comparator} (in ${range})`)
      operand = `${operand}.0-0`
    }
    const order = compareVersions(version, operand)
    const held = operator === '>=' ? order >= 0 : order < 0
    if (!held) return false
  }
  return true
}

/** The peers the host actually checks: only @deepseek-ai/dsh-* prefixed ones. */
function checkedPeers() {
  const manifest = JSON.parse(readFileSync(`${REPO_ROOT}package.json`, 'utf8'))
  return Object.entries(manifest.peerDependencies ?? {}).filter(([name]) => name.startsWith('@deepseek-ai/dsh-'))
}

test('every @deepseek-ai/dsh-* peer admits the host versions we run against', () => {
  const peers = checkedPeers()
  assert.equal(peers.length, 8, `expected eight host-checked peers, found ${peers.length}`)
  for (const [name, range] of peers) {
    for (const { version, why } of ADMIT) {
      assert.ok(satisfies(version, range), `${name} "${range}" rejects ${version} (${why})`)
    }
  }
})

test('widening the lid did not open the next generation', () => {
  for (const [name, range] of checkedPeers()) {
    for (const { version, why } of REFUSE) {
      assert.ok(!satisfies(version, range), `${name} "${range}" now admits ${version} (${why})`)
    }
  }
})

test('the peers outside the hosts check keep their own ranges', () => {
  // Judged against the copy the host bundles, not its own gate: the floor
  // is the 0.2 generation's bundle (cordis 4.0.4, schemastery ≥ 3.18.3).
  // The host does not block installation on these — the ranges are this
  // plugin's own contract about what it imports.
  //
  // pi-ai is the one that changed: the `^0.87.1` chosen at the 0.5.0 cut
  // refused the version every host actually bundles. Measured on this
  // machine (2026-10-03) both the desktop build and the standalone
  // `dsh` 0.2.0-rc.1 CLI ship `@earendil-works/pi-ai@0.85.1`, so a plugin
  // whose host entry imports pi-ai at module scope cannot even load —
  // and with it every loopback card route 404s (the symptom that sent
  // the 0.5.0 field down). The range spans 0.85.x through 0.87.x because
  // the two imports this plugin makes (`createProvider`,
  // `openAICompletionsApi`) both exist in 0.85.1.
  const { peerDependencies: peers } = JSON.parse(readFileSync(`${REPO_ROOT}package.json`, 'utf8'))
  assert.equal(peers['@deepseek-ai/cordis'], '>=4.0.4 <5.0.0')
  assert.equal(peers['@deepseek-ai/schemastery'], '^3.18.3')
  assert.equal(peers['@earendil-works/pi-ai'], '>=0.85.0 <0.88.0')
})

test('the pi-ai range admits what the hosts bundle and refuses the next gen', () => {
  // Golden values from semver 7.8.5 with the host's own includePrerelease:true,
  // re-measured after the 0.5.1 range fix. The admission list is what the
  // host actually ships today; the refusal list is the line the plugin has
  // never been tested on.
  const { peerDependencies: peers } = JSON.parse(readFileSync(`${REPO_ROOT}package.json`, 'utf8'))
  const range = peers['@earendil-works/pi-ai']
  for (const [version, why] of [
    ['0.85.1', 'bundled by the desktop build and the standalone dsh 0.2.0-rc.1 CLI'],
    ['0.86.0', 'the minor between the two known floors'],
    ['0.87.1', 'the version the 0.5.0 cut was validated against'],
  ]) {
    assert.ok(satisfies(version, range), `${range} rejects pi-ai ${version} (${why})`)
  }
  for (const version of ['0.84.9', '0.88.0', '1.0.0']) {
    assert.ok(!satisfies(version, range), `${range} now admits pi-ai ${version} (next generation)`)
  }
})

test('the helper and the host agree on the range the 0.5.0 cut chose', () => {
  // Golden values from semver 7.8.5 with the hosts own includePrerelease:true.
  // The 0.1.x floor is now refused on purpose: those hosts carry the
  // installSection/settingsScope ABI the 0.5.0 cut dropped.
  assert.equal(satisfies('0.1.7', '>=0.2.0-rc.0 <0.3'), false, 'the 0.1.x line must stay out after the cut')
  assert.equal(satisfies('0.2.0-rc.2', '>=0.2.0-rc.0 <0.3'), true, 'the rc builds the field runs on must come in')
  assert.equal(satisfies('0.2.0', '>=0.2.0-rc.0 <0.3'), true, 'and the stable release when it lands')
})
