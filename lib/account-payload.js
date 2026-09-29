/**
 * The payload behind the account panel's three routes.
 *
 * WHY THIS IS A MODULE AND NOT A CLOSURE IN lib/index.js
 *
 * It used to be a local arrow function there, and it stayed invisible to the
 * test suite for exactly as long as it stayed broken. `lib/index.js` imports the
 * Cordis peer packages, which this repository deliberately does not install, so
 * nothing in it can be imported by a test — and this payload called
 * `readAccountStateAsync` while the file's import line named only the
 * synchronous `readAccountState`. Every render of the account panel answered
 * `ReferenceError: readAccountStateAsync is not defined`, which escaped the
 * request handler into the host's catch-all and came back to the browser as a
 * bodyless 400 — the single line "读取账号状态失败" on an otherwise working
 * card, with nothing logged anywhere. The user saw it first. Nothing else
 * noticed: the model list, usage panel and generation were all fine because they
 * never touch this function.
 *
 * Moving it here puts the call where a test can execute it for real. The three
 * dependencies it needs are all peer-free already (`account-state`,
 * `credentials`, `preferences`), so this module has no Cordis contact at all —
 * same reasoning the README's table gives for every other extracted module.
 * `lib/index.js` now passes only what it uniquely owns: the regions and the
 * live settings snapshot.
 *
 * @module dsh-connect-qoder/account-payload
 */
import { readAccountStateAsync } from './account-state.js'
import { appDataRootFor } from './credentials.js'
import { regionEnabledFor } from './preferences.js'

/**
 * Build the account panel's answer for every region.
 *
 * Each record is one region's sign-in state PLUS `enabled` — whether that
 * region's provider is offered to DSH right now — and the response also carries
 * the whole `enabledRegions` map, because the panel's per-region switch posts a
 * complete map back on every flip. Both are resolved live so a save through the
 * settings pipeline shows up at the next render without a restart.
 *
 * `force` is what distinguishes the two callers: the GET reads with
 * `cachedOnly` (no unwrap — see issue 07; without it every panel render would
 * run a PowerShell child and stall the host on exactly the machines this panel
 * exists to explain), while "重读登录" reads for real. The SHAPE is identical
 * either way, which is why both share this function: a narrower reload body
 * once made the card follow every re-read with a second GET.
 *
 * @param options.regions - the region descriptors to report on.
 * @param options.settings - the live preferences snapshot.
 * @param options.force - read the store for real instead of from the key cache.
 * @param options.readAccountState - injected for tests; defaults to the async
 *   read this module imports.
 * @param options.appDataRoot - injected for tests; defaults to the resolved
 *   per-platform application-data root.
 * @param options.regionEnabled - injected for tests; defaults to the shared
 *   opt-out predicate.
 * @returns a promise of `{ regions, enabledRegions }`.
 */
export async function buildAccountPayload({
  regions,
  settings,
  force = false,
  readAccountState = readAccountStateAsync,
  appDataRoot = appDataRootFor(),
  regionEnabled = regionEnabledFor,
} = {}) {
  const enabledRegions = Object.fromEntries(
    regions.map((region) => [region.id, regionEnabled(settings, region.id)]),
  )
  // One mode object for every region: the panel's answer must be consistent
  // about HOW it was read, the same way it is consistent about what it read.
  const mode = force === true ? { force: true } : { cachedOnly: true }
  const states = await Promise.all(
    regions.map(async (region) => ({
      ...(await readAccountState(region, appDataRoot, mode)),
      enabled: enabledRegions[region.id],
    })),
  )
  return { regions: states, enabledRegions }
}
