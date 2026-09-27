/**
 * Catalog entry normalisation.
 *
 * Split out of `lib/index.js` for one concrete reason: this is pure data
 * reshaping with no Cordis context and no peer dependency, which makes it
 * directly importable from a test. It was previously a private function in the
 * plugin entry, and the contract test that guards it had to keep a hand-written
 * mirror in step by hand — which is precisely how the off-peak regression that
 * guard exists for survived, one layer further down (the host projection dropped
 * `promotion.active` and `promotion.timezone`, so the card's clock never ticked).
 *
 * A test that imports the real function cannot drift from it.
 *
 * The one import it takes is `regionEnabledFor` from lib/preferences.js — a
 * dependency-free module, so this one stays importable from lib/shim.js and
 * from a test without dragging in any of the adapter's peer dependencies.
 *
 * @module dsh-connect-qoder/catalog-entry
 */
import { regionEnabledFor } from './preferences.js'
import { contextWindowLabelFor, resolveContextWindow } from './pi-model.js'
import { unwrapVolatile } from './volatile.js'

/**
 * A model id is the catalog display name with whitespace removed, so the id is
 * stable and readable; the upstream key is tracked beside it for the wire.
 */
function modelIdFor(entry) {
  return (entry.display_name || 'QoderModel').replace(/\s+/g, '')
}

/**
 * Reshape one entry from `fetchModels` for storage and lookup.
 *
 * The catalog interpretation (vision, reasoning, effort support, and the
 * always-thinking rule) already happened in `fetchModels`, so this only adds
 * the user-facing id.
 *
 * @param entry - one entry as `fetchModels` produced it.
 * @returns the stored catalog entry.
 */
export function normalizeEntry(entry) {
  return {
    id: modelIdFor({ display_name: entry.name }),
    key: entry.key,
    name: entry.name,
    isVL: entry.isVL === true,
    isReasoning: entry.isReasoning === true,
    supportsEffort: entry.supportsEffort === true,
    alwaysThinking: entry.alwaysThinking === true,
    effortLevels: Array.isArray(entry.effortLevels) ? entry.effortLevels : [],
    maxInputTokens: entry.maxInputTokens ?? 0,
    // `toPiModel` sizes each model from these two, so dropping them here (which
    // is what happened before) made `useMaximumContextWindow` do nothing at all:
    // with no `contextOptions` the "widest offered window" is 0, the switch has
    // nothing to prefer, and every model falls back to `max_input_tokens` — a
    // smaller per-request floor, not the capacity the catalog advertises. They
    // are carried through verbatim so the setting and the picker agree.
    defaultContextWindow: entry.defaultContextWindow ?? 0,
    contextOptions: Array.isArray(entry.contextOptions) ? entry.contextOptions : [],
    // The credit multiplier Qoder charges for this model. It is display-only,
    // but the picker shows it beside the name so the cost of a choice is visible
    // before the request is sent. `toPiModel` is what formats it.
    priceFactor: Number(entry.priceFactor) || 0,
    // Free models skip the credit multiplier entirely; the picker reads
    // `isFree` to display 免费 instead of `x0.00`.
    isFree: entry.isFree === true,
    // Whether Qoder starts the app on this model by default
    // (`entry.is_default` in the raw catalog; the app's initial selection).
    isDefault: entry.isDefault === true,
    // The time-of-day discount block (`fetchModels` produced it as
    // `promotion` — the off-peak window, its discounted and pre-promotion
    // multipliers, and the copy that describes it). Dropped once: with the
    // field missing from the catalog entry, `toPiModel` and the settings
    // card both saw `promotion === undefined` and the whole off-peak
    // machinery — the `错峰` name suffix, the window countdown, the
    // `before × discount` rate — was dead code that could never fire.
    //
    // Carried through verbatim, `active` and `timezone` included: the card
    // gates its ticking clock on `promotion.active` and resolves the window
    // against `timezone`, so losing either silently freezes the rate at whatever
    // it was when the card mounted.
    promotion: entry.promotion,
  }
}

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
 * other — so the filtering lives here rather than being written twice.
 *
 * It lives in this dependency-free module rather than in adapter.js because
 * lib/shim.js needs it, and shim.js cannot import adapter.js: that module pulls
 * in `@earendil-works/pi-ai`, which a test checkout does not have. With the
 * filter here, lib/shim.js is importable and therefore testable.
 *
 * @param models - the catalog entries.
 * @param enabled - the user's allow-list; a non-array or empty list means "no filter".
 * @returns the entries the picker should offer.
 */
export function filterByEnabled(models, enabled) {
  const list = Array.isArray(enabled) ? enabled.filter((id) => typeof id === 'string' && id.length > 0) : []
  if (list.length === 0) return models
  const allowed = new Set(list)
  return models.filter((entry) => allowed.has(entry.id))
}

/**
 * Build the response body the settings card's model route serves.
 *
 * Extracted from the route handler in lib/index.js so it can be tested. The
 * route is I/O — a method check, an origin check, an optional upstream refresh —
 * but what it *answers* is a pure function of the started runtimes, the resolved
 * settings and the clock, and that is where the decisions are.
 *
 * The three settings are unwrapped individually. Resolving the settings source
 * unwraps the source, not the fields inside it, so on the 0.1.7 line a volatile
 * field is still a `{ get() }` shell here — and `typeof shell === 'object'` is
 * true, so a plain `?? {}` guard passes the shell straight through to the card
 * as an object containing no settings at all.
 *
 * @param options.runtimes - `[{ runtime }]`, the started regions.
 * @param options.settings - the resolved settings.
 * @param options.now - the instant rates are resolved against.
 * @param options.projectRow - the row projector, injected so this module stays
 *   free of the adapter import.
 * @param options.rates - the rate helpers `projectRow` uses.
 * @returns the JSON body.
 */
export function buildModelRowsPayload({ runtimes, settings, now, projectRow, rates }) {
  const models = []
  const preferMax = unwrapVolatile(settings?.useMaximumContextWindow) === true
  for (const { runtime } of runtimes) {
    // A switched-off region contributes nothing here either, so the card's
    // model list always agrees with the picker: both gate on the same
    // `regionEnabledFor` predicate. The region stays reachable — the account
    // panel still lists it with its switch, which is how it is turned back on.
    if (regionEnabledFor(settings, runtime.region.id) !== true) continue
    for (const entry of runtime.catalog.current()) {
      models.push(projectRow(entry, runtime.region, now, rates, preferMax))
    }
  }
  const overrides = unwrapVolatile(settings?.imageOverrides)
  const enabled = unwrapVolatile(settings?.enabledModelIds)
  return {
    models,
    imageOverrides: overrides !== null && typeof overrides === 'object' ? overrides : {},
    useMaximumContextWindow: unwrapVolatile(settings?.useMaximumContextWindow) === true,
    enabledModelIds: enabled !== null && typeof enabled === 'object' ? enabled : {},
    refreshedAt: now.getTime(),
  }
}

/**
 * Project one stored catalog entry into the row the settings card renders.
 *
 * This is the second half of the off-peak regression, and the half that
 * actually broke: `normalizeEntry` carried the whole `promotion` block, but the
 * host route re-projected it field by field and left out `active` and
 * `timezone`. The card gates its ticking clock on `promotion?.active === true`,
 * so the gate was permanently false, the interval was never installed, the
 * clock stayed frozen at mount, and the 22:00 rate flip and countdown never
 * happened without a manual refresh — while the window and the rate still
 * rendered, which is what kept the failure invisible.
 *
 * It is a separate exported function, rather than inline in the route handler,
 * for the same reason `normalizeEntry` moved: the field list is exactly the kind
 * of thing that must be asserted against, not eyeballed.
 *
 * @param entry - one stored catalog entry.
 * @param region - `{ id, displayName }` for the region that owns it.
 * @param now - the instant the rates are resolved against.
 * @param rates - `{ rateNow, offPeakActive, offPeakRemaining }`, injected so
 *   this stays free of the adapter import.
 * @returns the row shape the card consumes.
 */
export function projectModelRow(entry, region, now, rates, preferMax = false) {
  return {
    id: entry.id,
    name: entry.name,
    region: region.id,
    regionName: region.displayName,
    isVL: entry.isVL === true,
    // The raw catalog multiplier, kept for reference.
    priceFactor: Number(entry.priceFactor) || 0,
    // Free models display 免费 instead of x0.00 in the picker; `toPiModel` also
    // uses this flag directly.
    isFree: entry.isFree === true,
    // Whether the Qoder app starts on this model by default.
    isDefault: entry.isDefault === true,
    // The multiplier that applies right now, with the off-peak window resolved —
    // this is what the picker appends to the name.
    effectiveRate: rates.rateNow(entry, now),
    offPeakActive: rates.offPeakActive(entry, now),
    // The block is forwarded whole, `active` and `timezone` included. The card
    // gates its clock on `active` and resolves the window against `timezone`;
    // dropping either freezes the displayed rate at whatever it was when the
    // card mounted.
    ...(entry.promotion !== undefined
      ? { promotion: { ...entry.promotion, remainingSeconds: rates.offPeakRemaining(entry, now) } }
      : {}),
    // The advertised context window, resolved the same way the wire does, so
    // the label shown on the card row always matches what DSH actually sends.
    // `contextOptions` is forwarded raw for the same display; the label is
    // empty when upstream published no selectable windows, so a local
    // fallback number is never presented as a real choice.
    contextOptions: Array.isArray(entry.contextOptions) ? entry.contextOptions : [],
    defaultContextWindow: Number(entry.defaultContextWindow) || 0,
    contextWindow: resolveContextWindow(entry, preferMax),
    contextWindowLabel: contextWindowLabelFor(entry, preferMax),
  }
}
