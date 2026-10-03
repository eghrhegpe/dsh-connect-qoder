/**
 * Route mounting as a group decision, and the dispose order that keeps a
 * disposed fiber from leaving a zombie behind.
 *
 * Both modules exist because the thing worth testing is an ORDER or an
 * ALL-OR-NOTHING, and both were previously comments in `index.ts`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { mountRouteGroup } from '../src/host/route-mount.ts'
import { disposeFiber } from '../src/host/dispose-order.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const noop = () => {}

/**
 * A `webServer` whose `register` answers with a release, and can be told to
 * refuse one of the paths — the shape of a host that takes the first route of a
 * group and rejects a later one.
 */
function registrar({ failOn } = {}) {
  const registered = []
  const released = []
  return {
    registered,
    released,
    register: (route) => {
      if (failOn !== undefined && route.path === failOn) throw new Error(`refused ${route.path}`)
      registered.push(route.path)
      return () => released.push(route.path)
    },
  }
}

const route = (path) => ({ path, handler: noop })
const pathsOf = (routes) => routes.map((r) => r.path)

function quietLogger() {
  const lines = []
  return { lines, warn: (message) => lines.push(message) }
}

// ---------------------------------------------------------------------------
// mountRouteGroup
// ---------------------------------------------------------------------------

test('a group that registers cleanly reports every path and keeps every release', () => {
  const web = registrar()
  const sink = []
  const out = mountRouteGroup(web, [route('/a'), route('/b'), route('/c')], sink)

  assert.equal(out.registered, 3)
  assert.deepEqual(out.paths, ['/a', '/b', '/c'])
  assert.deepEqual(web.registered, ['/a', '/b', '/c'])
  assert.equal(sink.length, 3, 'a mounted group must be the fiber’s business')
})

test('a group refused half way releases what it already took', () => {
  // The defect this pins: the old code registered three account routes inside
  // ONE try, so a host that took `/account` and rejected `/account/confirm`
  // left the first route live. The card then read its account state and had two
  // buttons that did nothing — and the catch logged "account routes
  // unavailable", which was false.
  const web = registrar({ failOn: '/b' })
  const sink = []
  const logger = quietLogger()
  const out = mountRouteGroup(web, [route('/a'), route('/b'), route('/c')], sink, logger)

  assert.equal(out.registered, 0, 'a failed group registered nothing')
  assert.deepEqual(out.paths, [], 'a failed group claims no paths')
  assert.deepEqual(web.released, ['/a'], 'the route taken before the failure must be released')
  assert.deepEqual(sink, [], 'nothing goes into the fiber’s sink unless the whole group is up')
  assert.ok(
    logger.lines.some((line) => /\/b route unavailable/.test(line) && /released too/.test(line)),
    `the log must name the refused path AND say the group was rolled back; got ${JSON.stringify(logger.lines)}`,
  )
})

test('a group refused on its FIRST route releases nothing and still reports', () => {
  const web = registrar({ failOn: '/a' })
  const sink = []
  const logger = quietLogger()
  const out = mountRouteGroup(web, [route('/a'), route('/b')], sink, logger)

  assert.equal(out.registered, 0)
  assert.deepEqual(web.released, [], 'nothing was taken, so nothing is released')
  assert.deepEqual(sink, [])
  assert.equal(logger.lines.length, 1)
})

test('a group refused on its LAST route still rolls the earlier ones back', () => {
  // The case the old code got wrong in the most damaging direction: two routes
  // live, the third fails, and the user has a panel that half works.
  const web = registrar({ failOn: '/c' })
  const sink = []
  mountRouteGroup(web, [route('/a'), route('/b'), route('/c')], sink)
  assert.deepEqual(web.released, ['/a', '/b'])
  assert.deepEqual(sink, [])
})

test('a release that throws does not strand the ones after it', () => {
  // Ordering of the ROLLBACK is the same concern as ordering of dispose: the
  // releases already taken are the ones holding handlers, so a host that has
  // already reclaimed one of them (a common, legitimate shape) must not stop
  // the rest from being released.
  const released = []
  const web = {
    register: (r) => {
      if (r.path === '/c') throw new Error('refused')
      return () => {
        if (r.path === '/a') throw new Error('already reclaimed by the host')
        released.push(r.path)
      }
    },
  }
  const logger = quietLogger()
  mountRouteGroup(web, [route('/a'), route('/b'), route('/c')], [], logger)
  assert.deepEqual(released, ['/b'], 'a throwing release must not stop the next one')
  assert.ok(
    logger.lines.some((line) => /releasing the .* route group's earlier registration failed/.test(line)),
    'a failed rollback is reported rather than swallowed',
  )
})

test('a successful group stores each release exactly once', () => {
  // A release stored twice runs twice on dispose. Calling it out separately
  // because the cost is invisible until a host's release is not idempotent.
  const runs = []
  const web = { register: () => () => { runs.push('release') } }
  const sink = []
  mountRouteGroup(web, [route('/a'), route('/b')], sink)
  for (const release of sink) release()
  assert.equal(runs.length, 2, 'three routes must not leave four releases to run')
})

test('a host that reclaims by fiber and returns nothing is still a clean mount', () => {
  // The other host semantics. `rememberRouteRelease` is careful about exactly
  // this, and mountRouteGroup must not add a second opinion: a group whose
  // every register returned undefined has nothing to roll back and nothing to
  // keep, and that is a correct mount, not a failure.
  const web = { register: () => undefined }
  const sink = []
  const logger = quietLogger()
  const out = mountRouteGroup(web, [route('/a'), route('/b')], sink, logger)

  assert.equal(out.registered, 2, 'nothing to release is not a reason to call it a failure')
  assert.deepEqual(out.paths, ['/a', '/b'])
  assert.deepEqual(sink, [])
  assert.deepEqual(logger.lines, [], 'a healthy host must not produce a warning')
})

test('a host returning a non-function is treated as no release', () => {
  // `lifecycle.ts` narrows on `typeof result === 'function'`; a host that
  // changed the return shape must degrade to "no release" (today’s behaviour)
  // rather than throwing on dispose.
  const web = { register: () => ({ unregister: true }) }
  const sink = []
  const out = mountRouteGroup(web, [route('/a')], sink)
  assert.equal(out.registered, 1)
  assert.deepEqual(sink, [])
})

test('an empty group is a no-op, not a failure', () => {
  const web = registrar()
  const sink = []
  const out = mountRouteGroup(web, [], sink)
  assert.equal(out.registered, 0)
  assert.deepEqual(out.paths, [])
  assert.deepEqual(web.registered, [])
})

test('the registration carries kind exact and the handler it was given', () => {
  const seen = []
  const web = { register: (r) => { seen.push(r); return noop } }
  const handler = () => 'x'
  mountRouteGroup(web, [{ path: '/a', handler }], [])
  assert.equal(seen[0].kind, 'exact')
  assert.equal(seen[0].handler, handler, 'the handler must be passed through untouched')
})

// ---------------------------------------------------------------------------
// disposeFiber
// ---------------------------------------------------------------------------

/**
 * A runtime carrying a STAND-IN interval, not a real one.
 *
 * A real `setInterval` would keep the test process alive for its full period
 * after the suite finished, so the whole file hung. The identity of the handle
 * is all `disposeFiber` does with it — it passes it to `clearInterval` and
 * forgets it — so a token is a faithful stand-in.
 */
function runtime() {
  return {
    disposed: false,
    refreshTimer: { __timer: 'token' },
    refreshAbort: { abort: noop },
  }
}

function disposeDeps(over = {}) {
  const closed = []
  const events = []
  const runtimes = over.runtimes ?? [runtime()]
  const deps = {
    releaseAdapter: over.releaseAdapter,
    releaseDirectory: over.releaseDirectory,
    releaseRoutes: over.releaseRoutes ?? ((sink) => { events.push('routes'); sink.length = 0; return 0 }),
    routeSink: [],
    runtimes,
    shims: over.shims ?? [{ close: async () => { events.push('close'); closed.push(1) } }],
    timers: { clearInterval: (t) => { events.push('clear'); void t } },
  }
  return { deps, events, closed, runtimes }
}

test('dispose marks a runtime dead BEFORE clearing its interval', async () => {
  // The invariant that was a comment. `beginCatalogUpdates` installs its
  // interval from a `refreshCatalog().then` microtask; a `then` that runs
  // between "clear the timer" and "set disposed" would install a FRESH
  // interval on a runtime that no longer has one to clear — a zombie
  // credential-resolution loop outliving the plugin.
  const r = runtime()
  let disposedWhenCleared
  const { deps } = disposeDeps({ runtimes: [r] })
  deps.timers = {
    clearInterval: (t) => {
      disposedWhenCleared = r.disposed
      void t
    },
  }
  await disposeFiber(deps)
  assert.equal(disposedWhenCleared, true, 'disposed must already be true when the timer is cleared')
  assert.equal(r.disposed, true)
})

test('dispose releases the routes before it touches a runtime', async () => {
  const order = []
  const r = runtime()
  const { deps } = disposeDeps({ runtimes: [r] })
  deps.releaseRoutes = () => { order.push('routes'); return 1 }
  deps.timers = { clearInterval: () => order.push('clear') }
  await disposeFiber(deps)
  assert.deepEqual(order, ['routes', 'clear'], 'a live route must not outlive its runtime')
})

test('dispose releases the provider registrations first of all', async () => {
  const order = []
  const { deps } = disposeDeps({
    releaseAdapter: () => order.push('adapter'),
    releaseDirectory: () => order.push('directory'),
  })
  deps.releaseRoutes = () => { order.push('routes'); return 0 }
  await disposeFiber(deps)
  assert.deepEqual(order.slice(0, 2), ['adapter', 'directory'], 'DSH must stop offering the providers first')
})

test('dispose aborts the in-flight upstream request, not just ignoring its answer', async () => {
  let aborted = 0
  const r = runtime()
  r.refreshAbort = { abort: () => { aborted += 1 } }
  const { deps } = disposeDeps({ runtimes: [r] })
  await disposeFiber(deps)
  assert.equal(aborted, 1, 'a fetch started seconds earlier would keep a socket open (issue 13)')
})

test('dispose forgets the interval it cleared', async () => {
  // A runtime that keeps its handle after dispose will be cleared a second
  // time on a double-dispose, and the second clear is a handle to a recycled
  // timer id.
  const r = runtime()
  const { deps } = disposeDeps({ runtimes: [r] })
  await disposeFiber(deps)
  assert.equal(r.refreshTimer, undefined)
})

test('a runtime with no interval and no abort disposes cleanly', async () => {
  const r = { disposed: false }
  const { deps } = disposeDeps({ runtimes: [r] })
  const report = await disposeFiber(deps)
  assert.equal(r.disposed, true)
  assert.equal(report.runtimes, 1)
})

test('a shim whose close rejects does not strand the others', async () => {
  // `close()` is documented idempotent and swallows ERR_SERVER_NOT_RUNNING;
  // allSettled means one failure cannot prevent the rest. A throw here would
  // surface as a failed fiber cleanup where the user cannot act.
  const closed = []
  const { deps } = disposeDeps({
    shims: [
      { close: async () => { closed.push('a'); throw new Error('ERR_SERVER_NOT_RUNNING') } },
      { close: async () => { closed.push('b') } },
    ],
  })
  const report = await disposeFiber(deps)
  assert.deepEqual(closed, ['a', 'b'], 'a rejecting close must not stop the next')
  assert.equal(report.closed, 2, 'the report counts attempts, not successes')
})

test('a host that handed back no provider releases disposes without them', async () => {
  const { deps } = disposeDeps({ releaseAdapter: undefined, releaseDirectory: undefined })
  const report = await disposeFiber(deps)
  assert.equal(report.releasedRoutes, 0)
})

test('dispose reports what it undid', async () => {
  const { deps } = disposeDeps({
    runtimes: [runtime(), runtime()],
    shims: [{ close: async () => {} }, { close: async () => {} }],
  })
  deps.releaseRoutes = () => 3
  const report = await disposeFiber(deps)
  assert.deepEqual(report, { releasedRoutes: 3, runtimes: 2, closed: 2 })
})

test('a fiber with nothing started still disposes', async () => {
  const { deps } = disposeDeps({ runtimes: [], shims: [] })
  const report = await disposeFiber(deps)
  assert.equal(report.runtimes, 0)
  assert.equal(report.closed, 0)
})

// ---------------------------------------------------------------------------
// Structural: index.ts must keep the wiring, not re-grow the logic
// ---------------------------------------------------------------------------

test('index.ts delegates both the mount decision and the dispose order', () => {
  const source = readFileSync(join(root, 'src', 'host', 'index.ts'), 'utf8')
  assert.match(source, /mountRouteGroup\(/, 'the group mount must go through route-mount.ts')
  assert.match(source, /disposeFiber\(/, 'the dispose order must go through dispose-order.ts')
  // The one line that must not move below another: `disposed` is set inside
  // dispose-order.ts now, so index.ts must not set it itself any more.
  assert.doesNotMatch(
    source,
    /runtime\.disposed\s*=/,
    'index.ts must not set runtime.disposed — the ordering it belongs to is in dispose-order.ts',
  )
  // The three account routes must be mounted as ONE group. The pattern is
  // deliberately tight: a lazy `[^]*?` alone would happily match three
  // SEPARATE `mountRouteGroup` calls and pass, which is precisely the bug this
  // gate exists to prevent — so it may not cross a closing bracket.
  const group = /mountRouteGroup\(webServer, \[((?:[^\]]|\](?!, routeReleases))*?)\], routeReleases/
    .exec(source)
  assert.ok(group !== null, 'no single mountRouteGroup call names routeReleases as its sink')
  const accountGroup = /mountRouteGroup\(webServer, \[((?:[^\]]|\](?!, routeReleases))*QODER_ACCOUNT_CONFIRM_PATH(?:[^\]]|\](?!, routeReleases))*)\], routeReleases/
    .exec(source)
  assert.ok(
    accountGroup !== null,
    'the three account routes must be mounted as ONE group, not three separate calls',
  )
  for (const path of ['QODER_ACCOUNT_PATH', 'QODER_ACCOUNT_RELOAD_PATH', 'QODER_ACCOUNT_CONFIRM_PATH']) {
    assert.ok(
      accountGroup[1].includes(path),
      `the account group is missing ${path} — one of the three is mounted outside it`,
    )
  }
  // A second `mountRouteGroup` call that mentions an account path would mean
  // somebody re-split the group. The group-membership check above already
  // fails on that, so no count is needed here.
})

test('no route is registered outside a group', () => {
  // Every registration goes through the helper, so the all-or-nothing rule
  // cannot be forgotten for the next route somebody adds.
  const source = readFileSync(join(root, 'src', 'host', 'index.ts'), 'utf8')
  const direct = source.match(/webServer\.register\(/g) ?? []
  assert.deepEqual(direct, [], `index.ts still registers routes directly: ${direct.length} site(s)`)
})
