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
/**
 * WHY THE ERROR CARRIES A `kind`
 *
 * Two host answers are different failures and must be told apart, or the card
 * papers over a write that never landed:
 *
 * - `absent` — the endpoint answered **404**: this host does not serve the
 *   `__save` route at all (a host line that predates it). The settings scope
 *   is the only writer here, so a degraded save is legitimate — but only an
 *   *unconfirmed* one, because the scope can read back its own snapshot and
 *   say "saved" without the document ever changing (docs/issues/06).
 *
 * - `refused` — the endpoint exists and answered definitively: **503**
 *   (settings service unavailable), **500**, a **400**, or a 200 whose
 *   read-back mismatched. That is the host SAYING the value did not persist.
 *   Falling back to the scope snapshot here and showing "已保存" is the exact
 *   false-success the route above was re-gated to prevent, so it stays a hard
 *   failure the card renders as a failed save.
 */
type HostFailureKind = "absent" | "refused";
var QoderSettingsWriteError = class extends Error {
	field: string;
	kind: HostFailureKind;
	constructor(field: string, reason?: string, kind: HostFailureKind = "refused") {
		super(`qoder: settings field "${field}" was not persisted${reason === void 0 ? "" : `: ${reason}`}`);
		this.name = "QoderSettingsWriteError";
		this.field = field;
		this.kind = kind;
	}
};
/**
 * The result of a settings write that the host endpoint did NOT confirm.
 *
 * Returned (never thrown) only in the `absent` case: the route answered 404 and
 * the value delivered through the settings scope's own snapshot. A confirmed
 * host write returns the authoritative value instead, and a `refused` write
 * throws. The card shows "已保存（未确认）" for this — not the clean "已保存"
 * the endpoint only owes for a value it read back out of the document.
 */
export interface UnconfirmedSave {
	unconfirmed: true;
	/** The value the scope settled on, if it delivered one. */
	value?: unknown;
}
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
		// The web server itself is unreachable. That is a definitive host
		// failure, NOT the "legacy host without the route" case (which answers
		// an HTTP 404, not this), so it is a refused save, not an unconfirmed
		// one: the settings scope cannot prove a write the endpoint could not.
		throw new QoderSettingsWriteError(field, `Host save endpoint unreachable: ${String(error)}`, "refused");
	}
	// The endpoint's answers are unvalidated JSON from the Host, so each is
	// narrowed at the point of use rather than declared as a record up front —
	// a `catch` that answers `{ error }` and a success that answers `{ value }`
	// are different shapes and only the reader knows which it holds.
	if (!response.ok) {
		const detail = await response.json().catch(() => ({ error: `HTTP ${String(response.status)}` })) as Record<string, unknown>;
		const reason = `${String(detail.errorName ?? "")} ${String(detail.error ?? "")}`.trim();
		// Only a 404 means "this host does not serve the route at all", which
		// is the one case a degraded scope save is even worth trying. Every
		// other refusal (503 settings service unavailable, 500, 400) is the
		// host saying the value did not persist — a definitive failure that
		// must surface as a failed save, not a false "已保存".
		const kind: HostFailureKind = response.status === 404 ? "absent" : "refused";
		throw new QoderSettingsWriteError(
			field,
			`Host save ${kind === "absent" ? "endpoint absent (404)" : "refused"}: ${reason === "" ? `HTTP ${String(response.status)}` : reason}`,
			kind,
		);
	}
	const detail = await response.json().catch((): undefined => void 0) as Record<string, unknown> | undefined;
	if (detail !== void 0 && detail.ok === false) {
		const reason = `${String(detail.errorName ?? "")} ${String(detail.error ?? "")}`.trim();
		throw new QoderSettingsWriteError(field, `Host read-back mismatch: ${reason}`, "refused");
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
 * one that preserves the sibling region. A `scope.set` runs either as a
 * mirror refresh after a confirmed endpoint write, or — only when the
 * endpoint answered **404** (a host that does not serve the route at all) —
 * as the degraded writer. The degraded value is then read back against the
 * scope's own snapshot, which can only prove "the scope holds it", not "the
 * document holds it": that is exactly the lie that used to surface as a
 * false "已保存", so it is returned as an {@link UnconfirmedSave} rather than
 * passed off as a clean save. A **definitive** refusal (503 settings service
 * unavailable, 500, 400, or a read-back mismatch) is NOT papered over: it
 * throws, and the card shows a failed save.
 *
 * @returns the authoritative value the endpoint read back (a confirmed
 *   save), or an {@link UnconfirmedSave} when only the scope delivered it on
 *   a 404. Throws when the endpoint definitively refused, or when it was
 *   absent and the scope could not deliver a matching value either.
 */
export async function writeSettingsField(scope: SettingsScope, field: string, value: unknown): Promise<unknown> {
	let hostError: unknown;
	try {
		const authoritative = await saveFieldViaHost(field, value);
		try {
			// Mirror only; the endpoint already persisted the value.
			await scope.set(field, authoritative);
		} catch {
			// A mirror failure is not a save failure: the document holds the value.
		}
		// A confirmed endpoint write — the value was read back out of the document.
		return authoritative;
	} catch (error) {
		hostError = error;
	}

	// The endpoint declined. Only the `absent` (404) case may degrade to the
	// settings scope; a definitive `refused` (503/500/400/mismatch) throws at
	// the bottom, because the host already told us the value did not persist.
	if (hostError instanceof QoderSettingsWriteError && hostError.kind === "absent") {
		// `enabledModelIds` is per-region on the Host, so its scope mirror
		// must keep the regions the card did not edit — every other field
		// is posted whole and replaces the field outright.
		const nextValue =
			field === "enabledModelIds"
				? { ...(fieldSnapshot(scope, field) as Record<string, unknown> | null), ...(value as Record<string, unknown>) }
				: value;
		let scopeDelivered = false;
		try {
			// The scope stores the value verbatim (no server-side merge on this
			// path).
			scopeDelivered = (await scope.set(field, nextValue)) !== false;
		} catch {
			scopeDelivered = false;
		}
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
			// Delivered and consistent with the scope — but only the scope saw
			// it, so the card must say "unconfirmed", not "已保存".
			if (matches) return { unconfirmed: true, value: nextValue } satisfies UnconfirmedSave;
		}
	}

	// Either the endpoint definitively refused, or it was absent and the scope
	// could not deliver a matching value: the write did not land. Never swallow
	// this into a "已保存" the user is not owed.
	throw hostError instanceof Error
		? hostError
		: new QoderSettingsWriteError(field, "neither the Host save endpoint nor the settings scope persisted the value");
}