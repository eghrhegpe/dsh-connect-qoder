/**
 * Verified settings writes, adapted from the WorkBuddy bundle's
 * `writeField` contract (src/client/account-selection) to this card's
 * three top-level fields.
 *
 * The settings scope's `set()` resolving is NOT proof that anything was
 * stored.
 * The Host's settings document is replaced by writing a temp file and
 * renaming it over the target; on Windows an antivirus scanner or a sync
 * client can hold the file briefly, and once the atomic-write retries
 * exhaust the settings scope reloads Host state and merely RETURNS — the
 * card's `await` succeeds while the document is unchanged. Reading the
 * field back is the only reliable check, and the plugin's own Host
 * endpoint is the only writer that actually persists in that failure
 * mode (it runs the mutate inside the Host process).
 *
 * Field shapes, matching the Host `__save` whitelist:
 * - `enabledModelIds` is per-region, so the write posts only the
 *   regions the card edits and the Host merges them into the
 *   authoritative value — saving one region can never delete the
 *   other's allow-list.
 * - `imageOverrides` / `useMaximumContextWindow` are posted whole; the
 *   card always knows their complete value.
 */
/**
 * A settings write that did not take effect.
 *
 * Distinct from a rejected `set()`: thrown when the write reported
 * success (or the read-back disagreed) — which is the whole point of
 * this module. The card shows it, so the user knows the value is not
 * saved instead of trusting a "已保存" banner over stale settings.
 */
/**
 * The settings surface the card writes through, as this module reads it.
 *
 * Declared here rather than imported: `client/index.ts` probes the 0.2
 * harness's `configForms` surface and hands the card a value satisfying this
 * interface, so the card body — and this writer — never branches on the
 * harness shape. (The older `settingsScope` wrapper had its own `bind`
 * shape; it no longer exists, and with it the mirror this interface used to
 * cover both.)
 *
 * Every member is read defensively by the callers: `set` may reject, and
 * `getSnapshot().value` is `undefined` for a namespace the Host has not
 * materialized yet (that is the `fieldSnapshot` catch, not a programming error).
 */
export interface SettingsScope {
	set(field: string, value: unknown): Promise<unknown>
	getSnapshot(): { value?: Record<string, unknown> }
}
var QoderSettingsWriteError = class extends Error {
	field: string;
	constructor(field: string, reason?: string) {
		super(`qoder: settings field "${field}" was not persisted${reason === void 0 ? "" : `: ${reason}`}`);
		this.name = "QoderSettingsWriteError";
		this.field = field;
	}
};
/**
 * POST one field to the plugin's own Host save endpoint.
 *
 * The handler runs `settings.mutate` inside the Host process and
 * answers with the merged value plus a read-back, so a failure here
 * names its cause instead of arriving as a swallowed success.
 *
 * The 200 response may carry `ok: false` with an `errorName` when the
 * host read-back mismatched (the value did not land). That case is
 * indistinguishable from "not persisted" from the card's side, so it is
 * thrown as a write failure rather than returning the stale value.
 */
async function saveFieldViaHost(field: string, value: unknown): Promise<unknown> {
	let response: Response;
	try {
		response = await fetch("/plugins/dsh-connect-qoder/__save", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			credentials: "same-origin",
			body: JSON.stringify({ field, value })
		});
	} catch (error) {
		throw new QoderSettingsWriteError(field, `Host save endpoint unreachable: ${String(error)}`);
	}
	// The endpoint's answers are unvalidated JSON from the Host, so each is
	// narrowed at the point of use rather than declared as a record up front —
	// a `catch` that answers `{ error }` and a success that answers `{ value }`
	// are different shapes and only the reader knows which it holds.
	if (!response.ok) {
		const detail = await response.json().catch(() => ({ error: `HTTP ${String(response.status)}` })) as Record<string, unknown>;
		const reason = `${String(detail.errorName ?? "")} ${String(detail.error ?? "")}`.trim();
		throw new QoderSettingsWriteError(field, `Host save refused: ${reason === "" ? String(detail.error) : reason}`);
	}
	const detail = await response.json().catch((): undefined => void 0) as Record<string, unknown> | undefined;
	if (detail !== void 0 && detail.ok === false) {
		const reason = `${String(detail.errorName ?? "")} ${String(detail.error ?? "")}`.trim();
		throw new QoderSettingsWriteError(field, `Host read-back mismatch: ${reason}`);
	}
	return detail?.value;
}
/** Read one field back from the scope snapshot, tolerating an absent namespace. */
function fieldSnapshot(scope: SettingsScope, field: string): unknown {
	try {
		return scope.getSnapshot().value?.[field] ?? null;
	} catch {
		return null;
	}
}
/**
 * Write one settings field, then confirm the value actually landed.
 *
 * The Host endpoint goes FIRST — it is the only writer that persists in
 * the host's silent-failure mode and, for the per-region field, the only
 * one that preserves the sibling region. `scope.set` then runs purely as
 * a mirror refresh (and as the degraded path, where the endpoint is
 * unreachable or the settings service is absent): on a host whose scope
 * write is authoritative, delivering and reading back suffices; on a
 * host where it settled without persisting, the read-back mismatch
 * falls through to the endpoint error, which is thrown — never
 * swallowed into a false "已保存".
 *
 * @returns the authoritative value the write settled on (from the
 *   endpoint) or `null` when only the scope delivered it.
 */
export async function writeSettingsField(scope: SettingsScope, field: string, value: unknown): Promise<unknown> {
	let hostError: unknown;
	let authoritative: unknown = null;
	try {
		authoritative = await saveFieldViaHost(field, value);
		try {
			await scope.set(field, authoritative);
		} catch {
			// Mirror only; the endpoint already persisted the value.
		}
		return authoritative;
	} catch (error) {
		hostError = error;
	}
	let scopeDelivered = false;
	// `enabledModelIds` is per-region on the Host, so its scope mirror
	// must keep the regions the card did not edit — every other field
	// is posted whole and replaces the field outright. Declared here so the
	// read-back confirmation below can compare against it too.
	const nextValue =
		field === "enabledModelIds"
			? { ...(fieldSnapshot(scope, field) as Record<string, unknown> | null), ...(value as Record<string, unknown>) }
			: value;
	try {
		// The scope stores the value verbatim (no server-side merge on
		// this path).
		scopeDelivered = (await scope.set(field, nextValue)) !== false;
	} catch {
		scopeDelivered = false;
	}
	// On the 0.2 line the settings service owns the document: a
	// `scope.set` that resolves here has not necessarily landed in the
	// file — the
	// authoritative merge may keep a sibling region the card did not
	// post, and the scope's snapshot can trail the document. The Host
	// endpoint's read-back is the source of truth, so when it answered
	// `ok` the write is done; otherwise confirm what actually stored.
	if (authoritative !== null) return authoritative;
	if (scopeDelivered) {
		const readBack = fieldSnapshot(scope, field);
		const matches =
			field === "enabledModelIds"
				// Every posted region must match its read-back copy; the
				// mirror merge may legitimately keep sibling regions the
				// card did not edit, so the check is "all posted regions
				// equal", not "whole object equal".
				? Object.keys(nextValue as Record<string, unknown>).every((regionId) => JSON.stringify((readBack as Record<string, unknown> | null)?.[regionId]) === JSON.stringify((nextValue as Record<string, unknown>)[regionId]))
				: JSON.stringify(readBack) === JSON.stringify(nextValue);
		if (matches) return authoritative;
	}
	throw hostError instanceof Error ? hostError : new QoderSettingsWriteError(field, "neither the Host save endpoint nor the settings scope persisted the value");
}