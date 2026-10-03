/**
 * Publishing a region set to the host, and rolling it back when that fails.
 *
 * @module dsh-connect-qoder/publish-regions
 *
 * WHY THIS EXISTS
 *
 * This is the one piece of provider wiring that was still only textually
 * guarded. `publishRegions` used to live inline in `activate()`, where it
 * closed over eleven mutable bindings, so no test could execute it — the
 * rollback path was covered by a regex that checked nothing but its presence
 * (test/account-route-wiring.test.js).
 *
 * The rollback is the part that matters. A reload republishes the whole region
 * set; if the new registration fails halfway, the previous pair has already
 * been released, and the naive outcome is a plugin that has silently lost the
 * regions it was serving — with no adapter, no settings rows, and no error
 * anywhere the user can see. That is the exact shape of this plugin's incident
 * history (docs/issues/16: no new silent-failure branches).
 *
 * WHAT IS DECISION AND WHAT IS EFFECT
 *
 * Everything that decides *which* registration survives a failure is here, and
 * it is pure with respect to the host: given "what we are publishing", "what
 * was published before", and "how each registration attempt failed", it works
 * out the resulting state and the order releases must happen in. The two host
 * calls are injected, so a test can make each one fail independently and assert
 * the surviving state without a live host.
 */

/**
 * A host registration that can be undone.
 *
 * `undefined` is part of the contract, not an oversight: the host's
 * `registerAdapter` and `registerConfigurableProviders` are both typed as
 * returning a release **or nothing**, so a successful registration may hand
 * back no way to undo it. Treating that as an error would make a host that
 * reclaims by fiber look like a broken one.
 */
export type Release = (() => void) | undefined

/**
 * One region's row for `registerConfigurableProviders`.
 *
 * Kept as an opaque generic: the shape is the host's, and this module only
 * ever passes the rows through from one registration to the other, so naming
 * its fields here would be a claim about a contract it cannot check.
 */
export type ProviderRow = {
  provider: string
  displayName: string
  settingsNs: string
  settingsPath: string[]
  declared: boolean
}

/** The adapter pair being published, as the host receives it. */
export interface PublishTarget {
  /** Provider ids, in the order the host should offer them. */
  providerIds: string[]
  /** The adapter object handed to `registerAdapter`. */
  adapter: unknown
  /** One settings row per region, handed to `registerConfigurableProviders`. */
  directory: ProviderRow[]
  /** Called when a runtime invalidates, to re-announce the adapter set. */
  invalidate: () => void
}

/** The registration state that survives this call. */
export interface PublishedState {
  /** Undoes the adapter registration; `undefined` when nothing is registered. */
  releaseAdapter: Release | undefined
  /** Undoes the settings-row registration; `undefined` when nothing is registered. */
  releaseDirectory: Release | undefined
  /** The invalidate hook the caller must wire new runtimes against. */
  invalidate: () => void
}

/** The two host registration calls this module needs. */
export interface PublishDeps {
  registerAdapter: (providerIds: string[], adapter: unknown) => Release
  registerConfigurableProviders: (rows: ProviderRow[]) => Release
  /** Reports a rollback step that could not complete. Never throws. */
  onRollbackFailed?: (error: unknown) => void
}
/** The answer `publishRegions` gives its two callers. */
export interface PublishResult extends PublishedState {
  ok: boolean
  error?: unknown
}

/** Nothing registered, nothing to invalidate. */
const nothingPublished = (): PublishedState => ({
  releaseAdapter: undefined,
  releaseDirectory: undefined,
  invalidate: () => {},
})

/**
 * Register `target`, releasing whatever was registered before, and restore the
 * previous pair if the new registration fails.
 *
 * The ordering matters and is deliberate: the old pair is released *before* the
 * new one is registered, because the host is being asked to offer the same
 * provider ids and holding both at once is the state the host has no way to
 * represent. That makes the failure window real, which is why the restore path
 * exists at all.
 *
 * On failure the host is left in one of exactly two end states, and which one is
 * chosen never depends on what threw:
 *
 * - The previous pair could be re-registered → it is, and the caller keeps
 *   serving what it was serving. A region that worked before a reload keeps
 *   working after a *failed* reload.
 * - It could not → **nothing** is left registered, and `invalidate` becomes a
 *   no-op. This is the honest outcome. Re-claiming releases for a registration
 *   that does not exist would leave the host offering a provider that cannot
 *   answer, which is the silent failure this module exists to prevent.
 *
 * Every restore step is attempted even if an earlier one threw, because a
 * half-restored host is harder to reason about than an empty one; a step that
 * fails is reported through `onRollbackFailed` and never swallowed.
 *
 * @param target - the registration to make current.
 * @param previous - the pair in force before this call, if any.
 * @param deps - the host calls and the rollback reporter.
 * @returns the surviving state, plus `ok: false` and the error when publishing failed.
 */
export function publishRegions(
  target: PublishTarget | undefined,
  previous: PublishTarget | undefined,
  previousReleases: { releaseAdapter: Release; releaseDirectory: Release },
  deps: PublishDeps,
): PublishResult {
  // Nothing to publish. The caller keeps whatever it already had: this is the
  // zero-region activation, where the card routes must stay alive and there is
  // no adapter to offer. A region that comes online later goes through this
  // function again with a real target. Returning the previous pair unchanged is
  // what makes "nothing to do" mean literally nothing — publishing an empty set
  // would tear down regions that are serving.
  if (target === undefined) {
    return {
      ok: true,
      releaseAdapter: previousReleases.releaseAdapter,
      releaseDirectory: previousReleases.releaseDirectory,
      invalidate: previous?.invalidate ?? nothingPublished().invalidate,
    }
  }

  const { releaseAdapter: oldAdapterRelease, releaseDirectory: oldDirectoryRelease } = previousReleases
  // Both old releases run even if the first throws: a release that fails must
  // not strand the second, because the second is what holds the settings rows.
  const stale: string[] = []
  for (const release of [oldAdapterRelease, oldDirectoryRelease]) {
    if (release === undefined) continue
    try {
      release()
    } catch (error) {
      stale.push(describe(error))
    }
  }

  let releaseAdapter: Release | undefined
  let releaseDirectory: Release
  try {
    releaseAdapter = deps.registerAdapter(target.providerIds, target.adapter)
    releaseDirectory = deps.registerConfigurableProviders(target.directory)
  } catch (error) {
    // If the directory registration is what threw, the adapter registration
    // already succeeded and must be undone — otherwise a failed publish leaves
    // a provider offering itself with no settings row behind it. If the adapter
    // registration itself threw, both bindings are still unassigned and there is
    // nothing to undo.
    if (releaseAdapter !== undefined) {
      try {
        releaseAdapter()
      } catch (cleanupError) {
        stale.push(describe(cleanupError))
      }
    }
    if (previous === undefined) {
      report(stale, deps)
      return { ok: false, error, ...nothingPublished() }
    }
    // A region that was serving before this reload must not be taken down by a
    // reload that failed. Re-register what was there, and only if that works
    // keep it.
    let restoredAdapter: Release
    try {
      restoredAdapter = deps.registerAdapter(previous.providerIds, previous.adapter)
    } catch (restoreError) {
      stale.push(describe(restoreError))
      report(stale, deps)
      return { ok: false, error, ...nothingPublished() }
    }
    try {
      const restoredDirectory = deps.registerConfigurableProviders(previous.directory)
      report(stale, deps)
      return {
        ok: false,
        error,
        releaseAdapter: restoredAdapter,
        releaseDirectory: restoredDirectory,
        invalidate: previous.invalidate,
      }
    } catch (restoreError) {
      // The restore got as far as a live adapter registration. Returning
      // `nothingPublished()` while it is registered would drop the only handle
      // that could undo it — a leaked provider with settings rows that do not
      // exist. Undo it, then report the honest empty state.
      try {
        if (restoredAdapter !== undefined) restoredAdapter()
      } catch (cleanupError) {
        stale.push(describe(cleanupError))
      }
      stale.push(describe(restoreError))
      report(stale, deps)
      return { ok: false, error, ...nothingPublished() }
    }
  }

  // A stale release that failed is a leaked registration the host still holds,
  // so it is reported even when the publish itself succeeded — the leak is
  // independent of how the rest of this call went.
  report(stale, deps)
  return { ok: true, releaseAdapter, releaseDirectory, invalidate: target.invalidate }
}

/** Reduce a throwable to a loggable line. */
function describe(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * Report the rollback steps that did not complete.
 *
 * A swallowed release is a leak the user cannot see, so it is never silent:
 * with no reporter installed the step is still counted, and installing one is
 * how the caller turns it into a log line.
 */
function report(stale: string[], deps: PublishDeps): void {
  if (stale.length === 0) return
  const onRollbackFailed = deps.onRollbackFailed
  if (onRollbackFailed === undefined) return
  for (const step of stale) {
    try {
      onRollbackFailed(new Error(`release or rollback step failed: ${step}`))
    } catch {
      // A reporter that throws must not turn a handled failure into a crash
      // during dispose or during a reload the user is watching.
    }
  }
}
