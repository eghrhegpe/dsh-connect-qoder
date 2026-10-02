/**
 * Resolving the three settings this plugin offers.
 *
 * Extracted from `activate` in lib/index.js. The logic is pure — it takes a
 * configuration source and answers questions about it — but it was inlined in a
 * function that cannot be imported, so none of it was covered.
 *
 * Two of the three settings are read on every model build and on every listing,
 * so their resolution sits on the hot path of a card render. The interesting
 * part is the 0.1.7 live-reference shape: a volatile field holds `{ get() }`
 * rather than a value, and reading it directly yields the shell.
 *
 * @module dsh-connect-qoder/preferences
 */
import { unwrapVolatile } from './volatile.ts'
import type { VolatileRef } from './volatile.ts'

/**
 * The settings document this plugin owns, as it is read.
 *
 * `enabledModelIds` and `imageOverrides` are keyed BY REGION / BY MODEL, so
 * their value type is a map; `enabledRegions` maps a region id to its switch;
 * `useMaximumContextWindow` is the one plain boolean. Every field is optional
 * because absence is meaningful throughout this module — an absent allow-list
 * means "no filter" and an absent region switch means "offered", which is the
 * opposite of a default-filled document.
 *
 * The `VolatileRef<>` wrappers are not decoration: on the 0.1.7 line each of
 * these arrives as a `{ get() }` shell, and every reader here unwraps before
 * use. Declaring the shell in the type means a new reader cannot forget.
 */
export interface Preferences {
  enabledModelIds?: VolatileRef<Record<string, unknown>>
  imageOverrides?: VolatileRef<Record<string, unknown>>
  enabledRegions?: VolatileRef<Record<string, unknown>>
  useMaximumContextWindow?: VolatileRef<unknown>
}

/** The per-model image modes a saved override may hold. */
const IMAGE_MODES = ['on', 'off', 'auto']

/** The image mode used when nothing says otherwise. */
const DEFAULT_IMAGE_MODE: ImageMode = 'auto'

/** The three image modes `imageModeFor` may answer. */
export type ImageMode = 'auto' | 'on' | 'off'

/**
 * Resolve the current settings, preferring a live source over a frozen snapshot.
 *
 * The source may be a plain object, a `{ get() }` reference to the settings
 * document, or a zero-argument function returning either — the three shapes the
 * 0.1.6 installSection and 0.1.7 configure lines hand over. A source that
 * resolves to nothing usable falls back to the snapshot rather than blanking
 * the card.
 *
 * @param snapshot - the last known-good values.
 * @param source - the live source, or `undefined`.
 * @returns the merged settings.
 */
export function resolvePreferences(
  snapshot: Preferences,
  source: Preferences | VolatileRef<Preferences> | (() => unknown) | undefined,
): Preferences {
  let resolved: unknown = typeof source === 'function' ? source() : source
  resolved = unwrapVolatile(resolved as VolatileRef<unknown>)
  if (resolved === undefined || resolved === null) return snapshot
  // A plain-object test rather than `typeof === 'object'`: an array or a
  // Date is an object, and spreading one into the settings would produce keys
  // nobody asked for.
  if (Object.prototype.toString.call(resolved) !== '[object Object]') return snapshot
  // The guard above is a RUNTIME proof of plainness, which TypeScript cannot
  // follow — `toString.call` is not a type predicate. Re-widening after it is
  // the one cast here, and it is safe precisely because the line above already
  // excluded arrays, Dates and class instances: the spread produces only the
  // keys the check vouched for.
  return { ...snapshot, ...(resolved as Partial<Preferences>) }
}

/**
 * The sentinel a region's allow-list carries to mean "hide every model".
 *
 * The host convention is `[] = no filter = show all` (a fresh install must
 * still see every model), so "hide all" has no value of its own in that scheme.
 * A non-empty list that matches no real model id collapses to "show nothing" in
 * `filterByEnabled` (the allow-list branch keeps the ids, matches none, returns
 * `[]`), so a marker that no model id can ever equal expresses "hide all"
 * without touching that convention.
 *
 * It WAS considered to move this to an explicit `null` (docs/issues/12, item
 * 10), and staying with the sentinel is a trade rather than an oversight:
 * `null` reads better in a hand-edited settings file, but every existing user
 * has `["__hide-all__"]` in their document, and a format change would silently
 * turn their "hide all" into "show all". So the marker stays and the invariant
 * that makes it safe — no model id can ever equal it — is enforced where ids are
 * minted (`modelIdFor` in lib/catalog-entry.js) rather than assumed.
 */
export const HIDE_ALL_MODELS = '__hide-all__'

/**
 * The models the user enabled for one region.
 *
 * An empty result means "no filter" rather than "nothing": a fresh install has
 * saved nothing and must still see every model. The same convention
 * `filterByEnabled` applies on the model side.
 *
 * @param preferences - the resolved settings.
 * @param regionId - the region to look up.
 * @returns the allow-list, or `[]` for no filter.
 */
export function enabledIdsFor(preferences: Preferences | undefined, regionId: string): string[] {
  const byRegion = unwrapVolatile(preferences?.enabledModelIds) as Record<string, unknown> | undefined
  if (byRegion === null || typeof byRegion !== 'object') return []
  // An own-property check, not a bare lookup: `byRegion['constructor']` yields
  // a function, and the `Array.isArray` filter below would pass it through as
  // "not a list" — fine today, but only because the values happen to be
  // functions. Reading the prototype chain here is relying on a coincidence.
  if (!Object.hasOwn(byRegion, regionId)) return []
  const list = byRegion[regionId]
  return Array.isArray(list) ? list.filter((id) => typeof id === 'string' && id.length > 0) : []
}

/**
 * The user's image-input choice for one model.
 *
 * `'auto'` is the absence of an override, so a row in auto mode never writes a
 * key — the saved document stays minimal and a future catalog change is picked
 * up again. An unrecognised stored value degrades to `auto` rather than to
 * `off`: defaulting to off would silently drop image input for every model
 * after a settings format change.
 *
 * @param preferences - the resolved settings.
 * @param modelId - the model to look up.
 * @returns `'auto'`, `'on'`, or `'off'`.
 */
export function imageModeFor(preferences: Preferences | undefined, modelId: string): ImageMode {
  const overrides = unwrapVolatile(preferences?.imageOverrides) as Record<string, unknown> | undefined
  if (overrides === null || typeof overrides !== 'object') return DEFAULT_IMAGE_MODE
  if (!Object.hasOwn(overrides, modelId)) return DEFAULT_IMAGE_MODE
  const saved = overrides[modelId]
  return IMAGE_MODES.includes(saved as ImageMode) ? (saved as ImageMode) : DEFAULT_IMAGE_MODE
}

/**
 * Whether to advertise each model's largest declared context window.
 *
 * @param preferences - the resolved settings.
 * @returns true when the maximum-context switch is on.
 */
export function preferMaximumContext(preferences: Preferences | undefined): boolean {
  return unwrapVolatile(preferences?.useMaximumContextWindow) === true
}

/**
 * Whether one region's provider is offered to DSH at all.
 *
 * The inverse of the per-model allow-list: {@link enabledIdsFor} narrows the
 * models inside a region, this switches the whole region's provider off — its
 * model group disappears from the picker, but the account, the usage readings
 * and the saved model allow-list all survive, exactly as the card's switch
 * promises. The account panel's per-region toggle is what writes the field.
 *
 * Like `enabledIdsFor`, absence means the default, and the default is ON: a
 * fresh install offers every readable region. Only an explicit `false`
 * hides the region; a missing key and `true` both read as offered.
 *
 * @param preferences - the resolved settings.
 * @param regionId - the region to look up.
 * @returns true when the region is offered.
 */
export function regionEnabledFor(preferences: Preferences | undefined, regionId: string): boolean {
  const map = unwrapVolatile(preferences?.enabledRegions) as Record<string, unknown> | undefined
  if (map === null || typeof map !== 'object') return true
  // Own-property check: `map['constructor']` would read the prototype chain,
  // and `Boolean(Function)` is truthy — so an inherited member could never be
  // an explicit `false` anyway, but the guard keeps the read honest.
  if (!Object.hasOwn(map, regionId)) return true
  return map[regionId] !== false
}
