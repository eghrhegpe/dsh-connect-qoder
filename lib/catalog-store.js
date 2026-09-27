/**
 * The on-disk catalog cache.
 *
 * Split out of lib/index.js for two reasons. It depends on nothing but `node:fs`
 * and `node:path` once the path is injected, so it can be tested against a real
 * temporary directory — and the atomicity claim in `save()` is exactly the kind
 * of thing that must be checked on the platform it runs on rather than assumed.
 * A restart must not drop the user to an empty model group when a good catalog
 * was fetched minutes earlier, and a temporary upstream failure must not either.
 *
 * Only model metadata is stored here — never a token.
 *
 * @module dsh-connect-qoder/catalog-store
 */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** How long a fetched catalog stays fresh before it is refetched. */
export const CATALOG_TTL_MS = 30 * 60 * 1000

/** On-disk format this reader accepts; other versions are discarded. */
export const CATALOG_FORMAT_VERSION = 1

export class CatalogStore {
  /**
   * @param options.path - where the catalog file lives.
   * @param options.ttlMs - how long a fetch stays fresh; injectable for tests.
   * @param options.logger - optional, for a failed save.
   */
  constructor({ path, ttlMs = CATALOG_TTL_MS, logger } = {}) {
    this.path = path
    this.ttlMs = ttlMs
    this.logger = logger
    this.entries = []
    this.fetchedAt = 0
    /** Set when a save failed, so a caller can report it rather than assume. */
    this.lastSaveError = undefined
    this.load()
  }

  load() {
    // A crash mid-`save()` can leave a `.tmp` sibling behind; clean it up so
    // the next `save()` writes to a fresh temp file without stale data.
    const tmp = `${this.path}.tmp`
    try {
      if (existsSync(tmp)) unlinkSync(tmp)
    } catch {
      // Inert; the next save overwrites it.
    }
    if (!existsSync(this.path)) return
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8'))
      if (parsed?.version !== CATALOG_FORMAT_VERSION) return
      if (!Array.isArray(parsed.entries)) return
      this.entries = parsed.entries
      this.fetchedAt = Number(parsed.fetchedAt) || 0
    } catch {
      // A damaged cache is simply ignored; the next fetch replaces it.
    }
  }

  save() {
    this.lastSaveError = undefined
    // Write to a sibling temp file, then rename onto the target. On POSIX the
    // rename is atomic, so a crash mid-write never leaves a half-written JSON
    // that the next `load()` would parse-fail on and discard the whole catalog.
    // On Windows the rename-over-existing also works (MoveFileEx) — verified in
    // test/catalog-store.test.js rather than assumed.
    const tmp = `${this.path}.tmp`
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      writeFileSync(tmp, JSON.stringify({ version: CATALOG_FORMAT_VERSION, fetchedAt: this.fetchedAt, entries: this.entries }, null, 2), 'utf8')
      renameSync(tmp, this.path)
    } catch (error) {
      this.lastSaveError = error
      // A failed rename leaves the temp file behind; clean it up so the next
      // `save()` can write to it again.
      try {
        if (existsSync(tmp)) unlinkSync(tmp)
      } catch {
        // A leftover temp file is inert; the next save overwrites it.
      }
      this.logger?.warn?.(`dsh-connect-qoder: could not save catalog ${this.path}`, error)
    }
  }

  current() {
    return this.entries
  }

  fresh(now = Date.now()) {
    return now - this.fetchedAt < this.ttlMs
  }

  replace(entries, now = Date.now()) {
    this.entries = entries
    this.fetchedAt = now
    this.save()
  }
}
