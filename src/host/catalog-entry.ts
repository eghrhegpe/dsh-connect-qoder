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
import { regionEnabledFor, HIDE_ALL_MODELS } from './preferences.ts'
import { contextWindowLabelFor, resolveContextWindow } from './pi-model.ts'
import { unwrapVolatile } from './volatile.ts'
import { providerRegistrationState } from './errors.ts'
import type { CatalogEntry, Promotion, RefreshFailureReason, Region } from './domain.ts'
import type { Preferences } from './preferences.ts'

/**
 * The entry shape `fetchModels` produces, before `normalizeEntry` mints an id.
 *
 * Distinct from {@link CatalogEntry} on purpose: the two differ in exactly the
 * field that matters — `name` here becomes both `name` and the derived `id` on
 * the way in — and collapsing them into one type is what would let a future edit
 * read `entry.id` off a pre-normalization value and silently get `undefined`.
 */
export interface FetchedEntry {
  name: string
  key: string
  isVL?: boolean
  isReasoning?: boolean
  supportsEffort?: boolean
  alwaysThinking?: boolean
  effortLevels?: string[]
  maxInputTokens?: number
  defaultContextWindow?: number
  contextOptions?: unknown[]
  priceFactor?: number
  isFree?: boolean
  isDefault?: boolean
  promotion?: Promotion
}

/** The rate helpers `projectModelRow` calls, injected to keep this peer-free. */
export interface RateHelpers {
  rateNow: (entry: CatalogEntry, now: Date) => number
  offPeakActive: (entry: CatalogEntry, now: Date) => boolean
  offPeakRemaining: (entry: CatalogEntry, now: Date) => number | undefined
}

/** One started region, as the payload builder sees it. */
export interface RuntimeRef {
  runtime: {
    region: Region
    catalog: { current(): CatalogEntry[]; fetchedAt?: number }
    refreshFailed?: { reason: RefreshFailureReason; error?: unknown } | undefined
    /**
     * The ids this region's roster history still calls "first seen recently".
     *
     * Optional: the route's stand-ins (and a host that predates the field) have
     * no history to read, and a roster with no marker is exactly what a
     * first-ever run renders — so the absence is a supported state, not a hole.
     */
    newModelIds?: () => string[]
  }
}

/**
 * A model id is the catalog display name with whitespace removed, so the id is
 * stable and readable; the upstream key is tracked beside it for the wire.
 *
 * The one thing that is NOT free-form is `__hide-all__`: that string is the
 * sentinel a region's allow-list carries to mean "hide every model"
 * (`HIDE_ALL_MODELS` in lib/preferences.js), and the whole mechanism rests on no
 * real model id ever equalling it. It cannot today — Qoder's display names are
 * things like "GLM 5.3" — but the guard costs nothing and turns an assumption
 * into a property, so a future catalog carrying an odd name cannot silently
 * collide with the sentinel and make one model's row behave as "hide all".
 */
function modelIdFor(entry: { display_name?: unknown }): string {
  // Coerced before the regex rather than after: the value comes from an upstream
  // catalog, and `.replace` exists only on a string — an entry carrying a
  // numeric `display_name` would throw here instead of yielding an id. The
  // `|| 'QoderModel'` fallback is unchanged.
  const id = String(entry.display_name || 'QoderModel').replace(/\s+/g, '')
  // Prefixed rather than rejected: dropping such a model would hide a real
  // model, which is worse than renaming its id in a way the user never sees
  // (the picker shows the display name, not the id).
  return id === HIDE_ALL_MODELS ? `${id}_model` : id
}

/**
 * The credit multiplier as declared, or `undefined` when it was not declared.
 *
 * The point of this function is the case it does NOT collapse. A missing,
 * non-numeric or non-finite factor is a *gap*, and every consumer downstream
 * already has a branch for "no rate" (`effectiveRate` answers `NaN`,
 * `toPiModel` and `rateLabelOf` answer the bare name and `undefined`). Folding
 * that gap into `0` — which is what `Number(x) || 0` did — makes all three
 * branches unreachable and renders the model as 免费, a confident wrong fact
 * rather than a visible absence.
 *
 * `0` and negative factors are kept as-is on purpose: a model the upstream
 * really prices at zero is genuinely free, and that is not the same statement
 * as "the upstream did not say".
 */
function priceFactorOf(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined
  const factor = Number(value)
  return Number.isFinite(factor) ? factor : undefined
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
export function normalizeEntry(entry: FetchedEntry): CatalogEntry {
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
    // The credit multiplier Qoder charges, display-only: the picker shows it
    // beside the name so the cost of a choice is visible before the request.
    // An ABSENT factor stays absent, never `0` — `0` is finite, so it renders
    // as 免费 and makes the honest "no rate" branches unreachable.
    // A genuinely free model (factor 0 or negative) still reads 免费: declared,
    // not missing. See docs/issues/16-silent-failure-policy.md.
    priceFactor: priceFactorOf(entry.priceFactor),
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
export function filterByEnabled(
  models: CatalogEntry[],
  enabled: unknown,
): CatalogEntry[] {
  const list = Array.isArray(enabled) ? enabled.filter((id) => typeof id === 'string' && id.length > 0) : []
  if (list.length === 0) return models
  const allowed = new Set(list)
  return models.filter((entry) => allowed.has(entry.id))
}

/**
 * Build the response body the settings card's model route serves — a pure
 * function of the started runtimes, the resolved settings and the clock.
 *
 * Settings are unwrapped one field at a time: the source unwraps the source,
 * not the fields inside it, so a volatile field is still a `{ get() }` shell and
 * a plain `?? {}` guard would ship that shell as an object with no settings.
 * `refreshedAt` is the oldest fetch among the served regions, never "now", and
 * `refreshFailures` names the stale ones, so the card stops implying a refresh
 * it did not get. `providerRegistration` reports activation: since
 * docs/issues/20-llm-handoff-detached.md a failed registration no longer
 * unwinds `activate()`, so the route answers with the provider half dead; only
 * the error's name ships (see {@link providerRegistrationState}).
 *
 * @param options.runtimes - `[{ runtime }]`; each runtime carries optional
 *   `catalog.fetchedAt` and `refreshFailed`.
 * @param options.settings - the resolved settings.
 * @param options.now - the instant rates are resolved against.
 * @param options.projectRow - the row projector, injected to keep this module
 *   free of the adapter import.
 * @param options.rates - the rate helpers `projectRow` uses.
 * @param options.providerRegistrationError - the error `activate()` recorded,
 *   or `undefined` when it landed; `undefined` IS the success sentinel.
 * @returns the JSON body.
 */
export function buildModelRowsPayload({
  runtimes,
  settings,
  now,
  projectRow,
  rates,
  providerRegistrationError,
}: {
  runtimes: RuntimeRef[]
  settings: Preferences | undefined
  now: Date
  projectRow: (entry: CatalogEntry, region: Region, now: Date, rates: RateHelpers, preferMax: boolean) => unknown
  rates: RateHelpers
  providerRegistrationError?: unknown
}): Record<string, unknown> {
  const models: unknown[] = []
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
    // Which ids the roster history still calls "first seen recently", gathered
    // from the SAME regions that contributed rows (a switched-off region is
    // skipped by the loop above, so it must not announce anything here either —
    // otherwise the pill would mark a model the picker is not offering).
    //
    // The pill intersects these with the rows it already has, so the payload
    // carries ids and nothing else: shipping names too would be a second copy of
    // the roster's own field, and the two could disagree.
    newModelIds: newModelIdsOf(runtimes, settings),
    imageOverrides: overrides !== null && typeof overrides === 'object' ? overrides : {},
    useMaximumContextWindow: unwrapVolatile(settings?.useMaximumContextWindow) === true,
    enabledModelIds: enabled !== null && typeof enabled === 'object' ? enabled : {},
    // The instant the ANSWER was rendered is the wrong fact to ship, and this
    // line was the whole of issue 05. A failed refresh keeps the last good
    // catalog, so serving "now" told the card a refresh had just happened —
    // and the card renders that as "已更新（14:32）", a claim about upstream data
    // that nothing in the response had verified. The honest number is the
    // oldest fetch among the regions being served: it is the earliest moment
    // every visible row is known to reflect. `refreshFailures` names the
    // regions whose catalog is stale, and the reason, so the card can say so
    // instead of guessing from a timestamp.
    refreshedAt: oldestFetchedAtOf(runtimes),
    refreshFailures: refreshFailuresOf(runtimes),
    // Activation health, folded into the roster the card already fetches. See
    // the doc comment above: a card route that answers while the provider half
    // is dead is exactly the state docs/issues/20 left unexplained.
    providerRegistration: providerRegistrationState(providerRegistrationError),
  }
}

/**
 * Which model ids the roster history calls new, over the regions being served.
 *
 * Two filters, both deliberate:
 *  - a switched-off region contributes nothing, matching the row loop — a marker
 *    for a model the picker is not offering would point at a row the card does
 *    not show;
 *  - an id that is NOT in the region's current catalog is dropped. The history
 *    file can lag the roster (a model retired while this process slept), and
 *    announcing a model nobody can select is a marker that leads nowhere.
 *
 * An absent `newModelIds()` — a stand-in runtime, or a host older than this
 * field — answers an empty array rather than throwing: the payload builder is
 * pure and must not fail over a suggestion.
 *
 * @param runtimes - `[{ runtime }]`, as passed to the payload builder.
 * @param settings - the resolved settings, for the per-region switch.
 * @returns the ids, in the history's own order (oldest first).
 */
function newModelIdsOf(runtimes: RuntimeRef[], settings: Preferences | undefined): string[] {
  const ids: string[] = []
  for (const { runtime } of runtimes) {
    if (regionEnabledFor(settings, runtime.region.id) !== true) continue
    const read = runtime?.newModelIds
    if (typeof read !== 'function') continue
    let fresh: unknown
    try {
      fresh = read.call(runtime)
    } catch {
      // A history read that throws is the same absence as one that has nothing
      // to say: the marker is skipped, the roster is still served.
      continue
    }
    if (!Array.isArray(fresh)) continue
    const offered = new Set(runtime.catalog.current().map((entry) => entry.id))
    for (const id of fresh) {
      if (typeof id === 'string' && id !== '' && offered.has(id)) ids.push(id)
    }
  }
  return ids
}

/**
 * The fetch time every served row is known to reflect.
 *
 * The minimum over the regions that contribute rows, not the maximum and not
 * the render time: with CN fetched at 14:00 and the global edition at 14:30,
 * "updated at 14:30" would vouch for CN's rows too, and a failure since then
 * would be invisible. `undefined` when no region has ever fetched, so a card
 * that has never loaded shows no time at all rather than a fabricated one.
 *
 * @param runtimes - `[{ runtime }]`, as passed to the payload builder.
 * @returns epoch milliseconds, or `undefined`.
 */
function oldestFetchedAtOf(runtimes: RuntimeRef[]): number | undefined {
  let oldest: number | undefined
  for (const { runtime } of runtimes) {
    // A runtime stand-in without a store (the tests' minimal shapes) simply has
    // no timestamp to contribute; that must not throw inside a pure builder.
    const fetchedAt = Number(runtime?.catalog?.fetchedAt)
    if (!Number.isFinite(fetchedAt) || fetchedAt <= 0) continue
    if (oldest === undefined || fetchedAt < oldest) oldest = fetchedAt
  }
  return oldest
}

/**
 * Which regions are serving a catalog that is not their last upstream answer.
 *
 * The per-region reason is carried through, because the card must not collapse
 * them: `protocol-shape-changed` means the plugin needs an update and no
 * amount of re-signing will help, while `fetch` / `credential` are transient.
 * An empty array — the common case — is sent as such rather than omitted, so the
 * card's check is a comparison rather than an `in` check on a missing key.
 *
 * @param runtimes - `[{ runtime }]`, as passed to the payload builder.
 * @returns `[{ region, regionName, reason, detail }]`, one per stale region.
 */
function refreshFailuresOf(
  runtimes: RuntimeRef[],
): Array<{ region?: string; regionName?: string; reason: string; detail?: string | undefined }> {
  const failures: Array<{ region?: string; regionName?: string; reason: string; detail?: string | undefined }> = []
  for (const { runtime } of runtimes) {
    const failure = runtime?.refreshFailed
    if (failure === undefined || failure === null) continue
    failures.push({
      region: runtime?.region?.id,
      regionName: runtime?.region?.displayName,
      reason: String(failure.reason ?? 'fetch'),
      // The message is upstream's own text, already truncated at the throw site.
      detail: typeof (failure.error as { message?: unknown } | undefined)?.message === 'string'
        ? (failure.error as { message: string }).message
        : undefined,
    })
  }
  return failures
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
export function projectModelRow(
  entry: CatalogEntry,
  region: Region,
  now: Date,
  rates: RateHelpers,
  preferMax = false,
): Record<string, unknown> {
  return {
    id: entry.id,
    name: entry.name,
    region: region.id,
    regionName: region.displayName,
    isVL: entry.isVL === true,
    // The raw catalog multiplier, kept for reference — and the field the card
    // resolves its displayed rate from, on its own ticking clock. Absence is
    // preserved (see `priceFactorOf`) so the card can tell "declared free" from
    // "the upstream did not say": `rateAt` answers `undefined` for a non-finite
    // factor and the row shows no rate, where a manufactured `0` would be
    // labelled 免费.
    priceFactor: priceFactorOf(entry.priceFactor),
    // Free models display 免费 instead of x0.00 in the picker. NOTE: nothing
    // reads this flag today — `displayNameFor` decides 免费 from the resolved
    // `factor <= 0`, so a real zero-priced model is still labelled correctly.
    // It is carried for the payload's sake, and it is the honest signal should
    // "免费" ever need to mean "flagged free" rather than "priced at zero".
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
