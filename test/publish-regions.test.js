/**
 * Tests for publishing a region set to the host, and rolling it back.
 *
 * Run: node --test test/publish-regions.test.js
 *
 * This logic used to be an inline closure in `activate()`, closing over eleven
 * mutable bindings, so it had no executable test at all — only a regex in
 * test/account-route-wiring.test.js that checked the zero-region early return
 * existed. What went untested was the rollback.
 *
 * The rollback is where the damage is. A reload republishes every region, and by
 * the time the new registration is attempted the old pair has already been
 * released — so a failure that is not rolled back leaves the plugin offering
 * nothing, with no error anywhere the user can see. That is precisely the shape
 * of this plugin's incident history (docs/issues/16: no silent-failure
 * branches), which is why the terminal states are asserted here rather than
 * left to inspection.
 *
 * The two host calls are injected, so each can be made to fail on its own — the
 * distinction that matters, because "the adapter registration threw" and "the
 * settings rows threw" leave the host in different states and need different
 * repairs.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { publishRegions } from '../src/host/publish-regions.ts'

/** A `registerConfigurableProviders` row, as the host receives it. */
const row = (provider) => ({
  provider,
  displayName: provider.toUpperCase(),
  settingsNs: 'dsh-connect-qoder',
  settingsPath: [],
  declared: false,
})

/**
 * A host whose two registration calls can be told to fail independently.
 *
 * The two calls are indexed by attempt, not by intent, because the module makes
 * no promise about how many attempts a scenario involves: `adapter#1` is the
 * publish and `adapter#2` (when it happens) is the restore.
 *
 * `fail: { first: true }` makes the *publish* call throw.
 * `fail: { restore: true }` makes the *restore* call throw, keeping the publish
 * call working — that is the "host is broken only when we try to put it back"
 * case, which is what "the previous pair cannot be restored" actually means.
 * `failFirst: 'rows-then-restore-ok'` fails the publish's settings-row call and
 * lets the restore's through, which is the case where the restore fully works.
 */
function host({ fail, failFirst } = {}) {
  const calls = { adapter: 0, directory: 0, releases: [] }
  let pair = 0
  const release = (tag) => () => calls.releases.push(tag)
  return {
    calls,
    deps: {
      registerAdapter: (ids) => {
        calls.adapter += 1
        const restoring = calls.adapter > 1
        if (!restoring && fail?.first) throw new Error('adapter registration refused')
        if (restoring && fail?.restore) throw new Error('host registration service is down')
        pair += 1
        return release(`adapter#${pair}`)
      },
      registerConfigurableProviders: (rows) => {
        calls.directory += 1
        const restoring = calls.directory > 1
        if (failFirst === 'rows-then-restore-ok' ? !restoring : fail?.directory) {
          throw new Error('settings row registration refused')
        }
        pair += 1
        return release(`directory#${pair}`)
      },
    },
  }
}

const target = (id = 'qoder-cn') => ({
  providerIds: [id],
  adapter: { name: `adapter:${id}` },
  directory: [row(id)],
  invalidate: () => {},
})

const previous = (id = 'qoder') => ({
  providerIds: [id],
  adapter: { name: `adapter:${id}` },
  directory: [row(id)],
  invalidate: () => {},
})

test('a clean publish hands back both releases and the new invalidate', () => {
  const h = host()
  const result = publishRegions(target(), undefined, { releaseAdapter: undefined, releaseDirectory: undefined }, h.deps)
  assert.equal(result.ok, true)
  assert.equal(h.calls.adapter, 1)
  assert.equal(h.calls.directory, 1)
  assert.equal(typeof result.releaseAdapter, 'function')
  assert.equal(typeof result.releaseDirectory, 'function')
})

test('publishing a new set releases the previous one first', () => {
  // The host is asked to offer the same provider ids, so the old pair cannot
  // still be held when the new one is registered. This ordering is what makes
  // the failure window real — and therefore what the rollback exists for.
  const h = host()
  const stale = { releaseAdapter: () => h.calls.releases.push('old-adapter'), releaseDirectory: () => h.calls.releases.push('old-directory') }
  const result = publishRegions(target(), previous(), stale, h.deps)
  assert.equal(result.ok, true)
  assert.deepEqual(h.calls.releases, ['old-adapter', 'old-directory'], 'both old releases run before registering')
})

test('a failing registration restores the pair that was serving', () => {
  // The property that matters most: a reload that FAILS must not take down a
  // region that was working before it. The old releases have already run by the
  // time the failure happens, so restoring is the only thing standing between a
  // bad reload and a plugin offering nothing.
  const h = host({ fail: { first: true } })
  const result = publishRegions(
    target('qoder-cn'),
    previous('qoder'),
    { releaseAdapter: () => {}, releaseDirectory: () => {} },
    h.deps,
  )
  assert.equal(result.ok, false)
  assert.match(String(result.error?.message), /adapter registration refused/, 'the original error is reported')
  assert.equal(h.calls.adapter, 2, 'it tried to re-register the previous adapter')
  // The directory was never reached on the failed publish (the adapter call
  // threw first), so the only directory call is the restore's.
  assert.equal(h.calls.directory, 1, 'and the previous settings rows with it')
  assert.equal(typeof result.releaseAdapter, 'function', 'the restored pair is what survives')
  assert.equal(typeof result.releaseDirectory, 'function')
})

test('a failure with no previous pair leaves nothing registered', () => {
  // First activation. There is nothing to restore, and claiming a registration
  // that does not exist would leave the host offering a provider that cannot
  // answer — the silent failure this module exists to prevent.
  const h = host({ fail: { first: true } })
  const result = publishRegions(target(), undefined, { releaseAdapter: undefined, releaseDirectory: undefined }, h.deps)
  assert.equal(result.ok, false)
  assert.equal(result.releaseAdapter, undefined)
  assert.equal(result.releaseDirectory, undefined)
  result.invalidate()
  assert.ok(true, 'invalidate is a no-op, not the dead registration')
})

test('a settings-row failure releases the adapter that had already registered', () => {
  // The asymmetric case. `registerAdapter` succeeded, then the directory
  // registration threw — so the adapter is live and must be undone, or the host
  // is left offering a provider with no settings row behind it.
  const h = host({ fail: { directory: true } })
  const result = publishRegions(target(), undefined, { releaseAdapter: undefined, releaseDirectory: undefined }, h.deps)
  assert.equal(result.ok, false)
  assert.equal(h.calls.adapter, 1, 'the adapter had registered before the rows failed')
  assert.equal(h.calls.releases.length, 1, 'and was released again')
  assert.match(h.calls.releases[0], /^adapter#/)
})

test('a settings-row failure with a previous pair restores it, adapter release included', () => {
  // The publish registers the adapter, then the settings rows throw. The
  // half-registered adapter is undone, and the previous pair — which needs BOTH
  // calls to succeed — comes back.
  const h = host({ failFirst: 'rows-then-restore-ok' })
  const result = publishRegions(
    target('qoder-cn'),
    previous('qoder'),
    { releaseAdapter: () => {}, releaseDirectory: () => {} },
    h.deps,
  )
  assert.equal(result.ok, false)
  // adapter#1 is the one that registered before the rows threw, and it is
  // released; adapter#2 is the restore.
  assert.equal(h.calls.releases.length, 1)
  assert.match(h.calls.releases[0], /^adapter#1$/, 'the half-registered adapter is undone, not the restored one')
  assert.equal(h.calls.adapter, 2)
  assert.equal(typeof result.releaseAdapter, 'function', 'the restored pair survives')
  assert.equal(typeof result.releaseDirectory, 'function')
})

test('when the restore itself fails midway, its partial adapter is undone', () => {
  // The worst case, and the one a single try/catch gets wrong: the restore
  // registers an adapter, THEN its settings rows fail. Returning
  // "nothing published" at that point drops the only handle that could undo the
  // live adapter registration — a provider the host still offers, with settings
  // rows that do not exist, and no way to release it. This test is the reason
  // the restore is two separate steps rather than one try block.
  const h = host({ fail: { directory: true } })
  const result = publishRegions(
    target('qoder-cn'),
    previous('qoder'),
    { releaseAdapter: () => {}, releaseDirectory: () => {} },
    h.deps,
  )
  assert.equal(result.ok, false)
  assert.equal(result.releaseAdapter, undefined, 'claims nothing')
  // adapter#1 = the failed publish's registration, adapter#2 = the restore's.
  // Both must be released, or two live registrations are left behind.
  assert.equal(h.calls.releases.length, 2, 'both the half-registered publish and the partial restore are undone')
  assert.deepEqual(h.calls.releases, ['adapter#1', 'adapter#2'])
})

test('when the previous pair cannot be restored either, nothing is claimed', () => {
  // The host's registration service is broken across the board: the publish
  // failed AND putting the previous pair back fails too. The honest end state
  // is an empty one — releases for a registration that does not exist would
  // strand the ports, and keeping a stale invalidate would re-announce an
  // adapter the host no longer holds.
  const h = host({ fail: { directory: true, restore: true } })
  const result = publishRegions(
    target('qoder-cn'),
    previous('qoder'),
    { releaseAdapter: () => {}, releaseDirectory: () => {} },
    h.deps,
  )
  assert.equal(result.ok, false)
  assert.equal(h.calls.adapter, 2, 'it did try the restore')
  assert.equal(result.releaseAdapter, undefined, 'but claims nothing')
  assert.equal(result.releaseDirectory, undefined)
})

test('a host that hands back no release is not treated as a broken one', () => {
  // `registerAdapter` is typed as returning a release OR nothing, so a host
  // that reclaims by fiber legitimately returns `undefined`. Calling it would
  // throw during dispose, which is the one place an exception is least useful.
  const result = publishRegions(target(), undefined, { releaseAdapter: undefined, releaseDirectory: undefined }, {
    registerAdapter: () => undefined,
    registerConfigurableProviders: () => undefined,
  })
  assert.equal(result.ok, true)
  assert.equal(result.releaseAdapter, undefined)
  assert.equal(result.releaseDirectory, undefined)
})

test('a release that throws is reported, and does not stop the other release', () => {
  // A swallowed release is a leak nobody can see. It must reach the logger, and
  // the second release — the one holding the settings rows — must still run.
  const reported = []
  const h = host()
  const result = publishRegions(target(), undefined, { releaseAdapter: undefined, releaseDirectory: undefined }, {
    ...h.deps,
    onRollbackFailed: (error) => reported.push(error),
  })
  assert.equal(result.ok, true)

  const noisy = host()
  publishRegions(target('qoder-cn'), previous('qoder'), {
    releaseAdapter: () => { throw new Error('release refused') },
    releaseDirectory: () => noisy.calls.releases.push('old-directory'),
  }, { ...noisy.deps, onRollbackFailed: (error) => reported.push(error) })
  assert.equal(noisy.calls.releases.length, 1, 'the second old release still ran')
  assert.ok(
    reported.some((error) => /release refused/.test(String(error?.message ?? error))),
    'the failure that did not complete is named, not swallowed',
  )
})

test('a rollback reporter that throws does not turn a handled failure into a crash', () => {
  // This runs on the way out of a reload the user is watching, and during
  // dispose. An exception there surfaces as a failed fiber cleanup somewhere the
  // user cannot act on.
  const h = host({ fail: { first: true } })
  const result = publishRegions(target(), undefined, { releaseAdapter: undefined, releaseDirectory: undefined }, {
    ...h.deps,
    onRollbackFailed: () => { throw new Error('the logger is down too') },
  })
  assert.equal(result.ok, false)
  assert.equal(result.releaseAdapter, undefined)
})

test('nothing to publish leaves the existing registration exactly as it was', () => {
  // The zero-region activation. "Nothing to do" has to mean literally nothing:
  // publishing an empty set would tear down regions that are serving.
  const h = host()
  const releases = { releaseAdapter: () => h.calls.releases.push('kept'), releaseDirectory: () => h.calls.releases.push('kept-rows') }
  const result = publishRegions(undefined, previous('qoder'), releases, h.deps)
  assert.equal(result.ok, true)
  assert.equal(h.calls.adapter, 0, 'no registration was attempted')
  assert.equal(h.calls.releases.length, 0, 'and nothing was released')
  assert.equal(result.releaseAdapter, releases.releaseAdapter, 'the caller keeps the releases it had')
  assert.equal(result.releaseDirectory, releases.releaseDirectory)
})

test('a release that throws while cleaning up a failed publish is reported too', () => {
  // The worst corner: the publish failed, and undoing its half-registration also
  // fails. Both facts need to reach the log — this is a leak that no amount of
  // later cleanup will notice, because nothing is left holding the handle.
  const reported = []
  const h = host({ fail: { directory: true } })
  const result = publishRegions(target(), undefined, { releaseAdapter: undefined, releaseDirectory: undefined }, {
    ...h.deps,
    registerAdapter: (ids) => () => { throw new Error('release of the half-registered adapter refused') },
    onRollbackFailed: (error) => reported.push(String(error?.message ?? error)),
  })
  assert.equal(result.ok, false)
  assert.ok(
    reported.some((line) => /release of the half-registered adapter refused/.test(line)),
    'the release that could not complete is named, not swallowed',
  )
})

test('a release that throws while undoing a partial restore is reported', () => {
  // The same corner one step further along: the restore registered an adapter,
  // its rows failed, and undoing that adapter failed as well.
  const reported = []
  let attempt = 0
  const result = publishRegions(
    target('qoder-cn'),
    previous('qoder'),
    { releaseAdapter: () => {}, releaseDirectory: () => {} },
    {
      registerAdapter: () => {
        attempt += 1
        // Only the restore's adapter (the second call) has a release that
        // throws on undo; the publish's adapter registers and stays.
        return attempt > 1 ? () => { throw new Error('restored adapter will not release') } : () => {}
      },
      registerConfigurableProviders: () => { throw new Error('settings row registration refused') },
      onRollbackFailed: (error) => reported.push(String(error?.message ?? error)),
    },
  )
  assert.equal(result.ok, false)
  assert.equal(result.releaseAdapter, undefined)
  assert.ok(
    reported.some((line) => /restored adapter will not release/.test(line)),
    'a stuck restore is the most important thing to log, and it is logged',
  )
})

test('the wiring in index.ts reaches this module and keeps no rollback of its own', () => {
  // Structural, like the other guards in this repository: `activate()` cannot be
  // imported, so the only thing a test can check about the call site is its
  // shape. The three-layer try/catch that used to live here is the thing most
  // worth confirming is gone — it is the code these tests now cover, and leaving
  // a second copy of it in the closure would mean one of the two is dead.
  const source = readFileSync(new URL('../src/host/index.ts', import.meta.url), 'utf8')
  assert.match(source, /import \{ publishRegions as publishRegionSet \} from '\.\/publish-regions\.ts'/)
  const call = /function publishRegions\(\)[^{]*\{[\s\S]*?\n  \}/.exec(source)
  assert.ok(call !== null, 'src/host/index.ts no longer has a publishRegions wrapper')
  const body = call[0]
  assert.match(body, /publishRegionSet\(/, 'the wrapper delegates to the tested module')
  assert.doesNotMatch(
    body,
    /catch\s*\{[\s\S]{0,200}?releaseAdapter = undefined/,
    'the three-layer rollback must not remain inline in index.ts',
  )
})
