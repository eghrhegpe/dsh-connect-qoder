
import * as react from "react"
import { QODER_MODELS_PATH } from "./paths.ts"
import type { SettingsScope } from "./settings-write.ts"
// The two fetch-bearing containers. Split out of this file so the card-assembly
// module stays a thin wiring layer (the sensenova `panel-page.ts` shape): each
// container owns its own network + effects, and only the model list stays here
// because its editable state already lives in `controller.ts`.
import { QoderUsagePanel } from "./usage-panel.tsx"
import { QoderAccountPanel } from "./account-panel.tsx"
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
	describeThrown,
} from "./card-model.ts"
import { getJson } from "./http.ts"


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
				{/* Two figures, two weights. "266 / 1300 (21%)" is bookkeeping and
				    drops to the secondary label; "剩余 1034 Credits" is the answer
				    the bar exists for, so it keeps the primary label at a larger
				    size. The count itself is wrapped rather than concatenated into
				    one string so the number can be sized independently of its
				    "剩余" prefix and its unit suffix. */}
				<span className="dsm-qoder-usage-remain">
					{`${t("usage.remaining")} `}
					<strong>{known ? remaining : "—"}</strong>
					{unit ? ` ${unit}` : ""}
				</span>
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
export function CheckinCard({ t, checkin, busy, notice, onClaim }: CheckinCardProps) {
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
	/**
	 * Whether the campaign list is expanded. Owned by the usage panel, not
	 * here: this component is deliberately hook-free so it can be rendered
	 * without a tree. Absent means "collapse", so a caller that knows nothing
	 * about campaigns still gets the quiet default.
	 */
	campaignsOpen?: boolean
	onCampaignsToggle?: EventHandler
}

/**
 * One region's usage block, as returned by the host usage route.
 *
 * Holds only the quota bars and the promotional lines. The daily check-in is
 * NOT part of this block: it is rendered by {@link QoderUsagePanel} as a card
 * beside the whole panel, because a check-in row inside this stack spent a
 * full-width line on two short strings.
 */
export function RegionUsage({ t, entry, campaignsOpen, onCampaignsToggle }: RegionUsageProps) {
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
			{/* One campaign is a footnote and prints in full. Several used to
			    stack as same-weight lines each carrying an identical badge,
			    until the promo block was taller than the quota it sits under
			    — marketing must not outrank the number the user came for.
			    More than one collapses behind a count. The badge itself
			    carries no information of its own — it is the same string on
			    every line — so it prints once, on the first campaign. */}
			{campaigns.length > 1 && campaignsOpen !== true ? (
				<button
					type="button"
					className="dsm-qoder-button dsm-qoder-disclosure"
					aria-expanded={false}
					onClick={onCampaignsToggle}
				>
					{t("usage.promoCount", { count: campaigns.length })}
				</button>
			) : (
				<react.Fragment>
					{campaigns.map((camp, index) => (
						<p className="dsm-qoder-usage-promo" key={`camp:${camp.key}`}>
							{index === 0 ? (
								<span className="dsm-qoder-usage-badge dsm-qoder-usage-badge-offer">
									{t("usage.promotion")}
								</span>
							) : null}
							{index === 0 ? " " : null}
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
					{campaigns.length > 1 ? (
						<button
							type="button"
							className="dsm-qoder-button dsm-qoder-disclosure"
							aria-expanded
							onClick={onCampaignsToggle}
						>
							{t("usage.promoCollapse")}
						</button>
					) : null}
				</react.Fragment>
			)}
		</div>
	);
}


/**
 * Whether the card starts expanded. Defaults to collapsed (the body is
 * `hidden`, not unmounted, so staged edits and a ticking countdown survive a
 * cycle); a host slot that passes `view="page"` opens it.
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

export function QoderPluginCard({ t, settingsScope, view }: QoderPluginCardProps) {
	if (t === void 0) throw new Error("Qoder settings card requires its translation function");
	const [open, setOpen] = react.useState(() => initialOpenForView(view));
	const [models, setModels] = react.useState<CardModelRow[]>([]);
	// The editable-state machine (staged/saved fields, `dirty`, `save`,
	// `discard`, and the derived roster view) lives in `controller.ts`, not in
	// React. It is the one layer a user depends on and the one a DOM test
	// cannot easily reach; pulling it out means the rules are unit-testable
	// without a browser. The JSX below reads one snapshot per render and calls
	// methods — no `useState` in the rules, only around what React must own.
	//
	// Created once, via the initializer form, so a re-render never resets it.
	const [controller] = react.useState(() => new QoderCardController<CardModelRow>({ imageOverrides: {}, maxWindow: false, enabledIds: {} }));
	// Keep the roster the fetch returned in sync with the controller, so the
	// derived `regionModels` / `visibleModels` / `regionAllTicked` are current.
	// The roster is live catalog state, never persisted, so feeding it here is
	// not a write.
	react.useEffect(() => {
		controller.setModels(models);
	}, [controller, models]);
	// Subscribe to the controller. `getSnapshot` is referentially stable until
	// a mutation, so this does not loop.
	const snap = react.useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
	const [status, setStatus] = react.useState("loading");
	const [notice, setNotice] = react.useState<string | undefined>(undefined);
	const [refreshing, setRefreshing] = react.useState(false);
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
	const [usageBump, setUsageBump] = react.useState(0);
	// The model id whose row should flash, set by the last in-place edit
	// (checkbox tick or image-mode pick). A timeout clears it, so the CSS
	// animation plays once and the row settles back.
	// The id of the row to flash, or `undefined` when nothing is flashing.
	// Written explicitly because `useState(undefined)` infers `S = undefined`,
	// so the setter would only accept `undefined` — and both callers below set
	// it to a model id (see the `setPulse(modelId)` in `setMode` / `toggle`).
	const [pulse, setPulse] = react.useState<string | undefined>(undefined);
	// Whether the per-row image-input selects are shown at all. Pure VIEW state
	// — unlike `maxWindow` it is never written to the settings document and
	// never dirties the card, so it lives here rather than in the controller.
	// Default off: with it on, fourteen rows each print "跟随目录", a value
	// that means "nothing was set", and that column becomes the loudest thing
	// on the card. A model carrying a real override still shows its select
	// (see `imageTuningActive` below) — hiding a value the user set would be
	// worse than the noise it removes.
	const [imageTuning, setImageTuning] = react.useState(false);
	// A ticking clock, so the off-peak rate and its countdown flip on their
	// own at the window boundary instead of waiting for a manual refresh.
	// The tick only runs when at least one model carries a usable
	// off-peak window (`promotion.active === true`); with no active
	// window the rate and countdown are static and a per-second
	// re-render would cost nothing but gain nothing either.
	const [clock, setClock] = react.useState(() => new Date());
	const mounted = react.useRef(true);
	react.useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	// Clear the row flash after one animation cycle; a new pulse id re-arms
	// this timer because the effect re-runs on every id change.
	react.useEffect(() => {
		if (pulse === undefined) return undefined;
		const timer = window.setTimeout(() => setPulse(undefined), 1300);
		return () => window.clearTimeout(timer);
	}, [pulse]);
	react.useEffect(() => {
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
	const load = react.useCallback(async (refresh: boolean, signal?: AbortSignal) => {
		if (refresh) setRefreshing(true);
		try {
			// The model read goes through the card's only fetch surface, the
			// same `getJson` the two panels use: the "one place" contract
			// includes this roster pull, not just the account / usage reads.
			// An unparseable or non-OK answer throws (the roster has no
			// "no data" state to fall back to), which lands in the catch
			// below as a visible failure, never a silent empty list.
			const value = await getJson<{ models?: unknown; refreshedAt?: unknown }>(
				`${QODER_MODELS_PATH}${refresh ? "?refresh=1" : ""}`,
				{ signal },
			);
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
			// A bare-object rejection or a thrown `undefined` would otherwise
			// reach the banner as "[object Object]" / "undefined".
			setNotice(describeThrown(error));
		} finally {
			if (mounted.current) setRefreshing(false);
		}
	}, []);
	react.useEffect(() => {
		const controller = new AbortController();
		void load(false, controller.signal);
		return () => {
			controller.abort();
		};
	}, [load]);
	// The account panel's "the sign-ins just changed" callback: re-read
	// the catalog so the picker offers what the host now routes, and
	// bump the usage panel into a fresh quota pull.
	const reconcile = react.useCallback(() => {
		void load(true);
		setUsageBump((n) => n + 1);
	}, [load]);
	// An in-place edit and the row flash that acknowledges it. The flash is a
	// rendering concern (a one-shot CSS animation), so it stays here; the edit
	// itself is a controller mutation.
	const setMode = react.useCallback((modelId: string, mode: string) => {
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
	const toggleModel = react.useCallback((regionId: string, modelId: string) => {
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
	const setRegionAll = react.useCallback((regionId: string, allOn: boolean) => {
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
	const save = react.useCallback(() => {
		if (settingsScope === undefined) return Promise.resolve();
		return controller.save(persistViaScope(settingsScope));
	}, [controller, settingsScope]);
	const discard = react.useCallback(() => {
		controller.discard();
	}, [controller]);
	// View-only setters. The name filter narrows the VIEW, never the saved
	// document, and the selected region is a rendering concern too — so both
	// are controller state but neither feeds `dirty` or `save()`.
	const setQuery = react.useCallback((value: string) => {
		controller.setQuery(value);
	}, [controller]);
	const setActiveRegion = react.useCallback((regionId: string) => {
		controller.setActiveRegion(regionId);
	}, [controller]);
	const setMaxWindow = react.useCallback((on: boolean) => {
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
	// One row's image select is shown when the user asked for the tuning
	// column, or when that model already carries a non-default override — an
	// override is data the user set, and a view switch must not be able to
	// hide it. Read through `imageModeOf` rather than the raw map so "no key"
	// and "an unrecognised value" both resolve to the same default.
	const imageTuningActive =
		imageTuning || visibleModels.some((model) => imageModeOf(imageOverrides, model.id) !== "auto");
	// The off-peak footnote below the roster reads the promotion block of the
	// first model that carries one (the window its discount hours imply), rather
	// than re-running the `find` four times at the render site. The predicate
	// rejects BOTH `undefined` and `null`: a row's `promotion` is typed
	// `CardPromotion | null | undefined`, and a `null` block is as unusable as
	// an absent one — the old `!== undefined` gate let a `null` promotion
	// through and printed "undefined–undefined" into the window slot. The JSX
	// test below is `!= null` (loose) for the same reason: the `find`
	// predicate's narrowing does not flow into the `.promotion` type, so the
	// read site has to exclude both absent and `null` itself.
	const offPeakWindow = regionModels.find((model) => model.promotion !== undefined && model.promotion !== null)?.promotion;
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
								})}
								{" · "}
								<strong>{t("row.filterTicked", { ticked: visibleTicked })}</strong>
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
						{/* The two roster-level controls that are not per-model: the
						    context-window display and the image-input tuning switch.
						    They sit ABOVE the roster, not below it, for a hard
						    reason: "按最大上下文显示" is persisted state — it dirties
						    the card (`controller.ts`: `staged.maxWindow !==
						    saved.maxWindow`) — and the commit controls are now the
						    roster's own footer. A setting that "保存" would carry
						    must sit above the row that saves it. */}
						<div className="dsm-qoder-switches">
							<label className="dsm-qoder-switch" title={t("row.maxWindowTitle")}>
								<input
									type="checkbox"
									checked={maxWindow}
									disabled={saving}
									aria-label={t("row.maxWindow")}
									onChange={(event: unknown) => {
										setMaxWindow((event as CheckboxEvent).target.checked);
										if (status !== "error") setNotice(undefined); // 只在非 error 态清：error 态下 notice 是失败唯一详情，清了冒号后就剩空白
									}}
								/>
								<span>{t("row.maxWindow")}</span>
							</label>
							{/* A VIEW switch, not a setting: it reveals the per-row
							    image selects and never dirties the card, which is why
							    it sits beside the window switch but is not disabled
							    while a save is in flight — toggling the view during a
							    save cannot conflict with what is being written. */}
							<label className="dsm-qoder-switch" title={t("row.imageTuningTitle")}>
								<input
									type="checkbox"
									checked={imageTuning}
									aria-label={t("row.imageTuning")}
									onChange={(event: unknown) => {
										setImageTuning((event as CheckboxEvent).target.checked);
									}}
								/>
								<span>{t("row.imageTuning")}</span>
							</label>
						</div>
						{/* The image hint explains the per-row selects, so it is
						    only worth a line when those selects are actually on
						    screen. With the tuning column collapsed the card keeps
						    the two-line explanation it did not need. */}
						{imageTuningActive ? <p className="dsm-qoder-hint">{t("row.imageHint")}</p> : null}
						{/* Roster and its commit bar, in one scroll box owned by this
						    card (see `.dsm-qoder-roster` in styles.ts). The list used
						    to scroll on its own with the save row outside it, which
						    handed the row's sticky positioning to the host page. */}
						<div className="dsm-qoder-roster">
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
											// The badge names the WINDOW BOUNDARY, not a per-second countdown.
											// A ticking HH:MM:SS beside the multiplier reset this row's visual
											// anchor sixty times a minute to restate a fact nobody acts on
											// second by second — and it was the only thing on the card that
											// moved, so the eye kept going back to it. "至 08:00" answers the
											// same question (how long the cheap rate lasts) without the churn.
											// The exact countdown is unchanged; it moved to the tooltip, where
											// a user who wants it can still read it.
											const boundary =
												model.promotion == null
													? undefined
													: offPeak?.active === true
														? model.promotion.windowEnd
														: model.promotion.windowStart;
											const offPeakBadge =
												offPeak === undefined
													? ""
													: boundary === undefined
														? t(offPeak.active ? "row.offPeakOn" : "row.offPeakOff")
														: `${t(offPeak.active ? "row.offPeakOn" : "row.offPeakOff")} ${t(
																offPeak.active ? "row.offPeakEnd" : "row.offPeakStart",
																{ time: boundary },
															)}`;
											// Static facts about the model, as flat muted text: the context
											// window and whether it takes images. As pills they competed with
											// the rate — four same-sized chips with two colours between them,
											// so "1M" and "视觉" read as loudly as "x0.20". They are
											// attributes, not status, so they get the quiet label and no
											// border. `windowLabelOf` is read once rather than twice: it is
											// the same argument either way, and the old spelling called it in
											// the condition and again in the body.
											const windowLabel = windowLabelOf(model, maxWindow);
											const metaParts: string[] = [];
											if (windowLabel !== "") metaParts.push(windowLabel);
											metaParts.push(model.isVL === true ? t("row.vision") : t("row.textOnly"));
										const contextTitle = model.contextOptions?.length
											? `${t("row.maxWindow")}: ${model.contextOptions.map(formatContextWindowForUi).join(" / ")}`
											: t("row.maxWindowNote");
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
												{offPeak !== undefined ? (
													<span
														className={`dsm-qoder-badge${
															offPeak.active ? " dsm-qoder-badge-offer" : ""
														}`}
														title={
															model.promotion?.description !== undefined
																? String(model.promotion.description)
																: offPeakTitle
														}
													>
														{offPeakBadge}
													</span>
												) : null}
												{metaParts.length > 0 ? (
													<span className="dsm-qoder-meta" title={contextTitle}>
														{metaParts.join(" · ")}
													</span>
												) : null}
												</span>
											{imageTuning || imageModeOf(imageOverrides, model.id) !== "auto" ? (
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
											) : null}
											</li>
										);
									})}
								</ul>
							) : null}
						{/* Commit controls: the roster's own footer. Still a real
						    flow element — a sticky element sits at its natural
						    position until the box would scroll it out of view. */}
						<div className="dsm-qoder-actions dsm-qoder-actions-save">
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
										? snap.lastSave.confirmed === false ? t("row.savedUnconfirmed") : t("row.saved")
										: `${t("row.failed")}: ${snap.lastSave.reason}`}
								</span>
							) : dirty ? (
								<span className="dsm-qoder-state">{t("row.unsaved")}</span>
							) : null}
						</div>
						</div>
						{/* The rate rule is a footnote to the roster it describes,
						    so it reads after the box rather than inside it. */}
						{offPeakWindow != null ? (
							<p className="dsm-qoder-hint">
								{t("row.offPeakHint", {
									window: `${offPeakWindow.windowStart}–${offPeakWindow.windowEnd}`,
									zone:
										typeof offPeakWindow.timezone === "string"
											? offPeakWindow.timezone
											: "Asia/Shanghai",
								})}
							</p>
						) : null}
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
					</div>
				) : null}
			</div>
		</li>
	);
}
