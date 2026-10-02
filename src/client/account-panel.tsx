/**
 * The account section container.
 *
 * The second of the two card containers that owns a `fetch` (the other is
 * `usage-panel.tsx`); both go through `./http.ts`. This panel renders TWO
 * siblings — the body's region strip and, directly below it, the framed card
 * for the SELECTED region's sign-in — and owns every account-side network call:
 * the account read, the re-read, the per-region confirm, and the provider
 * switch write. The strip is the card's convergence point; it lives ABOVE the
 * account frame because it switches the WHOLE body, not just the sign-in card
 * (the WorkBuddy layout this card is modelled on).
 *
 * `activeRegion` / `onRegionChange` are the card-level pair that drives all
 * three surfaces (account, usage, model list). `onReconciled` lets the card
 * re-pull its models and usage once a re-read or switch has landed.
 */
import * as react from "react"
import type { CardAccountEntry, TranslateFn, CheckboxEvent } from "./card-model.ts"
import { withDate, describeThrown } from "./card-model.ts"
import { QODER_ACCOUNT_PATH, QODER_ACCOUNT_RELOAD_PATH, QODER_ACCOUNT_CONFIRM_PATH } from "./paths.ts"
import { getJson, postJson } from "./http.ts"
import { writeSettingsField } from "./settings-write.ts"
import type { SettingsScope } from "./settings-write.ts"

/** Props for {@link QoderAccountPanel}. */
interface QoderAccountPanelProps {
	t: TranslateFn
	onReconciled?: () => void
	settingsScope?: SettingsScope
	activeRegion?: string
	onRegionChange?: (regionId: string) => void
}

function QoderAccountPanel({ t, onReconciled, settingsScope, activeRegion = "qoder-cn", onRegionChange }: QoderAccountPanelProps) {
	const [accounts, setAccounts] = react.useState<CardAccountEntry[]>([]);
	const [status, setStatus] = react.useState("loading");
	const [reloading, setReloading] = react.useState(false);
	// One confirm outcome per region: `{ kind: "confirmed" |
	// "sign-in-expired" | "unavailable", detail? }`. Absent means
	// "not asked since the last re-read".
	const [confirmState, setConfirmState] = react.useState<Record<string, { kind?: string; detail?: string }>>({});
	const [confirmBusy, setConfirmBusy] = react.useState<Record<string, boolean>>({});
	// The per-region provider switch. The host answers with the fully
	// resolved map for every known region, so saving posts that whole
	// map back — a host-side per-region merge can never lose a
	// sibling region, and the scope-mirror fallback replaces a field
	// it always holds in full.
	const [enabledRegions, setEnabledRegions] = react.useState<Record<string, boolean>>({});
	const [toggling, setToggling] = react.useState(false);
	const [offerError, setOfferError] = react.useState<string | undefined>(undefined);
	const mounted = react.useRef(true);
	react.useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	const load = react.useCallback(async () => {
		try {
			const value = await getJson<{ regions?: unknown; enabledRegions?: unknown }>(QODER_ACCOUNT_PATH);
			if (!mounted.current) return;
			const regions = Array.isArray(value.regions) ? (value.regions as CardAccountEntry[]) : [];
			setAccounts(regions);
			// Prefer the host-resolved map; fall back to each region's
			// own `enabled` flag so an older host that predates the
			// map still drives the switch (absent = offered).
			const map = value.enabledRegions !== null && typeof value.enabledRegions === "object" ? (value.enabledRegions as Record<string, boolean>) : Object.fromEntries(regions.filter((entry) => entry.region !== undefined).map((entry) => [entry.region as string, entry.enabled !== false]));
			setEnabledRegions(map);
			setStatus("ready");
		} catch {
			if (mounted.current) setStatus("error");
		}
	}, []);
	react.useEffect(() => {
		void load();
	}, [load]);
	const reload = react.useCallback(async () => {
		setReloading(true);
		try {
			// The re-read only adds: drop the cached credential, refresh the
			// catalog, and start any region that looks signed-out.
			await postJson(QODER_ACCOUNT_RELOAD_PATH, {});
			if (!mounted.current) return;
			// The re-read just changed what is true on disk: drop the
			// confirm outcomes (they were answered against the old
			// credential) and let the card reconcile its models and
			// usage with the fresh state.
			setConfirmState({});
			if (onReconciled !== void 0) onReconciled();
			await load();
		} catch {
			if (mounted.current) setStatus("error");
		} finally {
			if (mounted.current) setReloading(false);
		}
	}, [load, onReconciled]);
	// WorkBuddy parity: the tab strip (rendered above the account frame)
	// is the body's whole header — no title row, no re-read button to
	// save. The re-read therefore has to find its own moment, and the
	// dots say when that is. The
	// opening GET already re-reads every store from disk, so the POST
	// only adds: drop the cached credential, refresh the catalog, and
	// start any region that looks signed-out. Once per open is enough;
	// selecting a still-bad tab (below) covers the "I just signed in
	// while the card was open" case.
	const autoReloaded = react.useRef(false);
	react.useEffect(() => {
		if (status !== "ready" || autoReloaded.current) return;
		if (!accounts.some((entry) => entry.state !== "ok")) return;
		autoReloaded.current = true;
		void reload();
	}, [status, accounts, reload]);
	const confirm = react.useCallback(async (regionId) => {
		setConfirmBusy((current) => ({ ...current, [regionId]: true }));
		setConfirmState((current) => {
			const next = { ...current };
			delete next[regionId];
			return next;
		});
		try {
			const value = await postJson<{ available?: unknown; confirmed?: unknown; kind?: string; detail?: string }>(QODER_ACCOUNT_CONFIRM_PATH, { region: regionId });
			if (!mounted.current) return;
			if (value.available !== true) {
				setConfirmState((current) => ({ ...current, [regionId]: { kind: "unavailable" } }));
				return;
			}
			setConfirmState((current) => ({
				...current,
				[regionId]: value.confirmed === true ? {
					kind: "confirmed"
				} : {
					kind: value.kind,
					detail: value.detail
				}
			}));
		} catch (error) {
			if (!mounted.current) return;
			setConfirmState((current) => ({
				...current,
				[regionId]: {
					kind: "unavailable",
					detail: describeThrown(error)
				}
			}));
		} finally {
			if (mounted.current) setConfirmBusy((current) => ({ ...current, [regionId]: false }));
		}
	}, []);
	// Flip one region's provider switch. The save goes through the
	// settings pipeline (host endpoint first, scope mirror second) with
	// the COMPLETE map, exactly like the model-section saves: a host
	// that merges per region cannot lose the sibling, and a host that
	// replaces the field is given the whole thing. On success the card
	// reconciles (models + usage) and re-reads the account panel, so
	// the switch settles on the authoritative state rather than an
	// optimistic guess; on failure the switch reverts and the reason
	// is shown instead of a silent no-op.
	const toggleRegion = react.useCallback(async (regionId, nextOn) => {
		setToggling(true);
		setOfferError(undefined);
		const next = { ...enabledRegions, [regionId]: nextOn };
		setEnabledRegions(next);
		try {
			if (settingsScope === void 0) throw new Error("settings service unavailable");
			await writeSettingsField(settingsScope, "enabledRegions", next);
			if (onReconciled !== void 0) onReconciled();
			await load();
		} catch (error) {
			setEnabledRegions((current) => ({ ...current, [regionId]: !nextOn }));
			if (mounted.current) setOfferError(describeThrown(error));
		} finally {
			if (mounted.current) setToggling(false);
		}
	}, [enabledRegions, settingsScope, onReconciled, load]);
	// Tone per state: `ok` is green, a lapsed or unreadable sign-in is
	// red or amber, and "not installed" stays neutral — the absence of
	// an app is not a fault of this machine. The same tones drive the
	// status dots on the region strip.
	const dotClassOf = (state: string | undefined) => state === "ok" ? " dsm-qoder-region-dot-ok" : state === "expired" ? " dsm-qoder-region-dot-expired" : state === "needs-app" ? " dsm-qoder-region-dot-needs" : "";
	const stateLabelOf = (entry: CardAccountEntry) => t(`account.state.${entry.state}`);
	// The strip shows every known region; the detail below it shows
	// only the one the strip has selected. A selection that no longer
	// exists should not happen — the host always answers with both
	// regions — but it falls back to the first entry rather than
	// breaking the panel.
	const activeEntry = accounts.find((entry) => entry.region === activeRegion) ?? accounts[0];
	// `region` is optional on the entry, so it cannot be used as an index until
	// it is known to be a string. An entry with no region is not addressable in
	// the per-region maps at all, which is why the fallbacks below answer
	// "nothing recorded for it" rather than guessing a key.
	const activeRegionId = activeEntry?.region;
	// The label the four user-facing strings interpolate. Built once from the
	// two optional sources rather than repeated as `regionName ?? region` at
	// each site: that spelling is `string | undefined`, which the translation
	// helper does not accept, and a missing label must read as an empty string
	// rather than the word "undefined".
	const activeEdition = activeEntry?.regionName ?? activeRegionId ?? "";
	const activeOffered = activeEntry !== undefined && activeRegionId !== undefined && enabledRegions[activeRegionId] !== false;
	const activeResult = activeEntry !== undefined && activeRegionId !== undefined ? confirmState[activeRegionId] : undefined;
	// Bound once and tested once: `activeHasIdentity` is a boolean, so it cannot
	// narrow `activeEntry.identity` at the reads below. Holding the identity
	// itself is what lets the three later reads be checked rather than asserted.
	const activeIdentity = activeEntry?.identity ?? undefined;
	const activeHasIdentity = activeIdentity !== undefined && activeIdentity !== null;
	const activeName = activeHasIdentity ? String(activeIdentity.name ?? "").trim() : "";
	// The same three chips the old rows carried: credential source,
	// app name, and the sign-in's expiry date — now for one region.
	const activeMeta = [];
	if (activeEntry !== undefined) {
		if (activeEntry.source === "env-pat") activeMeta.push(t("account.envPat"));
		else if (typeof activeEntry.appName === "string" && activeEntry.appName !== "") activeMeta.push(t("account.appFrom", { app: activeEntry.appName }));
		if (activeHasIdentity && Number(activeIdentity.expiresAt) > 0) activeMeta.push(withDate(t("account.expiresAt"), activeIdentity.expiresAt));
	}
	return (
		<react.Fragment>
			{/*
				The convergence point, now ABOVE the account card rather than
				inside its frame: one pill per region — status dot, name,
				provider switch — and selecting a pill scopes the sign-in
				detail, the usage panel and the model list to that region, so
				the region name appears exactly once on the card. The strip
				switches the WHOLE body, so it is the body's header, matching
				the WorkBuddy layout it was modelled on; it is hidden on a
				read failure, whose own retry stays in the card below.
			*/}
			{status !== "error" ? (
				<div className="dsm-qoder-region-tabs" role="tablist" aria-label={t("account.regionTabs")}>
					{accounts.map((entry) => {
						// A region-less entry is not addressable: it has no
						// key in `enabledRegions`, nothing to select, and
						// nothing to pass to `onRegionChange`. The host
						// always names one, so this narrows the type at the
						// render boundary instead of asserting it, and an
						// unnamed entry is skipped rather than rendered as a
						// tab that cannot work.
						const regionId = entry.region;
						if (regionId === undefined) return null;
						// Provider switch state. The local map is the source
						// of truth for the switch (it settles on the host
						// value after each save); a region with no key yet
						// reads as offered, the same default the host
						// predicate uses.
						const offered = enabledRegions[regionId] !== false;
						const isActive = regionId === activeRegion;
						return (
							<div
								key={`tab:${regionId}`}
								className={`dsm-qoder-region-tab-cell${isActive ? " dsm-qoder-region-tab-cell-active" : ""}`}
							>
								<button
									type="button"
									role="tab"
									aria-selected={isActive}
									className={`dsm-qoder-region-tab${offered ? "" : " dsm-qoder-region-tab-off"}`}
									title={`${entry.regionName ?? regionId} · ${stateLabelOf(entry)}`}
									onClick={() => {
										if (typeof onRegionChange === "function") onRegionChange(regionId);
										// Choosing a not-ok region is also the
										// moment the user has just signed in
										// over there: run the pick-up for it,
										// dots included.
										if (entry.state !== "ok") void reload();
									}}
								>
									<span aria-hidden="true" className={`dsm-qoder-region-dot${dotClassOf(entry.state)}`} />
									<span className="dsm-qoder-region-name">{entry.regionName ?? regionId}</span>
								</button>
								<label className="dsm-qoder-region-toggle-cell" title={t("account.offerTitle")}>
									<input
										type="checkbox"
										className="dsm-qoder-region-toggle"
										checked={offered}
										disabled={toggling}
										onChange={(event: CheckboxEvent) => {
											void toggleRegion(regionId, event.target.checked);
										}}
										aria-label={`${t("account.offer")}: ${entry.regionName ?? regionId}`}
									/>
								</label>
							</div>
						);
					})}
				</div>
			) : null}
			<div className="dsm-qoder-account">
				{status === "error" ? (
					// A failure says so with its own retry inside the card,
					// rather than a button that is otherwise redundant.
					<div className="dsm-qoder-account-error">
						<p className="dsm-qoder-error">{t("account.error")}</p>
						<button
							type="button"
							className="dsm-qoder-button"
							disabled={reloading}
							onClick={() => {
								void reload();
							}}
						>
							{t("account.reload")}
						</button>
					</div>
				) : (
					<react.Fragment>
						{/* The selected region's sign-in: who it is, where the
						    credential comes from, and what to do when it is not
						    `ok`. */}
						{activeEntry !== undefined ? (
							<react.Fragment>
								<div className={`dsm-qoder-account-row${activeOffered ? "" : " dsm-qoder-account-row-off"}`}>
									<span className="dsm-qoder-account-id">
										<span className="dsm-qoder-account-name">
											{activeName !== "" ? activeName : "—"}
										</span>
										{activeMeta.length > 0 ? (
											<span className="dsm-qoder-account-meta">{activeMeta.join(" · ")}</span>
										) : null}
									</span>
									<span className="dsm-qoder-usage-spacer" />
									{activeEntry.source !== undefined && activeRegionId !== undefined ? (
										<button
											type="button"
											className="dsm-qoder-button"
											disabled={confirmBusy[activeRegionId] === true}
											onClick={() => {
												void confirm(activeRegionId);
											}}
										>
											{confirmBusy[activeRegionId] === true ? t("account.confirming") : t("account.confirm")}
										</button>
									) : null}
								</div>
								{!activeOffered ? (
									<p className="dsm-qoder-account-note">{t("account.offerOff")}</p>
								) : null}
								{activeEntry.state === "needs-app" ? (
									<p className="dsm-qoder-account-note dsm-qoder-account-note-error">
										{t("account.readFail", { detail: activeEntry.detail ?? "" })}
									</p>
								) : null}
								{activeEntry.state === "expired" ? (
									<p className="dsm-qoder-account-note">
										<span>
											{t("account.expiredHint", {
												app: activeEntry.appName ?? activeEntry.regionName ?? "Qoder",
											})}
										</span>
										<br />
										<span>
											{t("account.download", { edition: activeEdition })}
											{typeof activeEntry.downloadUrl === "string" && activeEntry.downloadUrl !== "" ? (
												<react.Fragment>
													{" · "}
													<a
														href={activeEntry.downloadUrl}
														target="_blank"
														rel="noreferrer"
														title={activeEntry.downloadUrl}
													>
														{t("account.downloadLink", { edition: activeEdition })}
													</a>
												</react.Fragment>
											) : null}
										</span>
									</p>
								) : null}
								{activeEntry.state === "signed-out" ? (
									<p className="dsm-qoder-account-note">
										<span>{t("account.unsigned")}</span>
										<br />
										<span>
											{t("account.download", { edition: activeEdition })}
											{typeof activeEntry.downloadUrl === "string" && activeEntry.downloadUrl !== "" ? (
												<react.Fragment>
													{" · "}
													<a
														href={activeEntry.downloadUrl}
														target="_blank"
														rel="noreferrer"
														title={activeEntry.downloadUrl}
													>
														{t("account.downloadLink", { edition: activeEdition })}
													</a>
												</react.Fragment>
											) : null}
										</span>
									</p>
								) : null}
								{activeResult?.kind === "confirmed" ? (
									<p className="dsm-qoder-account-note">{t("account.confirmed")}</p>
								) : null}
								{activeResult?.kind === "sign-in-expired" ? (
									<p className="dsm-qoder-account-note dsm-qoder-account-note-error">
										{t("account.confirmExpired")}
									</p>
								) : null}
								{activeResult?.kind === "unavailable" ? (
									<p className="dsm-qoder-account-note dsm-qoder-account-note-error">
										{t("account.confirmFailed", { detail: activeResult.detail ?? "" })}
									</p>
								) : null}
							</react.Fragment>
						) : null}
					</react.Fragment>
				)}
				{offerError !== undefined ? (
					<p className="dsm-qoder-account-note dsm-qoder-account-note-error">
						{t("account.offerError", { detail: offerError })}
					</p>
				) : null}
			</div>
		</react.Fragment>
	);
}

export { QoderAccountPanel }
export type { QoderAccountPanelProps }
