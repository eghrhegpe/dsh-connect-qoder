/**
 * The card's browser-free decision layer.
 *
 * This module holds the pure rules the `QoderPluginCard` JSX reads — the
 * off-peak gate, the per-row rate, the context-window label, the refresh
 * verdict and the formatting helpers — plus the view-model type vocabulary the
 * card receives over HTTP. It imports nothing from React, nothing touches the
 * DOM, and it performs no `fetch`. That is deliberate, and it is the point of
 * the split:
 *
 *   - these functions can be imported into a plain Node test (strip types
 *     only) and asserted against the real implementation, instead of against
 *     a hand-written mirror that would pass even if the source drifted;
 *   - `scripts/build-client.mjs` still bundles them into `lib/client.js`, so
 *     the artifact-level guards (`test/client-bundle.test.js`,
 *     `test/protocol-shape-card.test.js`) keep reading the shipped bundle and
 *     stay meaningful — moving the source here changes nothing about what the
 *     bundle contains.
 *
 * The motivation traces to the same pain `dsh-connect-sensenova-token-plan`
 * solved by hoisting its snapshot decision logic into a Node-importable
 * `snapshot.ts`: a rule that lives only inside the browser bundle can be
 * pinned only by scraping the artifact or by mirroring it in a test, and both
 * drift. See `docs/KNOWN_GAPS.md`.
 *
 * NOTE: `describeThrown` stays in `card.tsx`, not here. It is called from two
 * `catch` blocks that format a *display* string, not from any pure rule, and
 * it is a one-line narrowing duplicated from `src/host/errors.ts` on purpose
 * (no client file imports from `src/host/`).
 */

/** One model row as the models route serves it. */
export interface CardModelRow {
	id: string
	region?: string
	name?: string
	contextWindowLabel?: string
	contextOptions?: unknown[]
	defaultContextWindow?: number
	priceFactor?: number
	/** Normalized by `upstream.normalizePromotion`; see `Promotion` in domain.ts. */
	promotion?: CardPromotion | null
	[key: string]: unknown
}

/** The time-of-day discount block, as the card reads it. */
export interface CardPromotion {
	active?: boolean
	windowStart?: string
	windowEnd?: string
	timezone?: string
	beforePromotionPriceFactor?: number
	discountFactor?: number
	[key: string]: unknown
}

/** A per-region usage block on the usage route's answer. */
export interface CardUsageRegion {
	region?: string
	regionName?: string
	displayName?: string
	available?: boolean
	expiresAt?: number
	userQuota?: CardQuota
	addOnQuota?: CardQuota
	dedicatedPackages?: CardQuota[]
	campaigns?: CardCampaign[]
	checkin?: CardCheckin
	[key: string]: unknown
}

/** One quota bucket, in either the base or the add-on slot. */
export interface CardQuota {
	used?: number
	total?: number
	remaining?: number
	unit?: string
	percentage?: number
	[key: string]: unknown
}

/** One promotional campaign row. */
export interface CardCampaign {
	id?: string
	badge?: string
	description?: string
	endsAt?: number
	[key: string]: unknown
}

/**
 * The daily check-in block, as the host's `checkinStateFrom` answers it.
 *
 * `active` says upstream has a round running, `todayCheckedIn` says this
 * account already collected it, and `amount` is the round's worth — taken from
 * the live campaign's benefit, so it is a fact the host resolved rather than a
 * number this card worked out. It is present whether or not the round has been
 * claimed, which is what lets the card keep showing what today is worth after
 * the button flips to "今日已签到".
 */
export interface CardCheckin {
	active?: boolean
	todayCheckedIn?: boolean
	amount?: number
	[key: string]: unknown
}

/** One account row as the account route serves it. */
export interface CardAccountEntry {
	region?: string
	regionName?: string
	appName?: string
	displayName?: string
	state?: string
	detail?: string
	downloadUrl?: string
	source?: string
	/** The provider switch, as the route resolved it (absent = offered). */
	enabled?: boolean
	identity?: { name?: string; email?: string; expiresAt?: number } | null
	[key: string]: unknown
}

/** The translation function the host injects. */
export type TranslateFn = (key: string, params?: Record<string, string | number>) => string

/**
 * Browser event shapes the card's handlers actually read.
 *
 * Not `unknown`, and not the DOM's own `Event` either — the JSX shim declares
 * `JSX.IntrinsicElements` only as an index signature, so there is no element
 * type for `jsx()` to propagate into a handler. What the code needs is narrow
 * and worth stating: a checkbox handler reads `target.checked`, a select or
 * text input reads `target.value`. Naming the two separately means each call
 * site says which one it is, and a `checked` read on a `value` handler is a
 * compile error rather than `undefined` at runtime.
 */
export interface CheckboxEvent {
	target: { checked: boolean }
}
export interface ValueEvent {
	target: { value: string }
}

/** A browser event handler, as the JSX shim's `jsx()` sees it. */
export type EventHandler = (event: unknown) => void

/** Fill a `{date}` placeholder in a translated string. */
export function withDate(template: string, at: number | undefined): string {
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
export function rateLabelOf(t: TranslateFn, factor: unknown): string | undefined {
	const value = Number(factor);
	if (!Number.isFinite(value)) return undefined;
	return value <= 0 ? t("row.rateFree") : `x${value.toFixed(2)}`;
}

/** Seconds past local midnight in `timezone`, or undefined when unusable. */
export function localSecondsOf(date: Date, timezone: string): number | undefined {
	try {
		const parts = new Intl.DateTimeFormat("en-US", {
			timeZone: timezone,
			hour12: false,
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit"
		}).formatToParts(date);
		const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? Number.NaN);
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
export function parseClock(text: unknown): number | undefined {
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
 * SYNC CONSTRAINT: this mirrors lib/offpeak.js. The card runs in the browser
 * and cannot be imported into a Node test, so the rule is pinned twice:
 * test/model-row.test.js specifies it, test/client-bundle.test.js executes
 * the shipped bundle — see docs/KNOWN_GAPS.md item 3（客户端卡片的门控表达式）.
 *
 * @returns `{ active, remainingSeconds }`, or undefined when the model
 *   carries no usable window or its promotion is not active.
 */
export function offPeakState(model: CardModelRow, now: Date): { active: boolean; remainingSeconds: number } | undefined {
	const promo = model.promotion;
	if (promo === null || typeof promo !== "object") return undefined;
	if (promo.active !== true) return undefined;
	const start = parseClock(promo.windowStart);
	const end = parseClock(promo.windowEnd);
	if (start === undefined || end === undefined || start === end) return undefined;
	const seconds = localSecondsOf(now, typeof promo.timezone === "string" ? promo.timezone : "Asia/Shanghai");
	if (seconds === undefined) return undefined;
	const active = start < end ? seconds >= start && seconds < end : seconds >= start || seconds < end;
	const target = active ? end : start;
	const remainingSeconds = target >= seconds ? target - seconds : 86400 - seconds + target;
	return { active, remainingSeconds };
}

/** `HH:MM:SS` from a second count, matching the Qoder client's countdown. */
export function formatCountdown(seconds: unknown): string {
	const total = Math.max(0, Math.floor(Number(seconds) || 0));
	const pad = (value: number) => String(value).padStart(2, "0");
	return [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60].map(pad).join(":");
}

/**
 * A short label for a raw context-window token count, matching the
 * catalog's own naming (`1M` / `200K` / `128K`).
 */
export function formatContextWindowForUi(tokens: unknown): string {
	const n = Number(tokens)
	if (!Number.isFinite(n) || n <= 0) return "";
	if (n >= 1000000) return `${Math.round(n / 1000000)}M`;
	if (n >= 1000) return `${Math.round(n / 1000)}K`;
	return String(n);
}

/**
 * The window label for one model row.
 *
 * The host already computes this — `contextWindowLabel` on every row it serves
 * — and this used to recompute it from `contextOptions` /
 * `defaultContextWindow`. The two copies had drifted: the host shows a label
 * only when upstream published BOTH a non-empty `contextOptions` and a
 * positive `defaultContextWindow`, while this one showed a label for any
 * non-empty `contextOptions` and fell back to the widest offered window. For a
 * model whose `context_config` lists windows but marks none as default, the
 * card showed a size and the picker showed none (test/card-host-parity.test.js
 * pins that state).
 *
 * So this reads the host's answer. The remaining local work is one thing the
 * host cannot do: the per-row toggle, which flips between the default and the
 * widest at click time, before any refresh has happened. Both choices are
 * therefore derived from the shipped `contextOptions` — and the guard is
 * deliberately the HOST's rule (a default must exist), not the old
 * options-only one, so the two screens cannot diverge again.
 */
export function windowLabelOf(model: CardModelRow, preferMax: boolean): string {
	const hostLabel = model.contextWindowLabel;
	const options = Array.isArray(model.contextOptions) ? model.contextOptions.filter((n): n is number => Number(n) > 0) : [];
	// Nothing offered, or nothing marked as the default: no label, which is the
	// host's `contextWindowIsReal` rule.
	if (options.length === 0 || !(Number(model.defaultContextWindow) > 0)) return "";
	// The toggled state, which no host field can express, is the widest offered
	// window; otherwise the host's own label already says it.
	if (preferMax) return formatContextWindowForUi(Math.max(...options.map(Number)));
	return typeof hostLabel === "string" ? hostLabel : formatContextWindowForUi(Number(model.defaultContextWindow));
}

/**
 * The multiplier that applies at `now`.
 *
 * Mirrors the host's resolution: `priceFactor` is Qoder's *discounted*
 * price, and `beforePromotionPriceFactor` is what applies outside the
 * window — the two are related by exactly `before x discount`. Reading
 * `priceFactor` alone understates the cost for most of the day.
 */
export function rateAt(model: CardModelRow, now: Date): number | undefined {
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
 * The one refresh verdict this card should show, from the host's report.
 *
 * A pure function of `value` so the decision can be tested against the shipped
 * bundle (see test/protocol-shape-card.test.js) rather than only by reading JSX.
 *
 * The host sends `{ refreshedAt, refreshFailures }`. Four outcomes, kept apart
 * on purpose — collapsing them is the bug this replaces:
 *
 * - **no failure** → `null`: the rows shown are the last upstream answer, and
 *   the "已更新（time）" stamp is honest.
 * - **a transient failure** (`fetch` / `credential` / `no-credential`) → the
 *   stamp still shows, marked stale, because the rows on screen are real, just
 *   old. The user's next move is to retry.
 * - **`persist`** → the rows on screen are the newest answer, but the disk
 *   write was swallowed, so they will not survive a restart. Nothing is wrong
 *   with the data being shown — only with its durability — so this gets its
 *   own wording instead of a misleading "stale" or a confident "updated".
 * - **`protocol-shape-changed`** → the envelope moved and the plugin is out of
 *   date. This is the case that used to be indistinguishable from a queue: the
 *   user was told to re-sign, or waited out a retry ladder that could not
 *   possibly help. Neither appears here — the copy points at a plugin update.
 *
 * The protocol verdict wins over a transient one in the same payload, since it
 * is the one that cannot resolve on its own; `persist` outranks a transient
 * one because it names a different, actionable condition.
 */
export function refreshNoticeKey(value: unknown): string | null {
	const failures = Array.isArray((value as { refreshFailures?: unknown } | null | undefined)?.refreshFailures) ? (value as { refreshFailures: unknown[] }).refreshFailures : [];
	if (failures.length === 0) return null;
	if (failures.some((f) => (f as { reason?: string } | null | undefined)?.reason === "protocol-shape-changed")) return "protocol-shape-changed";
	if (failures.some((f) => (f as { reason?: string } | null | undefined)?.reason === "persist")) return "persist";
	return "transient";
}
