/**
 * What a fiber does when it is disposed, in the order that is actually safe.
 *
 * @module dsh-connect-qoder/dispose-order
 */
import type { RouteRelease } from './lifecycle.ts'

/**
 * The parts of a runtime this module touches. Structural minimum, not the
 * host's type: the only reason this is a module is so the ORDER can be tested
 * without a Cordis context, and a structural shape keeps it that way.
 */
export interface DisposableRuntime {
  /**
   * Flipped to mark the runtime dead. `beginCatalogUpdates`'s pending
   * `refreshCatalog().then` reads it and refuses to install a timer.
   */
  disposed: boolean
  /** Aborts an in-flight upstream request rather than only ignoring its answer. */
  refreshAbort?: { abort: () => void }
  /** The catalog refresh interval, when one is installed. */
  refreshTimer?: ReturnType<typeof setInterval> | undefined
}

/** The shim's close, which must be awaited and never throws. */
export interface ClosableShim {
  close: () => Promise<unknown>
}

/** The clock handles, so a test can watch the interval go without leaking one. */
export interface TimerHandles {
  clearInterval: (timer: ReturnType<typeof setInterval>) => void
}

/** What dispose does, reported back for the caller's log line. */
export interface DisposeReport {
  /** How many route releases ran, as counted by `releaseRoutes`. */
  releasedRoutes: number
  /** How many runtimes were marked dead. */
  runtimes: number
  /** How many shims were closed, whether or not a close rejected. */
  closed: number
}

/** The dependencies of {@link disposeFiber}. */
export interface DisposeDeps {
  /** Releases the provider registration, if the host handed one back. */
  releaseAdapter?: (() => void) | undefined
  /** Releases the provider-directory registration, likewise. */
  releaseDirectory?: (() => void) | undefined
  /** Runs every remembered route release and clears the sink; see `lifecycle.ts`. */
  releaseRoutes: (sink: RouteRelease[] | undefined) => number
  /** The sink `lifecycle.ts` collected into. */
  routeSink: RouteRelease[]
  /** The runtimes this fiber started. */
  runtimes: DisposableRuntime[]
  /** The shims backing those runtimes. */
  shims: ClosableShim[]
  /** `clearInterval` — injected so a test can assert without a live timer. */
  timers: TimerHandles
}

/**
 * Undo one fiber's registrations, routes, runtimes and shims, in that order.
 *
 * The order is the whole content of this function, and it is not a matter of
 * taste. Three of these steps are load-bearing against a specific failure:
 *
 * 1. **The provider registrations go first.** They are the only thing a user
 *    can see from the outside — until they are gone, DSH still offers two
 *    providers whose loopback ports are about to close.
 * 2. **The routes go before the runtimes are torn down.** A route left
 *    reachable while its runtime is half-closed is the leak `docs/issues/13`
 *    is about: a POST to it would start a shim and a refresh interval that
 *    nothing will ever clean up.
 * 3. **`disposed` is set BEFORE the interval is cleared.** This is the subtle
 *    one, and it was a comment rather than a test until this module existed.
 *    `beginCatalogUpdates` installs its interval from a `refreshCatalog().then`
 *    callback — a microtask. If dispose cleared the timer first and set the
 *    flag after, then a `then` that runs between the two statements installs a
 *    FRESH interval onto a runtime that no longer has one to clear: a zombie
 *    credential-resolution loop that outlives the plugin and keeps resolving
 *    credentials for a region nothing is serving. The flag is therefore set
 *    first, unconditionally, for every runtime, before anything is cleared.
 *
 * A disposal that is given a rejecting `close()` still finishes: `close()` is
 * documented idempotent and swallows `ERR_SERVER_NOT_RUNNING`, and
 * `allSettled` means one failed close cannot strand the others. The port that
 * failed to release is the host's to report, not something to throw over on the
 * way out — an exception here surfaces as a failed fiber cleanup in a place
 * the user cannot act on.
 *
 * @param deps - everything this needs; see {@link DisposeDeps}.
 * @returns what was undone, for the caller's own logging.
 */
export async function disposeFiber(deps: DisposeDeps): Promise<DisposeReport> {
  deps.releaseAdapter?.()
  deps.releaseDirectory?.()

  const releasedRoutes = deps.releaseRoutes(deps.routeSink)

  for (const runtime of deps.runtimes) {
    // Mark dead FIRST, then clear. See note 3 above — this is the line that
    // must not move below the `clearInterval`.
    runtime.disposed = true
    // Cut the upstream request rather than only ignoring its answer: without
    // this a fetch started seconds earlier keeps a socket open against a
    // gateway for a region this process is no longer serving (issue 13).
    runtime.refreshAbort?.abort()
    if (runtime.refreshTimer !== undefined) {
      deps.timers.clearInterval(runtime.refreshTimer)
      runtime.refreshTimer = undefined
    }
  }

  await Promise.allSettled(deps.shims.map((shim) => shim.close()))

  return { releasedRoutes, runtimes: deps.runtimes.length, closed: deps.shims.length }
}
