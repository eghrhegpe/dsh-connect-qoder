
import * as react from "react"
import { QODER_MODELS_PATH, QODER_USAGE_PATH, QODER_ACCOUNT_PATH, QODER_ACCOUNT_RELOAD_PATH, QODER_ACCOUNT_CONFIRM_PATH, QODER_CHECKIN_PATH } from "./paths.ts"
import { writeSettingsField } from "./settings-write.ts"
import type { SettingsScope } from "./settings-write.ts"
// The editable-state machine. `imageModeOf`, `enabledIdsFor`, `IMAGE_MODES` and
// the sentinel are imported rather than re-declared, so the rules the JSX reads
// and the rules the tests assert are literally the same functions.
import { QoderCardController, imageModeOf, enabledIdsFor, initialEditableState, persistViaScope, IMAGE_MODES } from "./controller.ts"
// The browser-free decision layer (off-peak gate, rate, window label, refresh
// verdict, formatting) plus the view-model type vocabulary. Moved to its own
// module so Node tests can import the real rules instead of mirroring them —
// see ./card-model.ts.
import {
	type CardModelRow,
	type CardUsageRegion,
	type CardQuota,
	type CardCheckin,
	type CardAccountEntry,
	type TranslateFn,
	type CheckboxEvent,
	type ValueEvent,
	type EventHandler,
	withDate,
	rateLabelOf,
	offPeakState,
	formatCountdown,
	formatContextWindowForUi,
	windowLabelOf,
	rateAt,
	refreshNoticeKey,
} from "./card-model.ts"


/**
 * A readable description of a thrown value, for the two `catch` blocks in this
 * card that show a failure reason to the user.
 *
 * A catch binding is `unknown` (`useUnknownInCatchVariables`), so `.message` is
 * not readable without narrowing. The spelling this replaces —
 * `String(error?.message ?? error)` — had a real defect beyond the type error:
 * for a non-`Error` throw with no `message` (a bare object, or a rejection
 * carrying only a code) it produces the literal text `"undefined"`, which is
 * how a failed save could show the user a message that says nothing at all.
 *
 * This is a LOCAL copy of `host/errors.ts#describeThrown` on purpose. The card
 * is a separate bundle built by `scripts/build-client.mjs`, and no client file
 * imports from `src/host/`, so sharing one implementation would mean either
 * bundling host code into the browser card or hoisting this helper into the
 * generated `lib/client.js`. The duplication is two lines of narrowing against
 * a stable language rule; the coupling is not worth that price.
 */
function describeThrown(error: unknown): string {
	const message = (error as { message?: unknown } | null | undefined)?.message;
	if (typeof message === "string" && message !== "") return message;
	if (typeof error === "string") return error;
	return String(error);
}


/** Props for {@link QuotaBlock}. */
interface QuotaBlockProps {
	t: TranslateFn
	label: string
	quota: CardQuota
	when?: string
	badge?: string
}

/**
 * One quota row: label, optional badges, an optional date, a bar, and the
 * used/total figures. Shared by the plan quota, the add-on package and the
 * per-model dedicated packages, which differ only in their wording.
 */
function QuotaBlock({ t, label, quota, when, badge }: QuotaBlockProps) {
	const percentage = Math.min(1, Math.max(0, Number(quota.percentage) || 0));
	// Round before formatting: a ratio like 268/2000 is 0.14 in binary
	// floating point, and rendering the raw product would emit
	// "14.000000000000002%" into the style attribute.
	const percent = Math.round(percentage * 1000) / 10;
	// The healthy fill takes the card's success green — the same
	// --dsw-alias-state-success-primary the 限时特惠 badge and the "ok"
	// status dot use, so a green bar, a green badge and a green dot
	// all read as "fine" at once. Past 80% it turns amber and a
	// spent quota red, keeping a nearly-empty bar legible at a glance.
	// "Unknown" is not "exceeded". Upstream may omit `remaining` entirely, and
	// `undefined <= 0` is false — so the report below stays off in that case,
	// which is the honest answer: the card must not claim a quota is spent when
	// it simply was not told. (Before this was made explicit the figure line
	// below also rendered the literal text "undefined" into the UI.)
	const remaining = quota.remaining;
	const known = typeof remaining === "number" && Number.isFinite(remaining);
	const exhausted = known && remaining <= 0;
	const tone = exhausted ? " dsm-qoder-bar-full" : percentage >= 0.8 ? " dsm-qoder-bar-warn" : "";
	const unit = quota.unit === "credits" ? t("usage.credits") : quota.unit ?? "";
	return (
		<div className="dsm-qoder-usage-block">
			<div className="dsm-qoder-usage-label">
				<span>{label}</span>
				{badge !== undefined ? (
					<span className="dsm-qoder-usage-badge dsm-qoder-usage-badge-offer">{badge}</span>
				) : null}
				{exhausted ? (
					<span className="dsm-qoder-usage-badge">{t("usage.exceeded")}</span>
				) : null}
				{when ? <span className="dsm-qoder-usage-when">{when}</span> : null}
			</div>
			<div
				className="dsm-qoder-bar"
				role="progressbar"
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={Math.round(percentage * 100)}
				aria-label={label}
			>
				<div className={`dsm-qoder-bar-fill${tone}`} style={{ width: `${percent}%` }} />
			</div>
			<div className="dsm-qoder-usage-figures">
				<span>
					<strong>{`${quota.used} / ${quota.total}`}</strong>
					{` (${Math.round(percent)}%)`}
				</span>
				<span>{`${t("usage.remaining")} ${known ? remaining : "—"}${unit ? ` ${unit}` : ""}`}</span>
			</div>
		</div>
	);
}

/** Props for {@link CheckinCard}. */
interface CheckinCardProps {
	t: TranslateFn
	checkin: CardCheckin
	busy: boolean
	notice?: { kind?: string; message?: string; amount?: number } | null
	onClaim: EventHandler
}

/**
 * Today's check-in, as a small card beside the usage panel.
 *
 * This used to be one more full-width row in the panel's stack, which spent a
 * whole line on two short strings ("每日签到" / "今日已签到") and made the panel
 * read as low-density. The facts are unchanged and still all come from the
 * host: whether a round is running, whether it was claimed, and what it is
 * worth. The card holds no arithmetic of its own — the amount is the host's
 * `checkin.amount`, the same value the panel already printed as "今日可领".
 */
function CheckinCard({ t, checkin, busy, notice, onClaim }: CheckinCardProps) {
	const claimed = checkin.todayCheckedIn === true;
	const amount = typeof checkin.amount === "number" ? checkin.amount : undefined;
	return (
		<aside className="dsm-qoder-checkin">
			<span className="dsm-qoder-checkin-title">{t("usage.checkin")}</span>
			{amount !== undefined ? (
				<strong className="dsm-qoder-checkin-gain">{t("usage.checkinGain", { amount })}</strong>
			) : null}
			<button
				type="button"
				className="dsm-qoder-button dsm-qoder-checkin-button"
				disabled={busy || claimed}
				onClick={onClaim}
			>
				{busy ? t("usage.checkinClaiming") : claimed ? t("usage.checkinClaimed") : t("usage.checkinClaim")}
			</button>
			{/* `!= null` covers BOTH absent and explicit null, which is what the
			    prop type allows (`… | null`). Testing only for `undefined` let a
			    `null` through to the `.kind` reads below. */}
			{notice != null ? (
				<p className={notice.kind === "error" ? "dsm-qoder-error" : "dsm-qoder-state"}>
					{notice.kind === "error"
						? t("usage.checkinError", { message: notice.message ?? "" })
						: notice.kind === "granted" && typeof notice.amount === "number"
							? t("usage.checkinGranted", { amount: notice.amount })
							: t("usage.checkinAlready")}
				</p>
			) : null}
		</aside>
	);
}

/** Props for {@link RegionUsage}. */
interface RegionUsageProps {
	t: TranslateFn
	entry: CardUsageRegion & Record<string, unknown>
}

/**
 * One region's usage block, as returned by the host usage route.
 *
 * Holds only the quota bars and the promotional lines. The daily check-in is
 * NOT part of this block: it is rendered by {@link QoderUsagePanel} as a card
 * beside the whole panel, because a check-in row inside this stack spent a
 * full-width line on two short strings.
 */
function RegionUsage({ t, entry }: RegionUsageProps) {
	if (entry.available !== true) {
		return (
			<div className="dsm-qoder-usage-block">
				<p className="dsm-qoder-state">{t("usage.unavailable")}</p>
			</div>
		);
	}
	const packages = Array.isArray(entry.dedicatedPackages) ? entry.dedicatedPackages : [];
	const campaigns = Array.isArray(entry.campaigns) ? entry.campaigns : [];
	const hasAny = entry.userQuota !== undefined || entry.addOnQuota !== undefined || packages.length > 0;
	return (
		<div className="dsm-qoder-usage-block">
			{!hasAny ? <p className="dsm-qoder-state">{t("usage.empty")}</p> : null}
			{entry.userQuota !== undefined ? (
				<QuotaBlock
					t={t}
					label={t("usage.planCredits")}
					quota={entry.userQuota}
					when={withDate(t("usage.renewsOn"), typeof entry.expiresAt === "number" ? entry.expiresAt : undefined)}
				/>
			) : null}
			{entry.addOnQuota !== undefined ? (
				<QuotaBlock t={t} label={t("usage.resourcePackage")} quota={entry.addOnQuota} />
			) : null}
			{/* Dedicated packages are per-model allowances. They appear only
			    when the account actually holds one, so the panel stays honest
			    for accounts that have none. */}
			{packages.map((pack, index) => (
				<react.Fragment key={`pack:${pack.id}:${index}`}>
					<div className="dsm-qoder-usage-sep" />
					<QuotaBlock
						t={t}
						label={typeof pack.name === "string" && pack.name !== "" ? pack.name : t("usage.dedicatedPackage")}
						quota={pack}
						when={withDate(t("usage.expiresOn"), typeof pack.expiresAt === "number" ? pack.expiresAt : undefined)}
					/>
				</react.Fragment>
			))}
			{campaigns.length > 0 ? <div className="dsm-qoder-usage-sep" /> : null}
			{campaigns.map((camp) => (
				<p className="dsm-qoder-usage-promo" key={`camp:${camp.key}`}>
					<span className="dsm-qoder-usage-badge dsm-qoder-usage-badge-offer">
						{t("usage.promotion")}
					</span>
					{" "}
					{camp.title}
					{camp.endsAt !== undefined
						? ` · ${withDate(t("usage.expiresOn"), typeof camp.endsAt === "number" ? camp.endsAt : undefined)}`
						: ""}
					{camp.detailUrl ? (
						<react.Fragment>
							{" "}
							<a href={camp.detailUrl} target="_blank" rel="noreferrer">
								{t("usage.viewDetails")}
							</a>
						</react.Fragment>
					) : null}
				</p>
			))}
		</div>
	);
}

/**
 * The usage section: a refresh control plus one block per region.
 *
 * The panel owns its own fetch rather than riding the model read, because
 * quota changes with every turn and must be refreshable on demand.
 *
 * `refreshToken` is the card's "the world changed, re-read" signal: when
 * the account panel's re-read lands, the card bumps it, and this panel
 * forces a fresh quota pull for what the host can now serve.
 */
/** Props for {@link QoderUsagePanel}. */
interface QoderUsagePanelProps {
	t: TranslateFn
	refreshToken?: number
	activeRegion?: string
}

function QoderUsagePanel({ t, refreshToken = 0, activeRegion = "qoder-cn" }: QoderUsagePanelProps) {
	const [regions, setRegions] = react.useState<CardUsageRegion[]>([]);
	const [status, setStatus] = (0, react.useState)("loading");
	const [notice, setNotice] = react.useState<string | undefined>(undefined);
	const [busy, setBusy] = (0, react.useState)(false);
	const [claimBusy, setClaimBusy] = (0, react.useState)(false);
	const [claimNotice, setClaimNotice] = react.useState<{ kind?: string; message?: string; amount?: number } | undefined>(undefined);
	const mounted = (0, react.useRef)(true);
	(0, react.useEffect)(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	const load = (0, react.useCallback)(async (refresh: boolean) => {
		setBusy(true);
		try {
			const response = await fetch(`${QODER_USAGE_PATH}${refresh ? "?refresh=1" : ""}`, {
				headers: { accept: "application/json" },
				credentials: "same-origin"
			});
			const value = await response.json().catch((): undefined => void 0);
			if (!response.ok || value === void 0) throw new Error(`HTTP ${response.status}`);
			if (!mounted.current) return;
			setRegions(Array.isArray(value.regions) ? value.regions : []);
			setStatus("ready");
			setNotice(undefined);
		} catch (error) {
			if (!mounted.current) return;
			setStatus("error");
			setNotice(error instanceof Error ? error.message : String(error));
		} finally {
			if (mounted.current) setBusy(false);
		}
	}, []);
	// The daily check-in goes through the host rather than to Qoder: only the
	// host can say which round is live at the moment of the click, and a card
	// that carried its own campaign id could claim a round that closed
	// yesterday. The usage re-read follows every claim because the Credits land
	// in the add-on quota rendered a few lines above the button.
	const claimCheckin = (0, react.useCallback)(async () => {
		setClaimBusy(true);
		setClaimNotice(void 0);
		try {
			const response = await fetch(`${QODER_CHECKIN_PATH}?region=${encodeURIComponent(activeRegion)}`, {
				method: "POST",
				headers: { accept: "application/json" },
				credentials: "same-origin"
			});
			const value = await response.json().catch((): undefined => void 0);
			if (!response.ok) throw new Error(value?.error ?? `HTTP ${response.status}`);
			if (mounted.current) setClaimNotice({
				kind: value?.replayed === true ? "already" : "granted",
				// Absent when the upstream replayed the round: a repeat claim
				// grants nothing, so no amount is printed for it.
				amount: typeof value?.amount === "number" ? value.amount : void 0
			});
			await load(true);
		} catch (error) {
			if (mounted.current) setClaimNotice({
				kind: "error",
				message: error instanceof Error ? error.message : String(error)
			});
		} finally {
			if (mounted.current) setClaimBusy(false);
		}
	}, [activeRegion, load]);
	(0, react.useEffect)(() => {
		void load(false);
	}, [load]);
	// The card's "the account just changed" signal: a re-read landed, so
	// re-pull the quota for whatever the host can serve now. The mount
	// effect already did the initial read, so a zero token must not
	// force a second fetch.
	(0, react.useEffect)(() => {
		if (refreshToken === 0) return;
		void load(true);
	}, [refreshToken, load]);
	// Scoped to the selected region (the convergence point on the version
	// strip), so only one usage block renders instead of one per region. The
	// fetch still pulls every region; this just picks the one the strip has
	// selected. The same selection drives the check-in card beside it.
	const active = regions.find((entry) => entry.region === activeRegion);
	return (
		<div className="dsm-qoder-usage-row">
			<div className="dsm-qoder-usage">
				<div className="dsm-qoder-usage-head">
					{/* The head is a stable title row: the panel title stays on
					    the left and the refresh control stays on the right.
					    Loading and error states render below it, next to the
					    selected region's block. */}
					<h4 className="dsm-qoder-usage-title">{t("usage.title")}</h4>
					<button
						type="button"
						className="dsm-qoder-button"
						disabled={busy}
						onClick={() => {
							void load(true);
						}}
					>
						{t("usage.refresh")}
					</button>
				</div>
				{status === "loading" ? <p className="dsm-qoder-hint">{t("usage.loading")}</p> : null}
				{status === "error" ? (
					<p className="dsm-qoder-error">{`${t("usage.error")}: ${notice ?? ""}`}</p>
				) : null}
				{active !== undefined ? (
					<RegionUsage t={t} entry={active} />
				) : (
					// The selected edition has no quota entry yet — it is not
					// signed in or not started — so say so instead of leaving
					// the panel body empty under its header.
					status === "ready" ? <p className="dsm-qoder-state">{t("usage.none")}</p> : null
				)}
			</div>
			{/* The daily check-in sits BESIDE the usage panel rather than as one
			    more stacked row inside it: as a row it spent a full-width line on
			    "每日签到" and one short button. It is only rendered when upstream
			    has a round running, so no permanently grey card is left behind —
			    and the panel then keeps the full width to itself. */}
			{active?.checkin !== undefined && active.checkin.active === true ? (
				<CheckinCard
					t={t}
					checkin={active.checkin}
					busy={claimBusy}
					notice={claimNotice}
					onClaim={() => {
						void claimCheckin();
					}}
				/>
			) : null}
		</div>
	);
}

/**
 * The account section. It renders TWO siblings: the body's region strip
 * and, directly below it, the framed card with the SELECTED region's
 * sign-in — who drives it, in which state it is, and what to do when it
 * is not `ok`. The strip is the card's convergence point: each region is
 * one pill (status dot + name + provider switch), and selecting a pill
 * scopes the sign-in detail, the usage panel and the model list to that
 * region, so the region name appears exactly once on the card. It lives
 * ABOVE the account frame because it switches the WHOLE body, not just
 * the sign-in card (the WorkBuddy layout this card is modelled on).
 * `activeRegion` / `onRegionChange` are the card-level pair that drives
 * all three surfaces.
 *
 * The states come from the host's account route and are computed from
 * LOCAL evidence only, so reading the panel costs no network. The
 * deliberate actions are:
 *
 * - **Re-read sign-in** POSTs to the host's reload route, which
 *   invalidates the credential caches, re-reads the app stores, and
 *   starts any region that has come back online — a re-sign-in is
 *   picked up without restarting DSH. `onReconciled` lets the card
 *   re-pull its models and usage once the read has landed.
 * - **Confirm online** is the single optional network call
 *   (`fetchUserInfo`): it answers "is this sign-in still valid at the
 *   upstream?", a question a disk read cannot answer on its own.
 * - The pill's **provider switch** writes `enabledRegions` (opt-out:
 *   absent = offered) through the settings pipeline; a switched-off
 *   region contributes zero models, and the picker + card list hide
 *   it via the same host predicate.
 */
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
	const [status, setStatus] = (0, react.useState)("loading");
	const [reloading, setReloading] = (0, react.useState)(false);
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
	const [toggling, setToggling] = (0, react.useState)(false);
	const [offerError, setOfferError] = react.useState<string | undefined>(undefined);
	const mounted = (0, react.useRef)(true);
	(0, react.useEffect)(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	const load = (0, react.useCallback)(async () => {
		try {
			const response = await fetch(QODER_ACCOUNT_PATH, {
				headers: { accept: "application/json" },
				credentials: "same-origin"
			});
			const value = await response.json().catch((): undefined => void 0);
			if (!response.ok || value === void 0) throw new Error(`HTTP ${response.status}`);
			if (!mounted.current) return;
			const regions = Array.isArray(value.regions) ? value.regions : [];
			setAccounts(regions);
			// Prefer the host-resolved map; fall back to each region's
			// own `enabled` flag so an older host that predates the
			// map still drives the switch (absent = offered).
			const map = value.enabledRegions !== null && typeof value.enabledRegions === "object" ? value.enabledRegions as Record<string, boolean> : Object.fromEntries((regions as CardAccountEntry[]).filter((entry) => entry.region !== undefined).map((entry) => [entry.region, entry.enabled !== false]));
			setEnabledRegions(map);
			setStatus("ready");
		} catch {
			if (mounted.current) setStatus("error");
		}
	}, []);
	(0, react.useEffect)(() => {
		void load();
	}, [load]);
	const reload = (0, react.useCallback)(async () => {
		setReloading(true);
		try {
			const response = await fetch(QODER_ACCOUNT_RELOAD_PATH, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "same-origin",
				body: JSON.stringify({})
			});
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
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
	const autoReloaded = (0, react.useRef)(false);
	(0, react.useEffect)(() => {
		if (status !== "ready" || autoReloaded.current) return;
		if (!accounts.some((entry) => entry.state !== "ok")) return;
		autoReloaded.current = true;
		void reload();
	}, [status, accounts, reload]);
	const confirm = (0, react.useCallback)(async (regionId) => {
		setConfirmBusy((current) => ({ ...current, [regionId]: true }));
		setConfirmState((current) => {
			const next = { ...current };
			delete next[regionId];
			return next;
		});
		try {
			const response = await fetch(QODER_ACCOUNT_CONFIRM_PATH, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "same-origin",
				body: JSON.stringify({ region: regionId })
			});
			const value = await response.json().catch((): undefined => void 0);
			if (!response.ok || value === void 0) throw new Error(`HTTP ${response.status}`);
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
	const toggleRegion = (0, react.useCallback)(async (regionId, nextOn) => {
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
	// The expired / not-installed states no longer drag the user onto the
	// website: they point at the client (re-sign-in / install) and carry
	// the region's download link, labelled with where it goes. The manage
	// link is therefore gone, and with it the `manageUrl` render.
	// The expired / not-installed states no longer drag the user onto the
	// website: they point at the client (re-sign-in / install) and carry
	// the region's download link, labelled with where it goes. The manage
	// link is therefore gone, and with it the `manageUrl` render.
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

/**
 * Whether the card starts expanded, resolved from the host's `view`.
 *
 * The host renders a slot card with one of three shapes:
 *
 * - `view: "page"` — the card is the page itself (the bundle / row
 *   detail pages, and the WorkBuddy-style detail surface). Collapsing a
 *   page would leave the user staring at an empty screen, so the card
 *   opens by default. This is the "auto-expand" behaviour borrowed from
 *   the WorkBuddy bundle.
 * - `view: "summary"` — the card sits in a list of cards, where an
 *   expanded card would push every sibling off-screen; start collapsed
 *   and let the header click do the work.
 * - no `view` (legacy slots that predate the prop) — the previous
 *   default was collapsed, and keeping it means an old host surface
 *   does not suddenly change shape on upgrade.
 *
 * Collapsing is never destructive: the card's body is `hidden`, not
 * unmounted, so staged edits and a ticking off-peak countdown survive a
 * collapse/expand cycle.
 *
 * @param view - the `view` prop the host slot passed, if any.
 * @returns true when the card should start expanded.
 */
function initialOpenForView(view: unknown): boolean {
	return view === "page";
}

/** Props for the card the host's slot system mounts. */
interface QoderPluginCardProps {
	t: TranslateFn
	settingsScope?: SettingsScope
	/** The host slot's `view` discriminator (`"page"` renders expanded). */
	view?: unknown
}

/** Render the Qoder model and image-input card. */
export function QoderPluginCard({ t, settingsScope, view }: QoderPluginCardProps) {
	if (t === void 0) throw new Error("Qoder settings card requires its translation function");
	const [open, setOpen] = (0, react.useState)(() => initialOpenForView(view));
	const [models, setModels] = react.useState<CardModelRow[]>([]);
	// The editable-state machine (staged/saved fields, `dirty`, `save`,
	// `discard`, and the derived roster view) lives in `controller.ts`, not in
	// React. It is the one layer a user depends on and the one a DOM test
	// cannot easily reach; pulling it out means the rules are unit-testable
	// without a browser. The JSX below reads one snapshot per render and calls
	// methods — no `useState` in the rules, only around what React must own.
	//
	// Created once, via the initializer form, so a re-render never resets it.
	const [controller] = (0, react.useState)(() => new QoderCardController<CardModelRow>({ imageOverrides: {}, maxWindow: false, enabledIds: {} }));
	// Keep the roster the fetch returned in sync with the controller, so the
	// derived `regionModels` / `visibleModels` / `regionAllTicked` are current.
	// The roster is live catalog state, never persisted, so feeding it here is
	// not a write.
	(0, react.useEffect)(() => {
		controller.setModels(models);
	}, [controller, models]);
	// Subscribe to the controller. `getSnapshot` is referentially stable until
	// a mutation, so this does not loop.
	const snap = (0, react.useSyncExternalStore)(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
	const [status, setStatus] = (0, react.useState)("loading");
	const [notice, setNotice] = react.useState<string | undefined>(undefined);
	const [refreshing, setRefreshing] = (0, react.useState)(false);
	const [refreshedAt, setRefreshedAt] = react.useState<number | undefined>(undefined);
	// The host's own verdict about the last refresh, folded to one of
	// `null` / "transient" / "persist" / "protocol-shape-changed" by
	// refreshNoticeKey.
	// Kept apart from `notice` (which is the load-failure banner) so an
	// upstream problem never borrows the save banner's styling, and from
	// `status` (which is about whether the ROUTE answered at all).
	// Written explicitly because `useState(null)` infers the state as exactly
	// `null`, and the three values the comment above names are strings — the
	// inference and the documented contract disagreed, which the setter below
	// is where it surfaced.
	const [refreshFailure, setRefreshFailure] = react.useState<string | null>(null);
	// Bumped when the account panel's re-read lands; the usage panel
	// treats a non-zero value as "force a fresh quota pull".
	const [usageBump, setUsageBump] = (0, react.useState)(0);
	// The model id whose row should flash, set by the last in-place edit
	// (checkbox tick or image-mode pick). A timeout clears it, so the CSS
	// animation plays once and the row settles back.
	// The id of the row to flash, or `undefined` when nothing is flashing.
	// Written explicitly because `useState(undefined)` infers `S = undefined`,
	// so the setter would only accept `undefined` — and both callers below set
	// it to a model id (see the `setPulse(modelId)` in `setMode` / `toggle`).
	const [pulse, setPulse] = react.useState<string | undefined>(undefined);
	// A ticking clock, so the off-peak rate and its countdown flip on their
	// own at the window boundary instead of waiting for a manual refresh.
	// The tick only runs when at least one model carries a usable
	// off-peak window (`promotion.active === true`); with no active
	// window the rate and countdown are static and a per-second
	// re-render would cost nothing but gain nothing either.
	const [clock, setClock] = (0, react.useState)(() => new Date());
	const mounted = (0, react.useRef)(true);
	(0, react.useEffect)(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	// Clear the row flash after one animation cycle; a new pulse id re-arms
	// this timer because the effect re-runs on every id change.
	(0, react.useEffect)(() => {
		if (pulse === undefined) return undefined;
		const timer = window.setTimeout(() => setPulse(undefined), 1300);
		return () => window.clearTimeout(timer);
	}, [pulse]);
	(0, react.useEffect)(() => {
		// Tick only when a promotion window is active on at least one
		// model; otherwise the clock is inert and re-rendering every
		// second just churns the model list for no visible change.
		const hasActiveWindow = models.some((m) => m.promotion?.active === true);
		if (!hasActiveWindow) return undefined;
		const timer = window.setInterval(() => {
			if (mounted.current) setClock(new Date());
		}, 1000);
		return () => {
			window.clearInterval(timer);
		};
	}, [models]);
	/**
	 * Read the model roster from the host route.
	 *
	 * The card reads its rows from the host rather than the settings
	 * document: the roster and the rates are live catalog state, not
	 * configuration, so they are never persisted.
	 *
	 * `refresh` asks the host to re-read the catalog from upstream, which is
	 * how a newly published model or a changed multiplier reaches the
	 * picker without restarting DSH. The settings fields are only seeded on
	 * the first load: a refresh must not clobber edits the user has staged
	 * but not yet saved.
	 */
	const load = (0, react.useCallback)(async (refresh, signal?: AbortSignal) => {
		if (refresh) setRefreshing(true);
		try {
			const response = await fetch(`${QODER_MODELS_PATH}${refresh ? "?refresh=1" : ""}`, {
				headers: { accept: "application/json" },
				credentials: "same-origin",
				signal
			});
			const value = await response.json().catch((): undefined => void 0);
			if (!response.ok || value === void 0) throw new Error(`HTTP ${response.status}`);
			if (!mounted.current) return;
			setModels(Array.isArray(value.models) ? value.models : []);
			if (!refresh) controller.seedSaved(initialEditableState(value));
			// The host sends when the rows were FETCHED, not when this response
			// was rendered. The old `else Date.now()` fallback was the browser
			// half of issue 05: a route that answered while every refresh was
			// failing still stamped a brand-new time, so the card claimed a
			// successful update it had no evidence for. Without a number there is
			// nothing honest to show, so nothing is shown.
			setRefreshedAt(typeof value.refreshedAt === "number" ? value.refreshedAt : undefined);
			setRefreshFailure(refreshNoticeKey(value));
			setStatus("ready");
		} catch (error) {
			if (!mounted.current || signal?.aborted === true) return;
			setStatus("error");
			setNotice(error instanceof Error ? error.message : String(error));
		} finally {
			if (mounted.current) setRefreshing(false);
		}
	}, []);
	(0, react.useEffect)(() => {
		const controller = new AbortController();
		void load(false, controller.signal);
		return () => {
			controller.abort();
		};
	}, [load]);
	// The account panel's "the sign-ins just changed" callback: re-read
	// the catalog so the picker offers what the host now routes, and
	// bump the usage panel into a fresh quota pull.
	const reconcile = (0, react.useCallback)(() => {
		void load(true);
		setUsageBump((n) => n + 1);
	}, [load]);
	// An in-place edit and the row flash that acknowledges it. The flash is a
	// rendering concern (a one-shot CSS animation), so it stays here; the edit
	// itself is a controller mutation.
	const setMode = (0, react.useCallback)((modelId: string, mode: string) => {
		controller.setMode(modelId, mode);
		setPulse(modelId);
	}, [controller]);
	/**
	 * Tick or untick one model for the picker.
	 *
	 * Ticking is recorded against the region's **full** roster, not against
	 * whatever happens to be ticked now, so the saved list is a complete
	 * allow-list rather than a diff. That is what lets a partially curated
	 * region stay curated when the catalog later grows.
	 */
	const toggleModel = (0, react.useCallback)((regionId: string, modelId: string) => {
		controller.toggleModel(regionId, modelId);
		setPulse(modelId);
	}, [controller]);
	/**
	 * Bulk-set the ACTIVE region's roster to one of two extremes.
	 *
	 * `[]` is the host's "no filter" state — every model in the region
	 * shows, so this is the card's "show all". `[HIDE_ALL_MODELS]`
	 * matches no real model id, so `filterByEnabled` returns `[]`
	 * (nothing shown) — a true "hide all" / "deselect all" without
	 * changing that convention. Only the active region's entry is
	 * touched; the sibling region's allow-list is preserved, exactly
	 * like a per-model tick.
	 */
	const setRegionAll = (0, react.useCallback)((regionId: string, allOn: boolean) => {
		controller.setRegionAll(regionId, allOn);
	}, [controller]);
	/**
	 * Persist the card's three settings fields.
	 *
	 * The controller writes through `persistViaScope`, which verifies each write
	 * (read-back against what was posted) and merges the per-region allow-list,
	 * so a save either lands or raises — the "已保存" banner only appears for
	 * values that actually persisted. The banner text is derived from the
	 * controller's `lastSave` in the JSX, not set here.
	 */
	const save = (0, react.useCallback)(() => {
		if (settingsScope === undefined) return Promise.resolve();
		return controller.save(persistViaScope(settingsScope));
	}, [controller, settingsScope]);
	const discard = (0, react.useCallback)(() => {
		controller.discard();
	}, [controller]);
	// View-only setters. The name filter narrows the VIEW, never the saved
	// document, and the selected region is a rendering concern too — so both
	// are controller state but neither feeds `dirty` or `save()`.
	const setQuery = (0, react.useCallback)((value: string) => {
		controller.setQuery(value);
	}, [controller]);
	const setActiveRegion = (0, react.useCallback)((regionId: string) => {
		controller.setActiveRegion(regionId);
	}, [controller]);
	const setMaxWindow = (0, react.useCallback)((on: boolean) => {
		controller.setMaxWindow(on);
	}, [controller]);
	// The derived roster view (the active region's models, the filtered
	// subset, the ticked counter) is computed by the controller, not here.
	// `snap` below is the one object the JSX reads.
	const regionModels = snap.regionModels;
	const regionAllTicked = snap.regionAllTicked;
	const visibleModels = snap.visibleModels;
	const visibleTicked = snap.visibleTicked;
	const dirty = snap.dirty;
	const saving = snap.saving;
	const query = snap.query;
	const imageOverrides = snap.imageOverrides;
	const maxWindow = snap.maxWindow;
	const enabledIds = snap.enabledIds;
	const activeRegion = snap.activeRegion;
	return (
		<li
			className={`dsm-plugin-card${open ? " dsm-plugin-card-open" : ""}`}
			// Escape leaves the card in two steps: inside the search box it first
			// clears the filter (the natural "get me out of this search" gesture);
			// with the filter already clear it collapses the card from anywhere
			// inside it, so a user lost in a long roster has one keystroke out.
			onKeyDown={(event: { key?: string }) => {
				if (event.key !== "Escape" || !open) return;
				if (query !== "") {
					setQuery("");
					return;
				}
				setOpen(false);
			}}
		>
			<button
				type="button"
				className="dsm-plugin-card-header"
				aria-expanded={open}
				aria-label={`${t(open ? "row.collapse" : "row.expand")}: ${t("row.title")}`}
				onClick={() => {
					setOpen(!open);
				}}
			>
				<span className="dsm-plugin-card-head">
					<span className="dsm-plugin-card-title">{t("row.title")}</span>
					<span className="dsm-plugin-card-description">{t("row.desc")}</span>
				</span>
				{/* Empty span: the caret is drawn by the ::before rule copied
				    from WorkBuddy. A text glyph here too would render a second
				    arrow beside the CSS one. */}
				<span
					aria-hidden="true"
					className={`dsm-plugin-card-chevron${open ? " dsm-plugin-card-chevron-open" : ""}`}
				/>
			</button>
			<div className="dsm-plugin-card-body" hidden={!open}>
				{open ? (
					<div className="dsm-qoder-body">
						<QoderAccountPanel
							t={t}
							onReconciled={reconcile}
							settingsScope={settingsScope}
							activeRegion={activeRegion}
							onRegionChange={setActiveRegion}
						/>
						<QoderUsagePanel t={t} refreshToken={usageBump} activeRegion={activeRegion} />
						{status === "loading" ? (
							<div className="dsm-qoder-skeleton" aria-busy="true">
								<p className="dsm-qoder-state">{t("row.loading")}</p>
								<div className="dsm-qoder-skeleton-row" />
								<div className="dsm-qoder-skeleton-row" />
								<div className="dsm-qoder-skeleton-row" />
							</div>
						) : null}
						{status === "error" ? (
							<div className="dsm-qoder-tools">
								<p className="dsm-qoder-error">{`${t("row.requestFailed")}: ${notice ?? ""}`}</p>
								<button
									type="button"
									className="dsm-qoder-button"
									disabled={refreshing}
									// The retry sits ON the error, not behind the toolbar
									// button elsewhere on the page: recovery should be one
									// click from where the failure is being read. `load(true)`
									// also re-pulls the catalog, which is the failure mode
									// users actually hit (an upstream blip left a stale list).
									onClick={() => {
										void load(true);
									}}
								>
									{refreshing ? t("row.refreshing") : t("row.retry")}
								</button>
							</div>
						) : null}
						{status === "ready" && models.length === 0 ? (
							<p className="dsm-qoder-state">{t("row.signedOut")}</p>
						) : null}
						{/* The active region has no models of its own while the other
						    one does: it is either not signed in or its "models" switch
						    is off. The strip above shows which. */}
						{status === "ready" && models.length > 0 && regionModels.length === 0 ? (
							<p className="dsm-qoder-state">{t("row.regionEmpty")}</p>
						) : null}
						{/* The high-frequency filter stays above the roster: a name
						    search plus the count that matches the rows on screen.
						    Maintenance actions and the rate rules read as footnotes
						    below the list instead of competing with filtering for the
						    top of the card. */}
						{models.length > 0 ? (
							<div className="dsm-qoder-tools">
								<input
									type="search"
									className="dsm-qoder-search"
									value={query}
									placeholder={t("row.searchPlaceholder")}
									aria-label={t("row.search")}
									onChange={(event: ValueEvent) => setQuery(event.target.value)}
								/>
								<span className="dsm-qoder-count" aria-live="polite">
									{t("row.filterCount", {
										visible: visibleModels.length,
										total: regionModels.length,
										ticked: visibleTicked,
									})}
								</span>
							</div>
						) : null}
						{/* An empty result after filtering is distinct from a
						    roster-less region: this one has models, the name filter
						    just matched nothing, so it gets its own message plus a
						    one-click way back. */}
						{regionModels.length > 0 && visibleModels.length === 0 ? (
							<div className="dsm-qoder-tools">
								<p className="dsm-qoder-state">{t("row.searchEmpty")}</p>
								<button
									type="button"
									className="dsm-qoder-button"
									onClick={() => setQuery("")}
								>
									{t("row.clearFilter")}
								</button>
							</div>
						) : null}
						{visibleModels.length > 0 ? (
							<ul className="dsm-qoder-models">
								{visibleModels.map((model) => {
									// Same reasoning as `visibleTicked` above: an
									// unaddressable row must not read as ticked.
									const active =
										model.region !== undefined &&
										enabledIdsFor(models, enabledIds[model.region]).has(model.id);
									// The rate is resolved against the ticking clock, not
									// the server's snapshot, so it flips at the window
									// boundary.
									const offPeak = offPeakState(model, clock);
									const rate = rateLabelOf(t, rateAt(model, clock));
									const offPeakTitle =
										model.promotion === undefined
											? t("row.rateLabel")
											: offPeak?.active === true
												? `${t("row.offPeakOn")} · ${formatCountdown(offPeak.remainingSeconds)}`
												: t("row.offPeakOff");
									return (
										<li
											key={`${model.region}:${model.id}`}
											className={`dsm-qoder-row${active ? "" : " dsm-qoder-row-off"}${
												pulse === model.id ? " dsm-qoder-row-pulse" : ""
											}`}
										>
											<span className="dsm-qoder-row-main">
												<label className="dsm-qoder-pick" title={t("row.showInPicker")}>
													<input
														type="checkbox"
														checked={active}
														// A row with no region cannot be toggled:
														// `toggleModel` records the tick against that
														// region's roster, and there is no roster to
														// record it against. Disabled rather than
														// silently doing nothing, so the control
														// matches its behaviour.
														disabled={saving || model.region === undefined}
														aria-label={`${t("row.showInPicker")}: ${model.name ?? model.id}`}
														onChange={() => {
															if (model.region === undefined) return;
															toggleModel(model.region, model.id);
														}}
													/>
												</label>
												<span className="dsm-qoder-name" title={model.id}>
													{model.name ?? model.id}
												</span>
												{rate !== undefined ? (
													<span
														className={`dsm-qoder-rate${
															Number(rateAt(model, clock)) <= 0 ? " dsm-qoder-rate-free" : ""
														}`}
														title={offPeakTitle}
													>
														{rate}
													</span>
												) : null}
												{windowLabelOf(model, maxWindow) ? (
													<span
														className="dsm-qoder-badge"
														title={
															model.contextOptions?.length
																? `${t("row.maxWindow")}: ${model.contextOptions
																		.map(formatContextWindowForUi)
																		.join(" / ")}`
																: t("row.maxWindowNote")
														}
													>
														{windowLabelOf(model, maxWindow)}
													</span>
												) : null}
												{offPeak !== undefined ? (
													<span
														className={`dsm-qoder-badge${
															offPeak.active ? " dsm-qoder-badge-offer" : ""
														}`}
														title={model.promotion?.description ?? ""}
													>
														{`${offPeak.active ? t("row.offPeakOn") : t("row.offPeakOff")} ${formatCountdown(
															offPeak.remainingSeconds,
														)}`}
													</span>
												) : null}
												<span className="dsm-qoder-badge">
													{model.isVL === true ? t("row.vision") : t("row.textOnly")}
												</span>
											</span>
											<label className="dsm-qoder-switch">
												<span>{t("row.imageTitle")}</span>
												<select
													className="dsm-qoder-select"
													value={imageModeOf(imageOverrides, model.id)}
													disabled={saving}
													aria-label={`${t("row.imageTitle")}: ${model.name ?? model.id}`}
													onChange={(event: unknown) => {
														setMode(model.id, (event as ValueEvent).target.value);
													}}
												>
													{IMAGE_MODES.map((mode) => (
														<option key={mode} value={mode}>
															{t(mode === "auto" ? "row.imageAuto" : mode === "on" ? "row.imageOn" : "row.imageOff")}
														</option>
													))}
												</select>
											</label>
										</li>
									);
								})}
							</ul>
						) : null}
						{/* Rate-rule and image-mode footnotes sit below the roster:
						    the off-peak window belongs to the rates shown on the rows
						    above, and the image hint explains the per-model selects on
						    those same rows. */}
						{regionModels.some((model) => model.promotion !== undefined) ? (
							<p className="dsm-qoder-hint">
								{t("row.offPeakHint", {
									window: `${regionModels.find((model) => model.promotion !== undefined)?.promotion?.windowStart}–${
										regionModels.find((model) => model.promotion !== undefined)?.promotion?.windowEnd
									}`,
									zone:
										typeof regionModels.find((model) => model.promotion !== undefined)?.promotion?.timezone ===
										"string"
											? (regionModels.find((model) => model.promotion !== undefined)?.promotion?.timezone as string)
											: "Asia/Shanghai",
								})}
							</p>
						) : null}
						<label className="dsm-qoder-switch" title={t("row.maxWindowTitle")}>
							<input
								type="checkbox"
								checked={maxWindow}
								disabled={saving}
								aria-label={t("row.maxWindow")}
								onChange={(event: unknown) => {
									setMaxWindow((event as CheckboxEvent).target.checked);
									setNotice(undefined);
								}}
							/>
							<span>{t("row.maxWindow")}</span>
						</label>
						<p className="dsm-qoder-hint">{t("row.imageHint")}</p>
						{/* Maintenance actions drop below the settings block:
						    re-pulling the catalog and bulk-ticking the roster are
						    low-frequency upkeep, not part of the filter-first reading
						    order above. */}
						<div className="dsm-qoder-actions">
							<button
								type="button"
								className="dsm-qoder-button"
								disabled={refreshing}
								onClick={() => {
									void load(true);
								}}
							>
								{refreshing ? t("row.refreshing") : t("row.refreshModels")}
							</button>
							<button
								type="button"
								className="dsm-qoder-button"
								disabled={saving}
								title={t("row.showHint")}
								onClick={() => {
									// One bulk button for the ACTIVE region's roster,
									// like the official picker's select-all/deselect-all
									// toggle: when every model is ticked it flips to "hide
									// all" (HIDE_ALL_MODELS, a list matching no model);
									// otherwise it flips to "show all" ([] = no filter).
									// A fresh card (no saved allow-list) is all ticked, so
									// the label reads "hide all" on first open.
									setRegionAll(activeRegion, regionAllTicked);
								}}
							>
								{regionAllTicked ? t("row.disableAll") : t("row.enableAll")}
							</button>
							{refreshedAt !== undefined && !refreshing ? (
								<span className="dsm-qoder-state">
									{/* Four shapes, one slot. A protocol change replaces
									    the timestamp entirely rather than decorating it:
									    the time of a last successful fetch is not useful
									    next to "your plugin is out of date", and offering a
									    time there invites the user to believe the rows are
									    current. A persist failure does the same — the rows
									    are real, but a "已更新（time）" stamp would hide that
									    they will not survive a restart. */}
									{refreshFailure === "protocol-shape-changed"
										? t("row.protocolChanged")
										: refreshFailure === "persist"
											? t("row.refreshNotPersisted")
											: t(
													refreshFailure === "transient" ? "row.refreshStale" : "row.refreshed",
													{ time: new Date(refreshedAt).toLocaleTimeString() },
												)}
								</span>
							) : refreshFailure !== null && !refreshing ? (
								<span
									className="dsm-qoder-state"
									// No fetch has ever succeeded for this profile, so there
									// is no time to show — but the failure is still true and
									// still needs to be visible. This is the state a fresh
									// install with a broken protocol lands in, so swallowing
									// it here would restore the original "everything looks
									// fine" reading for exactly the case that matters.
									title={
										refreshFailure === "protocol-shape-changed" || refreshFailure === "persist"
											? undefined
											: t("row.refreshFailed", { reason: refreshFailure })
									}
								>
									{refreshFailure === "protocol-shape-changed"
										? t("row.protocolChanged")
										: t("row.refreshFailed", { reason: refreshFailure })}
								</span>
							) : null}
						</div>
						<div className="dsm-qoder-actions">
							<button
								type="button"
								className="dsm-qoder-button"
								disabled={saving || !dirty || settingsScope === undefined}
								onClick={save}
							>
								{saving ? t("row.saving") : t("row.save")}
							</button>
							<button
								type="button"
								className="dsm-qoder-button"
								disabled={saving || !dirty}
								onClick={discard}
							>
								{t("row.discard")}
							</button>
							{snap.lastSave !== undefined ? (
								<span className="dsm-qoder-state">
									{/* A save just completed (success banner or failure
									    reason), as decided by the controller. The failure
									    banner is the one that has to be visible: it is the
									    card's only proof that the value did not persist, so
									    it outranks the generic "unsaved" marker while it is
									    up. A load failure is a different banner (it lives in
									    `notice`, on the error panel) — a failed fetch must
									    not overwrite "已保存" here. */}
									{snap.lastSave.ok === true
										? t("row.saved")
										: `${t("row.failed")}: ${snap.lastSave.reason}`}
								</span>
							) : dirty ? (
								<span className="dsm-qoder-state">{t("row.unsaved")}</span>
							) : null}
						</div>
					</div>
				) : null}
			</div>
		</li>
	);
}
