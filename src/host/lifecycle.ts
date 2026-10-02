/**
 * What a fiber must undo when it is disposed.
 *
 * @module dsh-connect-qoder/lifecycle
 */

/**
 * Remember what a route registration returned, so it can be undone on dispose.
 *
 * WHY THIS EXISTS, AND WHY IT GUESSES NOTHING
 *
 * Every `webServer.register({ … })` call in this plugin discarded its return
 * value. Whether that is a leak depends on a question this repository cannot
 * answer from here: does `@deepseek-ai/dsh-host-webserver` tie a registration to
 * the fiber it was made from, or does it need an explicit release? The package
 * ships inside the host's `app.asar`, which is not readable from a plugin
 * checkout, so the answer is not available as of this writing
 * (docs/issues/13, "需先确认宿主语义").
 *
 * Rather than assume either way, the registrations are collected and released
 * if — and only if — `register` handed back something callable. That is correct
 * under both host behaviours: a host that reclaims by fiber ignores the extra
 * call, and a host that does not gets the release it was missing. Nothing here
 * asserts a host contract it cannot see, and a host that changed the shape of
 * the return value degrades to "no release" — today's behaviour — rather than
 * throwing during dispose.
 *
 * The cost of getting this wrong the other way is real: a leaked route keeps a
 * handler, and through it a whole runtime, reachable after the plugin is
 * disabled, so a POST to it would start a shim and a refresh interval that
 * nothing will ever clean up.
 *
 * @param sink - the array collecting releases for this fiber.
 * @param result - whatever `webServer.register(...)` returned.
 * @returns the release, or `undefined` when there was nothing to keep.
 */
export function rememberRouteRelease(sink, result) {
  if (typeof result === 'function') {
    sink.push(result)
    return result
  }
  return undefined
}

/**
 * Call every remembered release, tolerating a host that already reclaimed.
 *
 * All of them run even if one throws: a release that fails must not strand the
 * ones after it, because those are the ones holding the ports. Disposal
 * therefore never throws — it runs on the way out, and an exception there would
 * surface as a failed fiber cleanup in a place the user cannot act on.
 *
 * @param sink - the array collected by {@link rememberRouteRelease}.
 * @returns how many releases ran, for logging or a test.
 */
export function releaseRoutes(sink) {
  let released = 0
  for (const release of sink ?? []) {
    try {
      release()
      released += 1
    } catch {
      // Already reclaimed by the host, or a release that is not idempotent.
      // Either way there is nothing to recover and nothing to report.
    }
  }
  if (Array.isArray(sink)) sink.length = 0
  return released
}
