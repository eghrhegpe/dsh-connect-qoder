/**
 * What sign-in state one Qoder region is in, from local evidence only.
 *
 * The states, in the order a machine can be:
 *
 * - **`ok`** — a credential is readable and not expired: either an app
 *   sign-in whose store says so, or an env PAT (the PAT never expires on its
 *   own, so presence is the whole test).
 * - **`expired`** — an app sign-in is readable but its store says the access
 *   token has lapsed. The fix is to sign in again in the app; nothing this
 *   module does can cure it.
 * - **`needs-app`** — an app directory for the region exists but yields no
 *   credential: the OSCrypt key could not be unwrapped, or the app is
 *   installed without a sign-in yet. `detail` carries the recorded unwrap
 *   reason when there is one, so the card can say *why* rather than showing a
 *   blank.
 * - **`signed-out`** — no app directory and no PAT: there is simply nothing
 *   to use on this machine.
 *
 * Two rules keep the module honest:
 *
 * - **No network.** Every state is decidable from local files (and the
 *   recorded unwrap outcome). The optional online confirmation the card
 *   offers is a separate route that calls `fetchUserInfo`; it refines an
 *   `ok`/`expired` state but is not what produces these states.
 * - **No credential.** The record hands back `name` / `email` / `expiresAt`
 *   — identity, for display — and never the token or its refresh half. The
 *   card is a browser surface; a token reaching it is a leak, and this
 *   module's output is the only account payload the card ever receives.
 *
 * Split out like `lib/credential-cache.js`: the decision has no Cordis
 * context of its own, so it can be asserted against the real code with the
 * store readers injected.
 *
 * @module dsh-connect-qoder/account-state
 */
import { existsSync } from 'node:fs'
import { join, basename } from 'node:path'
import {
  loadCredential,
  loadEnvCredential,
  describeUnwrapFailure as readUnwrapFailure,
  appDataRootFor,
} from './credentials.js'

/** The four states {@link readAccountState} can return. */
export const ACCOUNT_STATES = ['ok', 'expired', 'needs-app', 'signed-out']

/**
 * The app data directories a region probes, new layout first.
 *
 * The region descriptor lists two spellings (`newAppNames` for the 0.3.x
 * `com.<vendor>.app.<channel>` layout, `appNames` for the legacy
 * `<AppName>` one) and `loadCredential` tries them in that order; a present
 * directory is a present directory in either layout, so both are checked.
 */
function probeDirs(region, appDataRoot) {
  const names = [...(region.newAppNames ?? []), ...region.appNames]
  return names
    .map((name) => ({ name, path: join(appDataRoot, name) }))
    .filter((entry) => existsSync(entry.path))
}

/**
 * Read one region's sign-in state from local evidence.
 *
 * @param region - one entry of `REGIONS`.
 * @param appDataRoot - the application-data root the region's app directories
 *   live under; `undefined` falls back to `appDataRootFor()` (per-platform:
 *   `%APPDATA%`, `~/Library/Application Support`, or `$XDG_CONFIG_HOME`/`~/.config`),
 *   and `''` when none can be determined, which reads as "no app present".
 * @param options - dependency overrides, all optional:
 *   `loadCredential` / `loadEnvCredential` (the store readers) and
 *   `describeUnwrapFailure` (the recorded-cause reader).
 * @param options.cachedOnly - when true, the store reader is asked NOT to
 *   unwrap a new OSCrypt key. This is what the card's account route uses: the
 *   route runs on every panel render, and an unwrap is a synchronous PowerShell
 *   child with a 30 s timeout, so a machine that cannot unwrap would block the
 *   host's event loop once per render instead of showing the `needs-app` state
 *   the panel exists to explain (issue 07). The consequence is deliberate and
 *   visible: until something else unwraps the key — the startup refresh, the
 *   periodic catalog refresh, or the user pressing "重读登录" — the panel reads
 *   `needs-app`. That is the same state it would have shown anyway, reached
 *   without the freeze.
 * @param options.force - when true, bypass the unwrap failure window and read
 *   the store for real. This is the counterpart to `cachedOnly`, for the one
 *   request that IS a user-initiated re-read; without it, pressing "重读登录"
 *   inside the window would silently do nothing.
 * @returns a state record shaped as
 *   `{ region, displayName, manageUrl, state, source, appName, identity, detail }`,
 *   where `identity` is `{ name, email, expiresAt? }` or `undefined`, and
 *   carries no credential material of any kind.
 */
export function readAccountState(region, appDataRoot, options = {}) {
  const loadCred =
    options.loadCredential ??
    (options.cachedOnly === true
      ? (r, root) => loadCredential(r, root, { cachedOnly: true })
      : options.force === true
        ? (r, root) => loadCredential(r, root, { force: true })
        : loadCredential)
  const loadEnv = options.loadEnvCredential ?? loadEnvCredential
  const unwrapFailure = options.describeUnwrapFailure ?? readUnwrapFailure
  // `appDataRootFor` rather than `process.env.APPDATA`: the variable does not
  // exist off Windows, so reading it directly made every non-Windows host probe
  // `''` and report "not signed in" for a user who was.
  const appData = typeof appDataRoot === 'string' ? appDataRoot : appDataRootFor()
  const base = {
    region: region.id,
    regionName: region.displayName,
    manageUrl: region.manageUrl,
  }

  const credential = loadCred(region, appData) ?? loadEnv(region)
  if (credential !== undefined) {
    const identity = {
      name: typeof credential.name === 'string' ? credential.name : '',
      email: typeof credential.email === 'string' ? credential.email : '',
      // Epoch milliseconds, when the source has them. An env PAT carries no
      // expiry of its own (the exchange result's expiry is not local
      // evidence), so its identity simply has no `expiresAt`.
      ...(Number(credential.expiresAt) > 0 ? { expiresAt: Number(credential.expiresAt) } : {}),
    }
    return {
      ...base,
      state: credential.expired === true ? 'expired' : 'ok',
      source: credential.source,
      appName: credential.appName,
      identity,
      detail: undefined,
    }
  }

  const present = probeDirs(region, appData)
  if (present.length > 0) {
    // The first recorded cause wins: it is the one for the directory the
    // credential reader tried first, i.e. the one that actually gated the
    // read.
    const detail = present
      .map((entry) => unwrapFailure(entry.path))
      .find((reason) => reason !== undefined)
    return {
      ...base,
      state: 'needs-app',
      source: undefined,
      appName: basename(present[0].path),
      identity: undefined,
      detail: detail ?? 'the app is present but holds no sign-in',
    }
  }
  return {
    ...base,
    state: 'signed-out',
    source: undefined,
    appName: undefined,
    identity: undefined,
    detail: undefined,
  }
}
