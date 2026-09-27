/**
 * Tests for the deployment-drift comparison.
 *
 * Run: node --test test/deploy-drift.test.js
 *
 * The script exists because a deployed copy of this plugin silently fell behind
 * the checkout while reporting the same version number — no test can run
 * against a real profile from inside the suite, so what is tested is the
 * comparison itself: given a fake checkout and a fake install, which shapes
 * count as in sync, which count as drift, and whether the version trap is
 * reported rather than hidden.
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { MARKERS, compareInstall, hashFile, profilesIn } from '../scripts/check-deploy-drift.mjs'

/** The three marker files, in the shape MARKERS describes. */
const CLIENT = `function offPeakState(model) {
  const promo = model.promotion;
  if (promo === null || typeof promo !== "object") return undefined;
  if (promo.active !== true) return undefined;
  return { active: true };
}`
const ACCOUNT_STATE = `export function readAccountState() { return 'ok' }`
const INDEX = `const path = '/plugins/dsh-connect-qoder/account';\nexport { path }`

const temporaries = []

/** A fake checkout containing the marker files. */
function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'qoder-drift-repo-'))
  temporaries.push(root)
  mkdirSync(join(root, 'lib'), { recursive: true })
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.2.0' }))
  writeFileSync(join(root, 'lib', 'client.js'), CLIENT)
  writeFileSync(join(root, 'lib', 'account-state.js'), ACCOUNT_STATE)
  writeFileSync(join(root, 'lib', 'index.js'), INDEX)
  return root
}

/** A deployed copy of that checkout, optionally damaged first. */
function makeInstall(repoRoot, damage = () => {}) {
  const install = mkdtempSync(join(tmpdir(), 'qoder-drift-install-'))
  temporaries.push(install)
  cpSync(join(repoRoot, 'lib'), join(install, 'lib'), { recursive: true })
  cpSync(join(repoRoot, 'package.json'), join(install, 'package.json'))
  damage(install)
  return install
}

after(() => {
  for (const dir of temporaries) rmSync(dir, { recursive: true, force: true })
})

test('a byte-identical install is in sync', () => {
  const repo = makeRepo()
  const install = makeInstall(repo)
  const report = compareInstall({ repoRoot: repo, installRoot: install })
  assert.strictEqual(report.kind, 'sync')
  assert.deepStrictEqual(report.differences, [])
})

test('a changed file is drift, and the version trap is reported not hidden', () => {
  const repo = makeRepo()
  const install = makeInstall(repo, (dir) => {
    writeFileSync(join(dir, 'lib', 'client.js'), '// rewritten by a hand hotfix\n')
  })
  const report = compareInstall({ repoRoot: repo, installRoot: install })
  assert.strictEqual(report.kind, 'drift')
  assert.ok(report.differences.some((d) => d.kind === 'changed' && d.file === 'lib/client.js'))
  // The whole reason drift goes unnoticed: both sides claim 0.2.0, so any
  // upgrade path keying on version concludes there is nothing to do.
  assert.strictEqual(report.sameVersion, true)
})

test('a deploy that lost a marker file is called out by what it lost', () => {
  const repo = makeRepo()
  const install = makeInstall(repo, (dir) => {
    rmSync(join(dir, 'lib', 'account-state.js'))
    // Keep client.js present but strip the gate — the shape the real deploy had.
    writeFileSync(join(dir, 'lib', 'client.js'), 'function offPeakState(model) { return { active: true } }')
  })
  const report = compareInstall({ repoRoot: repo, installRoot: install })
  assert.strictEqual(report.kind, 'drift')
  const markers = report.differences.filter((d) => d.kind === 'marker')
  assert.strictEqual(markers.length, MARKERS.length - 1, 'client.js lost its gate; account-state.js is gone; index.js still has its route')
  assert.ok(
    markers.some((d) => d.file === 'lib/client.js' && /discount/.test(d.meaning ?? '')),
    'the report must say what the missing marker means, not only that a file differs',
  )
  assert.ok(markers.some((d) => d.file === 'lib/account-state.js'))
})

test('a deploy carrying files the checkout no longer has is drift', () => {
  const repo = makeRepo()
  const install = makeInstall(repo, (dir) => {
    writeFileSync(join(dir, 'lib', 'client.js.bak-hotfix'), 'an old hand-patched snapshot\n')
  })
  const report = compareInstall({ repoRoot: repo, installRoot: install })
  assert.strictEqual(report.kind, 'drift')
  assert.ok(report.differences.some((d) => d.kind === 'extra' && d.file === 'lib/client.js.bak-hotfix'))
})

test('a symlink into this checkout is in sync by construction', (t) => {
  const repo = makeRepo()
  const installRoot = join(mkdtempSync(join(tmpdir(), 'qoder-drift-link-')), 'dsh-connect-qoder')
  temporaries.push(dirname(installRoot))
  try {
    symlinkSync(repo, installRoot, 'junction')
  } catch {
    t.skip('symlinks unavailable on this machine')
    return
  }
  const report = compareInstall({ repoRoot: repo, installRoot })
  assert.strictEqual(report.kind, 'link')
  assert.strictEqual(report.linkMatchesRepo, true)
})

test('a symlink into ANOTHER checkout is drift, not safety', (t) => {
  const repo = makeRepo()
  const other = makeRepo()
  const installRoot = join(mkdtempSync(join(tmpdir(), 'qoder-drift-link-')), 'dsh-connect-qoder')
  temporaries.push(dirname(installRoot))
  try {
    symlinkSync(other, installRoot, 'junction')
  } catch {
    t.skip('symlinks unavailable on this machine')
    return
  }
  const report = compareInstall({ repoRoot: repo, installRoot })
  assert.strictEqual(report.kind, 'drift')
})

test('profilesIn reads the profile directories and tolerates a missing home', () => {
  const home = mkdtempSync(join(tmpdir(), 'qoder-drift-home-'))
  temporaries.push(home)
  assert.deepStrictEqual(profilesIn(home), [], 'a home with no profiles is not an error')
  mkdirSync(join(home, 'profiles', 'desktop'), { recursive: true })
  mkdirSync(join(home, 'profiles', 'web'), { recursive: true })
  assert.deepStrictEqual(
    profilesIn(home).map((p) => p.split(/[\\/]/).pop()),
    ['desktop', 'web'],
  )
})

test('hashFile answers undefined rather than throwing for a missing file', () => {
  assert.strictEqual(hashFile(join(tmpdir(), 'definitely-not-here-42')), undefined)
})
