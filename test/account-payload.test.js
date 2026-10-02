/**
 * The account panel's payload, executed for real.
 *
 * WHY THESE ASSERTIONS EXIST (read before adding to them)
 *
 * This function was born from a defect no gate could see. It lived as a closure
 * inside src/host/index.ts — a file no test can import, because the Cordis peers are
 * deliberately not installed — and it called `readAccountStateAsync` while its
 * import line named only the synchronous `readAccountState`. Every account-panel
 * render therefore threw `ReferenceError`, escaped the request handler, and came
 * back to the browser as a bodyless 400, which the card renders as the single
 * line "读取账号状态失败". Models, usage and generation were all unaffected,
 * because they do not go through this function, so the card read as "half broken"
 * for reasons no log explained.
 *
 * The fix for that class of defect is not a smarter static check — it is putting
 * the call somewhere a test EXECUTES. So the "defaults are wired" test below
 * deliberately does not inject a reader: it runs the module's own default path,
 * and a missing or misnamed import inside the module fails right here instead of
 * in a user's browser.
 *
 * Everything else here pins the shape both routes depend on: GET reads cached,
 * "重读登录" reads forced, and both must answer the SAME body (a narrower
 * reload answer once forced the card to fire a second GET after every re-read).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildAccountPayload } from '../src/host/account-payload.ts'
import { REGIONS } from '../src/host/credentials.ts'

/**
 * A region shaped like a real one, but with nothing on disk to find.
 *
 * Derived from the shipped REGIONS rather than typed out here: a hand-written
 * descriptor drifts the moment someone adds a field the reader walks — which is
 * exactly how my first version of this fixture failed, on `patEnvNames`. Only
 * the three "where to look" lists are replaced, so the read stays side-effect
 * free and answers `signed-out`.
 */
const unprobeableRegion = (index = 0) => ({
  ...REGIONS[index],
  appNames: ['__no_such_app_dir_legacy__'],
  newAppNames: ['__no_such_app_dir__'],
  patEnvNames: ['__QODER_PROBE_NO_SUCH_ENV__'],
})

/** Record what the injected reader was asked, so the mode can be asserted. */
function recordingReader(state) {
  const calls = []
  const reader = async (region, appDataRoot, mode) => {
    calls.push({ region: region.id, appDataRoot, mode })
    return {
      region: region.id,
      regionName: region.displayName,
      manageUrl: region.manageUrl,
      downloadUrl: region.downloadUrl,
      state,
      source: undefined,
      appName: undefined,
      identity: undefined,
      detail: undefined,
    }
  }
  return { reader, calls }
}

test('the default read path is wired: no injected reader, no reference error', async () => {
  // The whole point of this file. Runs the module's own imports, so removing or
  // misnaming one fails HERE rather than as a bodyless 400 in someone's browser.
  const appDataRoot = mkdtempSync(join(tmpdir(), 'qoder-account-payload-'))
  const payload = await buildAccountPayload({
    regions: [unprobeableRegion(0)],
    settings: {},
    appDataRoot,
  })
  assert.equal(payload.regions.length, 1)
  assert.ok(payload.regions[0].state === 'signed-out', `expected signed-out for an absent app, got ${payload.regions[0].state}`)
  assert.equal(payload.regions[0].enabled, true, 'a region with no switch value reads as offered')
  assert.deepEqual(payload.enabledRegions, { 'qoder-cn': true })
})

test('each region carries its own switch state alongside the sign-in state', async () => {
  const { reader } = recordingReader('ok')
  // `preferences.regionEnabledFor` semantics: only an explicit false turns it off.
  const settings = { enabledRegions: { 'qoder-cn': false } }
  const payload = await buildAccountPayload({
    regions: [unprobeableRegion(0), unprobeableRegion(1)],
    settings,
    readAccountState: reader,
    appDataRoot: '/nonexistent',
  })
  assert.deepEqual(payload.enabledRegions, { 'qoder-cn': false, qoder: true })
  assert.equal(payload.regions.find((entry) => entry.region === 'qoder-cn').enabled, false)
  assert.equal(payload.regions.find((entry) => entry.region === 'qoder').enabled, true)
})

test('the plain GET reads cached, and never unwraps a key', async () => {
  const { reader, calls } = recordingReader('ok')
  await buildAccountPayload({
    regions: [unprobeableRegion(0)],
    settings: {},
    readAccountState: reader,
    appDataRoot: '/nonexistent',
  })
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].mode, { cachedOnly: true })
  assert.equal(calls[0].appDataRoot, '/nonexistent', 'every region is read against one root')
})

test('re-read sign-in reads the store for real', async () => {
  const { reader, calls } = recordingReader('ok')
  await buildAccountPayload({
    regions: [unprobeableRegion(0)],
    settings: {},
    force: true,
    readAccountState: reader,
    appDataRoot: '/nonexistent',
  })
  assert.deepEqual(calls[0].mode, { force: true })
})

test('both routes answer the same body shape', async () => {
  const shared = {
    regions: [unprobeableRegion(0), unprobeableRegion(1)],
    settings: { enabledRegions: { qoder: false } },
    appDataRoot: '/nonexistent',
  }
  const cached = await buildAccountPayload({ ...shared, readAccountState: recordingReader('ok').reader })
  const forced = await buildAccountPayload({ ...shared, force: true, readAccountState: recordingReader('ok').reader })
  assert.deepEqual(Object.keys(cached).sort(), ['enabledRegions', 'regions'])
  assert.deepEqual(Object.keys(forced).sort(), ['enabledRegions', 'regions'])
  assert.deepEqual(cached.enabledRegions, forced.enabledRegions, 'the switch map must not depend on how the sign-in was read')
  assert.deepEqual(
    cached.regions.map((entry) => Object.keys(entry).sort()),
    forced.regions.map((entry) => Object.keys(entry).sort()),
  )
})

test('the regions are read concurrently, not one 0.5 s freeze after another', async () => {
  // Asserted by execution rather than by pattern-matching `Promise.all` into the
  // source: the forced path really does unwrap (~0.5 s of PowerShell per region,
  // measured), and reading the two regions in series would put that back on the
  // host's event loop — the whole thing the async reader exists to avoid.
  const started = []
  const reader = async (region) => {
    started.push(region.id)
    await new Promise((resolve) => setTimeout(resolve, 40))
    return { region: region.id, state: 'ok' }
  }
  const before = Date.now()
  await buildAccountPayload({
    regions: [unprobeableRegion(0), unprobeableRegion(1)],
    settings: {},
    readAccountState: reader,
    appDataRoot: '/nonexistent',
  })
  const elapsed = Date.now() - before
  assert.deepEqual(started, ['qoder-cn', 'qoder'])
  assert.ok(elapsed < 70, `two 40 ms reads took ${elapsed} ms — they were serialized`)
})

test('one region failing fails the read rather than dropping it silently', async () => {
  await assert.rejects(
    buildAccountPayload({
      regions: [unprobeableRegion(0), unprobeableRegion(1)],
      settings: {},
      appDataRoot: '/nonexistent',
      readAccountState: async (region) => {
        // A silent half-answer here once looked like "only one region is broken"
        // while the card had no idea anything had failed at all.
        if (region.id === 'qoder') throw new Error('store unreadable')
        return { region: region.id, state: 'ok' }
      },
    }),
    /store unreadable/,
    'the caller (the route handler) is the one that turns this into a 500, not this function',
  )
})
