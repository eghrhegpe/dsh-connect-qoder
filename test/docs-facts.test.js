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
 * AGENTS.md IS under guard, unlike those archives: it is not a record of what
 * was decided, it is the operating manual the next agent follows, and a
 * manual that still says "we are migrating to .tsx" after the migration ended
 * sends the next reader to work that is already done.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, normalize, sep } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Every file under `src/<area>/`, including nested directories, as
 * `<area>/<relative path>` strings. `src/host/upstream.ts` was split into
 * `src/host/upstream/*.ts` (docs/issues/22), so a flat `readdirSync` would
 * both miss the leaves and hand `readFileSync` a directory.
 */
function sourceFiles(area) {
  const out = []
  const walk = (rel) => {
    for (const entry of readdirSync(join(root, 'src', area, rel), { withFileTypes: true })) {
      const next = rel === '' ? entry.name : `${rel}/${entry.name}`
      if (entry.isDirectory()) walk(next)
      else out.push(`src/${area}/${next}`)
    }
  }
  walk('')
  return out
}

/** Live files: the ones whose statements are promises about THIS checkout. */
const LIVE_FILES = [
  'README.md',
  // `AGENTS.md` is the first file the next agent reads, so a drift in it is
  // the most expensive kind: it is the one nobody re-checks, because everybody
  // assumes the agent guide is maintained.
  'AGENTS.md',
  'package.json',
  'docs/KNOWN_GAPS.md',
  // `lib/` is a versioned build artifact, not a live source; the live host
  // sources are `src/host/*.ts`, so the doc-fact guard reads those instead.
  // (It is still worth guarding: the `git-ignored` wording the four files below
  // used to carry is now factually wrong, and CI's freshness gate does not read
  // prose.)
  ...sourceFiles('host'),
  ...sourceFiles('client'),
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
  [
    /`?lib\/`?[^.\n]{0,40}?git-ignored|is git-ignored|lib\/ is a pure build artifact/i,
    '`lib/` is a VERSIONED build artifact since docs/issues/19: committing it is what makes a `github:` source install work, and CI (`.github/workflows/test.yml`) diffs a fresh build against the committed bytes. "git-ignored" describes the layout that was reverted.',
  ],
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
  [/\d+ 个测试文件/, 'a hardcoded test-file count drifts; point at the command output instead'],
  [/\d+ 条错误/, 'a hardcoded type-error count drifts; point at the command output instead'],
  [/\(budget \d+\)/, 'a hardcoded budget drifts; the ceilings live in scripts/ratchet-ledger.json'],
  [/\(floor \d+\)/, 'a hardcoded ratchet floor drifts; the floors live in scripts/ratchet-ledger.json'],
  [/下限是 \d+/, 'a hardcoded ratchet floor drifts; the floors live in scripts/ratchet-ledger.json'],
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

test('every host module and every src/client source is named in the README 目录', () => {
  const table = readmeCatalog()
  for (const f of readdirSync(join(root, 'src', 'host'))) {
    assert.ok(table.includes(f), `src/host/${f} has no row in the README 目录 table`)
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

/**
 * The README's verify table and `package.json`'s verify chain must be the
 * same list.
 *
 * WHY: the chain grew steps (the two any audits, the market-entry check)
 * while the README kept calling itself "seven things" and listing seven
 * rows. A reader who trusts the table skips a gate; a reader who trusts the
 * chain reads a table that lies. Neither is visible from the outside, so
 * the two lists are compared here instead of being kept in sync by hand.
 *
 * The table is found through the `<!-- verify-steps -->` marker, and each
 * row's first backticked token is the script name (`npm run audit:any` in
 * package.json is `audit:any` in the table).
 */
test('the README lists exactly the steps npm run verify runs', () => {
  const pkg = JSON.parse(read('package.json'))
  const chainText = /** @type {string} */ (pkg.scripts.verify)
  const chain = chainText
    .split('&&')
    .map((step) => step.trim().replace(/^npm (?:run )?/, ''))
  const readme = read('README.md')
  const marker = '<!-- verify-steps -->'
  const at = readme.indexOf(marker)
  assert.notEqual(at, -1, 'the README must keep the <!-- verify-steps --> marker in front of the verify table')
  const rows = []
  for (const line of readme.slice(at + marker.length).split(/\r?\n/)) {
    const m = /^\|\s*`([^`]+)`/.exec(line)
    if (m === null) {
      if (rows.length > 0) break // the table ended at the first line that is not a row
      continue // the marker is followed by the table header, which is not a step row
    }
    rows.push(m[1])
  }
  assert.ok(rows.length > 0, 'the verify table must list at least one step')
  assert.deepEqual(
    [...rows].sort(),
    [...chain].sort(),
    `the README verify table must list exactly the steps package.json runs (table: ${rows.join(', ')})`,
  )
})

test('the live docs point at the ratchet ledger that holds the thresholds', () => {
  for (const rel of ['README.md', 'AGENTS.md', 'docs/KNOWN_GAPS.md']) {
    assert.ok(
      read(rel).includes('scripts/ratchet-ledger.json'),
      `${rel} must point at scripts/ratchet-ledger.json — that is where the thresholds live now`,
    )
  }
})

/**
 * Images referenced by the repository's own prose, resolved against THIS
 * checkout.
 *
 * WHY: an `![](assets/x.png)` whose file was renamed or never committed
 * renders as an empty frame and nothing goes red — the same silent-failure
 * shape the code gates were built for, moved into the docs. `screenshots.json`
 * is worse: the market reads it to build the plugin's detail page, so a stale
 * entry drops a screenshot from a published listing with no error anywhere.
 *
 * Both sources are checked the same way, because they are two views of the
 * same asset set: a file must exist on disk and hold bytes. Only presence and
 * non-emptiness are asserted — matching image *pixels* or alt text would make
 * every screenshot refresh a test edit.
 */
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|svg)$/i
/** A remote reference is the author's call; a local one is this checkout's promise. */
const isRemote = (ref) => /^(https?:)?\/\//i.test(ref) || ref.startsWith('data:')

/** Resolve a repo-relative reference, refusing paths that climb out of the repo. */
function repoPath(ref, where) {
  const rel = normalize(ref.replace(/^\.\//, ''))
  assert.ok(
    !rel.startsWith('..') && !rel.includes(`..${sep}`) && !rel.match(/^([a-zA-Z]:|[\\/])/),
    `${where} points outside the repository: ${ref}`,
  )
  return join(root, rel)
}

function assertAssetExists(ref, where) {
  const abs = repoPath(ref, where)
  const stat = statSync(abs, { throwIfNoEntry: false })
  assert.ok(stat !== undefined, `${where} references ${ref}, which does not exist on disk`)
  assert.ok(stat.isFile(), `${where} references ${ref}, which is not a regular file`)
  assert.ok(stat.size > 0, `${where} references ${ref}, which is empty`)
}

test('every screenshots.json entry is a real, non-empty image in this checkout', () => {
  const declared = JSON.parse(read('screenshots.json'))
  assert.ok(Array.isArray(declared), 'screenshots.json must be an array of paths (or {"screenshots": [...]})')
  // awesomedsh (contributing.md, "Screenshots"): 1–8 entries; more are ignored
  // and zero means the market falls back to scraping the README.
  assert.ok(declared.length >= 1 && declared.length <= 8, `screenshots.json has ${declared.length} entries; the market shows 1–8`)

  const seen = new Set()
  for (const ref of declared) {
    assert.equal(typeof ref, 'string', `screenshots.json entry is not a string: ${JSON.stringify(ref)}`)
    assert.ok(isRemote(ref) || IMAGE_EXT.test(ref), `screenshots.json entry is not an image: ${ref}`)
    assert.ok(!seen.has(ref), `screenshots.json lists ${ref} twice`)
    seen.add(ref)
    if (isRemote(ref)) continue // the market honours GitHub-hosted absolute URLs; not ours to stat
    assertAssetExists(ref, 'screenshots.json')
  }
})

test('every local image referenced by the README exists AND is reachable on the registry page', () => {
  const readme = read('README.md')
  // Markdown images and raw <img> tags are both used in this README; the rule
  // has to cover whichever form the next edit picks.
  /** @type {string[]} */
  const refs = [
    ...[...readme.matchAll(/!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)].map((m) => /** @type {string} */ (m[1])),
    ...[...readme.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map((m) => /** @type {string} */ (m[1])),
  ].filter((ref) => !ref.startsWith('#'))
  const local = refs.filter((ref) => !isRemote(ref))

  // 2026-10-21: this gate used to demand `local.length > 0`, and that is what
  // kept the ONE local image alive — `assets/qoder-usage-capsule.png`, which was
  // a BROKEN image on the npm page because `assets/` is not in `files`. The
  // promise worth guarding is "the README still shows its screenshots", not
  // "the README uses a path npm cannot serve". So: count every image form, hold
  // local ones to the checkout, and hold them to whether npm actually ships them.
  assert.ok(refs.length > 0, 'the README lost every image — the registry page would show a text-only listing')
  for (const ref of local) assertAssetExists(decodeURI(ref), 'README.md')

  /** @type {string[]} */
  const files = JSON.parse(read('package.json')).files ?? []
  const shipsAssets = files.some((entry) => entry.replace(/^\.\//, '').replace(/\/$/, '') === 'assets')
  if (!shipsAssets) {
    const unreachable = local.filter((ref) => /^(\.\/)?assets\//.test(decodeURI(ref)))
    assert.deepEqual(
      unreachable,
      [],
      `package.json 的 files 不含 assets/，README 里用相对路径引用的 ${unreachable.join(', ')} 在 registry 页面上是裂图——` +
        '改成 raw.githubusercontent.com 绝对地址（本仓既有策略），或把 assets 加进 files',
    )
  }
})
