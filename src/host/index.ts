/**
 * DSH Connect Qoder — bring locally signed-in Qoder models into DeepSeek
 * Harness.
 *
 * The Qoder desktop apps (Qoder CN and the international Qoder) already hold a
 * valid sign-in on this machine. This bundle reads that sign-in, registers one
 * DSH provider per region, and routes each region's traffic through a private
 * loopback shim that speaks OpenAI to pi-ai and COSY-signed Qoder on the way
 * out.
 *
 * Both regions register unconditionally and independently: whichever apps are
 * signed in produce a visible model group, and a region with no credential
 * simply contributes no models. Nothing here starts an OAuth flow, and nothing
 * writes to the Qoder apps' own files.
 *
 * @module dsh-connect-qoder
 */
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { join } from 'node:path'
import z from '@deepseek-ai/schemastery'
import { resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm'
import { createQoderAdapter, offPeakActive, offPeakRemaining, rateNow } from './adapter.ts'
import { createQoderShim } from './shim.ts'
import type { ShimHandle } from './shim.ts'
import {
  REGIONS,
  loadCredentialAsync,
  loadEnvCredential,
  appDataRootFor,
} from './credentials.ts'
import { sweepStaleOscryptDirs, setCredentialDiagnosticSink } from './oscrypt-unwrap.ts'
import { buildAccountPayload } from './account-payload.ts'
import { CredentialCache } from './credential-cache.ts'
import type { CredentialKind } from './credential-kind.ts'
import { CredentialVault } from './credential-vault.ts'
import { DeviceCredentialSource } from './device-credential.ts'
import { FileThrottleStore } from './throttle-store.ts'
import { settingsNamespaceOf } from './settings-save.ts'
import type { SettingsService } from './settings-save.ts'
import { createSingleFlight, type SingleFlight } from './single-flight.ts'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  enabledIdsFor as resolveEnabledIds,
  imageModeFor as resolveImageMode,
  preferMaximumContext as prefersMaximumContext,
  regionEnabledFor as resolveRegionEnabled,
  resolvePreferences,
} from './preferences.ts'
import type { Preferences } from './preferences.ts'
import { CatalogStore, CATALOG_TTL_MS as catalogTtlMs } from './catalog-store.ts'
import { RosterSeenStore } from './roster-seen-store.ts'
import { normalizeEntry } from './catalog-entry.ts'
import type { FetchedEntry } from './catalog-entry.ts'
import type { RouteRelease } from './lifecycle.ts'
import type { CatalogEntry, CatalogOutcome, HostContext, PluginLogger, RefreshFailure, RefreshFailureReason, Region } from './domain.ts'
import { applyCatalogOutcome, isRefreshObsolete } from './catalog-refresh.ts'
import { releaseRoutes } from './lifecycle.ts'
import { mountRouteGroup } from './route-mount.ts'
import { requireInjected } from './injected.ts'
import { disposeFiber, disposeLateEntry } from './dispose-order.ts'
import { publishRegions as publishRegionSet } from './publish-regions.ts'
import { __dshQoderUmidState, exchangePat, fetchModels, fetchUsage } from './upstream.ts'
import type { UsageSnapshot } from './upstream.ts'
import { isProtocolShapeChangedError, thrownFlag } from './errors.ts'
import { RequestCounter } from './request-counter.ts'
import { TokenCounter } from './token-counter.ts'
import {
  modelsHandler,
  saveHandler,
  usageHandler,
  checkinHandler,
  accountHandler,
  reloadHandler,
  confirmHandler,
  statusHandler,
  deviceLoginStartHandler,
  deviceLoginPollHandler,
  deviceLoginCancelHandler,
  deviceLoginSignOutHandler,
  createTokenHistoryCache,
} from './handlers.ts'
import type { DeviceLoginDeps, TokenHistoryCache } from './handlers.ts'
import { DeviceLoginFlow } from './device-login-flow.ts'
import { regionPublishDecision, unreadableSignInDecision } from './region-gate.ts'

/** Loader row id; also the plugin's identity in the composition. */
export const name = 'llm-qoder'

/** The model registry that must exist before a provider can register. */
export const inject = ['llm']

/**
 * Settings namespace owning this plugin's section.
 *
 * A namespace only becomes configurable once a section is installed into it —
 * `registerConfigurableProviders` merely *addresses* the namespace. Without the
 * section there is no schema, so no configuration surface can render a control
 * for this route at all.
 */
export const QODER_SETTINGS_NS = 'dsh-connect-qoder'

/**
 * The settings fields a `__save` request may write, and the merge rule each
 * one uses, live in lib/settings-save.js — alongside the write-and-verify logic
 * that uses them, which is what the tests exercise.
 */

/** Plugin-owned route the settings card's save button writes through. */
const QODER_SAVE_PATH = '/plugins/dsh-connect-qoder/__save'

/**
 * Why every settings field in this module ends in `.volatile()`.
 *
 * A volatile field hands the Host a live reference (`{get()}`) that
 * re-resolves on every `loader/volatile-update` — that is how settings
 * edits reach a running host without a restart. The Host's `__save` route
 * unwraps the reference before merging and mutating, and the live
 * `current()` below resolves it the same way. This plugin targets the 0.2
 * host line, whose bundled schemastery (≥ 3.18.3) always carries
 * `Schema.volatile()`, so the fields call it directly; there is no no-op
 * fallback for an older schemastery to degrade to.
 */

/**
 * The `id` of a catalog entry, or `undefined` when it has none.
 *
 * `CatalogLike.current()` is `unknown[]` (see its doc), and every lookup by
 * model id goes through here rather than reading `entry.id` directly. An entry
 * that is not an object, or whose `id` is not a string, matches nothing —
 * which is the same "not this model" answer the old `entry.id === modelId`
 * gave, except that it no longer throws on a malformed row.
 */
function idOf(entry: unknown): string | undefined {
  const id = (entry as { id?: unknown } | null | undefined)?.id
  return typeof id === 'string' ? id : undefined
}

/**
 * Prefer the largest context window the catalog declares for a model.
 *
 * Qoder's catalog offers 200K/400K/1M for most models and flags one as its own
 * default. This switch decides whether this plugin advertises the largest
 * offered window or the one Qoder itself starts on.
 */
const USE_MAXIMUM_CONTEXT_WINDOW_FIELD = z
  .boolean()
  .default(false)
  .description('Advertise each model\'s largest declared context window instead of Qoder\'s own default window')
  .volatile()

/**
 * Per-model image-input opt-in, keyed by user-facing model id.
 *
 * Qoder's catalog advertises `is_vl` per model and this plugin maps it straight
 * onto the pi-ai `input` list, so a vision model arrives already declaring
 * image input. The user still owns the final say: an entry here overrides the
 * catalog for one model, which is what lets a model the catalog marks text-only
 * (or one the endpoint rejects images for) be turned off — and what lets a
 * mislabelled model be turned on. Absent means "follow `is_vl`".
 */
const IMAGE_MODES = ['auto', 'on', 'off']

/** One model's image preference. */
const IMAGE_OVERRIDES_FIELD = z
  .dict(z.union(IMAGE_MODES))
  .default({})
  .description('Per-model image input: "auto" follows the catalog, "on"/"off" force it')
  .volatile()

/**
 * Which models the picker offers, per region.
 *
 * An **empty list means "no filter"**, not "nothing": that is the same
 * convention the WorkBuddy bundle uses, and it is what keeps a fresh install
 * working — a new user has saved nothing yet, and must still see every model.
 * Once a list is non-empty it becomes an allow-list for that region.
 *
 * Keyed by region id (`qoder-cn`, `qoder`) so the two editions can be curated
 * independently; the CN and global rosters share no model ids.
 */
const ENABLED_MODEL_IDS_FIELD = z
  .dict(z.array(z.string()))
  .default({})
  .description('Per-region allow-list of model ids; an empty list shows every model')
  .volatile()

/**
 * Which editions offer their models to DSH at all, per region.
 *
 * The account panel's per-region "models" switch writes this field through the
 * settings pipeline. Declaring it here is not optional: the host validates
 * every `settings.mutate` field against this schema and accepts only fields
 * that are declared AND volatile — an undeclared field is refused with
 * `Config field "enabledRegions" is not volatile`, and the card's switch dies
 * with that error. Opt-out semantics match `regionEnabledFor` in
 * lib/preferences.js: a missing key (or a missing map) means offered, and only
 * an explicit `false` turns a region's models off.
 */
const ENABLED_REGIONS_FIELD = z
  .dict(z.boolean())
  .default({})
  .description('Per-region provider switch; a missing key is offered, only an explicit false disables')
  .volatile()

/** The plugin's whole configuration schema. */
export const Config = z.object({
  useMaximumContextWindow: USE_MAXIMUM_CONTEXT_WINDOW_FIELD,
  imageOverrides: IMAGE_OVERRIDES_FIELD,
  enabledModelIds: ENABLED_MODEL_IDS_FIELD,
  enabledRegions: ENABLED_REGIONS_FIELD,
})

/** Plugin-owned read-only route the settings card reads its model rows from. */
const QODER_MODELS_PATH = '/plugins/dsh-connect-qoder/models'

/**
 * Plugin-owned read-only route that answers "did this plugin finish coming up,
 * and if not, at which step".
 *
 * It always exists and always answers, so "still activating" and "this plugin
 * serves no such route" stay distinguishable — a failed `llm` registration used
 * to look like the latter (docs/issues/20). It reports the provider-registration
 * step only: the one step whose failure does not stop the card from being
 * available.
 */
const QODER_STATUS_PATH = '/plugins/dsh-connect-qoder/status'

/**
 * The rate helpers `projectModelRow` resolves against, passed in rather than
 * imported there so that projection stays a pure, directly testable function.
 */
const MODEL_RATES = { rateNow, offPeakActive, offPeakRemaining }

/**
 * Plugin-owned read-only route the card reads its usage panel from.
 *
 * Kept separate from the model route so the panel can be refreshed on its own:
 * quota moves with every turn, while the catalog changes rarely.
 */
const QODER_USAGE_PATH = '/plugins/dsh-connect-qoder/usage'

/**
 * Plugin-owned write route: "claim today's check-in".
 *
 * The one route in this plugin that changes something on Qoder's side, and the
 * reason it is shaped the way `dsh-connect-workbuddy`'s own check-in route is:
 * region-scoped, POST-only, loops back through this host rather than letting
 * the card talk to Qoder directly.
 *
 * Every claim re-reads the campaign list first. Qoder publishes a new round —
 * and therefore a new campaign id — each day, so nothing about today's round
 * may be carried over from an earlier render.
 */
const QODER_CHECKIN_PATH = '/plugins/dsh-connect-qoder/checkin'

/**
 * Plugin-owned read-only route the card reads its account panel from.
 *
 * Answers with one state record per region from `lib/account-state.js`:
 * which sign-in drives this machine, in which state it is, and — for the
 * "cannot read" state — the recorded cause. Identity only, no credential:
 * this is a browser-visible surface.
 */
const QODER_ACCOUNT_PATH = '/plugins/dsh-connect-qoder/account'

/**
 * Plugin-owned write route: "re-read the sign-ins, now".
 *
 * The card's reload button. A sign-in that was missing or expired at
 * activation never produced a runtime for its region, so the fix is not just
 * to invalidate the caches — it is to (re)start the regions that are readable
 * now and publish them. Answers with the fresh account states so the card
 * can re-render without a second round trip.
 */
const QODER_ACCOUNT_RELOAD_PATH = '/plugins/dsh-connect-qoder/account/reload'

/**
 * Plugin-owned write route: "is this region's sign-in still valid, online?".
 *
 * The card's confirm button. Calls `fetchUserInfo` with the region's
 * credential and reports whether the upstream still accepts it — the one
 * network call in the account flow, kept behind its own route so an
 * account render stays network-free.
 */
const QODER_ACCOUNT_CONFIRM_PATH = '/plugins/dsh-connect-qoder/account/confirm'

/**
 * Begin a device sign-in: answers with the URL the user approves in a browser.
 *
 * The Plugin's own sign-in, not the desktop application's. Four routes rather
 * than one because the user's part takes up to five minutes: holding a request
 * open for that long would occupy a route per attempt and lose the attempt if
 * the panel was reloaded. The card polls.
 */
const QODER_DEVICE_LOGIN_START_PATH = '/plugins/dsh-connect-qoder/device-login/start'

/** One poll of a pending attempt; the card repeats it until it resolves. */
const QODER_DEVICE_LOGIN_POLL_PATH = '/plugins/dsh-connect-qoder/device-login/poll'

/** Abandon a pending attempt (the user closed the panel, or changed their mind). */
const QODER_DEVICE_LOGIN_CANCEL_PATH = '/plugins/dsh-connect-qoder/device-login/cancel'

/**
 * Delete this plugin's stored credential.
 *
 * Only the plugin's own file: the desktop application's login, a PAT in the
 * environment, and the other region's file are untouched, and the answer says
 * so rather than leaving the user to discover it.
 */
const QODER_DEVICE_LOGIN_SIGNOUT_PATH = '/plugins/dsh-connect-qoder/device-login/signout'

/**
 * How long a fetched usage reading stays fresh.
 *
 * Quota moves only when a turn runs, so a short cache keeps the panel honest
 * without turning every card render into an upstream round trip. The refresh
 * button bypasses it.
 */
const USAGE_TTL_MS = 20 * 1000

/** How long a fetched catalog stays fresh before it is refetched. */
const CATALOG_TTL_MS = catalogTtlMs

/** Plugin-owned catalog path inside the Harness home. */
export function qoderCatalogPath(filename = '.qoder-catalog.json') {
  return join(resolveDshHome(), filename)
}

/**
 * One region's own credential file, and the reader/rotator over it.
 *
 * The path follows the catalog's and the PAT throttle's convention
 * (`.qoder-*.<region>.json`): one file per region, so switching tabs cannot
 * cross credentials and signing out of one edition cannot delete the other's.
 * It lives under the Harness home rather than the application's data root on
 * purpose — this file is the plugin's, not the application's, and it is the one
 * credential the user obtained through the plugin.
 *
 * Returned to every caller that needs THE instance for a region (the runtime
 * that resolves with it, the routes that read and clear it), because two
 * instances over one path would mean two failure windows and two stale caches.
 */
function deviceSourceFor(region: Region, ctx: HostContext): DeviceCredentialSource {
  return new DeviceCredentialSource({
    region: region.id,
    vault: new CredentialVault({
      path: qoderCatalogPath(`.qoder-auth.${region.id}.json`),
      logger: ctx.logger,
    }),
    logger: ctx.logger,
  })
}

/**
 * One region's credential cache: the desktop store, the plugin's own
 * credential and the PAT, in that order, with the PAT exchange and its
 * throttle.
 *
 * Built here rather than inside {@link RegionRuntime} so the confirm route can
 * resolve a credential for a region that has no runtime yet, through the SAME
 * cache that runtime would use — one store read, one PAT exchange and one
 * invalidation per region, instead of two caches over one credential.
 */
function credentialCacheFor(
  region: Region,
  ctx: HostContext,
  device: DeviceCredentialSource,
): CredentialCache {
  return new CredentialCache({
    // The ASYNC reader: a miss here spawns the DPAPI child, which measured
    // ~0.5 s of event-loop freeze per region on the success path and up to the
    // 30 s timeout on failure. `CredentialCache.resolve` is already async, so
    // awaiting costs nothing and removes the freeze from DSH's request paths
    // entirely. The synchronous `loadCredential` remains for the startup
    // sweep and the probes, which are not on anyone's latency budget.
    loadApp: () => loadCredentialAsync(region, appDataRootFor()),
    // Third source, and deliberately THIRD: the desktop application keeps its
    // own login fresh while it runs, so wherever it answers it is the newest
    // credential on the machine and must win. The vault is only reached when
    // the app has nothing to say — which is the machine that has no app
    // installed, or whose app is not signed in. That ordering is also why
    // this is safe to ship: on every machine that works today the answer is
    // unchanged, and the vault is not even read.
    loadDevice: () => device.load(),
    loadEnv: () => loadEnvCredential(region),
    exchangePat: async (credential) => exchangePat(region, credential.token),
    // The PAT exchange throttle is persisted so a platform-stated rate-limit
    // window survives a DSH restart. Without it the first poll after a restart
    // would re-POST an exchange the platform had just locked out, extending a
    // transient lockout toward permanent — the runaway the gate exists to
    // break. A parked dead-credential refusal is deliberately NOT written; a
    // restart is that refusal's release valve, and only a deliberate re-read
    // inside a live process clears it. See `throttle-store.ts`.
    throttleStore: new FileThrottleStore({
      path: qoderCatalogPath(`.qoder-exchange-throttle.${region.id}.json`),
      logger: ctx.logger,
    }),
  })
}

/**
 * The per-region sources a runtime starts from.
 *
 * One map, built once per plugin instance, so the runtime and the routes that
 * read the same region are guaranteed to be talking about the same two
 * objects — a second device source over one file would mean two failure
 * windows and two stale caches of the same credential.
 */
interface RegionSources {
  /** The plugin's own credential for this region — the file the browser sign-in writes. */
  device: DeviceCredentialSource
  /** The credential cache: the desktop store, then the plugin's own credential, then the PAT. */
  credentials: CredentialCache
  /**
   * Which credential path is serving this region, as far as the host knows.
   *
   * `undefined` until something has been resolved — the panel render path
   * deliberately does not resolve (see issue 07), so on a machine where the
   * panel is the first thing to run, the host may not know yet. The card falls
   * back to what it can infer in that case; the point of this field is that
   * once the host DOES know, the card stops guessing.
   */
  credentialKind: () => CredentialKind | undefined
}

/**
 * One region that came up: the runtime that owns it, and the shim serving it.
 *
 * Named because the activation, the card routes and the reload route all talk
 * about the same three things — an inline anonymous type repeated in each of
 * them is three places for the shape to drift, and the drift would be silent:
 * a route that expects a `shim` the activation stopped providing would answer
 * with a model list that no longer matches what the host serves.
 */
interface StartedRegion {
  /** The region descriptor this entry answers for. */
  region: Region
  /** The runtime that owns the region's credential, catalog and usage. */
  runtime: RegionRuntime
  /** The loopback shim the adapter's models are served through. */
  shim: ShimHandle
}

/**
 * Owns one region: its credential, catalog, shim, adapter, and registration.
 */
class RegionRuntime {
  /** The region descriptor this runtime owns. */
  region: Region
  /** The Cordis context this runtime was activated with. */
  ctx: HostContext
  /** The plugin logger. */
  logger: PluginLogger
  /** The on-disk catalog cache for this region. */
  catalog: CatalogStore
  /**
   * When each model in this region's roster was first seen, so the composer
   * pill can mark the ones that arrived recently.
   *
   * It is the plugin's OWN history, not a gateway fact: Qoder's catalog rows
   * carry no "listed since" field, so "new to this user" can only mean "absent
   * from the roster this plugin wrote down last time". The wording downstream
   * says exactly that ("本机首次见到"), never "网关新增".
   *
   * Written on the refresh commit path only — never by the models route, which
   * is a GET and documents itself as not changing state. See
   * {@link RegionRuntime.noteRoster}.
   */
  rosterSeen: RosterSeenStore
  /** The per-region credential cache. */
  credentials: CredentialCache
  /**
   * The region's own credential — the one device login obtained — kept in a
   * file this plugin owns under DSH home.
   *
   * Held as a field rather than closed over inside the cache so the account
   * routes and the status surface can ask what happened to it: "the file is
   * damaged" and "nobody has signed in here" are different sentences to a user
   * even though both resolve to no credential. See `device-credential.ts`.
   */
  device: DeviceCredentialSource
  /** The refresh interval handle, or `undefined` when stopped. */
  refreshTimer: NodeJS.Timeout | undefined
  /** The last usage reading, or `undefined` before the first read. */
  usage: UsageSnapshot | undefined
  /** Epoch ms of the last usage reading. */
  usageAt: number
  /**
   * Bumped by {@link RegionRuntime.invalidateUsage}, and captured by a read
   * before it awaits so a superseded answer can tell it is superseded.
   *
   * This is the half of invalidation the cache fields alone cannot express:
   * clearing `usage`/`usageAt` says nothing to a fetch that is already in
   * flight, and that fetch would otherwise write its pre-invalidation answer
   * back with a fresh timestamp. See {@link RegionRuntime.doReadUsage}.
   */
  usageGeneration: number
  /** One live catalog run, shared across triggers. */
  catalogFlight: () => Promise<void>
  /** One live usage run, shared across triggers. */
  usageFlight: SingleFlight<[force?: boolean], UsageSnapshot | undefined>
  /** Whether this runtime has been disposed. */
  disposed: boolean
  /** The controller for the catalog fetch currently in flight. */
  refreshAbort: AbortController | undefined
  /** Why the last refresh did not produce a catalog, or `undefined`. */
  refreshFailed: { reason: RefreshFailureReason; error?: unknown } | undefined
  /**
   * Re-advertise the provider after a catalog change.
   *
   * Assigned by {@link wireRuntime} once the adapter pair exists, and read by
   * `applyCatalogOutcome` — hence optional: a refresh that lands before the
   * adapter is registered has nothing to tell, and the `?.` there is what
   * makes that a no-op instead of a crash. It is a field rather than a method
   * because the behaviour it triggers (rebuild the adapter, emit the Host
   * event) belongs to the activation scope, not to the region.
   */
  invalidate?: () => void

  constructor(
    region: Region,
    ctx: HostContext,
    device?: DeviceCredentialSource,
    credentials?: CredentialCache,
  ) {
    this.region = region
    this.ctx = ctx
    this.logger = ctx.logger
    this.catalog = new CatalogStore({
      path: qoderCatalogPath(`.qoder-catalog.${region.id}.json`),
      logger: ctx.logger,
    })
    /**
     * The roster history. Per region, like the catalog it describes: the two
     * editions list different models, so one shared file would have each
     * region's refresh mark the other's models as "gone" and re-announce them
     * on the next poll.
     */
    this.rosterSeen = new RosterSeenStore({
      path: qoderCatalogPath(`.qoder-roster-seen.${region.id}.json`),
      logger: ctx.logger,
    })
    /**
     * The region's own credential file, and the reader/rotator over it.
     *
     * Handed in rather than built here because the sign-in routes write a
     * credential for regions that have not started. The fallback exists only so
     * a runtime can still be constructed standalone (the tests do that); every
     * activation path passes the shared instance, which is what keeps "the
     * panel's sign-out" and "this region's resolve" talking about one file.
     */
    this.device = device ?? deviceSourceFor(region, ctx)
    /**
     * The credential cache, holding the app-store reader, the PAT fallback and
     * the exchange. It carries the "a re-sign-in needs no restart" rule, which
     * lives in its own module so it can be tested without a Cordis context.
     *
     * Handed in for the same reason the device source is: the confirm route
     * resolves a credential for a region that has not started, and it must go
     * through the SAME cache — one PAT exchange and one invalidation per
     * region, not two caches over one credential.
     */
    this.credentials = credentials ?? credentialCacheFor(region, ctx, this.device)
    this.refreshTimer = undefined
    /** Last usage reading and when it was taken; see {@link RegionRuntime.readUsage}. */
    this.usage = undefined
    this.usageAt = 0
    this.usageGeneration = 0
    // The refresh triggers (timer, the card's ?refresh=1 route, the account
    // panel's re-read) do not know about each other; without coalescing, two
    // overlapping fetches each ended in `catalog.replace` and whichever landed
    // LAST won — not whichever was asked for. See lib/single-flight.js.
    /** @type {() => Promise<void>} one live catalog run, shared. */
    this.catalogFlight = createSingleFlight(() => this.doRefreshCatalog())
    /** @type {(force?: boolean) => Promise<unknown>} one live usage run, shared. */
    this.usageFlight = createSingleFlight((force) => this.doReadUsage(force))
    // Set by the fiber's effect cleanup (dispose) so any in-flight `.then`
    // callbacks that race the dispose can tell the runtime is already dead
    // and not install a new `setInterval` onto it.
    this.disposed = false
    /**
     * The controller for the catalog fetch currently in flight, so a dispose can
     * cut the request instead of only ignoring its answer. See
     * {@link RegionRuntime.doRefreshCatalog}.
     *
     * @type {AbortController | undefined}
     */
    this.refreshAbort = undefined
    /**
     * Why the last refresh did not produce a catalog, or `undefined` when the
     * current catalog IS the last upstream answer.
     *
     * "the fetch failed" and "the plugin is out of date" are different facts
     * that used to render alike — and one of them (docs/issues/05) let the card
     * announce a fresh "已更新" for a refresh that never happened. `reason` is
     * one of `credential` / `no-credential` / `fetch` /
     * `protocol-shape-changed`; the card maps the last to "update the plugin",
     * never to "sign in".
     *
     * @type {{ reason: string, error?: unknown } | undefined}
     */
    this.refreshFailed = undefined
  }

  /**
   * Resolve the current credential, exchanging a PAT when that is the source.
   *
   * The caching and invalidation rules live in `CredentialCache`, which takes
   * its store readers as arguments so they can be exercised without a
   * Cordis context or the desktop app's files.
   */
  async resolveCredential() {
    return this.credentials.resolve()
  }

  /**
   * Invalidate the cached credential after an upstream sign-in rejection.
   *
   * The next {@link RegionRuntime.resolveCredential} call re-reads the app's
   * store, so a re-sign-in is picked up without a restart. This is called
   * from the shim when the upstream answers with a sign-in failure.
   *
   * The device source is told too, so that a rejection clears its 60 s "that
   * renewal was refused" window: a gateway rejection is independent evidence
   * that the credential on disk is no longer the whole story, and without this
   * a user who signs in again would still be held back by the window for up to
   * a minute. The reverse leak — a device rejection clearing the PAT throttle's
   * parked state — is deliberate and harmless: the parked state is this
   * region's, both live credentials are this region's, and the next resolve
   * re-reads whichever source wins anyway.
   */
  invalidateCredential() {
    this.credentials.invalidate()
    this.device.retry()
  }

  /**
   * Refresh the model catalog from upstream, keeping the last good one on failure.
   *
   * Concurrent calls coalesce: while one run is live, later callers join its
   * promise instead of starting a second fetch. Joining is safe because a fetch
   * that began milliseconds ago is fresher than anything a duplicate would
   * return.
   *
   * There is no "refresh only when stale" mode on purpose: the refresh timer's
   * period IS the TTL cadence, and every trigger (timer, the card's
   * `?refresh=1`, the account reload) asks for a real fetch. A `catalog.fresh()`
   * early return used to guard a `force = false` that nothing ever passed —
   * a dead branch, gone.
   */
  refreshCatalog(): Promise<void> {
    return this.catalogFlight()
  }

  /** The actual refresh work behind {@link RegionRuntime.refreshCatalog}. */
  async doRefreshCatalog(): Promise<void> {
    let credential
    try {
      credential = await this.resolveCredential()
    } catch (error) {
      this.logger?.warn?.(`dsh-connect-qoder: ${this.region.displayName} credential resolution failed`, error)
      this.applyOutcome({ ok: false, reason: 'credential', error })
      return
    }
    // No credential is not a catalog verdict: it says nothing about what the
    // account's model list is, so the previous reading stands.
    if (credential === undefined) {
      this.applyOutcome({ ok: false, reason: 'no-credential', error: undefined })
      return
    }
    // The fetch is bounded by this region's own controller so a dispose can cut
    // a request in flight rather than only refusing to act on its answer
    // (issue 13). The signal is what stops the upstream socket; the
    // `isRefreshObsolete` check below is what stops the local side, because an
    // abort can lose a race with a response that had already arrived.
    this.refreshAbort?.abort()
    this.refreshAbort = new AbortController()
    const { signal } = this.refreshAbort
    try {
      const raw = await fetchModels(this.region, credential, signal)
      if (isRefreshObsolete(this)) return
      // `fetchModels` answers with rows this plugin only partly trusts: every
      // field is optional on the wire, and `normalizeEntry` is what mints the
      // id and fills the defaults. The cast states that division of labour —
      // the reader hands over the upstream's raw object, the normalizer is the
      // one that gives it a shape — rather than pretending `fetchModels`
      // already validated fields it deliberately passes through untouched.
      const entries = raw.map((entry) => normalizeEntry(entry as FetchedEntry))
      const outcome = this.applyOutcome({ ok: true, entries })
      // Only a COMMITTED answer updates the history. A refresh whose write was
      // swallowed still committed in memory (see catalog-refresh.ts), and the
      // roster on screen is that one — so `committed` is the right gate, not
      // `lastSaveError`. Noting a failed fetch would be the real bug: it would
      // diff an answer nobody served.
      if (outcome.committed) this.noteRoster(entries)
    } catch (error) {
      // A dispose mid-fetch is not a failure worth reporting: the runtime is
      // gone, there is nobody left to tell, and logging it would put a warning
      // in the log of every disable/reload.
      if (isRefreshObsolete(this)) return
      // Three failures that look alike and must not be merged: a transport or
      // auth error leaves the last good catalog in place, and so does a protocol
      // shape change — but the second is a standing verdict about the plugin,
      // not about this fetch, and it is recorded under its own reason so the
      // card says "update the plugin" instead of "sign in again". A spent daily
      // allowance is a third: the last good catalog is still right and the
      // remedy is neither a retry nor an update — it is tomorrow.
      //
      // The local "疑似已用尽" badge is deliberately NOT marked from here even
      // though this is where the model list is refreshed: that badge is
      // published inside the USAGE payload (`requestsExhausted`), the usage
      // route is the surface that marks it, and it is the same upstream
      // allowance gating both — so the next usage poll lights it. Threading a
      // counter into this class to reach it one poll earlier would buy nothing.
      this.logger?.warn?.(
        `dsh-connect-qoder: ${this.region.displayName} catalog refresh failed`,
        error,
      )
      this.applyOutcome({
        ok: false,
        reason: isProtocolShapeChangedError(error)
          ? 'protocol-shape-changed'
          : thrownFlag(error, 'upstreamKind') === 'daily-limit'
            ? 'daily-limit'
            : 'fetch',
        error,
      })
    }
  }

  /**
   * Record one refresh outcome on this runtime.
   *
   * The rule itself lives in `lib/catalog-refresh.js` so it can be tested
   * without the Cordis peer dependencies; this is the seam that lets the
   * untestable runtime delegate to it.
   *
   * NEVER THROWS, and that is the contract rather than a convenience. Every
   * caller runs inside a `catch` or at the tail of an error path, and three of
   * the four call sites are not themselves guarded — so a throw from here would
   * escape `doRefreshCatalog` entirely, and every caller of THAT is a bare
   * `void runtime.refreshCatalog()` with no `.catch`. The consequences are
   * worse than a lost log line: `beginCatalogUpdates` installs its refresh
   * interval in a `.then`, so a rejection means the timer is never installed
   * and this region silently stops updating for the life of the plugin — the
   * exact staleness `catalog-refresh.ts` exists to report.
   *
   * Failing to record an outcome is therefore logged, not propagated: the
   * caller has already handled the failure being recorded, and this is the
   * second-order failure of *describing* it.
   *
   * @param outcome - `{ ok: true, entries }` or `{ ok: false, reason, error }`.
   */
  applyOutcome(outcome: CatalogOutcome): { committed: boolean; previousFailure: RefreshFailure | undefined } {
    try {
      return applyCatalogOutcome(this, outcome)
    } catch (error) {
      this.logger?.error?.(
        `dsh-connect-qoder: ${this.region.displayName} could not record a catalog refresh outcome`,
        error,
      )
      // `committed: false` is the honest answer: nothing observable was
      // recorded, so no caller may treat the previous reading as replaced.
      return { committed: false, previousFailure: undefined }
    }
  }

  /**
   * Record the roster a committed refresh just served, and let the history
   * answer which models are new.
   *
   * Called from {@link RegionRuntime.doRefreshCatalog} only, so the models route
   * stays a pure read (docs/ROUTES.md row 1: `改状态 否`). A failure here is
   * logged and swallowed: the marker is a suggestion, and the alternative —
   * failing the refresh over a history file — would take the model list down
   * with it. The visible degradation is the marker's absence, which is the same
   * screen a first-ever run shows.
   *
   * @param entries - the entries the refresh committed.
   */
  noteRoster(entries: readonly CatalogEntry[]): void {
    try {
      this.rosterSeen.note(entries.map((entry) => entry.id))
    } catch (error) {
      // `note` is written not to throw; this guard exists because it runs inside
      // the refresh path whose failure modes are already counted, and an
      // escaping throw here would be indistinguishable from a fetch failure.
      this.logger?.warn?.(`dsh-connect-qoder: ${this.region.displayName} roster history update failed`, error)
    }
  }

  /**
   * The ids still reading as "first seen recently", oldest first.
   *
   * A read with no write, so the models route can call it on every GET.
   */
  newModelIds(): string[] {
    try {
      return this.rosterSeen.fresh()
    } catch (error) {
      this.logger?.warn?.(`dsh-connect-qoder: ${this.region.displayName} roster history unreadable`, error)
      return []
    }
  }

  /**
   * Look up the upstream key for a user-facing model id.
   *
   * `catalog.current()` is `unknown[]` on purpose — `CatalogLike` is declared
   * as the minimum every consumer reads, so the offline suite's stand-in with
   * only `current()`/`replace()` still satisfies it, and the entries came off
   * `JSON.parse` of a file on disk. That makes narrowing the caller's job, and
   * this is it: an entry that is not an object, or has no string `id`, simply
   * does not match.
   */
  upstreamKey(modelId: string): string | undefined {
    const found = this.catalog.current().find((entry) => idOf(entry) === modelId)
    return typeof (found as { key?: unknown } | null | undefined)?.key === 'string'
      ? (found as { key: string }).key
      : undefined
  }

  /** The catalog entry behind a user-facing model id. */
  entryFor(modelId: string): CatalogEntry | undefined {
    const found = this.catalog.current().find((entry) => idOf(entry) === modelId)
    return found as CatalogEntry | undefined
  }

  /**
   * Read the account's usage, with a short cache.
   *
   * The card is the only consumer and it can be expanded repeatedly, so a
   * reading taken moments ago is reused; `force` is what the panel's refresh
   * button asks for. A failure is never cached, so a transient upstream problem
   * does not pin the panel to an error state. Concurrent calls coalesce onto
   * one in-flight fetch, so mashing the button costs the upstream one request
   * per completed reading rather than one per click.
   */
  readUsage(force = false): Promise<UsageSnapshot | undefined> {
    return this.usageFlight(force)
  }

  /** The actual fetch behind {@link RegionRuntime.readUsage}. */
  async doReadUsage(force?: boolean): Promise<UsageSnapshot | undefined> {
    if (!force && this.usage !== undefined && Date.now() - this.usageAt < USAGE_TTL_MS) {
      return this.usage
    }
    // Captured BEFORE the first await. A claim that lands while this fetch is
    // in flight calls `invalidateUsage`, and this answer then describes the
    // balance from before that claim.
    const generation = this.usageGeneration
    const credential = await this.resolveCredential()
    if (credential === undefined) return undefined
    const usage = await fetchUsage(this.region, credential)
    // The answer is handed back to whoever awaited this run either way — a
    // caller that asked for a reading is owed one, and answering `undefined`
    // would render as "usage unavailable" instead of the pre-claim number it
    // actually is. What the check withholds is the CACHE WRITE: re-stamping a
    // superseded reading with `Date.now()` is what made it look brand new and
    // kept the pre-claim balance on screen for a further full TTL.
    if (generation === this.usageGeneration) {
      this.usage = usage
      this.usageAt = Date.now()
    }
    return usage
  }

  /**
   * Drop the cached usage reading, including any read already in flight.
   *
   * Claiming puts Credits into the very add-on quota this panel shows, so the
   * next render has to re-read rather than serve a number taken before the
   * claim. {@link RegionRuntime.doReadUsage}'s own freshness window would
   * otherwise keep the old balance on screen for its full TTL.
   *
   * Three things have to move together, and the first two alone were not
   * enough:
   *
   * 1. The generation, so a fetch already in flight — one that started before
   *    this claim and would otherwise write its pre-claim answer back with a
   *    fresh timestamp — is refused the cache write (see `doReadUsage`).
   * 2. The cache fields, so the next caller does not short-circuit on them.
   * 3. The flight slot itself. Without this the claim handler's own
   *    `readUsage(true)` simply JOINS the doomed pre-claim fetch and is handed
   *    the old balance — coalescing wins over `force`, because a joiner always
   *    receives the starting run's result. Releasing the slot is what makes
   *    the forced re-read actually start a new fetch.
   */
  invalidateUsage() {
    this.usageGeneration += 1
    this.usage = undefined
    this.usageAt = 0
    this.usageFlight.reset()
  }
}

/**
 * Start one region's shim and catalog lifecycle.
 *
 * @param enabledIdsFor - `(regionId) => string[]`, the user's roster choice. The
 *   shim needs it so `GET /v1/models` — the endpoint the picker's discovery
 *   reads — narrows the catalog the same way the adapter does.
 * @returns the runtime plus its shim, or `undefined` when the shim could not
 *   listen (the region is then simply absent rather than fatal).
 */
async function startRegion(
  region: Region,
  ctx: HostContext,
  enabledIdsFor: (regionId: string) => string[],
  sources: RegionSources | undefined,
  requestCounter: RequestCounter,
  tokenCounter: TokenCounter,
): Promise<{ region: Region; runtime: RegionRuntime; shim: ShimHandle } | undefined> {
  const runtime = new RegionRuntime(region, ctx, sources?.device, sources?.credentials)

  // A region is published only when it can actually answer; the three refusals
  // and their log levels are decided in lib/region-gate.js so they can be
  // asserted without importing this file.
  let credential
  try {
    credential = await runtime.resolveCredential()
  } catch (error) {
    const refusal = unreadableSignInDecision(region)
    ctx.logger[refusal.level]?.(refusal.message, error)
    return undefined
  }
  const decision = regionPublishDecision(credential, region)
  if (decision.ok !== true) {
    ctx.logger[decision.level]?.(decision.message)
    return undefined
  }

  const shim = createQoderShim({
    region,
    resolveCredential: () => runtime.resolveCredential(),
    // The store hands back `unknown[]` — its `current()` satisfies
    // `CatalogLike`, so it cannot promise more than "parsed from a JSON file".
    // The shim's own contract is `CatalogEntry[]`, and the cast is where those
    // two meet: every entry here went through `normalizeEntry` on its way in
    // (`refresh` above), which is what mints `id`/`key`/`name` and fills the
    // optional flags. Re-normalizing on every read would be the alternative,
    // and it would cost a pass over the roster on each listing to re-derive
    // fields the write path already established.
    resolveModels: () => runtime.catalog.current() as CatalogEntry[],
    resolveUpstreamKey: (id) => runtime.upstreamKey(id),
    resolveAlwaysThinking: (id) => runtime.entryFor(id)?.alwaysThinking === true,
    // Read on every listing so curating the roster reaches the picker live.
    resolveEnabledIds: () => enabledIdsFor(region.id),
    // A sign-in failure from the upstream means the cached credential is
    // stale; the next resolveCredential re-reads the app's store.
    invalidateCredential: () => runtime.invalidateCredential(),
    logger: ctx.logger,
    requestCounter,
    tokenCounter,
  })
  try {
    await shim.ready
  } catch (error) {
    // Close before giving up. The shim calls `server.listen(0, '127.0.0.1')`
    // before it settles `ready` (shim.ts), so by the time this rejects the
    // server may already be listening and bound to a port. Dropping the
    // reference here does not undo that: the handle keeps the port open and the
    // process alive, and because `startRegion` returned `undefined` nothing
    // downstream ever learns the shim exists — `disposeFiber` closes what is in
    // `started`, and this entry never gets there.
    //
    // The other two early exits in this function are BEFORE `createQoderShim`,
    // which is why only this one needs the cleanup; the asymmetry is the signal
    // that this path was missed rather than deliberately exempt.
    //
    // Skipped only if `close` itself throws, which must not replace the error
    // that is actually being reported.
    try {
      await shim.close()
    } catch (closeError) {
      ctx.logger.warn?.(
        `dsh-connect-qoder: ${region.displayName} loopback endpoint could not be closed after a failed start`,
        closeError,
      )
    }
    ctx.logger.error?.(`dsh-connect-qoder: ${region.displayName} loopback endpoint failed to start`, error)
    return undefined
  }
  // The entry carries its region as well as the runtime and shim: the reload
  // route's stopped-region check (`started.some((entry) => entry.region.id …)`)
  // reads it from here, and every consumer that destructures only
  // `{ runtime, shim }` is unaffected by the extra field.
  return { region, runtime, shim }
}

/**
 * Register every Qoder region.
 *
 * All regions are published through one adapter and one registration pair:
 * `registerAdapter` maps a set of providers onto a single adapter, so calling
 * it once per region would leave only the last provider owned.
 *
 * Activation is best-effort by design: this plugin contributes optional model
 * routes, and a failure to do so must never take the profile down with it. The
 * whole body is therefore guarded, so a fault here degrades to "Qoder models
 * are absent" rather than a profile that cannot boot.
 *
 * @param ctx - the plugin context, with `llm` injected.
 * @param config - the resolved plugin configuration.
 */
export async function apply(ctx: HostContext, config: Record<string, unknown> = {}) {
  try {
    await activate(ctx, config)
  } catch (error) {
    ctx.logger.error?.('dsh-connect-qoder: activation failed; Qoder models will be unavailable', error)
  }
}

/** The real activation sequence, called under {@link apply}'s guard. */
async function activate(ctx: HostContext, config: Record<string, unknown>): Promise<void> {
  // The context-window, image, and roster preferences are read through a mutable
  // holder so the settings section can change them without re-registering the
  // adapter; the adapter re-reads them every time it builds a model list, and the
  // shim re-reads them on every listing. The resolved config is the initial value.
  //
  // The source is the live one only, and it is the Config object the Loader hands
  // `apply`: on the 0.2 line its volatile fields hold `{ get() }` references that
  // the Loader swaps in place after every `settings.mutate` and announces with
  // `loader/volatile-update` (the listener below refreshes the picker when the
  // event lands; same shape as the host's own `plainOptions(config)` in
  // dsh-llm-deepseek). Reading `preferences` directly would keep the startup copy
  // forever, so `current()` re-reads that live object at read time. The 0.1.6
  // `installSection` host handed over its own document reference through a
  // `setSource` callback — that line no longer exists, and with it the second
  // source this used to juggle.
  //
  // `Preferences`, not a bare record: the Loader hands `apply` an object whose
  // fields ARE the four settings this plugin declares, and the volatile shells
  // (`{ get() }`) are a documented part of that hand-off. Typing it as an open
  // record here would let a reader index a field that does not exist and get
  // `unknown` back instead of a compile error.
  let preferences: Preferences = config as Preferences
  const livePreferences = (): Preferences => {
    const next = { ...(config as Record<string, unknown>) }
    for (const [key, value] of Object.entries(next)) {
      if (value !== null && typeof value === 'object' && typeof (value as { get?: unknown }).get === 'function') {
        next[key] = (value as { get: () => unknown }).get()
      }
    }
    return next as Preferences
  }
  let invalidateAdapter = () => {}

  /**
   * The namespace the HOST actually serves this plugin's settings under.
   *
   * On the 0.2 line the host derives it from the Loader entry — `describe()`
   * reports `ns: entry.options.id`, which for this bundle is `llm-qoder`, not
   * the `dsh-connect-qoder` the plugin used to name. The models settings page
   * resolves a provider's configuration row by **exact** match on this value
   * (`namespaces.get(entry.settingsNs)`), so declaring the constant here drops
   * the Qoder rows from that page entirely: the configuration surface and the
   * model-discovery entry point both go missing, silently, with the plugin
   * itself still registered and answering. See `settingsNamespaceOf`.
   */
  const settingsNs = settingsNamespaceOf(ctx, QODER_SETTINGS_NS)

  /** Resolve the live preferences, unwrapping the Loader's live-reference source. */
  const current = () => resolvePreferences(preferences, livePreferences)

  /**
   * The three settings taking effect needs the picker to rebuild: `invalidate`
   * re-snapshots the model list, and the emit is what makes every reader of the
   * catalog — DSH's model picker included — drop the stale copy.
   */
  const refreshPicker = () => {
    invalidateAdapter()
    ctx.emit('llm/adapters-updated')
  }

  /** The models the user enabled for one region; empty means "no filter". */
  const enabledIdsFor = (regionId: string): string[] => resolveEnabledIds(current(), regionId)

  // Give the credential layer a logger. Without one, a failed OSCrypt unwrap
  // was completely silent — the region simply never appeared in the picker.
  setCredentialDiagnosticSink((message: string) => ctx.logger.warn?.(message))

  // Reclaim the key hand-off directories a crashed or killed run left behind,
  // BEFORE this run creates its own. A `finally` in `oscryptKeyFor` covers
  // ordinary faults, but a force-killed host or a power loss leaves
  // `%TEMP%\qoder-oscrypt-*\key.b64` on disk holding the app's 32-byte master
  // key as plain base64. The sweep only touches directories older than its age
  // guard, so a concurrent DSH instance that is unwrapping right now is safe.
  try {
    const reclaimed = sweepStaleOscryptDirs()
    if (reclaimed > 0) {
      ctx.logger.info?.(`dsh-connect-qoder: reclaimed ${reclaimed} stale credential temp dir(s)`)
    }
  } catch (error) {
    // Housekeeping only: failing to sweep must never stop the plugin from
    // starting, and the directories are inert without a reader.
    ctx.logger.warn?.('dsh-connect-qoder: stale credential temp sweep failed', error)
  }

  /**
   * Every region's sources, built once and shared with its runtime.
   *
   * Built here rather than inside {@link RegionRuntime} because the sign-in
   * routes must be able to WRITE a credential for a region that has not started
   * — which is the whole point: a machine with no desktop app has no started
   * region, and signing in is what creates one. A source owned by the runtime
   * would not exist yet at the moment the credential arrives.
   *
   * The credential cache lives in the same map for the same reason: the confirm
   * route resolves a credential for a region that has no runtime, and it has to
   * go through the SAME cache — one store read, one PAT exchange and one
   * invalidation per region, instead of two caches over one credential.
   */
  const regionSources = new Map<string, RegionSources>()
  for (const region of REGIONS) {
    const device = deviceSourceFor(region, ctx)
    const credentials = credentialCacheFor(region, ctx, device)
    regionSources.set(region.id, { device, credentials, credentialKind: () => credentials.kind })
  }
  /**
   * The sign-in conversation, driven by the card.
   *
   * Stored host-side because the PKCE verifier must not travel to the browser;
   * see `device-login-flow.ts`.
   */
  const loginFlow = new DeviceLoginFlow({
    onAuthorized: async (regionId, payload, machineID) => {
      const source = regionSources.get(regionId)?.device
      // Cannot happen through a route (they validate the region first), but the
      // flow's contract is to report a storage failure rather than assume one.
      if (source === undefined) throw new Error(`no device credential source for region ${regionId}`)
      await source.remember(payload, machineID)
    },
    logger: ctx.logger,
  })

  /**
   * What the four sign-in routes read.
   *
   * `forget` and `status` go through the shared map rather than through a
   * runtime, because signing out of a region that never started is a case that
   * has to work: that region has a file on disk and no runtime at all.
   */
  const deviceDeps: DeviceLoginDeps = {
    regions: REGIONS,
    flow: loginFlow,
    forget: async (regionId) => (await regionSources.get(regionId)?.device.forget()) ?? false,
    status: (regionId) => regionSources.get(regionId)?.device.status ?? { state: 'none' },
    logger: ctx.logger,
  }

  const started: StartedRegion[] = []
  /**
   * Region ids whose start is currently in flight.
   *
   * Held separately from `started` because `started` records COMPLETION, and the
   * window that matters is the one before it: `startStoppedRegions` awaits a
   * credential read and `shim.ready` before it pushes, so the array alone
   * cannot witness a concurrent start. See the guard there.
   */
  const pendingStarts = new Set<string>()
  /**
   * Whether this fiber's dispose effect has run.
   *
   * A region start that is STILL IN FLIGHT when the fiber is torn down lands
   * after `disposeFiber` has read `started` — the entry is pushed only once
   * `await startRegion` resolves — so nothing else would ever release it: the
   * shim's HTTP server would keep serving and its catalog interval would keep
   * firing for the life of the process. This flag is how a late start learns
   * that it must release its own entry instead of joining `started`.
   */
  let disposed = false
  // 本地请求计数器：按 region + 上海本地日分文件，落在 $DSH_HOME。每次对话轮
  // 由 shim 调 bump，今日读数由 usage 路由随 region 下发。计数失败只降级、不
  // 阻塞对话；越界防护在模块内（region/日期白名单），绝不写目录外。
  const globalRequestCounter = new RequestCounter({
    basePath: (filename) => qoderCatalogPath(filename),
    logger: ctx.logger,
  })
  // 本地 token 消耗累加器：shim 每抓到一个上游 usage 帧就调 addUsage 累加
  // total_tokens / cached_tokens——这是上游每轮明确下发的真实数据，本地只
  // 聚合。与请求计数器同源但文件分开（`.qoder-token-count.<region>.<day>.json`），
  // 越界防护与原子写在模块内，失败只降级、不阻塞对话。
  const globalTokenCounter = new TokenCounter({
    basePath: (filename) => qoderCatalogPath(filename),
    logger: ctx.logger,
  })
  // 多日历史的进程内缓存（usage 路由轮询时复用），与计数器同生命周期。
  const globalTokenHistoryCache = createTokenHistoryCache()
  for (const region of REGIONS) {
    const entry = await startRegion(region, ctx, enabledIdsFor, regionSources.get(region.id), globalRequestCounter, globalTokenCounter)
    if (entry !== undefined) started.push(entry)
  }
  if (started.length === 0) {
    // Not a return. The card's routes are mounted BELOW this point, so bailing
    // out here left every one of them unregistered and the card's fetches 404 —
    // which the card renders as "读取账号状态失败", never as the "没有找到已登录的
    // Qoder 应用" copy that actually explains this situation. A user who has not
    // signed in yet is the NORMAL state of a fresh install, and it is precisely
    // the state the account panel must be able to explain.
    //
    // So the routes are registered anyway, with an empty region set. The reload
    // route is what brings a region online once one appears, and it is reachable
    // only through these routes — so returning here also made the documented
    // "re-sign in and it appears without restarting DSH" path unreachable from a
    // fresh install, which is the case that path exists for.
    ctx.logger.warn?.('dsh-connect-qoder: no Qoder region could start; card routes stay up so the account panel can explain it')
  }

  // The international edition's daily check-in round is served only to requests
  // carrying the desktop app's umid machine identity (KNOWN_GAPS §8); without
  // it the campaigns list omits the round and the card does not render the
  // check-in — a documented degradation, but a silent one: nothing on screen
  // says WHY the round is absent. This warn is the host-side half of the
  // visibility: it fires only where it can matter (the global region actually
  // started on this machine), so a CN-only or no-Qoder profile keeps a clean
  // log. The card-side half — a one-line hint on the international usage
  // panel — is still owed; see docs/KNOWN_GAPS §8.
  if (started.some((entry) => entry.region.id === 'qoder')) {
    const umid = __dshQoderUmidState()
    if (umid.available !== true) {
      ctx.logger.warn?.(`dsh-connect-qoder: ${umid.reason}; the international edition's daily check-in round cannot be claimed on this machine until it can`)
    }
  }

  /**
   * Releases for the card routes this fiber registered, in registration order.
   *
   * Every `webServer.register` result goes through `rememberRouteRelease`, and
   * the fiber's cleanup calls `releaseRoutes`. Whether the host needs this is
   * not answerable from a plugin checkout (docs/issues/13) — see the module
   * header of lib/lifecycle.js for why collecting is correct either way.
   *
   * @type {(() => void)[]}
   */
  const routeReleases: RouteRelease[] = []

  const buildAdapter = () =>
    createQoderAdapter({
      regions: started.map(({ runtime, shim }) => ({
        region: runtime.region,
        shim,
        catalog: () => runtime.catalog.current(),
      })),
      preferMaximumContext: () => prefersMaximumContext(current()),
      imageModeFor: (modelId) => resolveImageMode(current(), modelId),
      enabledIdsFor,
      // Per-build so the account panel's per-region switch takes effect on the
      // next refresh without re-registering: off → empty model list → DSH hides
      // the group; on → the models (with their saved curation) come back.
      regionEnabled: (regionId) => resolveRegionEnabled(current(), regionId),
      // Image input must be wired or every request carrying an image fails the
      // whole turn with UNSUPPORTED_CONTENT. Both services are optional by
      // contract (`ctx.get` + undefined check), so a host without them keeps
      // working for text-only turns and simply cannot accept images — the same
      // graceful degradation the official llm-pi-ai plugin has.
      resolveAttachments: () => ctx.get?.('attachments'),
      resolveImageAccess: (attachments: unknown, ref: unknown) =>
        resolveImageAttachmentAccess(
          attachments,
          (hostPath: string) =>
            (ctx.get?.('fs') as { processPathFromHostPath?: (p: string) => unknown } | undefined)
              ?.processPathFromHostPath?.(hostPath),
          ref,
        ),
    })

  // Undefined while no region has started; `publishRegions` builds the real one.
  // See its zero-region branch for why an empty set is not an error here.
  let adapter = started.length > 0 ? buildAdapter() : undefined

  let releaseAdapter: (() => void) | undefined
  let releaseDirectory: (() => void) | undefined

  /**
   * Make the host offer the current set of started regions, replacing any
   * earlier registration.
   *
   * The adapter is rebuilt rather than mutated: it was constructed from the
   * region set that existed at that moment, and its region list is not a
   * mutable input. This matters for the account reload route — a region that
   * failed to start at activation (no sign-in, or an expired one) can come
   * online later, and only a re-built and re-registered pair offers it.
   *
   * On failure the previous registration is restored, so a bad re-publish can
   * never take down regions that were already serving. The previous pair's
   * own release functions are captured before the new registration replaces
   * them, and re-invoking a release twice is harmless — both `registerAdapter`
   * and `registerConfigurableProviders` return idempotent releases.
   *
   * @returns `{ ok, error }`
   */
  /**
   * One region's registration row for `registerConfigurableProviders`.
   *
   * `settingsPath` is the empty list rather than a path: this plugin serves its
   * own settings section under {@link settingsNs}, so it registers no
   * configurable sub-schema for the host to walk. `declared: false` says the
   * same thing from the other side. Both are stated explicitly because an empty
   * array here is a deliberate "none", not an unfinished value.
   */
  const providerRowFor = (runtime: RegionRuntime) => ({
    provider: runtime.region.id,
    displayName: runtime.region.displayName,
    settingsNs,
    settingsPath: [] as string[],
    declared: false,
  })

  function publishRegions(): { ok: boolean; error?: unknown } {
    const previousAdapter = adapter
    const previousReleases = { releaseAdapter, releaseDirectory }
    // Captured before anything is released: these describe the pair that is
    // about to be taken down, and they are the only record of it once its
    // releases have run.
    const previousProviderIds = started.map(({ runtime }) => runtime.region.id)
    const previousDirectory = started.map(({ runtime }) => providerRowFor(runtime))
    // Nothing started: there is no adapter to publish, and `createQoderAdapter`
    // refuses an empty region set by design. Answering "nothing to do" keeps
    // the card routes (registered above and below this function) alive, which is
    // the whole reason a zero-region activation gets this far at all. When a
    // region does come online, the reload route calls this again with a
    // non-empty set.
    if (started.length === 0) return { ok: true }
    adapter = buildAdapter()
    const result = publishRegionSet(
      {
        providerIds: started.map(({ runtime }) => runtime.region.id),
        adapter: adapter.adapter,
        directory: started.map(({ runtime }) => providerRowFor(runtime)),
        invalidate: adapter.invalidate,
      },
      previousAdapter === undefined
        ? undefined
        : {
            providerIds: previousProviderIds,
            adapter: previousAdapter.adapter,
            directory: previousDirectory,
            invalidate: previousAdapter.invalidate,
          },
      previousReleases,
      {
        // Bound, not handed over bare: both `llm` methods are `this`-bound in
        // the host (`registerAdapter` calls `this.ctx.effect(...)`), so passing
        // the extracted reference makes `this` undefined and the call throws
        // `Cannot read properties of undefined (reading 'effect')` — which
        // failed provider registration AND the whole activation, leaving every
        // card route 404. See docs/issues/20.
        registerAdapter: (providerIds, adapter) => ctx.llm.registerAdapter(providerIds, adapter),
        registerConfigurableProviders: (rows) => ctx.llm.registerConfigurableProviders(rows),
        onRollbackFailed: (error) => ctx.logger.error?.('dsh-connect-qoder: a release did not complete', error),
      },
    )
    releaseAdapter = result.releaseAdapter
    releaseDirectory = result.releaseDirectory
    invalidateAdapter = result.invalidate
    return { ok: result.ok, error: result.error }
  }

  /** Wire one runtime's invalidation to the current adapter pair. */
  const wireRuntime = (runtime: RegionRuntime) => {
    runtime.invalidate = () => {
      invalidateAdapter()
      ctx.emit('llm/adapters-updated')
    }
  }

  for (const { runtime } of started) wireRuntime(runtime)

  // Provider registration is attempted once here, and its outcome is RECORDED,
  // not obeyed as a reason to unwind. Unwinding used to close every shim and
  // skip every card route below, so a failed `llm` registration presented as
  // seven 404s with no way to see why (docs/issues/20). The regions started and
  // their account and usage panels need no adapter at all; a failure keeps
  // them alive, is logged, and is published on the status route for the card
  // to show. Red line 1 forbids the opposite: a new failure path must be
  // visible, not silent.
  const initial = publishRegions()
  let providerRegistrationError: unknown
  if (initial.ok !== true) {
    providerRegistrationError = initial.error
    ctx.logger.error?.(
      'dsh-connect-qoder: provider registration failed; the card stays available and reports this on its status route',
      initial.error,
    )
  }

  ctx.effect(() => async () => {
    // The fiber is going away, so the flag goes up FIRST. A region start that
    // is in flight right now resolves AFTER `disposeFiber` has read `started`
    // — the entry is pushed only once `await startRegion` returns — and it has
    // to see that the fiber is gone, so it releases its own entry instead of
    // joining a list nobody will read again.
    disposed = true
    // The order, and why each step is where it is, live in `dispose-order.ts`
    // — extracted so the `disposed`-before-`clearInterval` invariant (the one
    // that keeps a racing `refreshCatalog().then` from installing a zombie
    // interval) is a test rather than a comment.
    const report = await disposeFiber({
      releaseAdapter,
      releaseDirectory,
      releaseRoutes,
      routeSink: routeReleases,
      runtimes: started.map(({ runtime }) => runtime),
      shims: started.map(({ shim }) => shim),
      timers: { clearInterval: (timer) => clearInterval(timer) },
    })
    if (report.releasedRoutes > 0) {
      ctx.logger.debug?.(`dsh-connect-qoder: released ${report.releasedRoutes} card route registration(s)`)
    }
    // In-flight device sign-in attempts are memory only, but leaving them
    // means a disposed fiber still holds two live timers and a verifier per
    // attempt for five minutes. Clear the table when the routes die.
    loginFlow.clear()
  })

  // The settings surface, the volatile-update listener and the seven card
  // routes are registered from the scope below, by top-level functions.
  // The 0.2 line dispatches `loader/volatile-update` on the plugin fiber after
  // a settings write updates the live config references in place — that is
  // the live seam the configure() auto-form relies on. `current()` re-reads
  // those references, so re-snapshotting `preferences` here and refreshing the
  // picker is what makes a card save reach the running adapter without a DSH
  // restart. `ctx.on` is optional on the context: a host without the event
  // simply re-reads on its next adapter build, which keeps settings correct,
  // just one save later.
  ctx.on?.('loader/volatile-update', () => {
    const next = current()
    if (next !== preferences) preferences = next
    refreshPicker()
  })

  // The status, models, save, usage and check-in routes are registered from
  // the scope below, by top-level functions.
  /**
   * Start the regions that are not running yet, publishing the widened set.
   *
   * Called from the account reload route: a region that could not start at
   * activation (no sign-in, or an expired one) left no runtime behind, so
   * there is nothing to invalidate — it must be started, which means building
   * a new shim and re-publishing the provider registration. A region that
   * still cannot start is left exactly as it was: no runtime, no route, and
   * the account panel keeps showing its state.
   */
  async function startStoppedRegions(onlyRegionId?: string) {
    let changed = false
    for (const region of REGIONS) {
      if (onlyRegionId !== undefined && region.id !== onlyRegionId) continue
      if (started.some((entry) => entry.region.id === region.id)) continue
      // A start already in flight for this region. `started` cannot answer this
      // on its own: the entry is pushed only AFTER `await startRegion`, so two
      // overlapping calls both pass the check above for the same region, both
      // build a shim, and both push — leaving the first entry unreachable to
      // `disposeFiber`, which iterates `started`. Its HTTP server keeps the port
      // and its catalog interval keeps running for the life of the process.
      //
      // Not hypothetical: this route is the panel's "重读登录" button, and
      // `startRegion` awaits a credential read plus `shim.ready`, so a second
      // click (or a client retry) lands squarely inside the window.
      if (pendingStarts.has(region.id)) continue
      pendingStarts.add(region.id)
      let entry: Awaited<ReturnType<typeof startRegion>>
      try {
        entry = await startRegion(region, ctx, enabledIdsFor, regionSources.get(region.id), globalRequestCounter, globalTokenCounter)
      } finally {
        // Cleared on both paths, so a failed start does not wedge the region
        // out of every future reload — that would trade a leak for a region
        // that can never be recovered without a DSH restart.
        pendingStarts.delete(region.id)
      }
      if (entry === undefined) continue
      if (disposed) {
        // The fiber was torn down while this start was in flight, so
        // `disposeFiber` read `started` before this entry existed: nothing
        // else will ever release it. Left alone, its shim's HTTP server keeps
        // serving and its catalog interval keeps firing for the life of the
        // process. Release it here — and keep it out of `started`, so a later
        // reader does not believe the region is live.
        await disposeLateEntry(
          { timers: { clearInterval: (timer) => clearInterval(timer) } },
          { runtime: entry.runtime, shim: entry.shim },
        )
        return
      }
      started.push(entry)
      wireRuntime(entry.runtime)
      beginCatalogUpdates(entry.runtime)
      changed = true
    }
    if (!changed) return
    // Only a new region justifies re-registering: a reload that finds nothing
    // new must not touch a working registration.
    const outcome = publishRegions()
    if (outcome.ok !== true) {
      ctx.logger.error?.(
        'dsh-connect-qoder: re-publishing the region set after reload failed; the previous registration is kept',
        outcome.error,
      )
      return
    }
    refreshPicker()
  }

  // The account panel: which sign-in drives each region, and in which state it
  // is — all from local evidence, so reading it costs no network. It is where
  // "this region shows no models" stops being a mystery: the panel says whether
  // the app is not installed, the sign-in expired, or the store cannot be read
  // and why (the recorded unwrap cause). The three routes share one mount
  // block: same loopback-only rule, same failure posture — registration
  // trouble logs and the card simply has no account panel, exactly like the
  // usage route.
  //
  // Every region record carries `enabled` (is that region's provider offered to
  // DSH right now) and the top level carries the fully-resolved
  // `enabledRegions` map, so the card can post a complete one back; resolved
  // live from `current()` on each request.
  //
  // The read is cached-only by default: this runs on EVERY panel render, and
  // the store read would otherwise unwrap — a PowerShell child that freezes the
  // event loop (~0.5 s per region, up to the 30 s timeout on failure), and the
  // host must stay responsive on a machine that cannot unwrap, which is exactly
  // the state this panel has to display (docs/issues/07). "重读登录" is the
  // explicit, user-driven moment that re-reads for real; `force` is that other
  // end, and the response SHAPE is the same either way — see the reload route.
  // It is async because the forced path DOES unwrap.
  // The read itself lives in `src/host/account-payload.ts`, a directly
  // importable module, so the panel's read path stays behind this repository's
  // gates.
  const accountPayload = (options: { force?: boolean } = {}) =>
    buildAccountPayload({
      regions: REGIONS,
      settings: current(),
      // Same reader the sign-out route answers with, so the sentence the panel
      // shows after signing out is the sentence it shows on the next render.
      deviceStatus: deviceDeps.status,
      // Which sign-in is serving each region, as far as the host knows. The
      // card used to infer this; the host can see the resolved credential, so
      // the host says it (see `RegionSources.credentialKind`).
      credentialKind: (regionId) => regionSources.get(regionId)?.credentialKind(),
      ...options,
    })

  /**
   * Everything the card routes need, handed over explicitly.
   *
   * The seven registrations below are top-level functions, so what they touch
   * has to be named somewhere they can see. Before this scope existed they were
   * inline `ctx.inject` blocks inside this function, and each one closed over a
   * different handful of the locals above — a route that needed a ninth thing
   * had no way to say so, it just reached for it, and the set of reachable
   * names changed with every edit above.
   *
   * A scope is that set, written down: a route that needs something it is not
   * given fails to compile instead of answering with `undefined`.
   */
  const scope: ActivateScope = {
    ctx,
    settingsNs,
    current,
    refreshPicker,
    regionSources,
    started,
    startStoppedRegions,
    deviceDeps,
    routeReleases,
    // Read at request time rather than copied at scope time: the verdict is
    // recorded before the routes mount, but a getter keeps the seam honest if
    // that ever stops being true.
    providerRegistrationError: () => providerRegistrationError,
    requestCounter: globalRequestCounter,
    tokenCounter: globalTokenCounter,
    tokenHistoryCache: globalTokenHistoryCache,
    accountPayload,
  }

  registerSettingsSection(scope)
  registerStatusRoute(scope)
  registerModelsRoute(scope)
  registerSaveRoute(scope)
  registerUsageRoute(scope)
  registerCheckinRoute(scope)
  registerAccountRoutes(scope)

  // Load credentials and catalogs without blocking activation: the providers
  // are registered either way, and an empty catalog is how DSH hides a model
  // group until a sign-in appears.
  for (const { runtime } of started) beginCatalogUpdates(runtime)
}

/**
 * Start a region's first catalog fetch and its refresh timer.
 *
 * Extracted from the activation tail so a region that comes online later —
 * through the account reload route, not at process start — gets exactly the
 * same treatment, including the dispose guard:
 *
 * The first refresh may still be in flight when the fiber disposes (disable,
 * hot reload, upgrade). Without this guard the timer installs onto a dead
 * runtime and is never cleared again — a zombie credential-resolution loop
 * that outlives the plugin.
 */
function beginCatalogUpdates(runtime: RegionRuntime) {
  void runtime
    .refreshCatalog()
    .catch((error) => {
      // `doRefreshCatalog` is written to be total, and `applyOutcome` no longer
      // throws — so reaching here means a defect rather than a failed refresh.
      // It is caught anyway because the cost of NOT catching it is this
      // function's whole purpose: the interval below is installed in a
      // continuation, so a rejection skips it and the region never updates
      // again, silently, for the life of the plugin.
      runtime.logger?.error?.(
        `dsh-connect-qoder: ${runtime.region.displayName} catalog refresh threw out of its own error handling`,
        error,
      )
    })
    .then(() => {
      if (runtime.disposed) return
      runtime.refreshTimer = setInterval(() => {
        // The interval must survive one bad tick: an unhandled rejection here
        // would (in Node) terminate the process, and the region would lose its
        // updates either way.
        void runtime.refreshCatalog().catch((error) => {
          runtime.logger?.error?.(
            `dsh-connect-qoder: ${runtime.region.displayName} catalog refresh threw out of its own error handling`,
            error,
          )
        })
      }, CATALOG_TTL_MS)
      runtime.refreshTimer.unref?.()
    })
}

/**
 * What the card routes need from the activation.
 *
 * The activation OWNS the state; the routes only read it. Before this
 * interface existed, each route was an inline `ctx.inject` callback inside
 * `activate()` and reached into the enclosing function's locals by name — seven
 * closures over one scope, each closing over a different subset of it, and the
 * subset was invisible from the outside. A route that needed a thing nobody
 * handed it got `undefined` and answered with a shape that looked right.
 *
 * Naming the subset turns that into a compile error, and it lets the routes
 * live at the top level of the file, where each one is a thing you can read
 * instead of a block you have to find.
 */
interface ActivateScope {
  /** The host context the routes register against. */
  ctx: HostContext
  /** The namespace the host serves this plugin's settings under. */
  settingsNs: string
  /** The live preferences, unwrapped. */
  current: () => Preferences
  /** Re-snapshot the model list and tell DSH the roster moved. */
  refreshPicker: () => void
  /** Each region's credential sources, by region id. */
  regionSources: Map<string, RegionSources>
  /** The regions that came up. */
  started: StartedRegion[]
  /** Start the regions that are not running yet — the reload route's job. */
  startStoppedRegions: (onlyRegionId?: string) => Promise<void>
  /** The plugin's own sign-in flow. */
  deviceDeps: DeviceLoginDeps
  /** Where the route releases are collected, for dispose. */
  routeReleases: RouteRelease[]
  /** The provider-registration failure, read when a request asks for it. */
  providerRegistrationError: () => unknown
  /** The local request counter, for the usage panel. */
  requestCounter: RequestCounter
  /** The local token counter, for the usage panel. */
  tokenCounter: TokenCounter
  /** The in-process token history cache. */
  tokenHistoryCache: TokenHistoryCache
  /** The account panel's payload builder. */
  accountPayload: (options?: { force?: boolean }) => Promise<unknown>
}

/**
 * Publish the settings surface.
 *
 * Without this the namespace a provider directory entry points at holds no
 * schema, and no configuration surface can render a control for this route —
 * context-window choice included. The 0.2 line serves it as an auto-form
 * derived from the Loader entry's config schema: `configure({auto:true})`
 * registers that presentation and nothing else — it does NOT hand the plugin a
 * live source. The live seam is the Config object the Loader hands `apply`,
 * whose volatile fields are updated in place after every `settings.mutate` and
 * announced with `loader/volatile-update` (the listener in the activation).
 * The 0.1.6 host used to publish a hand-built section through
 * `installSection` and hand back its own document reference through
 * `setSource`; that line no longer exists, and with it the second registration
 * shape this used to probe for. A host without a settings service still gets
 * working models, just no configuration surface.
 */
function registerSettingsSection(scope: ActivateScope): void {
  const { ctx } = scope
  ctx.inject(['settings'], (settingsCtx: HostContext) => {
    const settings = requireInjected(settingsCtx.settings, 'settings')
    try {
      if (typeof settings.configure === 'function') {
        settings.configure({ auto: true }, ctx.fiber)
      } else {
        // The surface is present but carries no presentation API this plugin
        // knows: the configuration surface will not render, and saying so
        // beats a silent one.
        ctx.logger.warn?.('dsh-connect-qoder: settings service has no configure(); the configuration surface is unavailable')
      }
    } catch (error) {
      ctx.logger.warn?.('dsh-connect-qoder: settings section unavailable', error)
    }
  })
}

/**
 * Activation health, on a route that is mounted no matter how the provider
 * registration went. See QODER_STATUS_PATH for why this exists, and the
 * recording block in the activation for why the failure no longer unwinds it.
 *
 * `started` is reported as a count rather than a region list: this is a
 * browser-visible surface, and how many regions came up is diagnostic while
 * which sign-ins exist is the account panel's job (and has its own route).
 * Which CREDENTIAL PATH each region is served by rides along, though: the
 * count says how many came up, and this says whether the desktop application
 * or the plugin's own sign-in is the one actually being used — the first
 * question when the answer looks wrong.
 */
function registerStatusRoute(scope: ActivateScope): void {
  const { ctx, started, routeReleases, regionSources } = scope
  ctx.inject(['webServer'], (webCtx: HostContext) => {
    // Injection is the guarantee: `inject(['webServer'], …)` runs this callback
    // only once that service exists, so binding it to a local states that fact
    // once instead of re-testing the optional at each of the registrations
    // below. See `HostContext.webServer` / `HostService.register`.
    const webServer = requireInjected(webCtx.webServer, 'webServer')
    mountRouteGroup(webServer, [{
      path: QODER_STATUS_PATH,
      handler: (req: IncomingMessage, res: ServerResponse) => statusHandler(req, res, {
        startedCount: started.length,
        providerRegistrationError: scope.providerRegistrationError(),
        regions: REGIONS.map((region) => ({
          id: region.id,
          credentialKind: regionSources.get(region.id)?.credentialKind(),
        })),
      }),
    }], routeReleases, ctx.logger)
  })
}

/**
 * The settings card needs the live model roster to render one row per model,
 * and it cannot read the host catalog directly. This route is the only path,
 * so it is mounted on the optional webServer context and answers with the
 * catalog the adapter already holds — metadata only, never a credential.
 */
function registerModelsRoute(scope: ActivateScope): void {
  const { ctx, started, current, routeReleases } = scope
  ctx.inject(['webServer'], (webCtx: HostContext) => {
    const webServer = requireInjected(webCtx.webServer, 'webServer')
    mountRouteGroup(webServer, [{
      path: QODER_MODELS_PATH,
      handler: (req: IncomingMessage, res: ServerResponse) => modelsHandler(req, res, {
        started,
        currentSettings: current,
        logger: ctx.logger,
        rates: MODEL_RATES,
        // Read at request time, not at registration time: this route mounts
        // after the registration attempt has already settled, so the captured
        // binding is always the final verdict. Shipping it here (as well as on
        // `QODER_STATUS_PATH`) is what puts the failure in front of the user —
        // the roster renders either way, so a card that never mentions it shows
        // a full list of models the picker cannot offer. See `ModelsDeps`.
        providerRegistrationError: scope.providerRegistrationError(),
      }),
    }], routeReleases, ctx.logger)
  })
}

/**
 * The card's save button writes through this authoritative Host endpoint
 * (same pattern as the WorkBuddy bundle's `__save`): the settings document
 * lives in the Host process, and on the DSH 0.2 line the client-side
 * settings scope `set()` can settle WITHOUT persisting — the Host's
 * atomic-write retries exhaust on a locked file, the scope reloads Host
 * state, and returns success anyway. A read-back check catches that, but
 * the only writer that actually lands the value there is a mutate executed
 * inside the Host process.
 */
function registerSaveRoute(scope: ActivateScope): void {
  const { ctx, settingsNs, refreshPicker, routeReleases } = scope
  ctx.inject(['webServer'], (webCtx: HostContext) => {
    // `webServer` alone is the point: the route mounts whether or not the
    // settings service exists, so the service-absent 503 is a real answer the
    // client can distinguish from a 404 (a host that does not serve this route
    // at all) — the false-"已保存" this closed, docs/issues/06. `webServer` is
    // guaranteed present by the injection; see the note on the other
    // `inject(['webServer'], …)` callbacks.
    const webServer = requireInjected(webCtx.webServer, 'webServer')
    mountRouteGroup(webServer, [{
      path: QODER_SAVE_PATH,
      handler: (req: IncomingMessage, res: ServerResponse) => saveHandler(req, res, {
        getSettings: () => webCtx.get?.('settings') as SettingsService | undefined,
        settingsNs,
        fallbackNs: QODER_SETTINGS_NS,
        refreshPicker,
      }),
    }], routeReleases, ctx.logger)
  })
}

/**
 * The usage panel needs the same treatment: the quota lives upstream behind a
 * bearer token the browser must never hold, so the host reads it and hands the
 * card a credential-free summary. Each region is read independently and a
 * failing region is reported as unavailable rather than failing the panel, so
 * one dead sign-in cannot hide the other region's numbers.
 */
function registerUsageRoute(scope: ActivateScope): void {
  const { ctx, started, routeReleases } = scope
  ctx.inject(['webServer'], (webCtx: HostContext) => {
    const webServer = requireInjected(webCtx.webServer, 'webServer')
    mountRouteGroup(webServer, [{
      path: QODER_USAGE_PATH,
      handler: (req: IncomingMessage, res: ServerResponse) => usageHandler(req, res, {
        started,
        logger: ctx.logger,
        // Same seam the activation warn reads, so the card's explanation and
        // the log line can never disagree about why the round is missing.
        umidState: __dshQoderUmidState,
        requestCounter: scope.requestCounter,
        tokenCounter: scope.tokenCounter,
        // 7 天历史的进程内备忘录：轮询一次就重读 7 个文件再重发整份数组，
        // 其中 6 份自从昨天起没动过。缓存按「今日读数」做 key（见
        // handlers.ts 的 TokenHistoryCache 论证）。
        tokenHistoryCache: scope.tokenHistoryCache,
      }),
    }], routeReleases, ctx.logger)
  })
}

/**
 * The daily check-in, from a route owned by this plugin.
 *
 * Nothing about it is automatic and nothing about it is guessed: the card
 * names the region, this host re-reads Qoder's own campaign list, and only a
 * round that is open and unclaimed is ever posted at. The card therefore
 * cannot claim a stale round even if it were to render one.
 */
function registerCheckinRoute(scope: ActivateScope): void {
  const { ctx, started, routeReleases } = scope
  ctx.inject(['webServer'], (webCtx: HostContext) => {
    const webServer = requireInjected(webCtx.webServer, 'webServer')
    mountRouteGroup(webServer, [{
      path: QODER_CHECKIN_PATH,
      handler: (req: IncomingMessage, res: ServerResponse) => checkinHandler(req, res, {
        started,
        logger: ctx.logger,
      }),
    }], routeReleases, ctx.logger)
  })
}

/**
 * The account panel, and the plugin's own sign-in.
 *
 * The account panel answers "which sign-in drives each region, and in which
 * state" — all from local evidence, so reading it costs no network. It is
 * where a "this region shows no models" stops being a mystery: the panel says
 * whether the app is not installed, the sign-in expired, or the store cannot
 * be read and why.
 */
function registerAccountRoutes(scope: ActivateScope): void {
  const { ctx, started, startStoppedRegions, deviceDeps, regionSources, accountPayload, routeReleases } = scope
  ctx.inject(['webServer'], (webCtx: HostContext) => {
    const webServer = requireInjected(webCtx.webServer, 'webServer')
    // These three are ONE feature, so they mount as one group: a card that can
    // read its account state but not re-read it or confirm it looks alive and
    // does nothing on two of its buttons. `mountRouteGroup` rolls the group
    // back if any of the three is refused, so a host that takes `/account` and
    // rejects `/account/confirm` ends with NO account panel rather than half
    // of one — and the log line it writes is then true.
    mountRouteGroup(webServer, [
      {
        path: QODER_ACCOUNT_PATH,
        handler: (req: IncomingMessage, res: ServerResponse) => accountHandler(req, res, {
          payload: accountPayload,
          logger: ctx.logger,
        }),
      },
      {
        path: QODER_ACCOUNT_RELOAD_PATH,
        handler: (req: IncomingMessage, res: ServerResponse) => reloadHandler(req, res, {
          regions: REGIONS,
          started,
          startStoppedRegions,
          payload: accountPayload,
          logger: ctx.logger,
        }),
      },
      {
        path: QODER_ACCOUNT_CONFIRM_PATH,
        handler: (req: IncomingMessage, res: ServerResponse) => confirmHandler(req, res, {
          regions: REGIONS,
          started,
          // A region with no running runtime still has a credential to check.
          // The shared per-region cache resolves it the way a runtime does —
          // the desktop store, then the plugin's own sign-in, then the PAT — so
          // a user who only ever signed in through the browser is not told
          // "there is nothing to confirm" for a region that has not started.
          //
          // Before this was wired, this branch read the desktop store and the
          // PAT only: the plugin's own credential was invisible to it, and a
          // browser-only user pressing "confirm" got "there is no sign-in" for
          // an edition that had one.
          readCredential: async (region) => regionSources.get(region.id)?.credentials.resolve(),
        }),
      },
    ], routeReleases, ctx.logger)

    // The plugin's own sign-in, as one group for the same reason the account
    // routes are: start without poll is a button that opens a browser and then
    // reports nothing, and poll without sign-out leaves the user unable to take
    // the credential back. All four or none.
    mountRouteGroup(webServer, [
      {
        path: QODER_DEVICE_LOGIN_START_PATH,
        handler: (req: IncomingMessage, res: ServerResponse) => deviceLoginStartHandler(req, res, deviceDeps),
      },
      {
        path: QODER_DEVICE_LOGIN_POLL_PATH,
        handler: (req: IncomingMessage, res: ServerResponse) => deviceLoginPollHandler(req, res, deviceDeps),
      },
      {
        path: QODER_DEVICE_LOGIN_CANCEL_PATH,
        handler: (req: IncomingMessage, res: ServerResponse) => deviceLoginCancelHandler(req, res, deviceDeps),
      },
      {
        path: QODER_DEVICE_LOGIN_SIGNOUT_PATH,
        handler: (req: IncomingMessage, res: ServerResponse) => deviceLoginSignOutHandler(req, res, deviceDeps),
      },
    ], routeReleases, ctx.logger)
  })
}
