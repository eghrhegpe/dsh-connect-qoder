/**
 * The Qoder pi-ai adapter.
 *
 * One adapter instance serves both Qoder regions, because each region is just
 * another profile in the same map — the same way a single `PiAiAdapter` can
 * front several providers. Every model's `baseUrl` points at its region's
 * loopback shim, so routing a request to a model is enough to select the
 * region, the credential, and the signing path.
 *
 * The profile is assembled by hand rather than through `dsh-llm-pi-ai`'s
 * internal resolver: that helper is not part of the package's public export
 * surface, so every field it would have supplied has to be named here.
 *
 * @module dsh-connect-qoder/adapter
 */
import { createProvider } from '@earendil-works/pi-ai'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import { resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import { filterByEnabled } from './catalog-entry.js'
import { toPiModel } from './pi-model.js'
import { offPeakActive, offPeakRemaining, rateNow } from './offpeak.js'

/**
 * The model descriptor builder, re-exported from lib/pi-model.js.
 *
 * The function itself builds a plain object and touches no pi-ai API, so it
 * lives in a module with no peer dependencies and can be tested directly — which
 * matters because it carries `compat.supportsDeveloperRole: false`, the flag
 * whose absence makes every request 403 with a fictional "you are in the queue"
 * error while DSH retries forever. Re-exported so the adapter keeps presenting
 * one module's surface.
 */
export { toPiModel } from './pi-model.js'

/** Idle ceiling while one stream read is outstanding. */
const STREAM_IDLE_TIMEOUT_MS = 300000

/**
 * Image budgets at the `dsh-llm-pi-ai` defaults. They bound requests to models
 * whose catalog entry declares image input; text-only models never see images.
 */
const REQUEST_IMAGE_BUDGETS = {
  maxRequestImageBytes: 20971520,
  requestImagePixelBudget: 4194304,
  requestImageMaxBytes: 1048576,
}

/**
 * Inert pi-ai auth plane.
 *
 * This route authenticates only through the shim's shared secret, resolved per
 * request by `resolveApiKey`. pi-ai's own credential lifecycle must never
 * manufacture a credential for it, so every ambient question answers "nothing
 * stored, nothing set".
 */
const INERT_AUTH = {
  credentials: {
    async read() {},
    async list() {
      return []
    },
    async modify() {
      throw new Error('dsh-connect-qoder: the qoder route has no pi-ai credential lifecycle')
    },
    async delete() {},
  },
  authContext: {
    async env() {},
    async fileExists() {
      return false
    },
  },
}

/**
 * The off-peak helpers, re-exported from lib/offpeak.js.
 *
 * They are re-exported rather than wrapped so that the settings card and the
 * adapter keep importing one name from one place, while the arithmetic itself
 * lives in a module that has no pi-ai dependency and can therefore be tested
 * directly. `offPeakRemaining` is exported so the card can show the same
 * countdown the Qoder client does, computed from the same catalog entry rather
 * than re-derived.
 */
export { offPeakActive, offPeakRemaining, rateNow } from './offpeak.js'

/**
 * Narrow a catalog to the models the user enabled.
 *
 * An **empty list means "no filter"**, following the WorkBuddy convention: a
 * fresh install has saved nothing and must still see every model. Once the list
 * is non-empty it becomes an allow-list.
 *
 * This is shared because two independent readers must agree: the adapter builds
 * the model list DSH routes requests through, and the shim answers
 * `GET /v1/models`, which is what the picker's discovery actually reads. If they
 * diverge, unchecking a model removes it from one surface and leaves it in the
 * other — so the filtering lives in one place rather than being written twice.
 *
 * Re-exported from lib/catalog-entry.js: that module is dependency-free, which
 * is what lets lib/shim.js use it without dragging adapter.js's peer
 * dependencies along.
 */
export { filterByEnabled } from './catalog-entry.js'

/**
 * Assemble one adapter covering every region.
 *
 * A single `PiAiAdapter` serves all regions because `registerAdapter` maps a
 * *set* of providers onto one adapter: registering each region in its own call
 * would leave only the last one owned, since a later call replaces the previous
 * registration rather than adding to it.
 *
 * @param options.regions - `[{ region, shim, catalog }]`, one entry per region.
 * @param options.preferMaximumContext - `() => boolean`, read per model build so
 *   the settings switch takes effect on the next `llm/adapters-updated`.
 * @param options.imageModeFor - `(modelId) => string`, the user's per-model image
 *   choice, read per model build for the same reason: turning a model's image
 *   input on or off must reach the picker without re-registering the adapter.
 * @param options.enabledIdsFor - `(regionId) => string[]`, the models the user
 *   wants offered in that region. An empty list means "no filter", not "none":
 *   a fresh install has saved nothing and must still show every model, which is
 *   the same convention the WorkBuddy bundle uses. Read per build so curating
 *   the roster reaches the picker on the next `llm/adapters-updated`.
 * @param options.regionEnabled - `(regionId) => boolean`, whether that region's
 *   provider is offered to DSH at all. The account panel's per-region switch is
 *   what writes it: a switched-off region contributes an **empty** model list,
 *   which is exactly how DSH hides a model group — the same mechanism a
 *   not-yet-signed-in region uses. Read per build so the switch takes effect on
 *   the next `llm/adapters-updated` without re-registering or restarting. The
 *   account, usage and saved allow-list all survive a switch-off, so switching
 *   back on restores the region with its previous curation intact.
 * @param options.resolveAttachments - `() => AttachmentStore | undefined`, the
 *   durable attachment service. **Omitting this breaks every image request.**
 *   pi-ai refuses any message carrying an image unless this resolves, so a route
 *   registered without it answers `UNSUPPORTED_CONTENT` ("pi-ai image input
 *   requires the durable attachment service") for the whole turn — which is what
 *   a model does the moment it reads back a screenshot it just produced.
 * @param options.resolveImageAccess - `(attachments, ref) => { readonlyPath } | undefined`,
 *   maps one durable image reference onto a path the request builder may read.
 *   Without it the store is reachable but no image can actually be located.
 * @returns `{ adapter, invalidate, providerIds }`.
 */
export function createQoderAdapter(options) {
  const runtimes = options.regions
  if (runtimes.length === 0) throw new Error('dsh-connect-qoder: no regions to adapt')
  const preferMaximumContext = options.preferMaximumContext ?? (() => false)
  const imageModeFor = options.imageModeFor ?? (() => 'auto')
  const enabledIdsFor = options.enabledIdsFor ?? (() => [])
  const regionEnabled = options.regionEnabled ?? (() => true)
  const resolveAttachments = options.resolveAttachments
  const resolveImageAccess = options.resolveImageAccess

  const buildModels = (runtime) => {
    // A switched-off region offers no models. Returning the empty list is what
    // makes DSH hide the region's model group (the same rule a not-yet-signed-in
    // region already rides on), and `invalidate()` re-snapshots on the next
    // settings change, so re-checking the switch brings the models back with
    // no restart and no re-registration.
    if (regionEnabled(runtime.region.id) !== true) return []
    const baseUrl = `${runtime.shim.baseUrl()}/v1`
    const widest = preferMaximumContext() === true
    const enabled = enabledIdsFor(runtime.region.id)
    return filterByEnabled(runtime.catalog(), enabled).map((entry) =>
      toPiModel(entry, baseUrl, runtime.region.id, widest, imageModeFor(entry.id)),
    )
  }

  const buildProfiles = () => {
    const profiles = new Map()
    for (const runtime of runtimes) {
      const providerId = runtime.region.id
      const displayName = runtime.region.displayName
      const provider = {
        ...createProvider({
          id: providerId,
          name: displayName,
          auth: {
            apiKey: {
              name: 'Qoder loopback shim token',
              async resolve({ credential }) {
                const apiKey = credential?.key
                return apiKey === undefined || apiKey.length === 0
                  ? undefined
                  : { auth: { apiKey }, source: displayName }
              },
            },
          },
          models: buildModels(runtime),
          api: openAICompletionsApi(),
        }),
        getModels: () => buildModels(runtime),
      }
      profiles.set(providerId, {
        provider: providerId,
        displayName,
        streamIdleTimeoutMs: STREAM_IDLE_TIMEOUT_MS,
        retryPolicy: resolveRetryPolicy(undefined, `dsh-connect-qoder.${providerId}.retryPolicy`),
        configuredMaxTokens: new Map(),
        modelErrors: new Map(),
        ...REQUEST_IMAGE_BUDGETS,
        piProvider: provider,
      })
    }
    return profiles
  }

  let profiles = buildProfiles()

  const adapter = new PiAiAdapter({
    profiles: () => profiles,
    auth: INERT_AUTH,
    // Each region's shim secret is the only credential this route presents.
    resolveApiKey: async (provider) => {
      const runtime = runtimes.find((entry) => entry.region.id === provider)
      return runtime?.shim.token()
    },
    // Image input is a hard requirement of the pi-ai adapter, not an optional
    // extra: `streamWithSnapshot` throws UNSUPPORTED_CONTENT whenever a message
    // carries an image and `resolveAttachments()` yields undefined. A Qoder
    // model that reads back a screenshot it just produced sends exactly such a
    // message, so leaving these unwired turns a normal step into a failed run.
    //
    // Both are passed through from the caller rather than resolved here: this
    // module stays free of Cordis context, and the official `llm-pi-ai` plugin
    // wires the same two hooks the same way.
    ...(resolveAttachments === undefined ? {} : { resolveAttachments }),
    ...(resolveImageAccess === undefined ? {} : { resolveImageAccess }),
  })

  return {
    adapter,
    invalidate: () => {
      profiles = buildProfiles()
    },
    providerIds: runtimes.map((runtime) => runtime.region.id),
  }
}
