/**
 * What one catalog refresh does with its answer.
 *
 * WHY THIS IS A MODULE
 *
 * `RegionRuntime.doRefreshCatalog` (lib/index.js) is the code this file exists
 * to test, and it cannot be imported: lib/index.js pulls in the Cordis peer
 * dependencies, which a test checkout does not install. It was extracted for
 * the same reason and with the same method as `lib/credential-cache.js` and
 * `lib/catalog-entry.js` — the decision is pure, so it belongs somewhere the
 * suite can reach, while the surrounding runtime keeps only the I/O.
 *
 * THE BUG THIS KEEPS FROM COMING BACK
 *
 * The original was three lines:
 *
 * ```js
 * const entries = raw.map(normalizeEntry)
 * if (entries.length > 0) {          // <-- the freeze (issue 04)
 *   this.catalog.replace(entries)
 *   this.invalidate?.()
 * }
 * ```
 *
 * That guard merged two answers that must not be merged. Upstream returning
 * zero models is a *result* — the account was narrowed, or the models were
 * retired — and it has to reach the disk, because an empty model group is how
 * DSH hides a provider and how the card tells the user there is nothing. But
 * with the guard in place, an empty result and a thrown fetch were the same
 * silent no-op: the last good roster stayed in place forever, the card and the
 * picker kept offering models the account no longer has, and pressing
 * "刷新计费" could not possibly change anything, because the only thing the
 * code path could do was nothing.
 *
 * So the rule this module states is: **an answer is committed even when it is
 * empty; only a failure keeps the previous catalog.** A failure also records
 * why, and records it per-reason — because "the plugin is out of date" and
 * "the network hiccuped" both keep the old rows, and the card must not tell a
 * user to update the plugin when the truth is to try again in a minute.
 *
 * @module dsh-connect-qoder/catalog-refresh
 */
import type { CatalogOutcome, RefreshableRuntime, RefreshFailure } from './domain.ts'

/** The reasons a refresh can leave the catalog unrefreshed. */
export const REFRESH_FAILURE_REASONS = [
  'credential',
  'no-credential',
  'fetch',
  'protocol-shape-changed',
]

/**
 * Whether a refresh that finished after a dispose may still touch the runtime.
 *
 * `doRefreshCatalog` can be in flight when the fiber disposes — a plugin
 * toggle, a hot reload, an upgrade. The fetch already had its answer, and the
 * code that follows used to run anyway: `catalog.replace()` wrote to disk and
 * emitted `llm/adapters-updated` on a fiber that had been torn down. Neither is
 * catastrophic, and both are invisible — the failure shape this repository
 * keeps finding. The `disposed` flag could not prevent it, because it was only
 * consulted by the caller that installs the refresh TIMER, never by the refresh
 * itself.
 *
 * Pure so it can be asserted without a Cordis context: the scenario is a boolean
 * over two values, and both ways to get it wrong — checking before the await
 * rather than after, or checking on the failure path only — are silent.
 *
 * @param runtime - the runtime, carrying `disposed`.
 * @returns true when the runtime is gone and the result must be dropped.
 */
export function isRefreshObsolete(runtime: RefreshableRuntime | null | undefined): boolean {
  return runtime?.disposed === true
}

/**
 * Fold one refresh's outcome into a runtime.
 *
 * Split by outcome so each branch can be asserted on its own, because the bug
 * was a branch that did not exist at all.
 *
 * @param runtime - the target: `catalog` (anything with `replace`), plus the
 *   optional `invalidate` hook the picker refreshes through.
 * @param outcome - `{ ok: true, entries }` for an answer, or
 *   `{ ok: false, reason, error }` for a failure.
 * @returns `{ committed, previousFailure }` — whether the catalog was replaced,
 *   and the failure marker that was displaced (so a caller that owns the
 *   runtime can log the transition rather than only the end state).
 */
export function applyCatalogOutcome(
  runtime: RefreshableRuntime,
  outcome: CatalogOutcome,
): { committed: boolean; previousFailure: RefreshFailure | undefined } {
  const previousFailure = runtime.refreshFailed
  if (outcome.ok !== true) {
    // Kept, not overwritten: a failed refresh is a statement about THIS fetch,
    // and the previous catalog is the one still on screen.
    runtime.refreshFailed = { reason: String(outcome.reason ?? 'fetch'), error: outcome.error }
    return { committed: false, previousFailure }
  }
  // Empty is a value. `replace([])` advances `fetchedAt`, so the TTL refreshes
  // and the card's "last fetched" stops aging as if nothing were known.
  runtime.catalog.replace(outcome.entries)
  runtime.refreshFailed = undefined
  // Called unconditionally, including for the empty result: a group that has to
  // disappear from the picker must be re-advertised as having disappeared, or
  // DSH keeps routing to a provider that now offers nothing.
  runtime.invalidate?.()
  return { committed: true, previousFailure }
}
