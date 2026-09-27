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
import { createQoderAdapter, offPeakActive, offPeakRemaining, rateNow } from './adapter.js'
import { createQoderShim } from './shim.js'
import { REGIONS, loadCredential, loadEnvCredential, sweepStaleOscryptDirs, setCredentialDiagnosticSink } from './credentials.js'
import { readAccountState } from './account-state.js'
import { CredentialCache } from './credential-cache.js'
import { applySettingsSave, settingsNamespaceOf } from './settings-save.js'
import { createSingleFlight } from './single-flight.js'
import {
  enabledIdsFor as resolveEnabledIds,
  imageModeFor as resolveImageMode,
  preferMaximumContext as prefersMaximumContext,
  regionEnabledFor as resolveRegionEnabled,
  resolvePreferences,
} from './preferences.js'
import { CatalogStore, CATALOG_TTL_MS as catalogTtlMs } from './catalog-store.js'
import { normalizeEntry, projectModelRow, buildModelRowsPayload } from './catalog-entry.js'
import { exchangePat, fetchModels, fetchUsage, fetchUserInfo, readCampaigns, claimCampaign } from './upstream.js'
import { classifyUpstreamError } from './errors.js'
import {
  campaignIsClaimed,
  checkinStateFrom,
  claimableCampaignOf,
  normalizeClaimResult,
} from './claim.js'
import { sendJson } from './http-utils.js'

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
function asVolatile(schema) {
  if (typeof schema.volatile === 'function') return schema.volatile()
  return schema
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

/**
 * Read one POST body as JSON, with a size cap.
 *
 * The bodies on this plugin's write routes are tiny (a settings field, a
 * region id), so a 64 KiB cap is generous and the overflow path is pure
 * rejection: the request is destroyed rather than drained. An empty body
 * parses as `undefined` from `JSON.parse`'s standpoint, so callers that
 * accept "no body" do so explicitly — the cap is enforced regardless.
 */
async function readJsonBody(req, maxBytes = 64 * 1024) {
  const chunks = []
  let size = 0
  await new Promise((resolve, reject) => {
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > maxBytes) {
        reject(new Error(`body exceeds ${maxBytes} bytes`))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', resolve)
    req.on('error', reject)
  })
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.length === 0) return undefined
  return JSON.parse(text)
}

/**
 * Whether a card request came from this machine.
 *
 * The route exposes model metadata, not credentials, but it stays loopback-only
 * anyway: it is an internal read path for a browser page this host itself
 * served, and a missing Origin (a same-origin GET) is the normal case.
 */
function loopbackRequest(req) {
  const origin = req.headers.origin
  if (origin === undefined) return true
  if (typeof origin !== 'string') return false
  try {
    const host = new URL(origin).hostname
    return host === '127.0.0.1' || host === 'localhost' || host === '::1'
  } catch {
    return false
  }
}

/**
 * Assert the request method is one of the allowed methods.
 *
 * Every card route starts with this check. Extracts the 405 response so each
 * handler's first line is the check and the rest is the handler logic.
 *
 * @returns true if the method is allowed, false if the response was sent.
 */
function methodAllowed(req, res, ...methods) {
  if (methods.includes(req.method)) return true
  sendJson(res, 405, { error: 'method not allowed' })
  return false
}

/**
 * Assert the request came from this machine.
 *
 * Every card route calls this after the method check. Extracts the 403
 * response so each handler's second line is the check and the rest is the
 * handler logic.
 *
 * @returns true if the origin is trusted, false if the response was sent.
 */
function originAllowed(req, res) {
  if (loopbackRequest(req)) return true
  sendJson(res, 403, { error: 'origin-not-trusted' })
  return false
}

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
  constructor(region, ctx) {
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
      loadApp: () => loadCredential(this.region, process.env.APPDATA ?? ''),
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
  refreshCatalog(force = false) {
    return this.catalogFlight(force)
  }

  /** The actual refresh work behind {@link RegionRuntime.refreshCatalog}. */
  async doRefreshCatalog(force) {
    if (!force && this.catalog.fresh()) return
    let credential
    try {
      credential = await this.resolveCredential()
    } catch (error) {
      this.logger?.warn?.(`dsh-connect-qoder: ${this.region.displayName} credential resolution failed`, error)
      return
    }
    if (credential === undefined) return
    try {
      const raw = await fetchModels(this.region, credential)
      const entries = raw.map(normalizeEntry)
      if (entries.length > 0) {
        this.catalog.replace(entries)
        this.invalidate?.()
      }
    } catch (error) {
      this.logger?.warn?.(`dsh-connect-qoder: ${this.region.displayName} catalog refresh failed`, error)
    }
  }

  /** Look up the upstream key for a user-facing model id. */
  upstreamKey(modelId) {
    const found = this.catalog.current().find((entry) => entry.id === modelId)
    return found?.key
  }

  /** The catalog entry behind a user-facing model id. */
  entryFor(modelId) {
    return this.catalog.current().find((entry) => entry.id === modelId)
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
  readUsage(force = false) {
    return this.usageFlight(force)
  }

  /** The actual fetch behind {@link RegionRuntime.readUsage}. */
  async doReadUsage(force) {
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
async function startRegion(region, ctx, enabledIdsFor) {
  const runtime = new RegionRuntime(region, ctx)

  // A region is published only when it can actually answer. Registering a
  // provider whose sign-in is missing or expired puts a dead route in the model
  // picker: selecting it sends a request the gateway answers with 403, which
  // the UI reports as "the provider rejected this request" — blaming the user's
  // account for a channel this plugin should never have offered. Skipping the
  // region leaves the other one working and the picker honest.
  let credential
  try {
    credential = await runtime.resolveCredential()
  } catch (error) {
    ctx.logger.warn(
      `dsh-connect-qoder: ${region.displayName} sign-in is unusable; region not registered`,
      error,
    )
    return undefined
  }
  if (credential === undefined) {
    ctx.logger.info(
      `dsh-connect-qoder: ${region.displayName} has no local sign-in; region not registered`,
    )
    return undefined
  }
  if (credential.expired === true) {
    ctx.logger.warn(
      `dsh-connect-qoder: ${region.displayName} sign-in has expired; region not registered ` +
        `(open the ${region.displayName} app to renew it, then re-read from the Qoder card ` +
        `or restart DSH)`,
    )
    return undefined
  }

  const shim = createQoderShim({
    region,
    resolveCredential: () => runtime.resolveCredential(),
    resolveModels: () => runtime.catalog.current(),
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
    ctx.logger.error(`dsh-connect-qoder: ${region.displayName} loopback endpoint failed to start`, error)
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
export async function apply(ctx, config = {}) {
  try {
    await activate(ctx, config)
  } catch (error) {
    ctx.logger.error('dsh-connect-qoder: activation failed; Qoder models will be unavailable', error)
  }
}

/** The real activation sequence, called under {@link apply}'s guard. */
async function activate(ctx, config) {
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
  let preferences = { ...config }
  const livePreferences = () => {
    const next = { ...config }
    for (const [key, value] of Object.entries(next)) {
      if (value !== null && typeof value === 'object' && typeof value.get === 'function') {
        next[key] = value.get()
      }
    }
    return next
  }
  let preferencesSource = livePreferences
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
  const enabledIdsFor = (regionId) => resolveEnabledIds(current(), regionId)

  // Give the credential layer a logger. Without one, a failed OSCrypt unwrap
  // was completely silent — the region simply never appeared in the picker.
  setCredentialDiagnosticSink((message) => ctx.logger.warn(message))

  // Reclaim the key hand-off directories a crashed or killed run left behind,
  // BEFORE this run creates its own. A `finally` in `oscryptKeyFor` covers
  // ordinary faults, but a force-killed host or a power loss leaves
  // `%TEMP%\qoder-oscrypt-*\key.b64` on disk holding the app's 32-byte master
  // key as plain base64. The sweep only touches directories older than its age
  // guard, so a concurrent DSH instance that is unwrapping right now is safe.
  try {
    const reclaimed = sweepStaleOscryptDirs()
    if (reclaimed > 0) {
      ctx.logger.info(`dsh-connect-qoder: reclaimed ${reclaimed} stale credential temp dir(s)`)
    }
  } catch (error) {
    // Housekeeping only: failing to sweep must never stop the plugin from
    // starting, and the directories are inert without a reader.
    ctx.logger.warn('dsh-connect-qoder: stale credential temp sweep failed', error)
  }

  const started = []
  for (const region of REGIONS) {
    const entry = await startRegion(region, ctx, enabledIdsFor)
    if (entry !== undefined) started.push(entry)
  }
  if (started.length === 0) {
    ctx.logger.warn('dsh-connect-qoder: no Qoder region could start')
    return
  }

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
      resolveAttachments: () => ctx.get('attachments'),
      resolveImageAccess: (attachments, ref) =>
        resolveImageAttachmentAccess(
          attachments,
          (hostPath) => ctx.get('fs')?.processPathFromHostPath(hostPath),
          ref,
        ),
    })

  let adapter = buildAdapter()

  let releaseAdapter
  let releaseDirectory

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
  function publishRegions() {
    const previousAdapter = adapter
    const previousProviderIds = started.map(({ runtime }) => runtime.region.id)
    const previousDirectory = started.map(({ runtime }) => ({
      provider: runtime.region.id,
      displayName: runtime.region.displayName,
      settingsNs,
      settingsPath: [],
      declared: false,
    }))
    adapter = buildAdapter()
    releaseAdapter?.()
    releaseDirectory?.()
    try {
      releaseAdapter = ctx.llm.registerAdapter(
        started.map(({ runtime }) => runtime.region.id),
        adapter.adapter,
      )
      releaseDirectory = ctx.llm.registerConfigurableProviders(
        started.map(({ runtime }) => ({
          provider: runtime.region.id,
          displayName: runtime.region.displayName,
          settingsNs,
          settingsPath: [],
          declared: false,
        })),
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
  const wireRuntime = (runtime) => {
    runtime.invalidate = () => {
      invalidateAdapter()
      ctx.emit('llm/adapters-updated')
    }
  }

  for (const { runtime } of started) wireRuntime(runtime)

  const initial = publishRegions()
  if (initial.ok !== true) {
    await Promise.allSettled(started.map(({ shim }) => shim.close()))
    ctx.logger.error('dsh-connect-qoder: provider registration failed', initial.error)
    return
  }

  ctx.effect(() => async () => {
    releaseAdapter?.()
    releaseDirectory?.()
    for (const { runtime, shim } of started) {
      // Mark the runtime dead before clearing anything: an in-flight
      // `refreshCatalog().then` that races this dispose can still run and
      // would otherwise install a fresh `setInterval` onto the dead runtime.
      runtime.disposed = true
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
  ctx.inject(['settings'], (settingsCtx) => {
    const settings = settingsCtx.settings
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
          setSource(source) {
            preferencesSource = source
            // Install the live source and fold in its current value at once.
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
      ctx.logger.warn('dsh-connect-qoder: settings section unavailable', error)
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
  ctx.inject(['webServer'], (webCtx) => {
    try {
      webCtx.webServer.register({
        kind: 'exact',
        path: QODER_MODELS_PATH,
        handler: async (req, res) => {
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
                ctx.logger.warn(
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
      })
    } catch (error) {
      ctx.logger.warn('dsh-connect-qoder: model route unavailable', error)
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
  ctx.inject(['webServer', 'settings'], (webCtx) => {
    try {
      webCtx.webServer.register({
        kind: 'exact',
        path: QODER_SAVE_PATH,
        handler: async (req, res) => {
          if (!methodAllowed(req, res, 'POST')) return
          if (!originAllowed(req, res)) return
          const settings = webCtx.get?.('settings')
          if (settings === undefined) {
            return sendJson(res, 503, { error: 'settings service unavailable to this fiber' })
          }
          try {
            const body = await readJsonBody(req)
            const outcome = await applySettingsSave({
              settings,
              field: body?.field,
              value: body?.value,
              // The live host namespace first: on 0.1.7 it is the Loader entry
              // id (`llm-qoder`), and the constant only covers hosts that mount
              // this plugin without a Loader entry. The provider name stays in
              // the list because it is what 0.1.6 keyed the document by.
              candidates: [...new Set([settingsNs, QODER_SETTINGS_NS, name])],
              equals: isDeepStrictEqual,
            })
            if (outcome.body.ok !== true) return sendJson(res, outcome.status, outcome.body)
            // `settings.mutate` already persisted the value and (on the 0.1.7
            // line) reconciles the Loader entry, which updates the live config
            // reference and dispatches `loader/volatile-update` — the listener
            // above refreshes the picker from that. This is belt-and-braces for
            // a host whose mutate does not dispatch the event: fold the merged
            // value into the base snapshot so `current()` sees it immediately.
            // Only on a confirmed write: folding in a value that did not land
            // would show the picker something the document does not contain.
            Object.assign(preferences, { [body.field]: outcome.body.value })
            refreshPicker()
            return sendJson(res, outcome.status, outcome.body)
          } catch (error) {
            const err = error
            sendJson(res, 500, {
              ok: false,
              errorName: err?.name ?? 'unknown',
              error: err?.message ?? String(error),
            })
          }
        },
      })
    } catch (error) {
      ctx.logger.warn('dsh-connect-qoder: save route unavailable', error)
    }
  })

  // The usage panel needs the same treatment: the quota lives upstream behind a
  // bearer token the browser must never hold, so the host reads it and hands the
  // card a credential-free summary. Each region is read independently and a
  // failing region is reported as unavailable rather than failing the panel, so
  // one dead sign-in cannot hide the other region's numbers.
  ctx.inject(['webServer'], (webCtx) => {
    try {
      webCtx.webServer.register({
        kind: 'exact',
        path: QODER_USAGE_PATH,
        handler: async (req, res) => {
          if (!methodAllowed(req, res, 'GET')) return
          if (!originAllowed(req, res)) return
          const force = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('refresh') === '1'
          const regions = await Promise.all(
            started.map(async ({ runtime }) => {
              const base = {
                region: runtime.region.id,
                regionName: runtime.region.displayName,
                manageUrl: runtime.region.manageUrl,
              }
              try {
                const usage = await runtime.readUsage(force)
                return usage === undefined ? { ...base, available: false } : { ...base, available: true, ...usage }
              } catch (error) {
                ctx.logger.warn(
                  `dsh-connect-qoder: ${runtime.region.displayName} usage read failed`,
                  error,
                )
                return { ...base, available: false }
              }
            }),
          )
          sendJson(res, 200, { regions })
        },
      })
    } catch (error) {
      ctx.logger.warn('dsh-connect-qoder: usage route unavailable', error)
    }
  })

  // The daily check-in, from a route owned by this plugin.
  //
  // Nothing about it is automatic and nothing about it is guessed: the card
  // names the region, this host re-reads Qoder's own campaign list, and only a
  // round that is open and unclaimed is ever posted at. The card therefore
  // cannot claim a stale round even if it were to render one.
  ctx.inject(['webServer'], (webCtx) => {
    try {
      webCtx.webServer.register({
        kind: 'exact',
        path: QODER_CHECKIN_PATH,
        handler: async (req, res) => {
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
            ctx.logger.warn(`dsh-connect-qoder: ${entry.region.displayName} check-in failed`, error)
            sendJson(res, 502, { error: error instanceof Error ? error.message : String(error) })
          }
        },
      })
    } catch (error) {
      ctx.logger.warn('dsh-connect-qoder: check-in route unavailable', error)
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
  async function claimToday(runtime) {
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

    const raw = await claimCampaign(runtime.region, credential, campaign.campaignId)
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
  async function startStoppedRegions(onlyRegionId) {
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
      ctx.logger.error(
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
  const accountPayload = () => {
    const enabledRegions = Object.fromEntries(
      REGIONS.map((region) => [region.id, resolveRegionEnabled(current(), region.id)]),
    )
    return {
      regions: REGIONS.map((region) => ({
        ...readAccountState(region, process.env.APPDATA ?? ''),
        enabled: enabledRegions[region.id],
      })),
      enabledRegions,
    }
  }

  ctx.inject(['webServer'], (webCtx) => {
    try {
      webCtx.webServer.register({
        kind: 'exact',
        path: QODER_ACCOUNT_PATH,
        handler: async (req, res) => {
          if (!methodAllowed(req, res, 'GET')) return
          if (!originAllowed(req, res)) return
          sendJson(res, 200, accountPayload())
        },
      })

      webCtx.webServer.register({
        kind: 'exact',
        path: QODER_ACCOUNT_RELOAD_PATH,
        handler: async (req, res) => {
          if (!methodAllowed(req, res, 'POST')) return
          if (!originAllowed(req, res)) return
          const body = await readJsonBody(req)
          const wanted =
            typeof body?.region === 'string' && REGIONS.some((region) => region.id === body.region)
              ? body.region
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
            ctx.logger.error('dsh-connect-qoder: account re-read failed to start a stopped region', error)
          }
          const regions = REGIONS.map((region) => readAccountState(region, process.env.APPDATA ?? ''))
          sendJson(res, 200, { regions })
        },
      })

      webCtx.webServer.register({
        kind: 'exact',
        path: QODER_ACCOUNT_CONFIRM_PATH,
        handler: async (req, res) => {
          if (!methodAllowed(req, res, 'POST')) return
          if (!originAllowed(req, res)) return
          const body = await readJsonBody(req)
          const region = REGIONS.find((entry) => entry.id === body?.region)
          if (region === undefined) return sendJson(res, 400, { error: 'unknown region' })
          const runtime = started.find((entry) => entry.region.id === region.id)?.runtime
          const credential =
            runtime !== undefined
              ? await runtime.resolveCredential()
              : loadCredential(region, process.env.APPDATA ?? '') ?? loadEnvCredential(region)
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
            const message = String(error?.message ?? error)
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
      })
    } catch (error) {
      ctx.logger.warn('dsh-connect-qoder: account routes unavailable', error)
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
function beginCatalogUpdates(runtime) {
  void runtime.refreshCatalog(true).then(() => {
    if (runtime.disposed) return
    runtime.refreshTimer = setInterval(() => {
      void runtime.refreshCatalog(true)
    }, CATALOG_TTL_MS)
    runtime.refreshTimer.unref?.()
  })
}
