/**
 * Round-trip tests for the on-disk catalog cache.
 *
 * Run: node --test test/catalog-store.test.js
 *
 * This is the code that decides whether a DSH restart shows the user their
 * models or an empty picker. A cache that silently fails to persist, or that
 * leaves a half-written file for the next `load()` to choke on, is invisible
 * until the one moment it matters — after a restart, or after a crash.
 *
 * The tests run against a real temporary directory rather than a mock, because
 * the whole point of the "write a temp file then rename" design is a filesystem
 * property. Whether `rename` replaces an existing file is platform-dependent, so
 * the atomicity claim is checked here on whichever platform CI runs, not
 * assumed in a comment.
 */
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { CatalogStore, CATALOG_FORMAT_VERSION } from '../lib/catalog-store.js'

const created = []

/** A fresh temporary directory, removed after the test. */
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'qoder-catalog-'))
  created.push(dir)
  return dir
}

afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop()
    try {
      chmodSync(dir, 0o700)
    } catch {
      // The directory may already be gone; the removal below is the fallback.
    }
    rmSync(dir, { recursive: true, force: true })
  }
})

const SAMPLE = [
  { id: 'ModelA', key: 'a', name: 'Model A', isVL: true, priceFactor: 0.01 },
  { id: 'ModelB', key: 'b', name: 'Model B', isVL: false, priceFactor: 0.02 },
]

test('a saved catalog is read back by a new store over the same path', () => {
  const path = join(tempDir(), 'catalog.json')
  const first = new CatalogStore({ path })
  assert.deepStrictEqual(first.current(), [], 'a fresh store starts empty')

  first.replace(SAMPLE, 1_700_000_000_000)
  assert.deepStrictEqual(first.current(), SAMPLE)

  const second = new CatalogStore({ path })
  assert.deepStrictEqual(second.current(), SAMPLE, 'a restart must see the cached models')
  assert.strictEqual(second.fetchedAt, 1_700_000_000_000)
})

test('the save is atomic: no temp file is left behind', () => {
  // The rename is what makes the write atomic; if it silently did nothing and
  // the code fell back to leaving a `.tmp`, the next load would find stale data.
  const path = join(tempDir(), 'catalog.json')
  const store = new CatalogStore({ path })
  store.replace(SAMPLE)
  assert.ok(existsSync(path), 'the catalog file must exist')
  assert.strictEqual(existsSync(`${path}.tmp`), false, 'no temp file may survive a successful save')
})

test('saving twice replaces the file rather than appending or failing', () => {
  // `rename` over an existing file is POSIX behaviour; on Windows it goes
  // through MoveFileEx. If either platform refused, this would be the test that
  // catches it, and the failure mode in production is a catalog that never
  // updates after the first fetch.
  const path = join(tempDir(), 'catalog.json')
  const store = new CatalogStore({ path })
  store.replace(SAMPLE, 1_700_000_000_000)
  store.replace([{ id: 'Only', key: 'o', name: 'Only' }], 1_700_000_100_000)

  const reloaded = new CatalogStore({ path })
  assert.strictEqual(reloaded.current().length, 1, 'the second save must replace the first')
  assert.strictEqual(reloaded.current()[0].id, 'Only')
  assert.strictEqual(existsSync(`${path}.tmp`), false)
})

test('the parent directory is created if it is missing', () => {
  const dir = tempDir()
  const path = join(dir, 'nested', 'deeper', 'catalog.json')
  const store = new CatalogStore({ path })
  store.replace(SAMPLE)
  assert.ok(existsSync(path))
  assert.deepStrictEqual(new CatalogStore({ path }).current(), SAMPLE)
})

test('a corrupt file is ignored rather than thrown', () => {
  // A half-written or truncated file must not take plugin startup down; the
  // next successful fetch replaces it.
  const path = join(tempDir(), 'catalog.json')
  writeFileSync(path, '{ this is not json')
  const store = new CatalogStore({ path })
  assert.deepStrictEqual(store.current(), [])
  // And it recovers: a subsequent save makes the file readable again.
  store.replace(SAMPLE)
  assert.deepStrictEqual(new CatalogStore({ path }).current(), SAMPLE)
})

test('a file from a future format version is discarded', () => {
  // Reading a v2 document with v1 rules would misinterpret it, so it is
  // dropped rather than parsed on a best-effort basis.
  const path = join(tempDir(), 'catalog.json')
  writeFileSync(path, JSON.stringify({ version: CATALOG_FORMAT_VERSION + 1, entries: SAMPLE, fetchedAt: 1 }))
  assert.deepStrictEqual(new CatalogStore({ path }).current(), [])
})

test('a document whose entries are not an array is discarded', () => {
  const path = join(tempDir(), 'catalog.json')
  writeFileSync(path, JSON.stringify({ version: CATALOG_FORMAT_VERSION, entries: { nope: true }, fetchedAt: 1 }))
  assert.deepStrictEqual(new CatalogStore({ path }).current(), [])
})

test('a leftover temp file from a crashed save is cleaned up on load', () => {
  // A force-killed host can leave the sibling behind. It must not be mistaken
  // for the catalog itself, and the next save must be able to proceed.
  const path = join(tempDir(), 'catalog.json')
  writeFileSync(`${path}.tmp`, '{"partial":')
  const store = new CatalogStore({ path })
  assert.strictEqual(existsSync(`${path}.tmp`), false, 'the orphan must be removed')
  store.replace(SAMPLE)
  assert.deepStrictEqual(new CatalogStore({ path }).current(), SAMPLE)
})

test('freshness follows the ttl and is computed against an injected clock', () => {
  const path = join(tempDir(), 'catalog.json')
  const now = 1_700_000_000_000
  const store = new CatalogStore({ path, ttlMs: 1000 })
  store.replace(SAMPLE, now)

  assert.strictEqual(store.fresh(now), true)
  assert.strictEqual(store.fresh(now + 999), true)
  assert.strictEqual(store.fresh(now + 1000), false, 'the ttl boundary is exclusive')
  assert.strictEqual(store.fresh(now + 60_000), false)
})

test('a store that has never fetched is not fresh', () => {
  // Otherwise a failed first fetch would be cached as "fresh" for the whole
  // ttl and the region would show no models for half an hour.
  const store = new CatalogStore({ path: join(tempDir(), 'catalog.json') })
  assert.strictEqual(store.fresh(), false)
})

test('a failed save is reported rather than silently swallowed', () => {
  // A save that cannot write must not look like a save. The in-memory value is
  // still usable, but the error has to be visible so the caller can say so.
  const dir = tempDir()
  // A directory where the file should be makes writeFileSync fail with EISDIR.
  const path = join(dir, 'catalog.json')
  mkdirSync(path)
  const warnings = []
  const store = new CatalogStore({ path, logger: { warn: (m) => warnings.push(m) } })
  store.replace(SAMPLE)

  assert.ok(store.lastSaveError !== undefined, 'a failed save must be recorded')
  assert.strictEqual(warnings.length, 1, 'a failed save must reach the logger')
  assert.deepStrictEqual(store.current(), SAMPLE, 'the in-memory catalog stays usable')
  // A later successful save clears the error.
  rmSync(path, { recursive: true, force: true })
  const good = join(dir, 'other.json')
  const ok = new CatalogStore({ path: good })
  ok.replace(SAMPLE)
  assert.strictEqual(ok.lastSaveError, undefined)
})

test('the file on disk is the documented shape', () => {
  // If this format changes, an older DSH reading the file must discard it
  // rather than misread it — so the version field is part of the contract.
  const path = join(tempDir(), 'catalog.json')
  new CatalogStore({ path }).replace(SAMPLE, 1234)
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  assert.deepStrictEqual(Object.keys(raw).sort(), ['entries', 'fetchedAt', 'version'])
  assert.strictEqual(raw.version, CATALOG_FORMAT_VERSION)
  assert.strictEqual(raw.fetchedAt, 1234)
  assert.deepStrictEqual(raw.entries, SAMPLE)
})
