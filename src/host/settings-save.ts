/**
 * The settings save pipeline.
 *
 * Extracted from the `__save` route in lib/index.js so it can be tested. The
 * route's whole reason for existing is a defect on the DSH 0.2 line: the
 * client-side settings scope `set()` can resolve successfully without
 * persisting anything — the host's atomic write exhausts its retries on a
 * locked file, the scope reloads the previous document, and success is
 * reported anyway. The card would then show "已保存" while the model roster,
 * image overrides and context window had all silently failed to change, with
 * nothing to indicate it.
 *
 * So a write here is only a success once the value has been read back out of the
 * document and compared. That check, the per-region merge, and the namespace
 * resolution all lived inline in an HTTP handler where no test could reach them.
 * They are here now as a function of `(settings, body)` — no Cordis, no
 * framework, no request or response objects.
 *
 * @module dsh-connect-qoder/settings-save
 */
import { unwrapVolatile } from './volatile.ts'
import type { VolatileRef } from './volatile.ts'

/** One row as `settings.describe()` reports it — `{ ns, value }` and whatever else. */
export type SettingsRow = { ns?: unknown; value?: Record<string, unknown> } & Record<string, unknown>

/**
 * The host settings service, as much of it as this module touches.
 *
 * `mutate` and `describe` are the only two members read. On the 0.2 line a
 * `mutate` can resolve without persisting — that is the whole reason the read-back
 * check below exists — so the shape being declared here must not be read as a
 * promise that calling it wrote anything.
 */
export interface SettingsService {
  describe(): SettingsRow[]
  mutate(ns: string, ops: Array<{ op: 'set'; path: string[]; value: unknown }>, extra?: unknown): Promise<unknown>
}

/** Deep equality, injected so this module stays free of `node:util`. */
export type EqualityFn = (a: unknown, b: unknown) => boolean

/**
 * The fields a save may write, and the merge rule each one uses.
 *
 * `regions` shape (`{ [regionId]: [...ids] }`): merge the incoming region keys
 * into the field's authoritative value, so saving one region's allow-list can
 * never delete the other region's. `whole` shape: replace the field outright
 * (the card always posts its complete value).
 */
export const SAVE_FIELDS = {
  enabledModelIds: 'regions',
  // The per-region provider switch (`{ [regionId]: boolean }`, "off" is the
  // only meaningful value). The `regions` merge is what keeps it safe: the
  // card posts one region's flag, and saving it can never delete the other
  // region's switch — the same rule `enabledModelIds` needs for the same
  // reason.
  enabledRegions: 'regions',
  imageOverrides: 'whole',
  useMaximumContextWindow: 'whole',
} as const

/**
 * Find the settings row this plugin owns.
 *
 * On the 0.2 line the service keys a provider's document by the Loader
 * entry id (`llm-qoder`), while a host that mounts the plugin without a
 * Loader entry serves it under the plugin namespace (`dsh-connect-qoder`).
 * Both are matched exactly, in that order.
 *
 * The substring fallbacks this replaced were a real hazard rather than a
 * theoretical one: `String(entry.ns).includes(name)` matches `llm-qoder-extra`,
 * and the save would then `mutate` a row belonging to something else. A
 * namespace that is not ours must produce no match, not a near one.
 *
 * @param rows - `settings.describe()`.
 * @param candidates - the namespaces to try, in priority order.
 * @returns the matching row, or `undefined`.
 */
export function findSettingsRow(rows: SettingsRow[], candidates: string[]): SettingsRow | undefined {
  for (const candidate of candidates) {
    const exact = rows.find((entry) => String(entry.ns) === candidate)
    if (exact !== undefined) return exact
  }
  return undefined
}

/**
 * The settings namespace the HOST actually serves this plugin under.
 *
 * On the 0.2 line a plugin can no longer pick its namespace: the service
 * derives it from the Loader entry and `describe()` reports it as
 * `ns: entry.options.id`. The host then looks a provider up by **exact** match
 * — the models settings page does `namespaces.get(entry.settingsNs)` — so a
 * directory entry declaring a namespace the host does not serve is judged
 * "not configured" and its row is dropped from the page outright. Nothing is
 * greyed out and nothing errors: the configuration surface simply is not there.
 *
 * The fallback is not decoration. A plugin that declares `dsh-connect-qoder`
 * while the host serves `llm-qoder` disappears from the models page exactly
 * this way, which is what this helper exists to prevent.
 *
 * `ctx.fiber.entry` is added by the Loader rather than by Cordis itself, so it
 * is absent on a host that mounts a plugin without a Loader entry (a test
 * harness, or `ctx.plugin()` called directly). Hence the probe plus an
 * explicit fallback.
 *
 * @param ctx - the plugin context.
 * @param fallback - the namespace to declare when the host exposes no entry id.
 * @returns the namespace to declare to the host.
 */
export function settingsNamespaceOf(ctx: unknown, fallback: string): string {
  const id = (ctx as { fiber?: { entry?: { options?: { id?: unknown } } } } | undefined)?.fiber?.entry?.options?.id
  return typeof id === 'string' && id !== '' ? id : fallback
}

/**
 * Merge an incoming value with what the document already holds.
 *
 * @param shape - `'regions'` or `'whole'`, from {@link SAVE_FIELDS}.
 * @param incoming - the value the card posted.
 * @param stored - the document's current value, already unwrapped.
 * @returns the value to write.
 */
export function mergeForShape(shape: unknown, incoming: unknown, stored: unknown): unknown {
  if (shape !== 'regions') return incoming
  // Merge per region rather than replacing: the card posts one region at a
  // time, and a wholesale replace would delete the other region's allow-list.
  const base = stored !== null && typeof stored === 'object' ? (stored as Record<string, unknown>) : {}
  const target = incoming !== null && typeof incoming === 'object' ? (incoming as Record<string, unknown>) : {}
  return { ...base, ...target }
}

/**
 * Read a field back out of a row, unwrapping a volatile reference.
 *
 * @param row - a row from `settings.describe()`.
 * @param field - the field name.
 * @returns the value the host actually holds.
 */
export function readField(row: SettingsRow | undefined, field: string): unknown {
  // The `value` hop goes through an explicit read rather than optional chaining
  // on an `unknown`: a row whose `value` is not an object must answer
  // `undefined`, not throw — and that is a runtime check, so it is written as one.
  const value = row?.value
  if (value === null || typeof value !== 'object') return undefined
  return unwrapVolatile((value as Record<string, VolatileRef<unknown>>)[field])
}

/**
 * Write one field, then prove it landed.
 *
 * The return value is the route's whole contract: `{ ok: true }` only when the
 * value is readable out of the document afterwards. A `mutate` that resolves is
 * not evidence of anything on the 0.2 line, so the document is re-read and
 * deep-compared against what was written.
 *
 * @param options.settings - the host settings service.
 * @param options.field - which field to write.
 * @param options.value - the value the card posted.
 * @param options.candidates - namespaces to try, in priority order.
 * @param options.equals - deep equality, injected so this module stays free of
 *   `node:util`; defaults to a structural comparison.
 * @returns `{ status, body }` — the HTTP status and the JSON payload.
 */
export async function applySettingsSave({
  settings,
  field,
  value,
  candidates,
  equals,
}: {
  settings: SettingsService
  field: unknown
  value: unknown
  candidates: string[]
  equals?: EqualityFn
}): Promise<{ status: number; body: Record<string, unknown> }> {
  // `Object.hasOwn` rather than a plain lookup: a bare `SAVE_FIELDS[field]`
  // reaches the prototype chain, so `field: 'constructor'` (or `toString`,
  // `__proto__`, …) yields a function, is not `undefined`, and walks straight
  // through this guard into `settings.mutate` and the preferences assign below.
  // `Object.keys` already used for the error message has the same exposure, so
  // the whitelist is read through one helper and both agree.
  if (typeof field !== 'string' || !Object.hasOwn(SAVE_FIELDS, field)) {
    return {
      status: 400,
      body: { error: `field must be one of ${Object.keys(SAVE_FIELDS).join(', ')}` },
    }
  }
  // `as const` on the whitelist is what makes this index legal: it turns the
  // four keys into literal types, so indexing with the narrowed `field` is
  // checked against the real key set rather than falling back to an index
  // signature. The `Object.hasOwn` guard above is what makes it safe at
  // runtime; this is what makes it readable at compile time.
  const shape = SAVE_FIELDS[field as keyof typeof SAVE_FIELDS]

  const rows = settings.describe()
  const row = findSettingsRow(rows, candidates)
  if (row === undefined) {
    return {
      status: 503,
      body: {
        error: `${candidates.join('/')} namespace missing from describe(); known: ${rows
          .map((entry) => String(entry.ns))
          .join(', ')}`,
      },
    }
  }

  const merged = mergeForShape(shape, value, readField(row, field))
  // `row.ns` is compared by `String(...)` everywhere above, so it is stringified
  // once here rather than passed as the raw `unknown` — the namespace that goes
  // to `mutate` is then the same value the match was made against.
  const ns = String(row.ns)
  await settings.mutate(ns, [{ op: 'set', path: [field], value: merged }], undefined)

  // Read the value back and verify it actually landed. On the 0.1.7 line a
  // `mutate` can settle without persisting, so "the call returned" is not
  // proof the value is in the document.
  const readBackRow = settings.describe().find((entry) => String(entry.ns) === row.ns)
  const readBack = readField(readBackRow, field)
  const same = equals ?? deepEqual
  if (!same(readBack, merged)) {
    // The write did not land. The caller must NOT fold this into its base
    // snapshot and must NOT refresh the picker, or the UI would show a value
    // that is not stored. The client treats this as a failure and will not
    // display "saved".
    return {
      status: 200,
      body: {
        ok: false,
        errorName: 'read-back-mismatch',
        error: 'settings.mutate returned but the value did not land in the document',
        value: merged,
        readBack,
      },
    }
  }

  return { status: 200, body: { ok: true, value: merged, readBack } }
}

/**
 * The `__save` route's verdict, factored out of the handler so the service-
 * absent case is assertable in a test.
 *
 * {@link applySettingsSave} assumes a live settings service. This is the OTHER
 * failure: the host has no `settings` service at all for this fiber, so there is
 * nothing to write through. Answering it a 503 (a body the client can read)
 * rather than letting the route simply not exist is the point — see
 * docs/issues/06: when the route was registered under
 * `inject(['webServer','settings'])` it never mounted without `settings`, the
 * client got a 404, and fell back to an unverified scope snapshot that then
 * showed a false "已保存". The route is now registered under `webServer` alone
 * (so it is present whether or not `settings` is), and this is the guard it
 * delegates to.
 *
 * @param settings - the settings service, or `undefined`/`null` when absent.
 * @param rawBody - the parsed request body; `field` and `value` are read off it
 *   as `unknown`, exactly as the handler does.
 * @param options.candidates - the namespaces to try, in priority order.
 * @param options.equals - deep equality, injected so the module stays peer-free.
 * @returns `{ status, body }` — the HTTP status and JSON payload the route sends.
 */
export async function saveFieldOutcome(
  settings: SettingsService | null | undefined,
  rawBody: unknown,
  { candidates, equals }: { candidates: string[]; equals?: EqualityFn },
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (settings === undefined || settings === null) {
    // The service is gone, not just the namespace: there is no document to write
    // through at all. A 503 with a body is what the client distinguishes from a
    // 404 (a host that does not serve the route at all) and refuse to paper over.
    return { status: 503, body: { error: 'settings service unavailable to this fiber' } }
  }
  // `rawBody` is whatever the route's body reader produced: a parsed JSON value,
  // or `undefined` for an empty body. `(rawBody ?? {})` gives a fresh object for
  // the empty case so `posted.field` / `posted.value` read as `undefined` and fall
  // into `applySettingsSave`'s 400, never a crash.
  const posted = (rawBody ?? {}) as { field?: unknown; value?: unknown }
  return applySettingsSave({ settings, field: posted.field, value: posted.value, candidates, equals })
}

/**
 * A structural deep-equality, used when the caller injects none.
 *
 * `node:util`'s `isDeepStrictEqual` is the real implementation used in
 * production; this exists so the module can be exercised without importing it,
 * and it is only ever reached when a test omits `equals`.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (a === null || b === null) return false
  if (typeof a !== 'object') return Number.isNaN(a) && Number.isNaN(b)
  if (Array.isArray(a) !== Array.isArray(b)) return false
  // Both are objects by this point and not both arrays, so the index reads are
  // legal against `Record<string, unknown>` rather than reaching for a cast.
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const aKeys = Object.keys(left)
  const bKeys = Object.keys(right)
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && deepEqual(left[key], right[key]))
}
