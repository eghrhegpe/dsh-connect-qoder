/**
 * The pi-ai model descriptor.
 *
 * Extracted from lib/adapter.js so it can be tested. `toPiModel` is a pure
 * function of a catalog entry and a few flags — it builds a plain object and
 * touches no pi-ai API — but it lived inside a module whose top-level imports
 * pull in `@earendil-works/pi-ai` and `@deepseek-ai/dsh-llm-pi-ai`, so no test
 * could reach it.
 *
 * That mattered, because this function carries two decisions whose failure mode
 * is invisible until every single request breaks:
 *
 * 1. `compat.supportsDeveloperRole: false`. pi-ai picks the system-prompt role
 *    as `reasoning && compat.supportsDeveloperRole ? 'developer' : 'system'`,
 *    and auto-detects the flag when it is unset — returning true for anything
 *    that does not look like a known non-standard provider. This route's baseUrl
 *    is the loopback shim, so nothing matches and the value resolves to true.
 *    Every Qoder model declares `reasoning: true`, so pi-ai then emits
 *    `role: "developer"`, which Qoder does not have. The result is a permanent
 *    `403 {"code":"10605"}` on every attempt, no matter how long DSH retries,
 *    with an error message about being "in the queue" that is pure fiction.
 * 2. `maxTokens` is deliberately ABSENT. A declared value becomes the model's
 *    configured output ceiling and pi-ai sends it as `max_tokens`; reasoning
 *    shares that budget with the answer, so a declared ceiling truncates long
 *    replies mid-sentence and the harness reports `finish: max-tokens`.
 *
 * Neither is a cosmetic field, and neither was asserted anywhere.
 *
 * @module dsh-connect-qoder/pi-model
 */
import { offPeakActive, rateNow } from './offpeak.js'

/** No per-token price is knowable for a subscription quota; report zero. */
export const NO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

/** Default context window when the catalog declares no usable one. */
export const FALLBACK_CONTEXT_WINDOW = 200000

/**
 * Whether one model may receive images.
 *
 * `auto` follows the catalog's own `is_vl` flag, which is what Qoder publishes
 * for every model it serves; `on` and `off` are the user's explicit override
 * from the settings card. An unrecognised mode degrades to `auto` rather than
 * disabling images, so a stale saved value cannot silently drop a capability.
 *
 * @param entry - one normalized catalog entry.
 * @param imageMode - `'auto'`, `'on'`, or `'off'`.
 * @returns true when the model should declare image input.
 */
export function imageEnabled(entry, imageMode) {
  if (imageMode === 'on') return true
  if (imageMode === 'off') return false
  return entry.isVL === true
}

/**
 * The name the picker shows for one model.
 *
 * `listModels` forwards only `id`, `name`, and the input modalities, so the
 * multiplier has nowhere else to travel and is folded into the name — the same
 * approach the WorkBuddy bundle uses for its own rate. Every DSH-side join keys
 * on the model **id** (the selector's choice, the session events, the wire
 * request), so decorating the name is display-only and cannot affect routing.
 *
 * A zero multiplier means the model is free, which is worth saying outright;
 * anything else is shown to two decimals so the ordering is comparable. A
 * catalog entry with no multiplier at all keeps its bare name.
 */
export function displayNameFor(entry, now) {
  const factor = rateNow(entry, now)
  if (!Number.isFinite(factor)) return entry.name
  if (factor <= 0) return `${entry.name} · 免费`
  const base = `${entry.name} · x${factor.toFixed(2)}`
  // The off-peak discount is time-dependent, so the name says which side of the
  // window it was computed on. Without this a rate that silently changes at
  // 22:00 would look like a bug.
  return offPeakActive(entry, now) ? `${base} 错峰` : base
}

/**
 * The context window to advertise.
 *
 * Taken from `context_config`, not `max_input_tokens`: the former is the set of
 * windows the app itself offers, with one flagged as the default, while the
 * latter is a smaller per-request floor that is not the advertised capacity.
 * When the user asked for the maximum, the largest offered window is advertised
 * instead — the Qoder client offers these up to 1M, so the gateway accepts it.
 *
 * @returns the advertised context window.
 */
export function resolveContextWindow(entry, preferMaximumContext) {
  const options = Array.isArray(entry.contextOptions) ? entry.contextOptions.filter((n) => Number(n) > 0) : []
  const widest = options.length > 0 ? Math.max(...options) : 0
  const preferred = preferMaximumContext && widest > 0 ? widest : 0
  if (preferred > 0) return preferred
  if (Number(entry.defaultContextWindow) > 0) return Number(entry.defaultContextWindow)
  if (Number(entry.maxInputTokens) > 0) return Number(entry.maxInputTokens)
  return FALLBACK_CONTEXT_WINDOW
}

/**
 * Whether the advertised window for this entry is a value upstream actually
 * published (`context_config`), rather than a local degradation: `resolveContextWindow`
 * falls back to `max_input_tokens` (a per-request floor) or the built-in
 * `FALLBACK_CONTEXT_WINDOW` when the catalog published no `context_config`, and
 * a UI label must not present that fallback as if Qoder had offered it.
 */
export function contextWindowIsReal(entry) {
  const hasOptions = Array.isArray(entry.contextOptions) && entry.contextOptions.some((n) => Number(n) > 0)
  return hasOptions && Number(entry.defaultContextWindow) > 0
}

/**
 * A short human label for a token count, matching the catalog's own naming
 * (`1M` / `200K` / `128K`). Returns `''` for a value that should not be shown.
 */
export function formatContextWindow(tokens) {
  const n = Number(tokens)
  if (!Number.isFinite(n) || n <= 0) return ''
  if (n >= 1000000) return `${Math.round(n / 1000000)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}K`
  return String(n)
}

/**
 * The window label the model row should display for one entry, or `''` when the
 * catalog published no selectable windows (showing a fallback number there
 * would claim a window size upstream does not actually offer).
 */
export function contextWindowLabelFor(entry, preferMaximumContext) {
  if (!contextWindowIsReal(entry)) return ''
  return formatContextWindow(resolveContextWindow(entry, preferMaximumContext))
}

/**
 * The thinking-level map the picker reads.
 *
 * The same decision the wire makes, expressed for the picker: a model that
 * always thinks refuses `enable_thinking: false`, so `off` is reported as
 * unsupported for it rather than offered and then rejected upstream.
 *
 * A non-reasoning model gets no map at all, rather than a map of nulls.
 */
export function thinkingLevelMapFor(entry) {
  if (entry.isReasoning !== true) return undefined
  const levels = Array.isArray(entry.effortLevels) ? entry.effortLevels : []
  const offered = (level) => (levels.includes(level) ? level : null)
  const canDisable = entry.alwaysThinking !== true
  return {
    off: canDisable ? 'off' : null,
    minimal: null,
    low: offered('low'),
    medium: offered('medium'),
    high: offered('high'),
    xhigh: offered('xhigh'),
    max: offered('max'),
  }
}

/**
 * Map a catalog entry onto a pi-ai model descriptor.
 *
 * `id` is the value DSH shows and the value the shim receives; `upstreamKey`
 * rides along as the Qoder-side model key, which the shim needs on the wire.
 *
 * @param entry - one normalized catalog entry.
 * @param baseUrl - the region's loopback shim, with the `/v1` suffix.
 * @param providerId - the DSH provider this model belongs to.
 * @param preferMaximumContext - advertise the largest offered window.
 * @param imageMode - `'auto'`, `'on'`, or `'off'`.
 * @param now - the instant the displayed rate is resolved against.
 * @returns the pi-ai model descriptor.
 */
export function toPiModel(
  entry,
  baseUrl,
  providerId,
  preferMaximumContext = false,
  imageMode = 'auto',
  now = new Date(),
) {
  const thinkingLevelMap = thinkingLevelMapFor(entry)
  return {
    id: entry.id,
    // The credit multiplier rides in the name because `listModels` forwards only
    // id/name/modalities, so there is no other field the picker would show. It is
    // resolved against `now`, because an off-peak model costs different amounts
    // on either side of its window.
    name: displayNameFor(entry, now),
    api: 'openai-completions',
    provider: providerId,
    baseUrl,
    // The catalog's `is_vl` is the default; the user's per-model choice wins.
    input: imageEnabled(entry, imageMode) ? ['text', 'image'] : ['text'],
    reasoning: entry.isReasoning === true,
    ...(thinkingLevelMap === undefined ? {} : { thinkingLevelMap }),
    cost: NO_COST,
    contextWindow: resolveContextWindow(entry, preferMaximumContext),
    // `supportsDeveloperRole: false` is load-bearing, not cosmetic. See the
    // module header for what happens without it: every request 403s with a
    // fictional "you are in the queue" error, and DSH retries forever.
    //
    // `maxTokensField: 'max_tokens'` is the other half — the field name pi-ai
    // should send the output ceiling under. There is deliberately no `maxTokens`
    // VALUE here: see the module header on why declaring one truncates replies.
    compat: { maxTokensField: 'max_tokens', supportsDeveloperRole: false },
    // Qoder's own key for this model, carried for the shim's wire request.
    upstreamKey: entry.key,
  }
}
