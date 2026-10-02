/**
 * The model list one region offers DSH — the decisions inside the adapter,
 * without the adapter.
 *
 * WHY THIS IS A MODULE
 *
 * `createQoderAdapter` (lib/adapter.js) cannot be imported by a test: it pulls
 * in `@earendil-works/pi-ai` and `@deepseek-ai/dsh-llm-pi-ai`, which this
 * repository does not install. So the whole file was outside the coverage
 * denominator (docs/issues/11), and the model list — which is where every user-
 * visible curation decision happens — was among the untested parts: the per-
 * region switch, the allow-list filter, the maximum-context preference and the
 * per-model image mode.
 *
 * All four are pure functions of their arguments, and all four have a failure
 * mode that is silent: a switch that stops switching hides a provider with no
 * error, a filter that stops filtering offers models the user unticked, a
 * context preference that is ignored is invisible until someone compares the
 * card with the picker.
 *
 * @module dsh-connect-qoder/adapter-models
 */
import { filterByEnabled } from './catalog-entry.ts'
import { toPiModel } from './pi-model.ts'

/**
 * Build the model list a region offers.
 *
 * @param runtime - `{ region, catalog }`; `shim` is NOT read here, the caller
 *   passes the resolved `baseUrl` so this stays free of the shim.
 * @param options.baseUrl - the region's OpenAI-compatible base URL.
 * @param options.preferMaximumContext - the user's maximum-context switch.
 * @param options.enabledIds - the region's allow-list (empty means no filter).
 * @param options.regionEnabled - the region's provider switch; only an
 *   explicit `true` offers models.
 * @param options.imageModeFor - `(modelId) => 'auto' | 'on' | 'off'`.
 * @returns the projected pi-ai model descriptors.
 */
export function buildModelsFor(runtime, options) {
  // A switched-off region offers no models. Returning the empty list is what
  // makes DSH hide the region's model group (the same rule a not-yet-signed-in
  // region already rides on), and `invalidate()` re-snapshots on the next
  // settings change, so re-checking the switch brings the models back with no
  // restart and no re-registration.
  //
  // Only an explicit `true` counts as on: a missing, undefined or non-boolean
  // value reads as off, because this switch decides whether a provider is
  // offered at all and a default-on here would publish a region the user
  // turned off.
  if (options.regionEnabled !== true) return []
  return filterByEnabled(runtime.catalog(), options.enabledIds).map((entry) =>
    toPiModel(entry, options.baseUrl, runtime.region.id, options.preferMaximumContext === true, options.imageModeFor(entry.id)),
  )
}
