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
import { isDeepStrictEqual } from 'node:util'
import z from '@deepseek-ai/schemastery'
import { resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm'
import { createQoderAdapter, offPeakActive, offPeakRemaining, rateNow } from './adapter.ts'
import { createQoderShim } from './shim.ts'
import type { ShimHandle } from './shim.ts'
import {
  REGIONS,
  loadCredential,
  loadCredentialAsync,
  loadEnvCredential,
  sweepStaleOscryptDirs,
  setCredentialDiagnosticSink,
  appDataRootFor,
} from './credentials.ts'
import { buildAccountPayload } from './account-payload.ts'
import { CredentialCache } from './credential-cache.ts'
import { applySettingsSave, settingsNamespaceOf } from './settings-save.ts'
import { createSingleFlight } from './single-flight.ts'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  enabledIdsFor as resolveEnabledIds,
  imageModeFor as resolveImageMode,
  preferMaximumContext as prefersMaximumContext,
  regionEnabledFor as resolveRegionEnabled,
  resolvePreferences,
} from './preferences.ts'
import type { Preferences, PreferencesSource } from './preferences.ts'
import { CatalogStore, CATALOG_TTL_MS as catalogTtlMs } from './catalog-store.ts'
import { normalizeEntry, projectModelRow, buildModelRowsPayload } from './catalog-entry.ts'
import type { FetchedEntry } from './catalog-entry.ts'
import type { RouteRelease } from './lifecycle.ts'
import type { CatalogEntry, CatalogOutcome, HostContext, PluginLogger, RefreshFailure, Region } from './domain.ts'
import { applyCatalogOutcome, isRefreshObsolete } from './catalog-refresh.ts'
import { rememberRouteRelease, releaseRoutes } from './lifecycle.ts'
import { exchangePat, fetchModels, fetchUsage, fetchUserInfo, readCampaigns, claimCampaign } from './upstream.ts'
import type { UsageSnapshot } from './upstream.ts'
import { classifyUpstreamError, describeThrown, isProtocolShapeChangedError } from './errors.ts'
import {
  campaignIsClaimed,
  checkinStateFrom,
  claimableCampaignOf,
  normalizeClaimResult,
} from './claim.ts'
import { sendJson } from './http-utils.ts'
// The request gates every card route passes through, moved out so they can be
// tested: `lib/index.js` is not importable without the Cordis peer
// dependencies, and the authentication surface is exactly the kind of thing
// that must not be able to be wrong while the suite is green.
import { readJsonBody, readJsonBodyOr400, methodAllowed, originAllowed } from './routes.ts'
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
 * Mark a schema's field as volatile on the DSH lines that support it.
 *
 * `volatile()` exists from schemastery 3.18.3 (the 0.1.7 line); on older
 * pinning (3.18.2, the 0.1.5 line) it is absent and this degrades to an
 * identity no-op, exactly as the WorkBuddy bundle does. Volatile fields
 * hand the Host a live reference (`{get()}`) that re-resolves on every
 * `loader/volatile-update` — that is how settings edits reach a running
 * host without a restart. The Host's `__save` route unwraps the reference
 * before merging and mutating, and the live `current()` below resolves it
 * the same way.
 */
function asVolatile<T extends { volatile?: unknown }>(schema: T): unknown {
  if (typeof schema.volatile === 'function') return (schema.volatile as () => unknown)()
  return schema
}

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
const USE_MAXIMUM_CONTEXT_WINDOW_FIELD = asVolatile(
  z
    .boolean()
    .default(false)
    .description('Advertise each model\'s largest declared context window instead of Qoder\'s own default window'),
)

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
const IMAGE_OVERRIDES_FIELD = asVolatile(
  z
    .dict(z.union(IMAGE_MODES))
    .default({})
    .description('Per-model image input: "auto" follows the catalog, "on"/"off" force it'),
)

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
const ENABLED_MODEL_IDS_FIELD = asVolatile(
  z
    .dict(z.array(z.string()))
    .default({})
    .description('Per-region allow-list of model ids; an empty list shows every model'),
)

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
const ENABLED_REGIONS_FIELD = asVolatile(
  z
    .dict(z.boolean())
    .default({})
    .description('Per-region provider switch; a missing key is offered, only an explicit false disables'),
)

/** The plugin's whole configuration schema. */
export const Config = z.object({
  useMaximumContextWindow: USE_MAXIMUM_CONTEXT_WINDOW_FIELD,
  imageOverrides: IMAGE_OVERRIDES_FIELD,
  enabledModelIds: ENABLED_MODEL_IDS_FIELD,
  enabledRegions: ENABLED_REGIONS_FIELD,
})

/** The section this plugin publishes for its settings namespace. */
const QODER_SECTION = z.object({
  useMaximumContextWindow: USE_MAXIMUM_CONTEXT_WINDOW_FIELD,
  imageOverrides: IMAGE_OVERRIDES_FIELD,
  enabledModelIds: ENABLED_MODEL_IDS_FIELD,
  enabledRegions: ENABLED_REGIONS_FIELD,
})

/** Plugin-owned read-only route the settings card reads its model rows from. */
const QODER_MODELS_PATH = '/plugins/dsh-connect-qoder/models'

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
  /** The per-region credential cache. */
  credentials: CredentialCache
  /** The refresh interval handle, or `undefined` when stopped. */
  refreshTimer: NodeJS.Timeout | undefined
  /** The last usage reading, or `undefined` before the first read. */
  usage: UsageSnapshot | undefined
  /** Epoch ms of the last usage reading. */
  usageAt: number
  /** One live catalog run, shared across triggers. */
  catalogFlight: (force?: boolean) => Promise<void>
  /** One live usage run, shared across triggers. */
  usageFlight: (force?: boolean) => Promise<UsageSnapshot | undefined>
  /** Whether this runtime has been disposed. */
  disposed: boolean
  /** The controller for the catalog fetch currently in flight. */
  refreshAbort: AbortController | undefined
  /** Why the last refresh did not produce a catalog, or `undefined`. */
  refreshFailed: { reason: string; error?: unknown } | undefined
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

  constructor(region: Region, ctx: HostContext) {
    this.region = region
    this.ctx = ctx
    this.logger = ctx.logger
    this.catalog = new CatalogStore({
      path: qoderCatalogPath(`.qoder-catalog.${region.id}.json`),
      logger: ctx.logger,
    })
    /**
     * The credential cache, holding the app-store reader, the PAT fallback and
     * the exchange. It carries the "a re-sign-in needs no restart" rule, which
     * lives in its own module so it can be tested without a Cordis context.
     */
    this.credentials = new CredentialCache({
      // The ASYNC reader: a miss here spawns the DPAPI child, which measured
      // ~0.5 s of event-loop freeze per region on the success path and up to the
      // 30 s timeout on failure. `CredentialCache.resolve` is already async, so
      // awaiting costs nothing and removes the freeze from DSH's request paths
      // entirely. The synchronous `loadCredential` remains for the startup
      // sweep and the probes, which are not on anyone's latency budget.
      loadApp: () => loadCredentialAsync(this.region, appDataRootFor()),
      loadEnv: () => loadEnvCredential(this.region),
      exchangePat: async (credential) => exchangePat(this.region, credential.token),
    })
    this.refreshTimer = undefined
    /** Last usage reading and when it was taken; see {@link RegionRuntime.readUsage}. */
    this.usage = undefined
    this.usageAt = 0
    // The refresh triggers (timer, the card's ?refresh=1 route, the account
    // panel's re-read) do not know about each other; without coalescing, two
    // overlapping fetches each ended in `catalog.replace` and whichever landed
    // LAST won — not whichever was asked for. See lib/single-flight.js.
    /** @type {(force?: boolean) => Promise<void>} one live catalog run, shared. */
    this.catalogFlight = createSingleFlight((force) => this.doRefreshCatalog(force))
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
     * It exists because "the fetch failed" and "the plugin is out of date" are
     * different facts that used to render as the same thing — an unchanged
     * model list — and one of them (issue 05) also let the card announce a
     * fresh "已更新" time for a refresh that never happened. `reason` is one of
     * `credential` / `no-credential` / `fetch` / `protocol-shape-changed`; the
     * card maps the last of those to "update the plugin", never to "sign in".
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
   */
  invalidateCredential() {
    this.credentials.invalidate()
  }

  /**
   * Refresh the model catalog from upstream, keeping the last good one on failure.
   *
   * Concurrent calls coalesce: while one run is live, later callers join its
   * promise instead of starting a second fetch. The force flag is read by the
   * run that started the flight; joining is safe because a fetch that began
   * milliseconds ago is fresher than anything a duplicate would return.
   */
  refreshCatalog(force = false): Promise<void> {
    return this.catalogFlight(force)
  }

  /** The actual refresh work behind {@link RegionRuntime.refreshCatalog}. */
  async doRefreshCatalog(force?: boolean): Promise<void> {
    if (!force && this.catalog.fresh()) return
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
      this.applyOutcome({ ok: true, entries: raw.map((entry) => normalizeEntry(entry as FetchedEntry)) })
    } catch (error) {
      // A dispose mid-fetch is not a failure worth reporting: the runtime is
      // gone, there is nobody left to tell, and logging it would put a warning
      // in the log of every disable/reload.
      if (isRefreshObsolete(this)) return
      // Two failures that look alike and must not be merged: a transport or
      // auth error leaves the last good catalog in place, and so does a protocol
      // shape change — but the second is a standing verdict about the plugin,
      // not about this fetch, and it is recorded under its own reason so the
      // card says "update the plugin" instead of "sign in again".
      this.logger?.warn?.(
        `dsh-connect-qoder: ${this.region.displayName} catalog refresh failed`,
        error,
      )
      this.applyOutcome({
        ok: false,
        reason: isProtocolShapeChangedError(error) ? 'protocol-shape-changed' : 'fetch',
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
   * @param outcome - `{ ok: true, entries }` or `{ ok: false, reason, error }`.
   */
  applyOutcome(outcome: CatalogOutcome): { committed: boolean; previousFailure: RefreshFailure | undefined } {
    return applyCatalogOutcome(this, outcome)
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
    const credential = await this.resolveCredential()
    if (credential === undefined) return undefined
    const usage = await fetchUsage(this.region, credential)
    this.usage = usage
    this.usageAt = Date.now()
    return usage
  }

  /**
   * Drop the cached usage reading.
   *
   * Claiming puts Credits into the very add-on quota this panel shows, so the
   * next render has to re-read rather than serve a number taken before the
   * claim. {@link RegionRuntime.doReadUsage}'s own freshness window would
   * otherwise keep the old balance on screen for its full TTL.
   */
  invalidateUsage() {
    this.usage = undefined
    this.usageAt = 0
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
): Promise<{ region: Region; runtime: RegionRuntime; shim: ShimHandle } | undefined> {
  const runtime = new RegionRuntime(region, ctx)

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
  })
  try {
    await shim.ready
  } catch (error) {
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
  // The section can hand the plugin a LIVE source (a `() => T` closure or a
  // `{ get(): T }` reference to the settings document) instead of a frozen
  // value. Reading `preferences` directly after such a hand-off would keep the
  // startup copy forever; `current()` resolves the live source at read time.
  //
  // The DEFAULT source re-reads the Config object the Loader hands `apply` on
  // every access. On the 0.1.7 line that object is live: its `asVolatile`
  // fields hold `{ get() }` references that the Loader's `_commitVolatile`
  // swaps in place after every `settings.mutate` (same shape as the host's own
  // `plainOptions(config)` in dsh-llm-deepseek). The installSection hosts
  // (0.1.6) replace the source with their document reference through the
  // `setSource` callback instead.
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
  let preferencesSource: PreferencesSource = livePreferences
  let invalidateAdapter = () => {}

  /**
   * The namespace the HOST actually serves this plugin's settings under.
   *
   * On the 0.1.7 line the host derives it from the Loader entry — `describe()`
   * reports `ns: entry.options.id`, which for this bundle is `llm-qoder`, not
   * the `dsh-connect-qoder` the plugin used to name. The models settings page
   * resolves a provider's configuration row by **exact** match on this value
   * (`namespaces.get(entry.settingsNs)`), so declaring the constant here drops
   * the Qoder rows from that page entirely: the configuration surface and the
   * model-discovery entry point both go missing, silently, with the plugin
   * itself still registered and answering. See `settingsNamespaceOf`.
   */
  const settingsNs = settingsNamespaceOf(ctx, QODER_SETTINGS_NS)

  /** Resolve the live preferences, unwrapping a 0.1.7 live-reference source. */
  const current = () => resolvePreferences(preferences, preferencesSource)

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

  const started: Array<{ region: Region; runtime: RegionRuntime; shim: ShimHandle }> = []
  for (const region of REGIONS) {
    const entry = await startRegion(region, ctx, enabledIdsFor)
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

  /**
   * The service an `inject` callback was handed, as a NON-optional value.
   *
   * `ctx.inject(['webServer'], cb)` is Cordis's way of saying "do not call `cb`
   * until `webServer` exists" — so inside `cb` the service is present. That
   * fact lives in the `inject` call rather than in the type of
   * `webCtx.webServer` (which must stay optional: a Host without the service
   * never runs this callback at all, and `apply` still has to compile for it).
   *
   * Rather than sprinkle `!` at the seven registrations, or `?.` on code that
   * cannot be reached without the service, the guarantee is converted once
   * here. The throw is unreachable under a correct Host; it exists so that a
   * Host which fires the callback WITHOUT the service fails loudly at
   * activation instead of registering routes into `undefined`.
   */
  function injected<T>(service: T | undefined, name: string): T {
    if (service === undefined) {
      throw new Error(`dsh-connect-qoder: ctx.inject ran for '${name}' without the service`)
    }
    return service
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

  function publishRegions(): { ok: boolean; error?: unknown } {    const previousAdapter = adapter
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
    releaseAdapter?.()
    releaseDirectory?.()
    try {
      releaseAdapter = ctx.llm.registerAdapter(
        started.map(({ runtime }) => runtime.region.id),
        adapter.adapter,
      )
      releaseDirectory = ctx.llm.registerConfigurableProviders(
        started.map(({ runtime }) => providerRowFor(runtime)),
      )
    } catch (error) {
      // Release anything the failed registration managed to install.
      releaseAdapter?.()
      releaseDirectory?.()
      // Restore the previous registration when there was one; a region that
      // was serving before the reload must not be taken down by it.
      if (previousAdapter !== undefined) {
        try {
          releaseAdapter = ctx.llm.registerAdapter(previousProviderIds, previousAdapter.adapter)
          releaseDirectory = ctx.llm.registerConfigurableProviders(previousDirectory)
          invalidateAdapter = previousAdapter.invalidate
        } catch {
          // The previous pair cannot be re-registered either: the host's
          // registration service is broken across the board. Leave nothing
          // registered rather than claiming a pair that does not exist.
          releaseAdapter = undefined
          releaseDirectory = undefined
          invalidateAdapter = () => {}
        }
      } else {
        releaseAdapter = undefined
        releaseDirectory = undefined
        invalidateAdapter = () => {}
      }
      return { ok: false, error }
    }
    invalidateAdapter = adapter.invalidate
    return { ok: true }
  }

  /** Wire one runtime's invalidation to the current adapter pair. */
  const wireRuntime = (runtime: RegionRuntime) => {
    runtime.invalidate = () => {
      invalidateAdapter()
      ctx.emit('llm/adapters-updated')
    }
  }

  for (const { runtime } of started) wireRuntime(runtime)

  const initial = publishRegions()
  if (initial.ok !== true) {
    await Promise.allSettled(started.map(({ shim }) => shim.close()))
    ctx.logger.error?.('dsh-connect-qoder: provider registration failed', initial.error)
    return
  }

  ctx.effect(() => async () => {
    releaseAdapter?.()
    releaseDirectory?.()
    // Undo the route registrations, if the host handed back releases at all.
    // Done before the runtimes are torn down so a route cannot be reached while
    // a runtime is half-closed, and it never throws (see releaseRoutes).
    const released = releaseRoutes(routeReleases)
    if (released > 0) {
      ctx.logger.debug?.(`dsh-connect-qoder: released ${released} card route registration(s)`)
    }
    for (const { runtime } of started) {
      // Mark the runtime dead before clearing anything: an in-flight
      // `refreshCatalog().then` that races this dispose can still run and
      // would otherwise install a fresh `setInterval` onto the dead runtime.
      runtime.disposed = true
      // Cut the upstream request rather than only ignoring its answer: without
      // this a fetch started seconds earlier keeps a socket open against a
      // gateway for a region this process is no longer serving (issue 13).
      runtime.refreshAbort?.abort()
      if (runtime.refreshTimer !== undefined) clearInterval(runtime.refreshTimer)
    }
    // `close()` is idempotent and swallows `ERR_SERVER_NOT_RUNNING`, so
    // `allSettled` is safe even on a double-dispose. Awaiting the close means
    // the fiber's cleanup is complete before the process moves on: any
    // in-flight request has been aborted by `closeAllConnections` and the
    // loopback port is released.
    await Promise.allSettled(started.map(({ shim }) => shim.close()))
  })

  // Publish the settings section. Without this the namespace a provider
  // directory entry points at would hold no schema, and no configuration
  // surface could render a control for this route — context-window choice
  // included. The section is optional: a host without a settings service still
  // gets working models, just no configuration surface.
  ctx.inject(['settings'], (settingsCtx: HostContext) => {
    const settings = injected(settingsCtx.settings, 'settings')
    try {
      // FIX 0.1.7: the settings service replaced `installSection` with a
      // configure() auto-form on the 0.1.7 rewrite. Probe both (neither throws
      // on absence) so one build spans 0.1.6 and 0.1.7. Without a served
      // section the client card is registered but never rendered.
      //
      // 0.1.7 live-config: `configure({auto:true})` only registers the
      // auto-form presentation — it does NOT hand the plugin a live source
      // (there is no `setSource` on that line). The live seam on 0.1.7 is the
      // Config object the Loader hands `apply`, whose volatile fields are
      // updated in place by the Loader after every `settings.mutate` and
      // announced with `loader/volatile-update`. The default
      // `preferencesSource` therefore re-reads that live object on every
      // access (above), and the listener below refreshes the picker when the
      // event lands. The installSection hosts (0.1.6) replace the source with
      // their document reference through `setSource` instead.
      if (typeof settings.configure === 'function') {
        settings.configure({ auto: true }, ctx.fiber)
      } else if (typeof settings.installSection === 'function') {
        settings.installSection(ctx, settingsNs, QODER_SECTION, config, {
          setSource(source: unknown) {
            preferencesSource = source as PreferencesSource            // Install the live source and fold in its current value at once.
            // A source that has not been resolved yet degrades to the startup
            // preferences, so a half-handoff never blanks a field.
            const next = current()
            if (next !== preferences) preferences = next
            refreshPicker()
          },
          onChange() {
            refreshPicker()
          },
        })
      }
    } catch (error) {
      ctx.logger.warn?.('dsh-connect-qoder: settings section unavailable', error)
    }
  })

  // 0.1.7 dispatches `loader/volatile-update` on the plugin fiber after a
  // settings write updates the live config references in place — that is the
  // live seam the configure() auto-form relies on. `current()` now re-reads
  // those references, so re-snapshotting `preferences` here and refreshing the
  // picker is what makes a card save reach the running adapter without a DSH
  // restart. Optional chaining: hosts before 0.1.7 have no such event (or no
  // `ctx.on` at all), and there the installSection callbacks above already do
  // this.
  ctx.on?.('loader/volatile-update', () => {
    const next = current()
    if (next !== preferences) preferences = next
    refreshPicker()
  })

  // The settings card needs the live model roster to render one row per model,
  // and it cannot read the host catalog directly. This route is the only path,
  // so it is mounted on the optional webServer context and answers with the
  // catalog the adapter already holds — metadata only, never a credential.
  ctx.inject(['webServer'], (webCtx: HostContext) => {
    // Injection is the guarantee: `inject(['webServer'], …)` runs this callback
    // only once that service exists, so binding it to a local states that fact
    // once instead of re-testing the optional at each of the registrations
    // below. See `HostContext.webServer` / `HostService.register`.
    const webServer = injected(webCtx.webServer, 'webServer')
    try {
      rememberRouteRelease(routeReleases, webServer.register({
        kind: 'exact',
        path: QODER_MODELS_PATH,
        handler: async (req: IncomingMessage, res: ServerResponse) => {
          if (!methodAllowed(req, res, 'GET')) return
          if (!originAllowed(req, res)) return
          // `refresh=1` re-reads the catalog from upstream. It matters because
          // both the roster and the rates move on their own: Qoder adds and
          // retires models, and an off-peak discount flips the effective price
          // at 22:00 and 08:00 Asia/Shanghai. Without this the picker would
          // keep showing whatever was true at process start.
          const force = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('refresh') === '1'
          if (force) {
            for (const { runtime } of started) {
              try {
                await runtime.refreshCatalog(true)
              } catch (error) {
                // A refresh failure must not blank the card: the last good
                // catalog is still served below.
                ctx.logger.warn?.(
                  `dsh-connect-qoder: ${runtime.region.displayName} catalog refresh failed`,
                  error,
                )
              }
            }
          }
          const now = new Date()
          const settings = current()
          sendJson(
            res,
            200,
            buildModelRowsPayload({
              runtimes: started,
              settings,
              now,
              projectRow: projectModelRow,
              rates: MODEL_RATES,
            }),
          )
        },
      }))
    } catch (error) {
      ctx.logger.warn?.('dsh-connect-qoder: model route unavailable', error)
    }
  })

  // The card's save button writes through this authoritative Host endpoint
  // (same pattern as the WorkBuddy bundle's `__save`): the settings document
  // lives in the Host process, and on DSH 0.1.7 the client-side
  // `settingsScope.set()` can settle WITHOUT persisting — the Host's
  // atomic-write retries exhaust on a locked file, the scope reloads Host
  // state, and returns success anyway. A read-back check catches that, but
  // the only writer that actually lands the value there is a mutate executed
  // inside the Host process.
  ctx.inject(['webServer', 'settings'], (webCtx: HostContext) => {
    // Both names in the list are present when this runs; see the note on the
    // other `inject(['webServer'], …)` callbacks.
    const webServer = injected(webCtx.webServer, 'webServer')
    try {
      rememberRouteRelease(routeReleases, webServer.register({
        kind: 'exact',
        path: QODER_SAVE_PATH,
        handler: async (req: IncomingMessage, res: ServerResponse) => {
          if (!methodAllowed(req, res, 'POST')) return
          if (!originAllowed(req, res)) return
          const settings = webCtx.get?.('settings')
          if (settings === undefined) {
            return sendJson(res, 503, { error: 'settings service unavailable to this fiber' })
          }
          try {
            const body = await readJsonBody(req)
            // `readJsonBody` is a raw reader — it parses JSON and nothing else,
            // so the shape is whatever the client sent. Both fields are handed
            // over as `unknown` on purpose: `applySettingsSave` does the
            // validating (a non-string `field` is a 400 there, not a crash
            // here), and reading `body.field` directly off `unknown` is exactly
            // the unchecked access this narrowing replaces.
            const posted = (body ?? {}) as { field?: unknown; value?: unknown }
            const outcome = await applySettingsSave({
              settings,
              field: posted.field,
              value: posted.value,
              // The live host namespace first: on 0.1.7 it is the Loader entry
              // id (`llm-qoder`), and the constant only covers hosts that mount
              // this plugin without a Loader entry. The provider name stays in
              // the list because it is what 0.1.6 keyed the document by.
              candidates: [...new Set([settingsNs, QODER_SETTINGS_NS, name])],
              equals: isDeepStrictEqual,
            })
            if (outcome.body.ok !== true) return sendJson(res, outcome.status, outcome.body)
            // No `Object.assign(preferences, …)` here, and its absence used to
            // be a bug report: the old comment claimed folding the merged value
            // into the base snapshot was "belt-and-braces for a host whose
            // mutate does not dispatch the event". It never was — `current()`
            // resolves `{ ...snapshot, ...liveSource }`, so a live source that
            // HAS the field shadows whatever was folded in, and one that LACKS
            // it means the write never landed, which `applySettingsSave`'s
            // read-back has already rejected. The assignment was therefore
            // dead in both directions, and on the 0.1.7 line it could only ever
            // make the snapshot disagree with the document.
            refreshPicker()
            return sendJson(res, outcome.status, outcome.body)
          } catch (error) {
            sendJson(res, 500, {
              ok: false,
              errorName: (error as { name?: unknown } | undefined)?.name ?? 'unknown',
              error: describeThrown(error),
            })
          }
        },
      }))
    } catch (error) {
      ctx.logger.warn?.('dsh-connect-qoder: save route unavailable', error)
    }
  })

  // The usage panel needs the same treatment: the quota lives upstream behind a
  // bearer token the browser must never hold, so the host reads it and hands the
  // card a credential-free summary. Each region is read independently and a
  // failing region is reported as unavailable rather than failing the panel, so
  // one dead sign-in cannot hide the other region's numbers.
  ctx.inject(['webServer'], (webCtx: HostContext) => {
    // Injection is the guarantee: `inject(['webServer'], …)` runs this callback
    // only once that service exists, so binding it to a local states that fact
    // once instead of re-testing the optional at each of the registrations
    // below. See `HostContext.webServer` / `HostService.register`.
    const webServer = injected(webCtx.webServer, 'webServer')
    try {
      rememberRouteRelease(routeReleases, webServer.register({
        kind: 'exact',
        path: QODER_USAGE_PATH,
        handler: async (req: IncomingMessage, res: ServerResponse) => {
          if (!methodAllowed(req, res, 'GET')) return
          if (!originAllowed(req, res)) return
          const force = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('refresh') === '1'
          const regions = await Promise.all(
            started.map(async ({ runtime }) => {
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
                ctx.logger.warn?.(
                  `dsh-connect-qoder: ${runtime.region.displayName} usage read failed`,
                  error,
                )
                return { ...base, available: false }
              }
            }),
          )
          sendJson(res, 200, { regions })
        },
      }))
    } catch (error) {
      ctx.logger.warn?.('dsh-connect-qoder: usage route unavailable', error)
    }
  })

  // The daily check-in, from a route owned by this plugin.
  //
  // Nothing about it is automatic and nothing about it is guessed: the card
  // names the region, this host re-reads Qoder's own campaign list, and only a
  // round that is open and unclaimed is ever posted at. The card therefore
  // cannot claim a stale round even if it were to render one.
  ctx.inject(['webServer'], (webCtx: HostContext) => {
    // Injection is the guarantee: `inject(['webServer'], …)` runs this callback
    // only once that service exists, so binding it to a local states that fact
    // once instead of re-testing the optional at each of the registrations
    // below. See `HostContext.webServer` / `HostService.register`.
    const webServer = injected(webCtx.webServer, 'webServer')
    try {
      rememberRouteRelease(routeReleases, webServer.register({
        kind: 'exact',
        path: QODER_CHECKIN_PATH,
        handler: async (req: IncomingMessage, res: ServerResponse) => {
          if (!methodAllowed(req, res, 'POST')) return
          if (!originAllowed(req, res)) return
          const requested = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('region')
          const entry = started.find((candidate) => candidate.region.id === requested)
          if (entry === undefined) return sendJson(res, 404, { error: 'unknown-region' })
          try {
            sendJson(res, 200, await claimToday(entry.runtime))
          } catch (error) {
            // The one route where failure must name itself: an unusable sign-in,
            // a round that ended minutes ago, and a rejected claim are three
            // different problems wearing the same "nothing happened".
            ctx.logger.warn?.(`dsh-connect-qoder: ${entry.region.displayName} check-in failed`, error)
            sendJson(res, 502, { error: error instanceof Error ? error.message : String(error) })
          }
        },
      }))
    } catch (error) {
      ctx.logger.warn?.('dsh-connect-qoder: check-in route unavailable', error)
    }
  })

  /**
   * Claim one region's daily check-in, reporting what actually happened.
   *
   * Extracted from the route so the interesting part — which round gets claimed
   * and what the answer means — is assertable without a Cordis context. Same
   * `(input) => result` shape `applySettingsSave` established for the settings
   * pipeline.
   *
   * @param runtime - the region's runtime.
   * @returns `{ region, claimed, replayed, amount?, alreadyClaimed, checkin }`.
   */
  async function claimToday(runtime: RegionRuntime) {
    const credential = await runtime.resolveCredential()
    if (credential === undefined) throw new Error('no usable sign-in on this machine')

    const campaigns = await readCampaigns(runtime.region, credential)
    const campaign = claimableCampaignOf(campaigns)
    if (campaign === undefined) throw new Error('Qoder is not running a check-in for this account today')
    if (campaignIsClaimed(campaign)) {
      // Already collected today: posting anyway would buy a round trip to be
      // told the same thing, and the upstream would grant nothing.
      return {
        region: runtime.region.id,
        claimed: false,
        replayed: true,
        alreadyClaimed: true,
        checkin: checkinStateFrom(campaigns),
      }
    }

    // `campaignId` is not read by `claim.ts` on purpose — the card-facing state
    // never publishes it — but the CLAIM POST needs it, so it is read here off
    // the record the picker returned. An absent id is the upstream changing the
    // protocol, and `claimCampaign` answers a 400 for it rather than posting an
    // empty id.
    const campaignId = campaign.campaignId
    if (typeof campaignId !== 'string') throw new Error('campaign record carries no campaign id')
    const raw = await claimCampaign(runtime.region, credential, campaignId)
    const result = normalizeClaimResult(raw, campaign)
    if (result.claimed !== true) throw new Error('Qoder did not confirm this check-in')

    // The Credits land in the add-on quota this same panel renders, so the
    // cached reading is now wrong about the balance.
    runtime.invalidateUsage()

    // Read the result back instead of assuming it: a claim that the upstream
    // answered without recording would otherwise read as claimed forever.
    let checkin = { ...checkinStateFrom(campaigns), todayCheckedIn: true }
    try {
      checkin = checkinStateFrom(await readCampaigns(runtime.region, credential))
    } catch {
      // An unreadable acknowledgement still leaves a claimed round; the derived
      // state above is the most honest answer available.
    }
    return { region: runtime.region.id, ...result, alreadyClaimed: false, checkin }
  }

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
      const entry = await startRegion(region, ctx, enabledIdsFor)
      if (entry === undefined) continue
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

  // The account panel: which sign-in drives each region, and in which state
  // it is — all from local evidence, so reading it costs no network. It is
  // where a "this region shows no models" stops being a mystery: the panel
  // says whether the app is not installed, the sign-in expired, or the store
  // cannot be read and why (the recorded unwrap cause, see
  // `lib/account-state.js`).
  //
  // The three routes share one mount block: same loopback-only rule, same
  // failure posture — registration trouble logs and the card simply has no
  // account panel, exactly like the usage route.

  // Every region record carries `enabled` — is that region's provider offered
  // to DSH right now (the account panel's switch state) — and the top level
  // carries the fully-resolved `enabledRegions` map so the card can post a
  // complete one back when the switch flips. Resolved live from `current()` on
  // each request, so a save made through the settings pipeline is visible to
  // the next panel render without a restart.
  //
  // `cachedOnly` here (issue 07): this runs on EVERY panel render, and the
  // underlying store read would otherwise unwrap — an OSCrypt unwrap is a
  // PowerShell child that measured ~0.5 s of event-loop freeze per region (and
  // up to the 30 s timeout on failure), so without this the host would stall on
  // a machine that cannot unwrap, which is exactly the state this panel is
  // supposed to be able to display. Reading from the key cache keeps the answer
  // honest (`needs-app` with the recorded reason) and the UI responsive;
  // "重读登录" is the explicit, user-driven moment that re-reads for real.
  //
  // `force` is the opposite end, for that one user-initiated request, and the
  // SHAPE is the same either way — see the reload route, which used to answer
  // with a narrower body and made the card follow up with a second GET.
  //
  // Async because the forced path DOES unwrap, and the handler awaits this
  // rather than blocking DSH's event loop for half a second while a user waits
  // to see whether their re-sign-in worked.
  // Named for what it does, not for where its dependencies live: the state read
  // it performs belongs to `lib/account-payload.js`, which a test can import.
  // Keeping it as a closure here once meant the panel's whole read path ran
  // outside every gate in this repository. See that module's header.
  const accountPayload = (options = {}) => buildAccountPayload({ regions: REGIONS, settings: current(), ...options })

  ctx.inject(['webServer'], (webCtx: HostContext) => {
    // Injection is the guarantee: `inject(['webServer'], …)` runs this callback
    // only once that service exists, so binding it to a local states that fact
    // once instead of re-testing the optional at each of the registrations
    // below. See `HostContext.webServer` / `HostService.register`.
    const webServer = injected(webCtx.webServer, 'webServer')
    try {
      rememberRouteRelease(routeReleases, webServer.register({
        kind: 'exact',
        path: QODER_ACCOUNT_PATH,
        handler: async (req: IncomingMessage, res: ServerResponse) => {
          if (!methodAllowed(req, res, 'GET')) return
          if (!originAllowed(req, res)) return
          // The guard the RELOAD route below carries, and this one did not.
          // It is the same drift that guard was written to fix: a throw from
          // the handler reaches the web server's catch-all, which answers a
          // bodyless 400, and the card can only render that as
          // "读取账号状态失败" — with nothing anywhere saying WHY, because the
          // catch-all logs nothing either. Crashing to a 500 with the reason
          // at least names the step that failed, and `logger.error` puts the
          // stack where it can be read.
          try {
            sendJson(res, 200, await accountPayload())
          } catch (error) {
            ctx.logger.error?.('dsh-connect-qoder: account state read failed', error)
            sendJson(res, 500, {
              error: 'account state read failed',
              errorName: (error as { name?: unknown } | undefined)?.name ?? 'Error',
              detail: describeThrown(error).slice(0, 300),
            })
          }
        },
      }))

      rememberRouteRelease(routeReleases, webServer.register({
        kind: 'exact',
        path: QODER_ACCOUNT_RELOAD_PATH,
        handler: async (req: IncomingMessage, res: ServerResponse) => {
          if (!methodAllowed(req, res, 'POST')) return
          if (!originAllowed(req, res)) return
          const read = await readJsonBodyOr400(req, res)
          if (read.ok !== true) return
          const body = read.body
          // As in the save route: the body's shape is the client's, so the one
          // read below goes through an explicit narrowing rather than off
          // `unknown`. A non-string `region` is not an error here — it simply
          // falls through to `undefined`, which means "every region".
          const posted = (body ?? {}) as { region?: unknown }
          const wanted =
            typeof posted.region === 'string' && REGIONS.some((region) => region.id === posted.region)
              ? posted.region
              : undefined
          // "Re-read" for a running region means: drop the cached credential
          // so the next resolve re-reads the app store, and force a catalog
          // refresh so the picker sees what is readable now.
          for (const { runtime } of started) {
            if (wanted !== undefined && runtime.region.id !== wanted) continue
            runtime.invalidateCredential()
            void runtime.refreshCatalog(true)
          }
          // A region with no runtime at all — no sign-in, or an expired one,
          // at activation — needs more: start it now, and publish the
          // widened set. This is the "re-sign in, and the region appears
          // without a DSH restart" path.
          //
          // Guarded: a region that fails to start is left exactly as it was
          // (the failure posture this route documents), and the panel still
          // gets its fresh states. Without the guard a throw here reached the
          // web server's catch-all, which answers a bare 400 with no body —
          // undiagnosable from the card, and it hid the whole panel.
          try {
            await startStoppedRegions(wanted)
          } catch (error) {
            ctx.logger.error?.('dsh-connect-qoder: account re-read failed to start a stopped region', error)
          }
          // `force: true` is deliberate and unlike the GET above: this is the
          // user pressing "重读登录", i.e. asking for the store to be read again
          // right now. Caching the answer here would make the button a no-op
          // exactly when someone re-signed-in to fix a `needs-app`, and `force`
          // additionally ignores the unwrap failure window so a retry inside that
          // window still really retries.
          //
          // The SHAPE is the shared `accountPayload` one — `{ regions,
          // enabledRegions }` — not a narrower `{ regions }`. The card reads
          // this response directly, so a thinner body meant it had to follow up
          // with a second GET to learn the per-region switches, and the two
          // responses could disagree in between (issue 12, item 8).
          sendJson(res, 200, await accountPayload({ force: true }))
        },
      }))

      rememberRouteRelease(routeReleases, webServer.register({
        kind: 'exact',
        path: QODER_ACCOUNT_CONFIRM_PATH,
        handler: async (req: IncomingMessage, res: ServerResponse) => {
          if (!methodAllowed(req, res, 'POST')) return
          if (!originAllowed(req, res)) return
          const read = await readJsonBodyOr400(req, res)
          if (read.ok !== true) return
          // Same narrowing as the reload route: `find` comparing against `entry.id`
          // is the validity check, so a missing or non-string `region` simply
          // matches nothing and the 400 below answers it.
          const posted = (read.body ?? {}) as { region?: unknown }
          const region = REGIONS.find((entry) => entry.id === posted.region)
          if (region === undefined) return sendJson(res, 400, { error: 'unknown region' })
          const runtime = started.find((entry) => entry.region.id === region.id)?.runtime
          const credential =
            runtime !== undefined
              ? await runtime.resolveCredential()
              : loadCredential(region, appDataRootFor()) ?? loadEnvCredential(region)
          if (credential === undefined) return sendJson(res, 200, { region: region.id, available: false })
          try {
            const info = await fetchUserInfo(region, credential)
            // Identity only: the panel is a browser surface, and a userID is
            // account data the card never renders, so it is dropped here
            // rather than carried to the browser.
            return sendJson(res, 200, {
              region: region.id,
              available: true,
              confirmed: true,
              identity: { name: info.name, email: info.email },
            })
          } catch (error) {
            // Classify the way the shim does: a sign-in rejection is the one
            // answer that changes what the user should do (re-sign in, then
            // re-read), so it is named; everything else is a plain "could
            // not confirm" with the transport detail.
            const message = describeThrown(error)
            const kind = classifyUpstreamError({ message }, '', message).kind
            if (kind === 'sign-in-expired' && runtime !== undefined) {
              // The upstream said this credential is dead: treat it as the
              // sign-in rejection it is, so the re-read after a re-sign-in
              // picks up the fresh store.
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
        },
      }))
    } catch (error) {
      ctx.logger.warn?.('dsh-connect-qoder: account routes unavailable', error)
    }
  })

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
  void runtime.refreshCatalog(true).then(() => {
    if (runtime.disposed) return
    runtime.refreshTimer = setInterval(() => {
      void runtime.refreshCatalog(true)
    }, CATALOG_TTL_MS)
    runtime.refreshTimer.unref?.()
  })
}
