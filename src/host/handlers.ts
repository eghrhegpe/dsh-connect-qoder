/**
 * The card route handlers, extracted from `src/host/index.ts`.
 *
 * WHY THIS IS A MODULE
 *
 * `index.ts` pulls in the Cordis peer dependencies at module scope, so a test
 * cannot import it — which meant every route's business decisions (which status
 * an unknown region answers with, what a refused save looks like, how a
 * protocol shape change is reported) could be wrong with the suite fully green
 * (docs/KNOWN_GAPS.md item 2（`RegionRuntime` 本身与 `activate` 的 Cordis 接线）).
 *
 * The request gates already live in `lib/routes.ts`; this module is the second
 * half of the same cut: the HANDLERS, shaped as `(req, res, deps) => Promise<void>`
 * with every non-peer dependency injected through `deps`. `index.ts` keeps only
 * the `webServer.register` calls and the deps assembly, so each handler here is
 * importable and directly assertable — the same `(input) => result` shape
 * `applySettingsSave` established for the settings pipeline.
 *
 * The bodies are verbatim moves from `activate()`; nothing here re-decides
 * anything. `claimTodayFor` (the check-in's interesting half) is extracted the
 * same way the account reload route was.
 *
 * @module dsh-connect-qoder/handlers
 */
import { isDeepStrictEqual } from 'node:util'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { sendJson } from './http-utils.ts'
import { methodAllowed, originAllowed, readJsonBody, readJsonBodyOr400 } from './routes.ts'
import { buildModelRowsPayload, projectModelRow } from './catalog-entry.ts'
import type { RateHelpers } from './catalog-entry.ts'
import { saveFieldOutcome } from './settings-save.ts'
import type { SettingsService } from './settings-save.ts'
import { classifyUpstreamError, describeThrown } from './errors.ts'
import {
  campaignIsClaimed,
  checkinStateFrom,
  claimableCampaignOf,
  normalizeClaimResult,
} from './claim.ts'
import { appDataRootFor, loadCredential, loadEnvCredential } from './credentials.ts'
import type { LoadedCredential } from './credentials.ts'
import { claimCampaign, fetchUserInfo, readCampaigns } from './upstream.ts'
import type { UsageSnapshot } from './upstream.ts'
import type { CatalogEntry, PluginLogger, Region } from './domain.ts'
import type { Preferences } from './preferences.ts'

/**
 * The runtime surface the routes read — a structural minimum of the
 * `RegionRuntime` `index.ts` builds, declared here so this module stays free of
 * the Cordis peer dependencies. See the structural rule in `domain.ts`.
 */
export interface RouteRuntimeLike {
  region: Region
  resolveCredential(): Promise<LoadedCredential | undefined>
  invalidateCredential(): void
  refreshCatalog(): Promise<void>
  readUsage(force?: boolean): Promise<UsageSnapshot | undefined>
  invalidateUsage(): void
  catalog: { current(): CatalogEntry[]; fetchedAt?: number }
  refreshFailed?: { reason: string; error?: unknown } | undefined
}

/** One started region, as the handlers see it. */
export interface RouteRuntimeEntry {
  region: Region
  runtime: RouteRuntimeLike
}

/** The settings the models route resolves rates and rows against. */
export interface ModelsDeps {
  started: RouteRuntimeEntry[]
  currentSettings: () => Preferences
  logger: PluginLogger
  /** The rate helpers `projectModelRow` calls, injected from the adapter. */
  rates: RateHelpers
}

/**
 * Serve the card's model roster.
 *
 * `refresh=1` re-reads the catalog from upstream. It matters because both the
 * roster and the rates move on their own: Qoder adds and retires models, and an
 * off-peak discount flips the effective price at 22:00 and 08:00 Asia/Shanghai.
 * Without this the picker would keep showing whatever was true at process
 * start.
 */
export async function modelsHandler(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ModelsDeps,
): Promise<void> {
  if (!methodAllowed(req, res, 'GET')) return
  if (!originAllowed(req, res)) return
  const force = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('refresh') === '1'
  if (force) {
    for (const { runtime } of deps.started) {
      try {
        await runtime.refreshCatalog()
      } catch (error) {
        // A refresh failure must not blank the card: the last good catalog is
        // still served below.
        deps.logger.warn?.(
          `dsh-connect-qoder: ${runtime.region.displayName} catalog refresh failed`,
          error,
        )
      }
    }
  }
  const now = new Date()
  sendJson(
    res,
    200,
    buildModelRowsPayload({
      runtimes: deps.started,
      settings: deps.currentSettings(),
      now,
      projectRow: projectModelRow,
      rates: deps.rates,
    }),
  )
}

/** The settings the save route writes through. */
export interface SaveDeps {
  /** The host settings service, or `undefined` when the host has none — the 503 path. */
  getSettings: () => SettingsService | undefined
  /** The namespace the HOST actually serves this plugin's settings under. */
  settingsNs: string
  /** The plugin's own namespace constant, the fallback candidate. */
  fallbackNs: string
  /** Re-publish the picker after a landed save. */
  refreshPicker: () => void
}

/**
 * Write one settings field through the authoritative Host endpoint.
 *
 * `webServer` alone is the point: the route mounts whether or not the settings
 * service exists, so the service-absent 503 is a real answer the client can
 * distinguish from a 404 (a host that does not serve this route at all) — the
 * false-"已保存" this closed, docs/issues/06.
 */
export async function saveHandler(
  req: IncomingMessage,
  res: ServerResponse,
  deps: SaveDeps,
): Promise<void> {
  if (!methodAllowed(req, res, 'POST')) return
  if (!originAllowed(req, res)) return
  try {
    const body = await readJsonBody(req)
    // `readJsonBody` is a raw reader — it parses JSON and nothing else, so the
    // shape is whatever the client sent. `saveFieldOutcome` validates it (a
    // non-string `field` is a 400 there, not a crash here) and answers the whole
    // verdict.
    const outcome = await saveFieldOutcome(deps.getSettings(), body, {
      // The live namespace first: on the 0.2 line `settingsNs` is the Loader
      // entry id (`llm-qoder`), and the constant is the fallback for a host that
      // mounts this plugin without a Loader entry. The two are the same value in
      // the entry case, so the list is what it is — no third candidate.
      candidates: [deps.settingsNs, deps.fallbackNs],
      equals: isDeepStrictEqual,
    })
    if (outcome.body.ok !== true) return sendJson(res, outcome.status, outcome.body)
    // No `Object.assign(preferences, …)` here, and its absence used to be a bug
    // report: `current()` resolves `{ ...snapshot, ...liveSource }`, so folding
    // the merged value in was dead in both directions (see the full note in
    // `index.ts`). The picker refresh is what makes a save reach the running
    // adapter without a restart.
    deps.refreshPicker()
    return sendJson(res, outcome.status, outcome.body)
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      errorName: (error as { name?: unknown } | undefined)?.name ?? 'unknown',
      error: describeThrown(error),
    })
  }
}

/** The regions the usage route reports on. */
export interface UsageDeps {
  started: RouteRuntimeEntry[]
  logger: PluginLogger
}

/**
 * Serve the credential-free usage summary.
 *
 * The quota lives upstream behind a bearer token the browser must never hold,
 * so the host reads it and hands the card a summary. Each region is read
 * independently and a failing region is reported as unavailable rather than
 * failing the panel, so one dead sign-in cannot hide the other region's
 * numbers.
 */
export async function usageHandler(
  req: IncomingMessage,
  res: ServerResponse,
  deps: UsageDeps,
): Promise<void> {
  if (!methodAllowed(req, res, 'GET')) return
  if (!originAllowed(req, res)) return
  const force = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('refresh') === '1'
  const regions = await Promise.all(
    deps.started.map(async ({ runtime }) => {
      const base = {
        region: runtime.region.id,
        regionName: runtime.region.displayName,
        manageUrl: runtime.region.manageUrl,
        downloadUrl: runtime.region.downloadUrl,
      }
      try {
        const usage = await runtime.readUsage(force)
        return usage === undefined ? { ...base, available: false } : { ...base, available: true, ...usage }
      } catch (error) {
        deps.logger.warn?.(
          `dsh-connect-qoder: ${runtime.region.displayName} usage read failed`,
          error,
        )
        return { ...base, available: false }
      }
    }),
  )
  sendJson(res, 200, { regions })
}

/** The started regions the check-in route can claim for. */
export interface CheckinDeps {
  started: RouteRuntimeEntry[]
  logger: PluginLogger
  /**
   * Claim one region's check-in. Defaults to {@link claimTodayFor}; injectable
   * so the route's status posture (200 / 502 / 404) is assertable without the
   * upstream network calls.
   */
  claim?: (runtime: RouteRuntimeLike) => Promise<ClaimOutcome>
}

/** What one claim call actually did, for the card to render. */
export interface ClaimOutcome {
  region: string
  claimed: boolean
  replayed: boolean
  amount?: number
  expiresAt?: number
  alreadyClaimed: boolean
  checkin: unknown
}

/** The upstream calls a claim makes, injectable so the orchestration is testable. */
export interface ClaimIo {
  readCampaigns: (region: Region, credential: LoadedCredential) => Promise<unknown>
  claimCampaign: (region: Region, credential: LoadedCredential, campaignId: string) => Promise<unknown>
}

/** The real upstream calls, used when a test injects no `io`. */
const realClaimIo: ClaimIo = { readCampaigns, claimCampaign }

/**
 * Claim one region's daily check-in, reporting what actually happened.
 *
 * Extracted from the route so the interesting part — which round gets claimed
 * and what the answer means — is assertable without a Cordis context. Same
 * `(input) => result` shape `applySettingsSave` established for the settings
 * pipeline.
 */
export async function claimTodayFor(runtime: RouteRuntimeLike, io: ClaimIo = realClaimIo): Promise<ClaimOutcome> {
  const credential = await runtime.resolveCredential()
  if (credential === undefined) throw new Error('no usable sign-in on this machine')

  const campaigns = await io.readCampaigns(runtime.region, credential)
  const campaign = claimableCampaignOf(campaigns)
  if (campaign === undefined) throw new Error('Qoder is not running a check-in for this account today')
  if (campaignIsClaimed(campaign)) {
    // Already collected today: posting anyway would buy a round trip to be told
    // the same thing, and the upstream would grant nothing.
    return {
      region: runtime.region.id,
      claimed: false,
      replayed: true,
      alreadyClaimed: true,
      checkin: checkinStateFrom(campaigns),
    }
  }

  // `campaignId` is not read by `claim.ts` on purpose — the card-facing state
  // never publishes it — but the CLAIM POST needs it, so it is read here off the
  // record the picker returned. An absent id is the upstream changing the
  // protocol, and `claimCampaign` answers a 400 for it rather than posting an
  // empty id.
  const campaignId = campaign.campaignId
  if (typeof campaignId !== 'string') throw new Error('campaign record carries no campaign id')

  const raw = await io.claimCampaign(runtime.region, credential, campaignId)
  const result = normalizeClaimResult(raw, campaign)
  if (result.claimed !== true) throw new Error('Qoder did not confirm this check-in')

  // The Credits land in the add-on quota this same panel renders, so the cached
  // reading is now wrong about the balance.
  runtime.invalidateUsage()

  // Read the result back instead of assuming it: a claim that the upstream
  // answered without recording would otherwise read as claimed forever.
  let checkin = { ...checkinStateFrom(campaigns), todayCheckedIn: true }
  try {
    checkin = checkinStateFrom(await io.readCampaigns(runtime.region, credential))
  } catch {
    // An unreadable acknowledgement still leaves a claimed round; the derived
    // state above is the most honest answer available.
  }
  return { region: runtime.region.id, ...result, alreadyClaimed: false, checkin }
}

/**
 * Claim the daily check-in for one named region.
 *
 * Nothing about it is automatic and nothing about it is guessed: the card names
 * the region, this host re-reads Qoder's own campaign list, and only a round
 * that is open and unclaimed is ever posted at. The card therefore cannot claim
 * a stale round even if it were to render one.
 */
export async function checkinHandler(
  req: IncomingMessage,
  res: ServerResponse,
  deps: CheckinDeps,
): Promise<void> {
  if (!methodAllowed(req, res, 'POST')) return
  if (!originAllowed(req, res)) return
  const requested = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('region')
  const entry = deps.started.find((candidate) => candidate.region.id === requested)
  if (entry === undefined) return sendJson(res, 404, { error: 'unknown-region' })
  try {
    const claim = deps.claim ?? ((runtime: RouteRuntimeLike) => claimTodayFor(runtime))
    sendJson(res, 200, await claim(entry.runtime))
  } catch (error) {
    // The one route where failure must name itself: an unusable sign-in, a
    // round that ended minutes ago, and a rejected claim are three different
    // problems wearing the same "nothing happened".
    deps.logger.warn?.(`dsh-connect-qoder: ${entry.region.displayName} check-in failed`, error)
    sendJson(res, 502, { error: error instanceof Error ? error.message : String(error) })
  }
}

/** The account panel's payload reader and logger. */
export interface AccountDeps {
  /** Read the per-region sign-in states; `force` re-reads the store for real. */
  payload: (options?: { force?: boolean; cachedOnly?: boolean }) => Promise<unknown> | unknown
  logger: PluginLogger
}

/**
 * Serve the account panel: which sign-in drives each region, and in which state
 * it is — all from local evidence, so reading it costs no network.
 *
 * The guard the RELOAD route carries, and this one did not: a throw from the
 * handler reaches the web server's catch-all, which answers a bodyless 400, and
 * the card can only render that as "读取账号状态失败" — with nothing anywhere
 * saying WHY. Crashing to a 500 with the reason at least names the step that
 * failed.
 */
export async function accountHandler(
  req: IncomingMessage,
  res: ServerResponse,
  deps: AccountDeps,
): Promise<void> {
  if (!methodAllowed(req, res, 'GET')) return
  if (!originAllowed(req, res)) return
  try {
    sendJson(res, 200, await deps.payload())
  } catch (error) {
    deps.logger.error?.('dsh-connect-qoder: account state read failed', error)
    sendJson(res, 500, {
      error: 'account state read failed',
      errorName: (error as { name?: unknown } | undefined)?.name ?? 'Error',
      detail: describeThrown(error).slice(0, 300),
    })
  }
}

/** The regions and runtimes the reload route widens. */
export interface ReloadDeps {
  regions: readonly Region[]
  started: RouteRuntimeEntry[]
  /** Start any region that is not running yet and re-publish the set. */
  startStoppedRegions: (onlyRegionId?: string) => Promise<void>
  /** The shared account payload; the reload answers with `force: true`. */
  payload: (options?: { force?: boolean; cachedOnly?: boolean }) => Promise<unknown> | unknown
  logger: PluginLogger
}

/**
 * Re-read the sign-ins, now.
 *
 * A sign-in that was missing or expired at activation never produced a runtime
 * for its region, so the fix is not just to invalidate the caches — it is to
 * (re)start the regions that are readable now and publish them. Answers with
 * the fresh account states so the card can re-render without a second round
 * trip.
 */
export async function reloadHandler(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ReloadDeps,
): Promise<void> {
  if (!methodAllowed(req, res, 'POST')) return
  if (!originAllowed(req, res)) return
  const read = await readJsonBodyOr400(req, res)
  if (read.ok !== true) return
  // As in the save route: the body's shape is the client's, so the read below
  // goes through an explicit narrowing rather than off `unknown`. A non-string
  // `region` is not an error here — it simply falls through to `undefined`,
  // which means "every region".
  const posted = (read.body ?? {}) as { region?: unknown }
  const wanted =
    typeof posted.region === 'string' && deps.regions.some((region) => region.id === posted.region)
      ? posted.region
      : undefined
  // "Re-read" for a running region means: drop the cached credential so the
  // next resolve re-reads the app store, and force a catalog refresh so the
  // picker sees what is readable now.
  for (const { runtime } of deps.started) {
    if (wanted !== undefined && runtime.region.id !== wanted) continue
    runtime.invalidateCredential()
    void runtime.refreshCatalog()
  }
  // A region with no runtime at all — no sign-in, or an expired one, at
  // activation — needs more: start it now, and publish the widened set. This is
  // the "re-sign in, and the region appears without a DSH restart" path.
  //
  // Guarded: a region that fails to start is left exactly as it was, and the
  // panel still gets its fresh states. Without the guard a throw here reached
  // the web server's catch-all, which answers a bare 400 with no body —
  // undiagnosable from the card, and it hid the whole panel.
  try {
    await deps.startStoppedRegions(wanted)
  } catch (error) {
    deps.logger.error?.('dsh-connect-qoder: account re-read failed to start a stopped region', error)
  }
  // `force: true` is deliberate and unlike the GET above: this is the user
  // pressing "重读登录", i.e. asking for the store to be read again right now.
  // The SHAPE is the shared `accountPayload` one, not a narrower `{ regions }` —
  // the card reads this response directly (issue 12, item 8).
  sendJson(res, 200, await deps.payload({ force: true }))
}

/** The regions and runtimes the confirm route reads. */
export interface ConfirmDeps {
  regions: readonly Region[]
  started: RouteRuntimeEntry[]
  /**
   * Online identity check. Defaults to the real `fetchUserInfo`; injectable so
   * the route's classification posture (confirmed / sign-in-expired /
   * unavailable) is assertable without the upstream call.
   */
  confirmUserInfo?: (region: Region, credential: LoadedCredential) => Promise<{ name: unknown; email: unknown }>
}

/**
 * Confirm one region's sign-in is still valid, online.
 *
 * The card's confirm button. Calls `fetchUserInfo` with the region's credential
 * and reports whether the upstream still accepts it — the one network call in
 * the account flow, kept behind its own route so an account render stays
 * network-free.
 */
export async function confirmHandler(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ConfirmDeps,
): Promise<void> {
  if (!methodAllowed(req, res, 'POST')) return
  if (!originAllowed(req, res)) return
  const read = await readJsonBodyOr400(req, res)
  if (read.ok !== true) return
  // Same narrowing as the reload route: `find` comparing against `entry.id` is
  // the validity check, so a missing or non-string `region` simply matches
  // nothing and the 400 below answers it.
  const posted = (read.body ?? {}) as { region?: unknown }
  const region = deps.regions.find((entry) => entry.id === posted.region)
  if (region === undefined) return sendJson(res, 400, { error: 'unknown region' })
  const runtime = deps.started.find((entry) => entry.region.id === region.id)?.runtime
  // Resolving a credential can now throw two ways the route has to answer for:
  // a failed PAT exchange, and the exchange throttle refusing to re-probe a
  // window the platform stated. Without this catch the confirmation press would
  // reach the web server's catch-all as a bare 400 for a whole window at a
  // time. The card maps `available: false` to "unavailable" and carries the
  // detail through.
  let credential
  try {
    credential =
      runtime !== undefined
        ? await runtime.resolveCredential()
        : loadCredential(region, appDataRootFor()) ?? loadEnvCredential(region)
  } catch (error) {
    return sendJson(res, 200, {
      region: region.id,
      available: false,
      detail: describeThrown(error).slice(0, 300),
    })
  }
  if (credential === undefined) return sendJson(res, 200, { region: region.id, available: false })
  try {
    const check = deps.confirmUserInfo ?? fetchUserInfo
    const info = await check(region, credential)
    // Identity only: the panel is a browser surface, and a userID is account
    // data the card never renders, so it is dropped here rather than carried to
    // the browser.
    return sendJson(res, 200, {
      region: region.id,
      available: true,
      confirmed: true,
      identity: { name: info.name, email: info.email },
    })
  } catch (error) {
    // Classify the way the shim does: a sign-in rejection is the one answer
    // that changes what the user should do (re-sign in, then re-read), so it is
    // named; everything else is a plain "could not confirm" with the transport
    // detail.
    const message = describeThrown(error)
    const kind = classifyUpstreamError({ message }, '', message).kind
    if (kind === 'sign-in-expired' && runtime !== undefined) {
      // The upstream said this credential is dead: treat it as the sign-in
      // rejection it is, so the re-read after a re-sign-in picks up the fresh
      // store.
      runtime.invalidateCredential()
    }
    return sendJson(res, 200, {
      region: region.id,
      available: true,
      confirmed: false,
      kind: kind === 'sign-in-expired' ? 'sign-in-expired' : 'unavailable',
      detail: message.slice(0, 300),
    })
  }
}
