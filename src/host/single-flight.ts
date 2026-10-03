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
 * A coalescing wrapper around one async operation.
 *
 * Callable with `task`'s own arguments, plus {@link SingleFlight.reset}.
 */
export interface SingleFlight<Args extends unknown[], Result> {
  (...args: Args): Promise<Result>
  /**
   * Abandon the active run, if any, so the next call starts a fresh one.
   *
   * The abandoned run is NOT cancelled: it still settles, and every caller that
   * already awaited it still receives its result. What `reset` changes is only
   * who may occupy the slot next — which is what a caller needs when the
   * in-flight answer has been invalidated by an event (a claim landing) and is
   * therefore no longer the answer anyone wants.
   */
  reset(): void
}

/**
 * Wrap `task` so only one run of it is active at a time.
 *
 * Generic over the task's arguments and result, so a caller keeps the real
 * signature: `createSingleFlight((force) => …)` still takes a boolean and still
 * answers with the catalog, rather than degrading to `(…args: any[]) => any`
 * and throwing that away at every call site.
 *
 * Note the contract this implies for JOINERS: a caller that arrives while a run
 * is active joins it and receives THAT run's result, whatever arguments the
 * joiner passed. The arguments of the run that started first win. A caller for
 * which that is wrong — because its own argument changes what the answer must
 * be — has to {@link SingleFlight.reset} first, or hold its own short-circuit.
 *
 * @param task - the async operation; receives the starting caller's arguments.
 * @returns a function with `task`'s call signature, plus `reset`. Concurrent
 *   calls share the first call's promise; once a run settles, the next call
 *   starts a fresh one with its own arguments. A rejection is handed to every
 *   joined caller and clears the slot, so a failed run never blocks future
 *   ones.
 */
export function createSingleFlight<Args extends unknown[], Result>(
  task: (...args: Args) => Promise<Result> | Result,
): SingleFlight<Args, Result> {
  /** The active run, if any. */
  let inFlight: Promise<Result> | undefined = undefined
  const start = (...args: Args): Promise<Result> => {
    if (inFlight !== undefined) return inFlight
    // The async wrapper starts `task` SYNCHRONOUSLY — the run is live by the
    // time this call returns, so a joiner arriving in the same tick can never
    // slip past an empty slot — while still converting a synchronous throw
    // into a rejection of the shared promise. A bare `task(...args)` call
    // outside any wrapper would do neither: the throw would escape the caller
    // and leave the slot occupied by a dead flight, freezing every refresh
    // behind it.
    const run: Promise<Result> = (async () => task(...args))().finally(() => {
      // Only clear the slot when it still holds THIS run. A `reset()` during
      // the await has already released it (and possibly let a newer run take
      // it); clearing unconditionally would evict that newer run and reopen
      // exactly the coalescing window the reset just closed.
      if (inFlight === run) inFlight = undefined
    })
    inFlight = run
    return run
  }
  return Object.assign(start, {
    reset: () => {
      inFlight = undefined
    },
  })
}
