
import * as react from "react"
import * as react_jsx_runtime from "react/jsx-runtime"
import { QODER_MODELS_PATH, QODER_USAGE_PATH, QODER_ACCOUNT_PATH, QODER_ACCOUNT_RELOAD_PATH, QODER_ACCOUNT_CONFIRM_PATH, QODER_CHECKIN_PATH } from "./paths"
import { writeSettingsField } from "./settings-write"
/** The three per-model image choices this card writes. */
const IMAGE_MODES = ["auto", "on", "off"];

/**
 * Sentinel stored in a region's allow-list to mean "hide every model".
 *
 * The host convention is `[] = no filter = show all` (a fresh install
 * must still see every model), so "hide all" has no value of its own in
 * that scheme. A non-empty list that matches no real model id collapses
 * to "show nothing" in `filterByEnabled` (the allow-list branch keeps
 * the ids, matches none, returns `[]`), so a marker that no model id can
 * ever equal expresses "hide all" without touching that convention.
 * Unticking any one model drops the marker (it is not in the region's
 * roster) and the list becomes a plain allow-list again.
 */
const HIDE_ALL_MODELS = "__hide-all__";

/** Normalise whatever the saved map holds into one of {@link IMAGE_MODES}. */
function imageModeOf(overrides, modelId) {
	const saved = overrides === null || typeof overrides !== "object" ? undefined : overrides[modelId];
	return IMAGE_MODES.includes(saved) ? saved : "auto";
}

/** Fill a `{date}` placeholder in a translated string. */
function withDate(template, at) {
	if (typeof at !== "number" || !Number.isFinite(at) || at <= 0) return "";
	const date = new Date(at).toLocaleDateString(undefined, { year: "numeric", month: "numeric", day: "numeric" });
	return template.replace("{date}", date);
}

/**
 * The credit multiplier as a short label.
 *
 * A zero multiplier is a free model, which is worth naming rather than
 * rendering as "x0.00"; a model whose catalog entry carries no multiplier
 * shows nothing at all. This mirrors how the host decorates the picker
 * name, so the card and the picker never disagree.
 */
function rateLabelOf(t, factor) {
	const value = Number(factor);
	if (!Number.isFinite(value)) return undefined;
	return value <= 0 ? t("row.rateFree") : `x${value.toFixed(2)}`;
}

/** Seconds past local midnight in `timezone`, or undefined when unusable. */
function localSecondsOf(date, timezone) {
	try {
		const parts = new Intl.DateTimeFormat("en-US", {
			timeZone: timezone,
			hour12: false,
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit"
		}).formatToParts(date);
		const read = (type) => Number(parts.find((part) => part.type === type)?.value ?? Number.NaN);
		const hour = read("hour") % 24;
		const minute = read("minute");
		const second = read("second");
		if (![hour, minute, second].every(Number.isFinite)) return undefined;
		return hour * 3600 + minute * 60 + second;
	} catch {
		return undefined;
	}
}

/** Parse `HH:MM` into seconds past midnight, or undefined. */
function parseClock(text) {
	const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(text ?? "").trim());
	if (match === null) return undefined;
	const hour = Number(match[1]);
	const minute = Number(match[2]);
	const second = Number(match[3] ?? 0);
	if (hour > 23 || minute > 59 || second > 59) return undefined;
	return hour * 3600 + minute * 60 + second;
}

/**
 * The off-peak window state for one model at a given instant.
 *
 * The window is evaluated in the browser rather than taken from the
 * server's answer so the card can flip the rate and tick the countdown on
 * its own — a rate that silently changed at 22:00 only after a manual
 * refresh would look broken. `end` not after `start` means the window
 * crosses midnight (`22:00`-`08:00` is the case Qoder uses), so the test
 * is a disjunction.
 *
 * The `active` gate is load-bearing and must match the host's own rule
 * (`isOffPeakActive` in lib/offpeak.js, reached here through
 * `projectModelRow`). Qoder keeps the window fields populated on a
 * promotion it has switched off, and `upstream.normalizePromotion` carries
 * `active` and `windowStart`/`windowEnd` independently, so a window alone
 * is NOT evidence that the discount is live. Without this check a model
 * whose promotion is off was rendered at the discounted rate during its
 * own hours — showing the user a price they are not charged — and the two
 * surfaces (card and picker) disagreed, because the host was correctly
 * showing the `before` rate for that same model.
 *
 * The bug needs a mixed catalog to appear: the ticking clock is installed
 * when ANY model has `active === true` (see the `hasActiveWindow` gate),
 * and from then on every row re-resolves through this function.
 *
 * SYNC CONSTRAINT: this mirrors lib/offpeak.js, which the test suite
 * guards. The card is a browser bundle built from TypeScript sources not in
 * this repository, so that rule cannot be imported here — see
 * test/KNOWN_GAPS.md item 3.
 *
 * @returns `{ active, remainingSeconds }`, or undefined when the model
 *   carries no usable window or its promotion is not active.
 */
function offPeakState(model, now) {
	const promo = model.promotion;
	if (promo === null || typeof promo !== "object") return undefined;
	if (promo.active !== true) return undefined;
	const start = parseClock(promo.windowStart);
	const end = parseClock(promo.windowEnd);
	if (start === undefined || end === undefined || start === end) return undefined;
	const seconds = localSecondsOf(now, promo.timezone ?? "Asia/Shanghai");
	if (seconds === undefined) return undefined;
	const active = start < end ? seconds >= start && seconds < end : seconds >= start || seconds < end;
	const target = active ? end : start;
	const remainingSeconds = target >= seconds ? target - seconds : 86400 - seconds + target;
	return { active, remainingSeconds };
}

/** `HH:MM:SS` from a second count, matching the Qoder client's countdown. */
function formatCountdown(seconds) {
	const total = Math.max(0, Math.floor(Number(seconds) || 0));
	const pad = (value) => String(value).padStart(2, "0");
	return [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60].map(pad).join(":");
}

/**
 * A short label for a raw context-window token count, matching the
 * catalog's own naming (`1M` / `200K` / `128K`).
 */
function formatContextWindowForUi(tokens) {
	const n = Number(tokens)
	if (!Number.isFinite(n) || n <= 0) return "";
	if (n >= 1000000) return `${Math.round(n / 1000000)}M`;
	if (n >= 1000) return `${Math.round(n / 1000)}K`;
	return String(n);
}

/**
 * The window label for one model row: the raw ingredients the host
 * publishes (`contextOptions` / `defaultContextWindow`) resolved
 * against the card's live `maxWindow` toggle, not the server-computed
 * label (which only reflects the last load). A model with no
 * selectable windows shows nothing — its fallback number is a local
 * degradation, not a window Qoder offers.
 */
function windowLabelOf(model, preferMax) {
	const options = Array.isArray(model.contextOptions) ? model.contextOptions.filter((n) => Number(n) > 0) : [];
	if (options.length === 0) return "";
	const widest = Math.max(...options);
	const tokens = preferMax ? widest : (Number(model.defaultContextWindow) > 0 ? Number(model.defaultContextWindow) : widest);
	return formatContextWindowForUi(tokens);
}

/**
 * The multiplier that applies at `now`.
 *
 * Mirrors the host's resolution: `priceFactor` is Qoder's *discounted*
 * price, and `beforePromotionPriceFactor` is what applies outside the
 * window — the two are related by exactly `before x discount`. Reading
 * `priceFactor` alone understates the cost for most of the day.
 */
function rateAt(model, now) {
	const base = Number(model.priceFactor);
	const promo = model.promotion;
	if (promo === null || typeof promo !== "object") return Number.isFinite(base) ? base : undefined;
	const before = Number(promo.beforePromotionPriceFactor);
	const discount = Number(promo.discountFactor);
	const state = offPeakState(model, now);
	if (state?.active === true) {
		if (Number.isFinite(before) && Number.isFinite(discount)) return before * discount;
		return Number.isFinite(base) ? base : undefined;
	}
	if (Number.isFinite(before)) return before;
	return Number.isFinite(base) ? base : undefined;
}

/**
 * The set of model ids currently ticked, given what the host reported.
 *
 * The host stores an empty list as "no filter" (every model shows), so the
 * card presents that same state as "everything ticked" — otherwise a fresh
 * install would render every box empty while every model was visible.
 */
function enabledIdsFor(models, saved) {
	const list = Array.isArray(saved) ? saved.filter((id) => typeof id === "string") : [];
	if (list.length === 0) return new Set(models.map((model) => model.id));
	return new Set(list);
}

/**
 * One quota row: label, optional badges, an optional date, a bar, and the
 * used/total figures. Shared by the plan quota, the add-on package and the
 * per-model dedicated packages, which differ only in their wording.
 */
function QuotaBlock({ t, label, quota, when, badge }) {
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
	const tone = quota.remaining <= 0 ? " dsm-qoder-bar-full" : percentage >= 0.8 ? " dsm-qoder-bar-warn" : "";
	const unit = quota.unit === "credits" ? t("usage.credits") : quota.unit ?? "";
	return (0, react_jsx_runtime.jsxs)("div", {
		className: "dsm-qoder-usage-block",
		children: [
			(0, react_jsx_runtime.jsxs)("div", {
				className: "dsm-qoder-usage-label",
				children: [
					(0, react_jsx_runtime.jsx)("span", { children: label }),
					badge !== undefined ? (0, react_jsx_runtime.jsx)("span", {
						className: "dsm-qoder-usage-badge dsm-qoder-usage-badge-offer",
						children: badge
					}) : null,
					quota.remaining <= 0 ? (0, react_jsx_runtime.jsx)("span", {
						className: "dsm-qoder-usage-badge",
						children: t("usage.exceeded")
					}) : null,
					when ? (0, react_jsx_runtime.jsx)("span", {
						className: "dsm-qoder-usage-when",
						children: when
					}) : null
				]
			}),
			(0, react_jsx_runtime.jsx)("div", {
				className: "dsm-qoder-bar",
				role: "progressbar",
				"aria-valuemin": 0,
				"aria-valuemax": 100,
				"aria-valuenow": Math.round(percentage * 100),
				"aria-label": label,
				children: (0, react_jsx_runtime.jsx)("div", {
					className: `dsm-qoder-bar-fill${tone}`,
					style: { width: `${percent}%` }
				})
			}),
			(0, react_jsx_runtime.jsxs)("div", {
				className: "dsm-qoder-usage-figures",
				children: [
					(0, react_jsx_runtime.jsxs)("span", {
						children: [
							(0, react_jsx_runtime.jsx)("strong", { children: `${quota.used} / ${quota.total}` }),
							` (${Math.round(percent)}%)`
						]
					}),
					(0, react_jsx_runtime.jsx)("span", {
						children: `${t("usage.remaining")} ${quota.remaining}${unit ? ` ${unit}` : ""}`
					})
				]
			})
		]
	});
}

/**
 * Today's check-in row.
 *
 * Assembled from parts this card already had — the `.dsm-qoder-row` frame and
 * the pill button every other action uses — rather than new CSS, and shaped
 * after `dsh-connect-workbuddy`'s check-in row so the two sibling cards read
 * alike in the same settings list.
 *
 * Everything it decides comes from the state the host computed. An earlier bug
 * in this family of cards rendered an off-peak price the card had worked out
 * for itself while the picker charged another, so this row deliberately holds
 * no arithmetic of its own: whether today's round exists, and whether it has
 * been claimed, are answered upstream and merely rendered here.
 */
function CheckinRow({ t, checkin, busy, onClaim }) {
	const claimed = checkin.todayCheckedIn === true;
	const amount = typeof checkin.amount === "number" ? checkin.amount : undefined;
	return (0, react_jsx_runtime.jsxs)("div", {
		className: "dsm-qoder-row",
		children: [
			(0, react_jsx_runtime.jsxs)("div", {
				className: "dsm-qoder-row-main",
				children: [
					(0, react_jsx_runtime.jsx)("span", {
						className: "dsm-qoder-usage-badge dsm-qoder-usage-badge-offer",
						children: t("usage.checkin")
					}),
					amount !== undefined && !claimed ? (0, react_jsx_runtime.jsx)("span", {
						className: "dsm-qoder-name",
						children: t("usage.checkinAvailable", { amount })
					}) : null
				]
			}),
			(0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: "dsm-qoder-button",
				disabled: busy || claimed,
				onClick: onClaim,
				children: busy ? t("usage.checkinClaiming") : claimed ? t("usage.checkinClaimed") : t("usage.checkinClaim")
			})
		]
	});
}

/** One region's usage block, as returned by the host usage route. */
function RegionUsage({ t, entry, checkinBusy = false, checkinNotice = undefined, onClaimCheckin = undefined }) {
	if (entry.available !== true) {
		return (0, react_jsx_runtime.jsxs)("div", {
			className: "dsm-qoder-usage-block",
			children: [
				(0, react_jsx_runtime.jsx)("p", {
					className: "dsm-qoder-state",
					children: t("usage.unavailable")
				})
			]
		});
	}
	const packages = Array.isArray(entry.dedicatedPackages) ? entry.dedicatedPackages : [];
	const campaigns = Array.isArray(entry.campaigns) ? entry.campaigns : [];
	const hasAny = entry.userQuota !== undefined || entry.addOnQuota !== undefined || packages.length > 0;
	return (0, react_jsx_runtime.jsxs)("div", {
		className: "dsm-qoder-usage-block",
		children: [
			!hasAny ? (0, react_jsx_runtime.jsx)("p", {
				className: "dsm-qoder-state",
				children: t("usage.empty")
			}) : null,
			entry.userQuota !== undefined ? (0, react_jsx_runtime.jsx)(QuotaBlock, {
				t,
				label: t("usage.planCredits"),
				quota: entry.userQuota,
				when: withDate(t("usage.renewsOn"), entry.expiresAt)
			}) : null,
			entry.addOnQuota !== undefined ? (0, react_jsx_runtime.jsx)(QuotaBlock, {
				t,
				label: t("usage.resourcePackage"),
				quota: entry.addOnQuota
			}) : null,
			// Dedicated packages are per-model allowances. They appear only
			// when the account actually holds one, so the panel stays honest
			// for accounts that have none.
			packages.map((pack, index) => (0, react_jsx_runtime.jsxs)(react.Fragment, {
				children: [
					(0, react_jsx_runtime.jsx)("div", { className: "dsm-qoder-usage-sep" }),
					(0, react_jsx_runtime.jsx)(QuotaBlock, {
						t,
						label: pack.name || t("usage.dedicatedPackage"),
						quota: pack,
						when: withDate(t("usage.expiresOn"), pack.expiresAt)
					})
				]
			}, `pack:${pack.id}:${index}`)),
			// The check-in sits next to the add-on quota because that is where
			// the Credits land, and disappears entirely when no round is
			// running instead of leaving a permanently grey button behind.
			entry.checkin !== undefined && entry.checkin.active === true ? (0, react_jsx_runtime.jsxs)(react.Fragment, {
				children: [
					(0, react_jsx_runtime.jsx)("div", { className: "dsm-qoder-usage-sep" }),
					(0, react_jsx_runtime.jsx)(CheckinRow, {
						t,
						checkin: entry.checkin,
						busy: checkinBusy,
						onClaim: onClaimCheckin
					}),
					checkinNotice !== undefined ? (0, react_jsx_runtime.jsx)("p", {
						className: checkinNotice.kind === "error" ? "dsm-qoder-error" : "dsm-qoder-state",
						children: checkinNotice.kind === "error" ? t("usage.checkinError", {
							message: checkinNotice.message ?? ""
						}) : checkinNotice.kind === "granted" && typeof checkinNotice.amount === "number" ? t("usage.checkinGranted", {
							amount: checkinNotice.amount
						}) : t("usage.checkinAlready")
					}) : null
				]
			}) : null,
			campaigns.length > 0 ? (0, react_jsx_runtime.jsx)("div", { className: "dsm-qoder-usage-sep" }) : null,
			campaigns.map((camp) => (0, react_jsx_runtime.jsxs)("p", {
				className: "dsm-qoder-usage-promo",
				children: [
					(0, react_jsx_runtime.jsx)("span", {
						className: "dsm-qoder-usage-badge dsm-qoder-usage-badge-offer",
						children: t("usage.promotion")
					}),
					" ",
					camp.title,
					camp.endsAt !== undefined ? ` · ${withDate(t("usage.expiresOn"), camp.endsAt)}` : "",
					camp.detailUrl ? (0, react_jsx_runtime.jsxs)(react.Fragment, {
						children: [
							" ",
							(0, react_jsx_runtime.jsx)("a", {
								href: camp.detailUrl,
								target: "_blank",
								rel: "noreferrer",
								children: t("usage.viewDetails")
							})
						]
					}) : null
				]
			}, `camp:${camp.key}`))
		]
	});
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
function QoderUsagePanel({ t, refreshToken = 0, activeRegion = "qoder-cn" }) {
	const [regions, setRegions] = (0, react.useState)([]);
	const [status, setStatus] = (0, react.useState)("loading");
	const [notice, setNotice] = (0, react.useState)(undefined);
	const [busy, setBusy] = (0, react.useState)(false);
	const [claimBusy, setClaimBusy] = (0, react.useState)(false);
	const [claimNotice, setClaimNotice] = (0, react.useState)(undefined);
	const mounted = (0, react.useRef)(true);
	(0, react.useEffect)(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	const load = (0, react.useCallback)(async (refresh) => {
		setBusy(true);
		try {
			const response = await fetch(`${QODER_USAGE_PATH}${refresh ? "?refresh=1" : ""}`, {
				headers: { accept: "application/json" },
				credentials: "same-origin"
			});
			const value = await response.json().catch(() => void 0);
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
			const value = await response.json().catch(() => void 0);
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
	return (0, react_jsx_runtime.jsxs)("div", {
		className: "dsm-qoder-usage",
		children: [
			(0, react_jsx_runtime.jsxs)("div", {
				className: "dsm-qoder-usage-head",
				children: [
					// The head is a stable title row: the panel title stays
					// on the left and the refresh control stays on the
					// right. Loading and error states render below it,
					// next to the selected region's block.
					(0, react_jsx_runtime.jsx)("h4", {
						className: "dsm-qoder-usage-title",
						children: t("usage.title")
					}),
					(0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "dsm-qoder-button",
						disabled: busy,
						onClick: () => {
							void load(true);
						},
						children: t("usage.refresh")
					})
				]
			}),
			status === "loading" ? (0, react_jsx_runtime.jsx)("p", {
				className: "dsm-qoder-hint",
				children: t("usage.loading")
			}) : null,
			status === "error" ? (0, react_jsx_runtime.jsx)("p", {
				className: "dsm-qoder-error",
				children: `${t("usage.error")}: ${notice ?? ""}`
			}) : null,
			// Scoped to the selected region (the convergence point on the
			// version strip), so only one usage block renders instead of
			// one per region. The fetch still pulls every region; this
			// just picks the one the strip has selected.
			(() => {
				const active = regions.find((entry) => entry.region === activeRegion);
				if (active !== undefined) return (0, react_jsx_runtime.jsx)(RegionUsage, {
					t,
					entry: active,
					checkinBusy: claimBusy,
					checkinNotice: claimNotice,
					onClaimCheckin: () => {
						void claimCheckin();
					}
				});
				// The selected edition has no quota entry yet — it is not
				// signed in or not started — so say so instead of leaving
				// the panel body empty under its header.
				return status === "ready" ? (0, react_jsx_runtime.jsx)("p", {
					className: "dsm-qoder-state",
					children: t("usage.none")
				}) : null;
			})()
		]
	});
}

/**
 * The account section: a version strip over the SELECTED region's
 * sign-in — who drives it, in which state it is, and what to do when
 * it is not `ok`. The strip is the card's convergence point: each
 * region is one pill (status dot + name + provider switch), and
 * selecting a pill scopes this detail, the usage panel and the model
 * list to that region, so the region name appears exactly once on the
 * card. `activeRegion` / `onRegionChange` are the card-level pair that
 * drives all three surfaces.
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
function QoderAccountPanel({ t, onReconciled, settingsScope, activeRegion = "qoder-cn", onRegionChange }) {
	const [accounts, setAccounts] = (0, react.useState)([]);
	const [status, setStatus] = (0, react.useState)("loading");
	const [reloading, setReloading] = (0, react.useState)(false);
	// One confirm outcome per region: `{ kind: "confirmed" |
	// "sign-in-expired" | "unavailable", detail? }`. Absent means
	// "not asked since the last re-read".
	const [confirmState, setConfirmState] = (0, react.useState)({});
	const [confirmBusy, setConfirmBusy] = (0, react.useState)({});
	// The per-region provider switch. The host answers with the fully
	// resolved map for every known region, so saving posts that whole
	// map back — a host-side per-region merge can never lose a
	// sibling region, and the scope-mirror fallback replaces a field
	// it always holds in full.
	const [enabledRegions, setEnabledRegions] = (0, react.useState)({});
	const [toggling, setToggling] = (0, react.useState)(false);
	const [offerError, setOfferError] = (0, react.useState)(undefined);
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
			const value = await response.json().catch(() => void 0);
			if (!response.ok || value === void 0) throw new Error(`HTTP ${response.status}`);
			if (!mounted.current) return;
			const regions = Array.isArray(value.regions) ? value.regions : [];
			setAccounts(regions);
			// Prefer the host-resolved map; fall back to each region's
			// own `enabled` flag so an older host that predates the
			// map still drives the switch (absent = offered).
			const map = value.enabledRegions !== null && typeof value.enabledRegions === "object" ? value.enabledRegions : Object.fromEntries(regions.filter((entry) => entry.region !== undefined).map((entry) => [entry.region, entry.enabled !== false]));
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
	// WorkBuddy parity: the tab strip is the panel's whole header — no
	// title row, no re-read button to save. The re-read therefore has
	// to find its own moment, and the dots say when that is. The
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
			const value = await response.json().catch(() => void 0);
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
					detail: String(error?.message ?? error)
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
			if (mounted.current) setOfferError(String(error?.message ?? error));
		} finally {
			if (mounted.current) setToggling(false);
		}
	}, [enabledRegions, settingsScope, onReconciled, load]);
	// Tone per state: `ok` is green, a lapsed or unreadable sign-in is
	// red or amber, and "not installed" stays neutral — the absence of
	// an app is not a fault of this machine. The same tones drive the
	// status dots on the region strip.
	const dotClassOf = (state) => state === "ok" ? " dsm-qoder-region-dot-ok" : state === "expired" ? " dsm-qoder-region-dot-expired" : state === "needs-app" ? " dsm-qoder-region-dot-needs" : "";
	const stateLabelOf = (entry) => t(`account.state.${entry.state}`);
	// The strip shows every known region; the detail below it shows
	// only the one the strip has selected. A selection that no longer
	// exists should not happen — the host always answers with both
	// regions — but it falls back to the first entry rather than
	// breaking the panel.
	const activeEntry = accounts.find((entry) => entry.region === activeRegion) ?? accounts[0];
	const activeOffered = activeEntry !== undefined && enabledRegions[activeEntry.region] !== false;
	const activeResult = activeEntry !== undefined ? confirmState[activeEntry.region] : undefined;
	const activeHasIdentity = activeEntry !== undefined && activeEntry.identity !== undefined && activeEntry.identity !== null;
	const activeName = activeHasIdentity ? String(activeEntry.identity.name ?? "").trim() : "";
	// The same three chips the old rows carried: credential source,
	// app name, and the sign-in's expiry date — now for one region.
	const activeMeta = [];
	if (activeEntry !== undefined) {
		if (activeEntry.source === "env-pat") activeMeta.push(t("account.envPat"));
		else if (typeof activeEntry.appName === "string" && activeEntry.appName !== "") activeMeta.push(t("account.appFrom", { app: activeEntry.appName }));
		if (activeHasIdentity && Number(activeEntry.identity.expiresAt) > 0) activeMeta.push(withDate(t("account.expiresAt"), activeEntry.identity.expiresAt));
	}
	// A manage-page link accompanies every state the card cannot fix
	// by itself; only the selected region's notes carry one now.
	const activeManageLink = activeEntry !== undefined && typeof activeEntry.manageUrl === "string" && activeEntry.manageUrl !== "" ? (0, react_jsx_runtime.jsx)("a", {
		href: activeEntry.manageUrl,
		target: "_blank",
		rel: "noreferrer",
		children: ` · ${t("account.openManage")}`
	}) : null;
	return (0, react_jsx_runtime.jsxs)("div", {
		className: "dsm-qoder-account",
		children: [
			// No header row: the tab strip below IS the panel's title
			// (WorkBuddy's design), and a failure says so with its own
			// retry rather than a button that is otherwise redundant.
			status === "error" ? (0, react_jsx_runtime.jsxs)("div", {
				className: "dsm-qoder-account-error",
				children: [
					(0, react_jsx_runtime.jsx)("p", {
						className: "dsm-qoder-error",
						children: t("account.error")
					}),
					(0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "dsm-qoder-button",
						disabled: reloading,
						onClick: () => {
							void reload();
						},
						children: t("account.reload")
					})
				]
			}) : (0, react_jsx_runtime.jsxs)(react.Fragment, {
				children: [
					// The convergence point: one pill per region —
					// status dot, name, provider switch. Selecting a
					// pill scopes the detail below, the usage panel
					// and the model list to that region, so the
					// region name appears exactly once on the card.
					(0, react_jsx_runtime.jsx)("div", {
						className: "dsm-qoder-region-tabs",
						role: "tablist",
						"aria-label": t("account.regionTabs"),
						children: accounts.map((entry) => {
							// Provider switch state. The local map is
							// the source of truth for the switch (it
							// settles on the host value after each
							// save); a region with no key yet reads
							// as offered, the same default the host
							// predicate uses.
							const offered = enabledRegions[entry.region] !== false;
							const isActive = entry.region === activeRegion;
							return (0, react_jsx_runtime.jsxs)("div", {
								className: `dsm-qoder-region-tab-cell${isActive ? " dsm-qoder-region-tab-cell-active" : ""}`,
								children: [(0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									role: "tab",
									"aria-selected": isActive,
									className: `dsm-qoder-region-tab${offered ? "" : " dsm-qoder-region-tab-off"}`,
									title: `${entry.regionName ?? entry.region} · ${stateLabelOf(entry)}`,
									onClick: () => {
										if (typeof onRegionChange === "function") onRegionChange(entry.region);
										// Choosing a not-ok region is also
										// the moment the user has just
										// signed in over there: run the
										// pick-up for it, dots included.
										if (entry.state !== "ok") void reload();
									},
									children: [(0, react_jsx_runtime.jsx)("span", {
										"aria-hidden": "true",
										className: `dsm-qoder-region-dot${dotClassOf(entry.state)}`
									}), (0, react_jsx_runtime.jsx)("span", {
										className: "dsm-qoder-region-name",
										children: entry.regionName ?? entry.region
									})]
								}), (0, react_jsx_runtime.jsxs)("label", {
									className: "dsm-qoder-region-toggle-cell",
									title: t("account.offerTitle"),
									children: [(0, react_jsx_runtime.jsx)("input", {
										type: "checkbox",
										className: "dsm-qoder-region-toggle",
										checked: offered,
										disabled: toggling,
										onChange: (event) => {
											void toggleRegion(entry.region, event.target.checked);
										},
										"aria-label": `${t("account.offer")}: ${entry.regionName ?? entry.region}`
									})]
								})]
							}, `tab:${entry.region}`);
						})
					}),
					// The selected region's sign-in: who it is, where
					// the credential comes from, and what to do when
					// it is not `ok`.
					activeEntry !== undefined ? (0, react_jsx_runtime.jsxs)(react.Fragment, {
						children: [
							(0, react_jsx_runtime.jsxs)("div", {
								className: `dsm-qoder-account-row${activeOffered ? "" : " dsm-qoder-account-row-off"}`,
								children: [
									(0, react_jsx_runtime.jsxs)("span", {
										className: "dsm-qoder-account-id",
										children: [
											(0, react_jsx_runtime.jsx)("span", {
												className: "dsm-qoder-account-name",
												children: activeName !== "" ? activeName : "—"
											}),
											activeMeta.length > 0 ? (0, react_jsx_runtime.jsx)("span", {
												className: "dsm-qoder-account-meta",
												children: activeMeta.join(" · ")
											}) : null
										]
									}),
									(0, react_jsx_runtime.jsx)("span", { className: "dsm-qoder-usage-spacer" }),
									activeEntry.source !== undefined ? (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dsm-qoder-button",
										disabled: confirmBusy[activeEntry.region] === true,
										onClick: () => {
											void confirm(activeEntry.region);
										},
										children: confirmBusy[activeEntry.region] === true ? t("account.confirming") : t("account.confirm")
									}) : null
								]
							}),
						!activeOffered ? (0, react_jsx_runtime.jsx)("p", {
							className: "dsm-qoder-account-note",
							children: t("account.offerOff")
						}) : null,
						activeEntry.state === "needs-app" ? (0, react_jsx_runtime.jsxs)("p", {
							className: "dsm-qoder-account-note dsm-qoder-account-note-error",
							children: [
								t("account.readFail", { detail: activeEntry.detail ?? "" }),
								activeManageLink
							]
						}) : null,
						activeEntry.state === "expired" ? (0, react_jsx_runtime.jsxs)("p", {
							className: "dsm-qoder-account-note",
							children: [
								t("account.expiredHint"),
								activeManageLink
							]
						}) : null,
						activeEntry.state === "signed-out" ? (0, react_jsx_runtime.jsxs)("p", {
							className: "dsm-qoder-account-note",
							children: [
								t("account.unsigned"),
								activeManageLink
							]
						}) : null,
						activeResult?.kind === "confirmed" ? (0, react_jsx_runtime.jsx)("p", {
							className: "dsm-qoder-account-note",
							children: t("account.confirmed")
						}) : null,
						activeResult?.kind === "sign-in-expired" ? (0, react_jsx_runtime.jsxs)("p", {
							className: "dsm-qoder-account-note dsm-qoder-account-note-error",
							children: [
								t("account.confirmExpired"),
								activeManageLink
							]
						}) : null,
						activeResult?.kind === "unavailable" ? (0, react_jsx_runtime.jsx)("p", {
							className: "dsm-qoder-account-note dsm-qoder-account-note-error",
							children: t("account.confirmFailed", { detail: activeResult.detail ?? "" })
						}) : null
					]
				}) : null
			]
		}),
			offerError !== undefined ? (0, react_jsx_runtime.jsx)("p", {
				className: "dsm-qoder-account-note dsm-qoder-account-note-error",
				children: t("account.offerError", { detail: offerError })
			}) : null
		]
	});
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
function initialOpenForView(view) {
	return view === "page";
}

/** Render the Qoder model and image-input card. */
export function QoderPluginCard({ t, settingsScope, view }) {
	if (t === void 0) throw new Error("Qoder settings card requires its translation function");
	const [open, setOpen] = (0, react.useState)(() => initialOpenForView(view));
	const [models, setModels] = (0, react.useState)([]);
	const [imageOverrides, setImageOverrides] = (0, react.useState)({});
	const [savedOverrides, setSavedOverrides] = (0, react.useState)({});
	const [maxWindow, setMaxWindow] = (0, react.useState)(false);
	const [savedMaxWindow, setSavedMaxWindow] = (0, react.useState)(false);
	// Picker visibility, per region. The host stores an empty list as "no
	// filter", so the card keeps the same shape and renders that state as
	// "everything ticked".
	const [enabledIds, setEnabledIds] = (0, react.useState)({});
	const [savedEnabledIds, setSavedEnabledIds] = (0, react.useState)({});
	const [status, setStatus] = (0, react.useState)("loading");
	const [saving, setSaving] = (0, react.useState)(false);
	const [notice, setNotice] = (0, react.useState)(undefined);
	const [refreshing, setRefreshing] = (0, react.useState)(false);
	const [refreshedAt, setRefreshedAt] = (0, react.useState)(undefined);
	// Bumped when the account panel's re-read lands; the usage panel
	// treats a non-zero value as "force a fresh quota pull".
	const [usageBump, setUsageBump] = (0, react.useState)(0);
	// View-only filter state. It narrows which rows RENDER, never which
	// rows are SAVED: filtering the list cannot change `enabledModelIds`,
	// so it is deliberately kept out of `dirty` and out of `save()`.
	const [query, setQuery] = (0, react.useState)("");
	// The selected region, shared with the account panel's region strip
	// (the convergence point). The usage panel and the model list are
	// both scoped to it, so the region name appears once — on the
	// strip — instead of on every model row. The model row badges and
	// the model section's own region tabs are gone for the same reason.
	const [activeRegion, setActiveRegion] = (0, react.useState)("qoder-cn");
	// The model id whose row should flash, set by the last in-place edit
	// (checkbox tick or image-mode pick). A timeout clears it, so the CSS
	// animation plays once and the row settles back.
	const [pulse, setPulse] = (0, react.useState)(undefined);
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
	const load = (0, react.useCallback)(async (refresh, signal) => {
		if (refresh) setRefreshing(true);
		try {
			const response = await fetch(`${QODER_MODELS_PATH}${refresh ? "?refresh=1" : ""}`, {
				headers: { accept: "application/json" },
				credentials: "same-origin",
				signal
			});
			const value = await response.json().catch(() => void 0);
			if (!response.ok || value === void 0) throw new Error(`HTTP ${response.status}`);
			if (!mounted.current) return;
			setModels(Array.isArray(value.models) ? value.models : []);
			if (!refresh) {
				const overrides = value.imageOverrides !== null && typeof value.imageOverrides === "object" ? value.imageOverrides : {};
				const savedEnabled = value.enabledModelIds !== null && typeof value.enabledModelIds === "object" ? value.enabledModelIds : {};
				setImageOverrides(overrides);
				setSavedOverrides(overrides);
				setMaxWindow(value.useMaximumContextWindow === true);
				setSavedMaxWindow(value.useMaximumContextWindow === true);
				setEnabledIds(savedEnabled);
				setSavedEnabledIds(savedEnabled);
			}
			setRefreshedAt(typeof value.refreshedAt === "number" ? value.refreshedAt : Date.now());
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
	// Every editable field participates in "has unsaved changes": the
	// per-model image modes, the picker roster, and the context-window switch.
	const dirty = (0, react.useMemo)(() => JSON.stringify(imageOverrides) !== JSON.stringify(savedOverrides) || JSON.stringify(enabledIds) !== JSON.stringify(savedEnabledIds) || maxWindow !== savedMaxWindow, [imageOverrides, savedOverrides, enabledIds, savedEnabledIds, maxWindow, savedMaxWindow]);
	const setMode = (0, react.useCallback)((modelId, mode) => {
		setImageOverrides((current) => {
			const next = { ...current };
			// "auto" is the absence of an override, so an auto row never
			// writes a key — the saved document stays minimal and a future
			// catalog change is picked up again.
			if (mode === "auto") delete next[modelId];
			else next[modelId] = mode;
			return next;
		});
		// Flash the row so the pick gives feedback where it happened;
		// without it the only signal is the banner at the bottom.
		setPulse(modelId);
		setNotice(undefined);
	}, []);
	/**
	 * Tick or untick one model for the picker.
	 *
	 * Ticking is recorded against the region's **full** roster, not against
	 * whatever happens to be ticked now, so the saved list is a complete
	 * allow-list rather than a diff. That is what lets a partially curated
	 * region stay curated when the catalog later grows.
	 */
	const toggleModel = (0, react.useCallback)((regionId, modelId) => {
		setEnabledIds((current) => {
			const roster = models.filter((m) => m.region === regionId).map((m) => m.id);
			const active = enabledIdsFor(models, current[regionId]);
			const next = new Set(active);
			if (!next.delete(modelId)) next.add(modelId);
			// A full selection is stored as the empty list, which is the
			// "no filter" state — so re-ticking everything returns the region
			// to following the catalog automatically.
			const list = roster.filter((id) => next.has(id));
			return { ...current, [regionId]: list.length === roster.length ? [] : list };
		});
		// Same in-place flash as the image-mode pick: the tick visibly
		// lands even though nothing is saved yet.
		setPulse(modelId);
		setNotice(undefined);
	}, [models]);
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
	const setRegionAll = (0, react.useCallback)((regionId, allOn) => {
		setEnabledIds((current) => ({ ...current, [regionId]: allOn ? [HIDE_ALL_MODELS] : [] }));
		setNotice(undefined);
	}, []);
	/**
	 * Persist the card's three settings fields.
	 *
	 * Each write is verified (read-back against what was posted) and the
	 * per-region allow-list goes through the Host merge, so a save
	 * either lands or raises — the "已保存" banner only appears for
	 * values that actually persisted.
	 */
	const save = (0, react.useCallback)(async () => {
		if (settingsScope === undefined) return;
		setSaving(true);
		try {
			await writeSettingsField(settingsScope, "enabledModelIds", enabledIds);
			await writeSettingsField(settingsScope, "imageOverrides", imageOverrides);
			// The other fields are siblings of the same namespace, so they are
			// written in the same save action.
			await writeSettingsField(settingsScope, "useMaximumContextWindow", maxWindow);
			setSavedOverrides(imageOverrides);
			setSavedMaxWindow(maxWindow);
			setSavedEnabledIds(enabledIds);
			setNotice(t("row.saved"));
		} catch (error) {
			setNotice(`${t("row.failed")}: ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			if (mounted.current) setSaving(false);
		}
	}, [settingsScope, imageOverrides, maxWindow, enabledIds, t]);
	const discard = (0, react.useCallback)(() => {
		setImageOverrides(savedOverrides);
		setMaxWindow(savedMaxWindow);
		setEnabledIds(savedEnabledIds);
		setNotice(undefined);
	}, [savedOverrides, savedMaxWindow, savedEnabledIds]);
	// The card is scoped to the selected region, so the bulk button
	// names the ACTIVE region's roster: "show all" is its no-filter
	// state (`[]`), "hide all" the sentinel list that matches nothing.
	// `[]` counts as every model ticked, like a fresh install.
	const regionModels = models.filter((model) => model.region === activeRegion);
	const regionAllTicked = regionModels.length > 0 && regionModels.every((model) => enabledIdsFor(models, enabledIds[activeRegion]).has(model.id));
	const needle = query.trim().toLowerCase();
	// What actually renders: the active region's roster through the name
	// filter. The filter only narrows the VIEW — `save()` still writes
	// the full per-region allow-list, so hiding rows while a filter is
	// active can never silently uncheck a model the user never saw.
	const visibleModels = regionModels.filter((model) => {
		if (needle === "") return true;
		return String(model.name ?? model.id).toLowerCase().includes(needle) || model.id.toLowerCase().includes(needle);
	});
	// Visible + ticked, for the counter beside the filter. Counted over
	// `visibleModels` so the number matches the rows on screen.
	const visibleTicked = visibleModels.filter((model) => enabledIdsFor(models, enabledIds[model.region]).has(model.id)).length;
	return (0, react_jsx_runtime.jsxs)("li", {
		className: `dsm-plugin-card${open ? " dsm-plugin-card-open" : ""}`,
		// Escape leaves the card in two steps: inside the search box it first
		// clears the filter (the natural "get me out of this search" gesture);
		// with the filter already clear it collapses the card from anywhere
		// inside it, so a user lost in a long roster has one keystroke out.
		onKeyDown: (event) => {
			if (event.key !== "Escape" || !open) return;
			if (query !== "") {
				setQuery("");
				return;
			}
			setOpen(false);
		},
		children: [(0, react_jsx_runtime.jsxs)("button", {
			type: "button",
			className: "dsm-plugin-card-header",
			"aria-expanded": open,
			"aria-label": `${t(open ? "row.collapse" : "row.expand")}: ${t("row.title")}`,
			onClick: () => {
				setOpen(!open);
			},
			children: [(0, react_jsx_runtime.jsxs)("span", {
				className: "dsm-plugin-card-head",
				children: [(0, react_jsx_runtime.jsx)("span", {
					className: "dsm-plugin-card-title",
					children: t("row.title")
				}), (0, react_jsx_runtime.jsx)("span", {
					className: "dsm-plugin-card-description",
					children: t("row.desc")
				})]
			}), (0, react_jsx_runtime.jsx)("span", {
				// Empty span: the caret is drawn by the ::before rule copied
				// from WorkBuddy. A text glyph here too would render a second
				// arrow beside the CSS one.
				"aria-hidden": "true",
				className: `dsm-plugin-card-chevron${open ? " dsm-plugin-card-chevron-open" : ""}`
			})]
		}), (0, react_jsx_runtime.jsx)("div", {
			className: "dsm-plugin-card-body",
			hidden: !open,
			children: open ? (0, react_jsx_runtime.jsxs)("div", {
				className: "dsm-qoder-body",
				children: [
					(0, react_jsx_runtime.jsx)(QoderAccountPanel, {
						t,
						onReconciled: reconcile,
						settingsScope,
						activeRegion,
						onRegionChange: setActiveRegion
					}),
					(0, react_jsx_runtime.jsx)(QoderUsagePanel, {
						t,
						refreshToken: usageBump,
						activeRegion
					}),
					status === "loading" ? (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-qoder-skeleton",
						"aria-busy": "true",
						children: [(0, react_jsx_runtime.jsx)("p", {
							className: "dsm-qoder-state",
							children: t("row.loading")
						}), (0, react_jsx_runtime.jsx)("div", { className: "dsm-qoder-skeleton-row" }), (0, react_jsx_runtime.jsx)("div", { className: "dsm-qoder-skeleton-row" }), (0, react_jsx_runtime.jsx)("div", { className: "dsm-qoder-skeleton-row" })]
					}) : null,
					status === "error" ? (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-qoder-tools",
						children: [(0, react_jsx_runtime.jsx)("p", {
							className: "dsm-qoder-error",
							children: `${t("row.requestFailed")}: ${notice ?? ""}`
						}), (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dsm-qoder-button",
							disabled: refreshing,
							// The retry sits ON the error, not behind the toolbar
							// button elsewhere on the page: recovery should be one
							// click from where the failure is being read. `load(true)`
							// also re-pulls the catalog, which is the failure mode
							// users actually hit (an upstream blip left a stale list).
							onClick: () => {
								void load(true);
							},
							children: refreshing ? t("row.refreshing") : t("row.retry")
						})]
					}) : null,
					status === "ready" && models.length === 0 ? (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-qoder-state",
						children: t("row.signedOut")
					}) : null,
					// The active region has no models of its own while the
					// other one does: it is either not signed in or its
					// "models" switch is off. The strip above shows which.
					status === "ready" && models.length > 0 && regionModels.length === 0 ? (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-qoder-state",
						children: t("row.regionEmpty")
					}) : null,
					// The high-frequency filter stays above the roster:
					// a name search plus the count that matches the rows
					// on screen. Maintenance actions and the rate rules
					// read as footnotes below the list instead of
					// competing with filtering for the top of the card.
					models.length > 0 ? (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-qoder-tools",
						children: [(0, react_jsx_runtime.jsx)("input", {
							type: "search",
							className: "dsm-qoder-search",
							value: query,
							placeholder: t("row.searchPlaceholder"),
							"aria-label": t("row.search"),
							onChange: (event) => setQuery(event.target.value)
						}), (0, react_jsx_runtime.jsx)("span", {
							className: "dsm-qoder-count",
							"aria-live": "polite",
							children: t("row.filterCount", { visible: visibleModels.length, total: regionModels.length, ticked: visibleTicked })
						})]
					}) : null,
					// An empty result after filtering is distinct from a
					// roster-less region: this one has models, the name
					// filter just matched nothing, so it gets its own
					// message plus a one-click way back.
					regionModels.length > 0 && visibleModels.length === 0 ? (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-qoder-tools",
						children: [(0, react_jsx_runtime.jsx)("p", {
							className: "dsm-qoder-state",
							children: t("row.searchEmpty")
						}), (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dsm-qoder-button",
							onClick: () => setQuery(""),
							children: t("row.clearFilter")
						})]
					}) : null,
					visibleModels.length > 0 ? (0, react_jsx_runtime.jsx)("ul", {
						className: "dsm-qoder-models",
						children: visibleModels.map((model) => {
							const active = enabledIdsFor(models, enabledIds[model.region]).has(model.id);
							// The rate is resolved against the ticking clock, not the
							// server's snapshot, so it flips at the window boundary.
							const offPeak = offPeakState(model, clock);
							const rate = rateLabelOf(t, rateAt(model, clock));
							const offPeakTitle = model.promotion === undefined ? t("row.rateLabel") : offPeak?.active === true ? `${t("row.offPeakOn")} · ${formatCountdown(offPeak.remainingSeconds)}` : t("row.offPeakOff");
							return (0, react_jsx_runtime.jsxs)("li", {
								className: `dsm-qoder-row${active ? "" : " dsm-qoder-row-off"}${pulse === model.id ? " dsm-qoder-row-pulse" : ""}`,
								children: [(0, react_jsx_runtime.jsxs)("span", {
									className: "dsm-qoder-row-main",
									children: [(0, react_jsx_runtime.jsx)("label", {
										className: "dsm-qoder-pick",
										title: t("row.showInPicker"),
										children: (0, react_jsx_runtime.jsx)("input", {
											type: "checkbox",
											checked: active,
											disabled: saving,
											"aria-label": `${t("row.showInPicker")}: ${model.name ?? model.id}`,
											onChange: () => {
												toggleModel(model.region, model.id);
											}
										})
									}), (0, react_jsx_runtime.jsx)("span", {
										className: "dsm-qoder-name",
										title: model.id,
										children: model.name ?? model.id
									}), rate !== undefined ? (0, react_jsx_runtime.jsx)("span", {
										className: `dsm-qoder-rate${Number(rateAt(model, clock)) <= 0 ? " dsm-qoder-rate-free" : ""}`,
										title: offPeakTitle,
										children: rate
									}) : null, windowLabelOf(model, maxWindow) ? (0, react_jsx_runtime.jsx)("span", {
										className: "dsm-qoder-badge",
										title: model.contextOptions?.length ? `${t("row.maxWindow")}: ${model.contextOptions.map(formatContextWindowForUi).join(" / ")}` : t("row.maxWindowNote"),
										children: windowLabelOf(model, maxWindow)
									}) : null, offPeak !== undefined ? (0, react_jsx_runtime.jsx)("span", {
										className: `dsm-qoder-badge${offPeak.active ? " dsm-qoder-badge-offer" : ""}`,
										title: model.promotion?.description ?? "",
										children: `${offPeak.active ? t("row.offPeakOn") : t("row.offPeakOff")} ${formatCountdown(offPeak.remainingSeconds)}`
									}) : null, (0, react_jsx_runtime.jsx)("span", {
										className: "dsm-qoder-badge",
										children: model.isVL === true ? t("row.vision") : t("row.textOnly")
									})]
								}), (0, react_jsx_runtime.jsxs)("label", {
									className: "dsm-qoder-switch",
									children: [(0, react_jsx_runtime.jsx)("span", {
										children: t("row.imageTitle")
									}), (0, react_jsx_runtime.jsx)("select", {
										className: "dsm-qoder-select",
										value: imageModeOf(imageOverrides, model.id),
										disabled: saving,
										"aria-label": `${t("row.imageTitle")}: ${model.name ?? model.id}`,
										onChange: (event) => {
											setMode(model.id, event.target.value);
										},
										children: IMAGE_MODES.map((mode) => (0, react_jsx_runtime.jsx)("option", {
											value: mode,
											children: t(mode === "auto" ? "row.imageAuto" : mode === "on" ? "row.imageOn" : "row.imageOff")
										}, mode))
									})]
								})]
							}, `${model.region}:${model.id}`);
						})
					}) : null,
					// Rate-rule and image-mode footnotes sit below the
					// roster: the off-peak window belongs to the rates
					// shown on the rows above, and the image hint
					// explains the per-model selects on those same rows.
					regionModels.some((model) => model.promotion !== undefined) ? (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-qoder-hint",
						children: t("row.offPeakHint", {
							window: `${regionModels.find((model) => model.promotion !== undefined)?.promotion?.windowStart}–${regionModels.find((model) => model.promotion !== undefined)?.promotion?.windowEnd}`,
							zone: regionModels.find((model) => model.promotion !== undefined)?.promotion?.timezone ?? "Asia/Shanghai"
						})
					}) : null,
					(0, react_jsx_runtime.jsxs)("label", {
						className: "dsm-qoder-switch",
						title: t("row.maxWindowTitle"),
						children: [(0, react_jsx_runtime.jsx)("input", {
							type: "checkbox",
							checked: maxWindow,
							disabled: saving,
							"aria-label": t("row.maxWindow"),
							onChange: (event) => {
								setMaxWindow(event.target.checked);
								setNotice(undefined);
							}
						}), (0, react_jsx_runtime.jsx)("span", {
							children: t("row.maxWindow")
						})]
					}),
					(0, react_jsx_runtime.jsx)("p", {
						className: "dsm-qoder-hint",
						children: t("row.imageHint")
					}),
					// Maintenance actions drop below the settings block:
					// re-pulling the catalog and bulk-ticking the
					// roster are low-frequency upkeep, not part of the
					// filter-first reading order above.
					(0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-qoder-actions",
						children: [(0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dsm-qoder-button",
							disabled: refreshing,
							onClick: () => {
								void load(true);
							},
							children: refreshing ? t("row.refreshing") : t("row.refreshModels")
						}), (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dsm-qoder-button",
							disabled: saving,
							title: t("row.showHint"),
							onClick: () => {
								// One bulk button for the ACTIVE region's roster,
								// like the official picker's select-all/deselect-all
								// toggle: when every model is ticked it flips to "hide
								// all" (HIDE_ALL_MODELS, a list matching no model);
								// otherwise it flips to "show all" ([] = no filter).
								// A fresh card (no saved allow-list) is all ticked,
								// so the label reads "hide all" on first open.
								setRegionAll(activeRegion, regionAllTicked);
							},
							children: t(regionAllTicked ? "row.disableAll" : "row.enableAll")
						}), refreshedAt !== undefined && !refreshing ? (0, react_jsx_runtime.jsx)("span", {
							className: "dsm-qoder-state",
							children: t("row.refreshed", { time: new Date(refreshedAt).toLocaleTimeString() })
						}) : null]
					}),
					(0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-qoder-actions",
						children: [(0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dsm-qoder-button",
							disabled: saving || !dirty || settingsScope === undefined,
							onClick: save,
							children: saving ? t("row.saving") : t("row.save")
						}), (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dsm-qoder-button",
							disabled: saving || !dirty,
							onClick: discard,
							children: t("row.discard")
						}), notice !== undefined ? (0, react_jsx_runtime.jsx)("span", {
							className: "dsm-qoder-state",
							// A save just completed (success banner or failure
							// reason). The failure banner is the one that has to
							// be visible: it is the card's only proof that the
							// value did not persist, so it outranks the generic
							// "unsaved" marker while it is up.
							children: notice
						}) : dirty ? (0, react_jsx_runtime.jsx)("span", {
							className: "dsm-qoder-state",
							children: t("row.unsaved")
						}) : null]
					})
				]
			}) : null
		})]
	});
}