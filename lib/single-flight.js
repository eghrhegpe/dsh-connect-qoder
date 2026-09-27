/**
 * Coalesce concurrent runs of one async operation.
 *
 * Extracted from `lib/index.js` for the reason everything else here is
 * extracted: the rule is pure and it deserves a real test, but it sat inside a
 * module that cannot be imported without the peer dependencies installed.
 *
 * The behaviour it prevents: the catalog refresh has three triggers — a
 * startup/timer refresh, the card's `?refresh=1` route, and the account panel's
 * re-read — and none of them knew about the others. Two overlapping
 * `fetchModels` calls each ended in `catalog.replace(entries)`, so whichever
 * response LANDED last won, not whichever was requested last; a user mashing
 * the refresh button could watch the list settle on the data from a stale
 * response, and each press cost the upstream another full request. `readUsage`
 * had the same shape from the panel's refresh button.
 *
 * Sharing one in-flight promise fixes both at once: callers that arrive while
 * a run is active join it instead of starting a second one. They receive the
 * in-flight run's result, which for a catalog or a usage reading is the correct
 * answer — a fetch started moments ago is fresher than anything a queued
 * duplicate would return, and "whoever lands last wins" stops being a race
 * because there is only ever one landing.
 *
 * @module dsh-connect-qoder/single-flight
 */

/**
 * Wrap `task` so only one run of it is active at a time.
 *
 * @param task - the async operation; receives the caller's arguments.
 * @returns a function with `task`'s call signature. Concurrent calls share the
 *   first call's promise; once a run settles, the next call starts a fresh one
 *   with its own arguments. A rejection is handed to every joined caller and
 *   clears the slot, so a failed run never blocks future ones.
 */
export function createSingleFlight(task) {
  /** @type {Promise<unknown> | undefined} the active run, if any. */
  let inFlight = undefined
  return (...args) => {
    if (inFlight !== undefined) return inFlight
    // The async wrapper starts `task` SYNCHRONOUSLY — the run is live by the
    // time this call returns, so a joiner arriving in the same tick can never
    // slip past an empty slot — while still converting a synchronous throw
    // into a rejection of the shared promise. A bare `task(...args)` call
    // outside any wrapper would do neither: the throw would escape the caller
    // and leave the slot occupied by a dead flight, freezing every refresh
    // behind it.
    inFlight = (async () => task(...args))().finally(() => {
      inFlight = undefined
    })
    return inFlight
  }
}
