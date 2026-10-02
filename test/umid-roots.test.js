/**
 * Pin `umidRootsFor` to the ENUMERATED version-directory layout.
 *
 * Run: node --test test/umid-roots.test.js
 *
 * WHY THIS FILE EXISTS
 *
 * `umidRootsFor` used to pin `0.4.3` — the measured value of the day it was
 * written. A pinned list stops matching the moment upstream ships the next
 * desktop version, and the umid machine identity (the one the international
 * edition's daily check-in gates on, KNOWN_GAPS §8) would silently degrade to
 * the launcher-tree fallback. The 2026-10-03 fix enumerates the
 * `.qoder-versions` directory instead: only directory entries become
 * candidates (the measured layout carries sibling MARKER FILES such as
 * `0.4.3.qoder-update-ready.json`), the order is numeric-newest-first
 * (`0.4.10` must beat `0.4.9` — a lexicographic sort is exactly the bug this
 * fix exists to avoid), and an absent or unreadable directory degrades to the
 * launcher-tree root rather than failing.
 *
 * The test points `LOCALAPPDATA` at a temp tree it builds, so it is
 * deterministic on any machine and never touches the real install.
 */
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { umidRootsFor } = await import('../src/host/upstream.ts')

const GLOBAL = { id: 'qoder', displayName: 'Qoder' }
const CN = { id: 'qoder-cn', displayName: 'Qoder CN' }

let root
let savedAppData

beforeEach(() => {
  savedAppData = process.env.LOCALAPPDATA
  root = mkdtempSync(join(tmpdir(), 'umid-roots-'))
  process.env.LOCALAPPDATA = root
})

afterEach(() => {
  if (savedAppData === undefined) delete process.env.LOCALAPPDATA
  else process.env.LOCALAPPDATA = savedAppData
  rmSync(root, { recursive: true, force: true })
})

/** Create `<root>\Programs\<tree>\.qoder-versions\<name>` for each name. */
function makeVersions(tree, names) {
  const dir = join(root, 'Programs', tree, '.qoder-versions')
  mkdirSync(dir, { recursive: true })
  for (const name of names) mkdirSync(join(dir, name), { recursive: true })
}

test('version roots are enumerated newest-first, numerically per part', () => {
  makeVersions('Qoder', ['0.4.3', '0.4.4', '0.4.10', '0.4.9'])
  const roots = umidRootsFor(GLOBAL)
  const versioned = roots.filter((r) => r.includes('.qoder-versions'))
  assert.deepStrictEqual(
    versioned,
    [
      join(root, 'Programs', 'Qoder', '.qoder-versions', '0.4.10'),
      join(root, 'Programs', 'Qoder', '.qoder-versions', '0.4.9'),
      join(root, 'Programs', 'Qoder', '.qoder-versions', '0.4.4'),
      join(root, 'Programs', 'Qoder', '.qoder-versions', '0.4.3'),
    ],
    '0.4.10 must beat 0.4.9: the compare is numeric, not lexicographic',
  )
  // The launcher tree stays the fallback, AFTER every versioned root.
  assert.strictEqual(
    roots[roots.length - 1],
    join(root, 'Programs', 'Qoder'),
    'the thin launcher tree (shared umid binary) remains the last candidate',
  )
})

test('marker files next to the version directories are not candidates', () => {
  makeVersions('Qoder', ['0.4.3', '0.4.4'])
  // The measured 2026-10-03 layout carries this exact sibling.
  writeFileSync(join(root, 'Programs', 'Qoder', '.qoder-versions', '0.4.3.qoder-update-ready.json'), '{}')
  const roots = umidRootsFor(GLOBAL)
  assert.ok(!roots.some((r) => r.includes('update-ready')), 'a .json marker file must not become a root')
  assert.strictEqual(readdirSync(join(root, 'Programs', 'Qoder', '.qoder-versions')).length, 3)
  assert.strictEqual(roots.length, 3, 'two versioned roots + the launcher tree')
})

test('an absent .qoder-versions degrades to the launcher tree, without failing', () => {
  // No Programs tree at all: the enumeration must answer an empty candidate
  // list, and the launcher root still stands. This is the CI-runner /
  // fresh-machine branch — no install, no error.
  const roots = umidRootsFor(GLOBAL)
  assert.deepStrictEqual(roots, [join(root, 'Programs', 'Qoder')])
})

test('the CN region appends its own tree, enumerated the same way', () => {
  makeVersions('Qoder', ['0.4.3'])
  makeVersions('QoderCN', ['0.1.2', '0.1.10'])
  const roots = umidRootsFor(CN)
  // The CN block is the two versioned roots (newest first) then the CN launcher
  // tree: …, 0.1.10, 0.1.2, QoderCN.
  assert.strictEqual(
    roots[roots.length - 3],
    join(root, 'Programs', 'QoderCN', '.qoder-versions', '0.1.10'),
    'the CN versioned roots are numeric-newest-first too',
  )
  assert.strictEqual(roots[roots.length - 2], join(root, 'Programs', 'QoderCN', '.qoder-versions', '0.1.2'))
  assert.strictEqual(roots[roots.length - 1], join(root, 'Programs', 'QoderCN'))
  // The global tree is still there, before the CN one.
  assert.ok(roots.includes(join(root, 'Programs', 'Qoder')))
})

test('no LOCALAPPDATA answers no roots', () => {
  // `delete`, not an assignment: assigning the value `undefined` makes Node
  // store the string "undefined" in the environment, which the module would
  // happily join into a path.
  delete process.env.LOCALAPPDATA
  assert.deepStrictEqual(umidRootsFor(GLOBAL), [])
  assert.deepStrictEqual(umidRootsFor(CN), [])
})
