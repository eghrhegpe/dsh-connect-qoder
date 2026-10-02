/**
 * Position gate #2 — the README 目录 table for `src/client/` must list EXACTLY
 * the files that exist. Not a superset, not a subset.
 *
 * Run: node --test test/registration-consistency.test.js
 *
 * WHY THIS GATE (distinct from `docs-facts.test.js`)
 *
 * `docs-facts.test.js` checks the one-way invariant "every src/client file is
 * named in the table". That catches a missing row — but it does NOT catch the
 * mirror failure: a row that names a file we deleted, or a row whose description
 * no longer matches what the file now is. After the card was split into
 * `account-panel.tsx` / `usage-panel.tsx` / `http.ts` with `card.tsx` demoted
 * to an assembly layer, the table that listed `card.tsx` as "the six components"
 * would be wrong even though the file still exists.
 *
 * This gate closes that gap: it reads the table, extracts every `src/client/`
 * path it claims, and asserts the SET equals the set of files actually on disk.
 * A drift in either direction — an orphan row, or a real file left unlisted —
 * turns this red, so the prose and the tree cannot quietly disagree.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(join(root, rel), 'utf8')

test('README 目录 lists exactly the src/client files that exist', () => {
  const readme = read('README.md')
  const section = /## 目录\r?\n([\s\S]*?)(?=\r?\n## )/.exec(readme)
  assert.ok(section !== null, 'README 目录 section not found')

  const listed = new Set()
  // Scan only table rows (`| ... |`), not the section prose — a sentence like
  // "向 sensenova `snapshot.ts` 对齐" mentions a file without listing it, and
  // must not count as a claimed client file. The name class allows an embedded
  // dot (`react-shim.d.ts`), and both a full-path and a bare-name form are
  // accepted so the copy-* row (names inline, no `src/client/` prefix) resolves.
  // The actual client files, against which every claimed token is resolved — a
  // bare `foo.ts` in a row is only a claimed client file when `src/client/foo.ts`
  // exists. This keeps host-file mentions (e.g. a row citing `adapter.ts`) from
  // being mistaken for client files.
  const actual = new Set(readdirSync(join(root, 'src', 'client')).map((f) => `src/client/${f}`))
  const NAME = String.raw`[A-Za-z0-9_\-]+(?:\.[A-Za-z0-9_\-]+)*\.(?:tsx|ts)`
  for (const line of section[1].split('\n')) {
    if (!/^\s*\|/.test(line)) continue
    // Full-path form: `src/client/foo.ts` — claim it directly.
    for (const m of line.matchAll(new RegExp(`src/client/(${NAME})`, 'g'))) {
      listed.add(`src/client/${m[1]}`)
    }
    // Bare form: a `foo.ts` token in the cell, resolved only if that client file
    // exists (the copy-* row names them this way).
    for (const m of line.matchAll(/(?:^|\s|`)([A-Za-z0-9_\-]+(?:\.[A-Za-z0-9_\-]+)*\.(?:tsx|ts))(?=\s|`|\||$)/g)) {
      const candidate = `src/client/${m[1]}`
      if (actual.has(candidate)) listed.add(candidate)
    }
  }

  // Every file on disk is claimed — the one-way half `docs-facts` also enforces.
  for (const f of actual) {
    assert.ok(listed.has(f), `${f} exists but is not claimed by the README 目录 table`)
  }
  // No row names a file that is not on disk — the mirror half this gate owns.
  for (const f of listed) {
    assert.ok(actual.has(f), `${f} is claimed by the README 目录 table but does not exist in src/client/`)
  }
})

test('the split architecture is reflected: assembly layer + two containers + http consolidation', () => {
  const readme = read('README.md')
  // The three new files from the sensenova-style split must each have a row.
  for (const f of ['src/client/http.ts', 'src/client/usage-panel.tsx', 'src/client/account-panel.tsx']) {
    assert.ok(readme.includes(f), `the split must be documented: ${f} has no README 目录 row`)
  }
  // `card.tsx` must no longer be described as owning all six components — it is
  // the assembly layer now. A stale "六个组件" claim would mean the README drifted
  // from the actual split.
  const cardRow = /`src\/client\/card\.tsx` \| ([^|\n]+)/.exec(readme)
  assert.ok(cardRow !== null, 'src/client/card.tsx row missing')
  assert.ok(!/六个组件/.test(cardRow[1]), 'src/client/card.tsx is no longer the six-component file; update its README row')
})
