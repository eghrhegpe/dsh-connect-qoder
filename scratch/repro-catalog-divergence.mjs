/**
 * Offline reproduction of the sibling plugin's §40 class in OUR repo.
 *
 * Simulates: persist() swallows a disk-write failure while the in-memory
 * state (entries / fetchedAt) has already advanced — the "signature" whose
 * only purpose is "what the disk holds" now describes something the disk
 * does not have.
 *
 * Runs against the REAL src/ modules (node 24 type stripping), no mocks.
 */
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CatalogStore } from '../src/host/catalog-store.ts'
import { applyCatalogOutcome } from '../src/host/catalog-refresh.ts'

const root = mkdtempSync(join(tmpdir(), 'qoder-repro-'))
// Make the catalog path unwritable: its parent is a FILE, so mkdirSync fails.
const blocker = join(root, 'blocker')
writeFileSync(blocker, 'i am a file, not a directory')
const path = join(blocker, 'catalog.json')

// ① The live store advances memory even though the disk write failed.
const store = new CatalogStore({ path })
store.replace([{ id: 'a', key: 'a', name: 'A' }], Date.now())
console.log('[memory] entries=%d fetchedAt=%d fresh()=%s', store.entries.length, store.fetchedAt, store.fresh())
console.log('[disk] catalog file exists:', existsSync(path))
console.log('[store] lastSaveError set:', store.lastSaveError !== undefined)
console.log('  -> memory claims a catalog the disk does not have:', store.entries.length === 1 && !existsSync(path))

// ② A restart reads the disk: nothing there (or the old copy).
const store2 = new CatalogStore({ path })
console.log('[restart store] entries=%d fetchedAt=%d (disk is the authority on restart)', store2.entries.length, store2.fetchedAt)

// ③ The refresh-outcome fold reports "committed" even though nothing landed.
const runtime = { catalog: store, invalidate() {}, refreshFailed: undefined }
const outcome = applyCatalogOutcome(runtime, { ok: true, entries: [{ id: 'a', key: 'a', name: 'A' }] })
console.log('[applyCatalogOutcome] committed=%s refreshFailed=%s', outcome.committed, runtime.refreshFailed === undefined ? 'undefined' : runtime.refreshFailed.reason)

// ④ The skip gate `!force && catalog.fresh()` would skip the next poll.
console.log('[fresh() gate] a force=false poll would be skipped:', store.fresh() === true)

rmSync(root, { recursive: true, force: true })
