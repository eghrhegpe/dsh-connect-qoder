/**
 * Guard the repository's PROSE against the same disease its code tests guard
 * against: statements that outlive the facts they describe.
 *
 * Run: node --test test/docs-facts.test.js
 *
 * WHY THIS FILE EXISTS
 *
 * The card-source restore (`121d1a3`, docs/issues/17) invalidated a whole
 * generation of statements — "the sources are not in this repository", "the
 * bundle holds the card on its own", "根治仍取决于 src 入库" — and every
 * gate stayed green. The suite can only catch drift in code; nothing caught
 * drift in the prose, while the prose is exactly where this repository keeps
 * its load-bearing claims (sync constraints, cross-references, file roles). A
 * stale comment does what a hand-copied transcription did in
 * model-row.test.js: it asserts a rule nobody still has to follow, confidently.
 *
 * So this file is the prose gate. It enforces one layout rule while it is
 * here: docs/KNOWN_GAPS.md is the single source for gap claims, and a live
 * file may point at a numbered item only with the item's heading quoted in
 * parentheses — a bare number rots the moment the list is edited.
 *
 * All matching runs on WHITESPACE-FLATTENED text: comments wrap, and a rule
 * that only holds on unwrapped lines would be a gate with holes in it.
 * docs/PLAN.md and docs/issues/**, docs/history/** are deliberately NOT under
 * guard: they are dated audit snapshots, kept as filed. A stale claim inside
 * a dated record is a fact about the past, not a lie about the present.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Live files: the ones whose statements are promises about THIS checkout. */
const LIVE_FILES = [
  'README.md',
  'package.json',
  'docs/KNOWN_GAPS.md',
  ...readdirSync(join(root, 'lib')).map((f) => `lib/${f}`),
  ...readdirSync(join(root, 'src', 'client')).map((f) => `src/client/${f}`),
  ...readdirSync(join(root, 'scripts')).map((f) => `scripts/${f}`),
  ...readdirSync(join(root, 'test'))
    .filter((f) => f.endsWith('.test.js') && f !== 'docs-facts.test.js')
    .map((f) => `test/${f}`),
]

const read = (rel) => readFileSync(join(root, rel), 'utf8')
/** Flatten so wrapped comments match the same as single-line prose. */
const flat = (rel) => read(rel).replace(/\s+/g, ' ')

/**
 * Statements that were true before the client-source restore and are false
 * now. Each new fossil found in review gets appended here the way a
 * regression test gets appended — this list only ever grows by evidence.
 */
const FOSSILS = [
  [/sources? not in this repository/i, 'src/client/*.ts is in the repository since the restore (issue 17)'],
  [/held the card.s code on its own|the only copy of the card/i, 'the card has buildable sources (scripts/build-client.mjs)'],
  [/由 5 个 从不提交的 TypeScript|从不提交的 TypeScript/, 'the client sources are committed'],
  [/根治仍取决于.*入库/, 'src/client was restored and committed (121d1a3)'],
  [/价值最高的一条待办/, 'that 待办 is done; do not re-file it as open'],
]

/**
 * Phrases that must never come back, because the tests already proved the
 * disease they name: a numeric fact copied out of a live file instead of
 * read from it, or a cross-reference whose target is a bare number.
 */
const FORBIDDEN = [
  [/# pass \d+/, 'hardcoded test counts drift; quote "# fail 0" or nothing'],
  [/KNOWN_GAPS\.md.{0,40}?第 \d+ 条(?![（(])/, 'a 第 N 条 reference must quote its target: 第 N 条（标题…）'],
  [/KNOWN_GAPS\.md.{0,40}?item \d+(?![（(])/, 'an "item N" reference must quote its target: item N（标题…）'],
]

for (const rel of LIVE_FILES) {
  test(`no fossil claims in ${rel}`, () => {
    const text = flat(rel)
    for (const [re, why] of [...FOSSILS, ...FORBIDDEN]) {
      const m = re.exec(text)
      assert.equal(m, null, `${rel}: found "${(m?.[0] ?? '').trim().slice(0, 70)}" — ${why}`)
    }
  })
}

/** Parse KNOWN_GAPS.md's `## N. Title` list into { number → heading }. */
function gapsSections() {
  const map = new Map()
  // `\r?\n` tolerates both LF and CRLF checkouts: the CI matrix spans ubuntu
  // (LF) and windows-latest, where the runner's `core.autocrlf=true` can
  // hand the test a CRLF working tree unless .gitattributes pins `eol=lf`.
  for (const line of read('docs/KNOWN_GAPS.md').split(/\r?\n/)) {
    const m = /^## (\d+)\.\s*(.+?)\r?$/.exec(line)
    if (m !== null) map.set(Number(m[1]), m[2].trim())
  }
  return map
}

test('every topic-qualified gap reference anywhere in a live file names a real section and quotes its heading', () => {
  const sections = gapsSections()
  assert.ok(sections.size >= 7, 'the numbered gap list must not be collapsed or unnumbered')
  let checked = 0
  for (const rel of LIVE_FILES) {
    if (rel === 'docs/KNOWN_GAPS.md') continue
    // The proximity to a "KNOWN_GAPS.md" mention is irrelevant: any 第 N 条（topic）/
    // item N（topic） qualified reference in a live file is a gap-register pointer,
    // and it must hold up against the current headings no matter how far away
    // the filename is. (Qualified topics must use fullwidth （）, by convention.)
    const re = /(?:第 (\d+) 条|item (\d+))（([^）]{1,40})）/g
    for (const m of flat(rel).matchAll(re)) {
      checked += 1
      const num = Number(m[1] ?? m[2])
      const heading = sections.get(num)
      assert.ok(heading !== undefined, `${rel}: KNOWN_GAPS item ${num} does not exist`)
      assert.ok(
        heading.includes(m[3].trim()),
        `${rel}: reference "第 ${num} 条（${m[3].trim()}）" no longer matches the heading "${heading}"`,
      )
    }
  }
  // Zero matches would mean someone deleted the parentheticals — which is
  // the exact fossil the FORBIDDEN patterns above catch. Belt and braces.
  assert.ok(checked > 0, 'no topic-qualified gap reference found in any live file')
})

/** The README 目录 section, up to the next `## ` heading. */
function readmeCatalog() {
  // `\r?\n` and `(?=\r?\n## )` keep the gate valid on a CRLF checkout;
  // .gitattributes pins the committed bytes to LF, so the test is correct
  // on both matrix platforms either way.
  const section = /## 目录\r?\n([\s\S]*?)(?=\r?\n## )/.exec(read('README.md'))
  assert.ok(section !== null, 'README 目录 section not found — the gate keys on that heading')
  return section[1]
}

test('every lib module and every src/client source is named in the README 目录', () => {
  const table = readmeCatalog()
  for (const f of readdirSync(join(root, 'lib'))) {
    // lib/client.js is the generated artifact; the README names it in prose.
    if (f === 'client.js') continue
    assert.ok(table.includes(f), `lib/${f} has no row in the README 目录 table`)
  }
  for (const f of readdirSync(join(root, 'src', 'client'))) {
    assert.ok(table.includes(f), `src/client/${f} has no row in the README 目录 table`)
  }
})

test('the coverage thresholds quoted in the README are the ones the script runs', () => {
  const flags = /--test-coverage-lines=(\d+) .*--test-coverage-branches=(\d+) .*--test-coverage-functions=(\d+)/.exec(
    read('package.json'),
  )
  assert.ok(flags !== null, 'package.json lost its coverage thresholds')
  const readme = /门槛[（(]行 (\d+) \/ 分支 (\d+) \/ 函数 (\d+)/.exec(read('README.md'))
  assert.ok(readme !== null, 'the README no longer states the thresholds — restate or delete, do not let it drift')
  assert.deepEqual(readme.slice(1).map(Number), flags.slice(1).map(Number))
})

test('package.json points every self-referential URL at the repository it declares', () => {
  const pkg = JSON.parse(read('package.json'))
  const owner = new URL(pkg.repository.url.replace(/^git\+/, '')).pathname.split('/')[1]
  for (const url of [pkg.homepage, pkg.bugs.url]) {
    assert.equal(new URL(url).pathname.split('/')[1], owner, `${url} is not under ${owner} (fork leftover)`)
  }
})
