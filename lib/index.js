import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import { basename, dirname, join } from "node:path";
import z from "@deepseek-ai/schemastery";
import { resolveImageAttachmentAccess, resolveRetryPolicy } from "@deepseek-ai/dsh-llm";
import { createProvider } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { PiAiAdapter } from "@deepseek-ai/dsh-llm-pi-ai";
import { createServer } from "node:http";
import crypto, { createDecipheriv, createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { execFile, execFileSync } from "node:child_process";
import { closeSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, truncateSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { isDeepStrictEqual } from "node:util";

//#region src/host/route-retry-policy.ts
/**
* The retry policy this plugin hands the host for every region route.
*
* The host runs its own retry loop on top of a provider failure, so this
* route narrows the retryable SET to the failures along the loopback hop —
* which the plugin cannot retry itself: an empty provider response, a stream
* idle past `streamIdleTimeoutMs`, a transport failure between host and shim.
*
* `maxRetries` and `backoff` are deliberately NOT set: the host owns its
* budget and its delays; narrowing the SET is the only decision that is ours.
* Accident history: docs/issues/24-terminal-failure-status-codes.md
*/
const ROUTE_RETRY_POLICY = {
	mode: "normal",
	retryableCodes: [
		"EMPTY_RESPONSE",
		"TIMEOUT",
		"TRANSPORT"
	]
};

//#endregion
//#region src/host/volatile.ts
/**
* Resolve a value that may be a volatile live reference.
*
* The `get()` call is made behind the runtime check below, which is what the
* narrowing hinges on — an `as` would suppress exactly the property access this
* guard is there to make legal.
*
* @param value - a field value, possibly a `{ get() }` shell.
* @returns the resolved value.
*/
function unwrapVolatile(value) {
	if (value !== null && typeof value === "object" && typeof value.get === "function") return value.get();
	return value;
}

//#endregion
//#region src/host/preferences.ts
/**
* Resolving the three settings this plugin offers.
*
* Extracted from `activate` in lib/index.js. The logic is pure — it takes a
* configuration source and answers questions about it — but it was inlined in a
* function that cannot be imported, so none of it was covered.
*
* Two of the three settings are read on every model build and on every listing,
* so their resolution sits on the hot path of a card render. The interesting
* part is the live-reference shape: a volatile field holds `{ get() }`
* rather than a value, and reading it directly yields the shell.
*
* @module dsh-connect-qoder/preferences
*/
/** The per-model image modes a saved override may hold. */
const IMAGE_MODES = [
	"on",
	"off",
	"auto"
];
/** The image mode used when nothing says otherwise. */
const DEFAULT_IMAGE_MODE = "auto";
function resolvePreferences(snapshot, source) {
	let resolved = typeof source === "function" ? source() : source;
	resolved = unwrapVolatile(resolved);
	if (resolved === void 0 || resolved === null) return snapshot;
	if (Object.prototype.toString.call(resolved) !== "[object Object]") return snapshot;
	return {
		...snapshot,
		...resolved
	};
}
/** The sentinel a region's allow-list carries to mean "hide every model".
* The host convention is `[] = no filter = show all`, so "hide all" has no
* value of its own; a marker no model id can ever equal expresses it without
* touching that convention. It stays a sentinel, not `null`: existing settings
* hold `["__hide-all__"]` (docs/issues/12-small-fixes-batch.md).
*/
const HIDE_ALL_MODELS = "__hide-all__";
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
function enabledIdsFor(preferences, regionId) {
	const byRegion = unwrapVolatile(preferences?.enabledModelIds);
	if (byRegion === null || typeof byRegion !== "object") return [];
	if (!Object.hasOwn(byRegion, regionId)) return [];
	const list = byRegion[regionId];
	return Array.isArray(list) ? list.filter((id) => typeof id === "string" && id.length > 0) : [];
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
function imageModeFor(preferences, modelId) {
	const overrides = unwrapVolatile(preferences?.imageOverrides);
	if (overrides === null || typeof overrides !== "object") return DEFAULT_IMAGE_MODE;
	if (!Object.hasOwn(overrides, modelId)) return DEFAULT_IMAGE_MODE;
	const saved = overrides[modelId];
	return IMAGE_MODES.includes(saved) ? saved : DEFAULT_IMAGE_MODE;
}
/**
* Whether to advertise each model's largest declared context window.
*
* @param preferences - the resolved settings.
* @returns true when the maximum-context switch is on.
*/
function preferMaximumContext(preferences) {
	return unwrapVolatile(preferences?.useMaximumContextWindow) === true;
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
function regionEnabledFor(preferences, regionId) {
	const map = unwrapVolatile(preferences?.enabledRegions);
	if (map === null || typeof map !== "object") return true;
	if (!Object.hasOwn(map, regionId)) return true;
	return map[regionId] !== false;
}

//#endregion
//#region src/host/offpeak.ts
/**
* Seconds past local midnight in `timezone`, or `undefined` when the zone is
* unusable.
*
* Every caller must spell the fallback out. A window Qoder publishes without a
* zone (`22:00`-`08:00`) has to be read in Shanghai time, but `undefined` here
* does NOT mean Shanghai — it means the *machine's* zone, so a host west of +08
* would place the window eight hours off and invert the day. That went
* unnoticed for as long as it did because a laptop in China is already on
* `Asia/Shanghai`, which made the omission look correct; the `TZ=UTC` row of
* CI is what caught it. `src/client/card.tsx` carries the same fallback for the
* card's copy of this arithmetic.
*
* `Intl` is used rather than a manual UTC offset because the promotion window is
* declared in a named zone (`Asia/Shanghai`) and China has no DST — but a zone
* that does would silently drift with a fixed offset.
*/
function localSecondsOf(date, timezone) {
	try {
		const parts = new Intl.DateTimeFormat("en-US", {
			timeZone: timezone,
			hourCycle: "h23",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit"
		}).formatToParts(date);
		const read = (type) => Number(parts.find((part) => part.type === type)?.value ?? NaN);
		const hour = read("hour") % 24;
		const minute = read("minute");
		const second = read("second");
		if (![
			hour,
			minute,
			second
		].every(Number.isFinite)) return void 0;
		return hour * 3600 + minute * 60 + second;
	} catch {
		return;
	}
}
/** Parse `HH:MM` (or `HH:MM:SS`) into seconds past midnight. */
function parseClock(text) {
	const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(text).trim());
	if (match === null) return void 0;
	const hour = Number(match[1]);
	const minute = Number(match[2]);
	const second = Number(match[3] ?? 0);
	if (hour > 23 || minute > 59 || second > 59) return void 0;
	return hour * 3600 + minute * 60 + second;
}
/**
* Whether `now` falls inside the clock window, ignoring any campaign state.
*
* Split out of `isOffPeakActive` because `upstream.normalizePromotion` needs
* exactly this bare question: Qoder's `active` flag flips with the window, and
* telling "window closed" from "campaign killed" requires evaluating the clock
* before the flag is ever consulted.
*
* A window whose end is not after its start crosses midnight (`22:00`-`08:00`
* is the case Qoder actually uses), so the test is a disjunction rather than a
* range check.
*/
function windowIsOpen(windowStart, windowEnd, timezone, now = /* @__PURE__ */ new Date()) {
	const start = parseClock(windowStart);
	const end = parseClock(windowEnd);
	if (start === void 0 || end === void 0 || start === end) return false;
	const seconds = localSecondsOf(now, timezone ?? "Asia/Shanghai");
	if (seconds === void 0) return false;
	return start < end ? seconds >= start && seconds < end : seconds >= start || seconds < end;
}
/**
* Whether a model's off-peak discount is in effect right now.
*
* `entry.promotion.active` means "the campaign is on" — the producer
* (`upstream.normalizePromotion`) is what turns Qoder's moment-in-time flag
* into that meaning. Given a live campaign, the window itself is evaluated
* locally, matching what the Qoder client does.
*
* @param entry - one catalog entry.
* @param now - the instant to evaluate.
* @returns true when the discount applies.
*/
function isOffPeakActive(entry, now = /* @__PURE__ */ new Date()) {
	const promotion = entry.promotion;
	if (promotion === void 0 || promotion.active !== true) return false;
	return windowIsOpen(promotion.windowStart, promotion.windowEnd, promotion.timezone, now);
}
/**
* The multiplier that actually applies right now.
*
* Qoder publishes `price_factor` as the **discounted** price and
* `before_promotion_price_factor` as the price outside the window — the two are
* related by exactly `before × discount_factor`, which is what the catalog
* reports while the window is open. Reading `price_factor` alone therefore
* understates the cost by the discount for most of the day: during working hours
* these models bill at the *before* rate, which is 2.5x to 5x higher.
*
* The window is evaluated locally rather than trusted from the server, matching
* what the Qoder client itself does, so the number is right on both sides of the
* boundary regardless of when the catalog was fetched.
*
* @param entry - one catalog entry.
* @param now - the instant to evaluate.
* @returns the multiplier, or `NaN` when nothing usable is declared.
*/
function effectiveRate(entry, now = /* @__PURE__ */ new Date()) {
	const base = Number(entry.priceFactor);
	const promotion = entry.promotion;
	if (promotion === void 0) return Number.isFinite(base) ? base : NaN;
	const before = Number(promotion.beforePromotionPriceFactor);
	const discount = Number(promotion.discountFactor);
	if (isOffPeakActive(entry, now)) {
		if (Number.isFinite(before) && Number.isFinite(discount)) return before * discount;
		return Number.isFinite(base) ? base : NaN;
	}
	if (Number.isFinite(before)) return before;
	return Number.isFinite(base) ? base : NaN;
}
/**
* Seconds until the current off-peak window flips, or `undefined`.
*
* @param entry - one catalog entry.
* @param now - the instant to evaluate.
* @returns the countdown, or `undefined` when no window is in play.
*/
function offPeakRemaining(entry, now = /* @__PURE__ */ new Date()) {
	const promotion = entry.promotion;
	if (promotion === void 0 || promotion.active !== true) return void 0;
	const start = parseClock(promotion.windowStart);
	const end = parseClock(promotion.windowEnd);
	if (start === void 0 || end === void 0 || start === end) return void 0;
	const seconds = localSecondsOf(now, promotion.timezone ?? "Asia/Shanghai");
	if (seconds === void 0) return void 0;
	const target = (start < end ? seconds >= start && seconds < end : seconds >= start || seconds < end) ? end : start;
	return target >= seconds ? target - seconds : 86400 - seconds + target;
}
const offPeakActive = isOffPeakActive;
const rateNow = effectiveRate;

//#endregion
//#region src/host/pi-model.ts
/**
* The pi-ai model descriptor.
*
* Extracted from lib/adapter.js so it can be tested. `toPiModel` is a pure
* function of a catalog entry and a few flags — it builds a plain object and
* touches no pi-ai API — but it lived inside a module whose top-level imports
* pull in `@earendil-works/pi-ai` and `@deepseek-ai/dsh-llm-pi-ai`, so no test
* could reach it.
*
* That mattered, because this function carries two decisions whose failure mode
* is invisible until every single request breaks:
*
* 1. `compat.supportsDeveloperRole: false`. pi-ai picks the system-prompt role
*    as `reasoning && compat.supportsDeveloperRole ? 'developer' : 'system'`,
*    and auto-detects the flag when it is unset — returning true for anything
*    that does not look like a known non-standard provider. This route's baseUrl
*    is the loopback shim, so nothing matches and the value resolves to true.
*    Every Qoder model declares `reasoning: true`, so pi-ai then emits
*    `role: "developer"`, which Qoder does not have. The result is a permanent
*    `403 {"code":"10605"}` on every attempt, no matter how long DSH retries,
*    with an error message about being "in the queue" that is pure fiction.
* 2. `maxTokens` is pinned to `PROBED_MAX_TOKENS` (65536), the platform's
*    probed single-call output ceiling. This used to be the opposite — "no
*    value, on purpose" — and that was the more expensive mistake, because
*    omission does NOT mean "no ceiling". dsh-llm-pi-ai's `resolveEntry` runs
*    `entry.maxTokens ?? base?.maxTokens ?? request.defaultMaxTokens`, and
*    that chain bottoms out at a 32768 default: an undeclared ceiling was
*    silently capping every reply (reasoning and answer share the budget), so
*    a long reasoned turn ended in a forced stop at 32K while the platform
*    itself would have allowed 64K. The pin is the probed value, not a
*    documented one — the platform's 400-body says "max_tokens 不能超过
*    65536", and the re-probe (`scripts/probe-max-tokens.mjs`) is the rule:
*    the accepted value must still be accepted, and twice it must still be
*    rejected, on whatever machine has credentials.
*
* Neither is a cosmetic field. Both are now asserted in `test/pi-model.test.js`
* — the value of `maxTokens` on purpose, not just its presence, so a future
* "simplification" that drops it back to omission fails the suite instead of
* re-halving the ceiling.
*
* @module dsh-connect-qoder/pi-model
*/
/** No per-token price is knowable for a subscription quota; report zero. */
const NO_COST = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0
};
/** Default context window when the catalog declares no usable one. */
const FALLBACK_CONTEXT_WINDOW = 2e5;
/**
* The platform's single-call output ceiling, in tokens: 64K.
*
* This is the value every descriptor declares as `maxTokens`, and it is the
* number that replaces the old "deliberately absent" decision — see the module
* header, item 2, for the fallback chain that made omission a trap.
*
* Provenance, so the number is never re-invented from memory: the sibling
* plugin's live probe (dsh-connect-agnes-token-plan, 2026-10-01) sent
* 32768 / 65536 / omitted (all accepted, HTTP 200) and 131072 (rejected, HTTP
* 400, platform's own words: "max_tokens 不能超过 65536"). The ceiling is
* therefore platform-stated, not guessed. Per the live-contract discipline
* the guide pins (§5: values to be pinned are probed, not documented), a
* machine with Qoder credentials must re-run `scripts/probe-max-tokens.mjs`
* before trusting the constant: 65536 must still be accepted, and 131072
* must still be rejected.
*
* The effective per-turn cap is `min(PROBED_MAX_TOKENS, contextWindow − prompt
* − 4096)` — the 4096 is pi-ai's `clampMaxTokensToContext` safety margin
* (`CONTEXT_SAFETY_TOKENS`). With this plugin's context windows (≥ 200K) the
* clamp never binds, which is also why the margin does not need a constant
* here.
*/
const PROBED_MAX_TOKENS = 65536;
/**
* Whether one model may receive images.
*
* `auto` follows the catalog's own `is_vl` flag, which is what Qoder publishes
* for every model it serves; `on` and `off` are the user's explicit override
* from the settings card. An unrecognised mode degrades to `auto` rather than
* disabling images, so a stale saved value cannot silently drop a capability.
*
* @param entry - one normalized catalog entry.
* @param imageMode - `'auto'`, `'on'`, or `'off'`.
* @returns true when the model should declare image input.
*/
function imageEnabled(entry, imageMode) {
	if (imageMode === "on") return true;
	if (imageMode === "off") return false;
	return entry.isVL === true;
}
/**
* The name the picker shows for one model.
*
* `listModels` forwards only `id`, `name`, and the input modalities, so the
* multiplier has nowhere else to travel and is folded into the name — the same
* approach the WorkBuddy bundle uses for its own rate. Every DSH-side join keys
* on the model **id** (the selector's choice, the session events, the wire
* request), so decorating the name is display-only and cannot affect routing.
*
* A zero multiplier means the model is free, which is worth saying outright;
* anything else is shown to two decimals so the ordering is comparable. A
* catalog entry with no multiplier at all keeps its bare name. Outside an
* active window the name additionally promises the switch hour and the
* discounted rate — daytime alone, the multiplier would hide that a discount
* exists at all for anyone who never opens the plugin card.
*/
/** `22:00` reads as `22点`; `22:30` keeps its minutes; anything else is nothing to promise. */
function switchClockLabel(text) {
	const match = /^(\d{1,2}):(\d{2})$/.exec(String(text ?? "").trim());
	if (match === null) return void 0;
	const hour = Number(match[1]);
	const minute = Number(match[2]);
	if (hour > 23 || minute > 59) return void 0;
	return minute === 0 ? `${hour}点` : `${hour}:${match[2]}`;
}
function displayNameFor(entry, now) {
	const factor = rateNow(entry, now);
	if (!Number.isFinite(factor)) return entry.name;
	if (factor <= 0) return `${entry.name} · 免费`;
	const base = `${entry.name} · x${factor.toFixed(2)}`;
	const promotion = entry.promotion;
	if (offPeakActive(entry, now)) return `${base} 错峰`;
	if (promotion !== void 0 && promotion.active === true) {
		const discounted = Number(promotion.beforePromotionPriceFactor) * Number(promotion.discountFactor);
		const label = switchClockLabel(promotion.windowStart);
		if (Number.isFinite(discounted) && discounted < factor && label !== void 0) return `${base}（${label} x${discounted.toFixed(2)}）`;
	}
	return base;
}
/**
* The context window to advertise.
*
* Taken from `context_config`, not `max_input_tokens`: the former is the set of
* windows the app itself offers, with one flagged as the default, while the
* latter is a smaller per-request floor that is not the advertised capacity.
* When the user asked for the maximum, the largest offered window is advertised
* instead — the Qoder client offers these up to 1M, so the gateway accepts it.
*
* @returns the advertised context window.
*/
function resolveContextWindow(entry, preferMaximumContext) {
	const options = Array.isArray(entry.contextOptions) ? entry.contextOptions.map(Number).filter((n) => Number.isFinite(n) && n > 0) : [];
	const widest = options.length > 0 ? Math.max(...options) : 0;
	const preferred = preferMaximumContext && widest > 0 ? widest : 0;
	if (preferred > 0) return preferred;
	if (Number(entry.defaultContextWindow) > 0) return Number(entry.defaultContextWindow);
	if (Number(entry.maxInputTokens) > 0) return Number(entry.maxInputTokens);
	return FALLBACK_CONTEXT_WINDOW;
}
/**
* Whether the advertised window for this entry is a value upstream actually
* published (`context_config`), rather than a local degradation: `resolveContextWindow`
* falls back to `max_input_tokens` (a per-request floor) or the built-in
* `FALLBACK_CONTEXT_WINDOW` when the catalog published no `context_config`, and
* a UI label must not present that fallback as if Qoder had offered it.
*/
function contextWindowIsReal(entry) {
	return Array.isArray(entry.contextOptions) && entry.contextOptions.some((n) => Number(n) > 0) && Number(entry.defaultContextWindow) > 0;
}
/**
* A short human label for a token count, matching the catalog's own naming
* (`1M` / `200K` / `128K`). Returns `''` for a value that should not be shown.
*/
function formatContextWindow(tokens) {
	const n = Number(tokens);
	if (!Number.isFinite(n) || n <= 0) return "";
	if (n >= 1e6) return `${Math.round(n / 1e6)}M`;
	if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
	return String(n);
}
/**
* The window label the model row should display for one entry, or `''` when the
* catalog published no selectable windows (showing a fallback number there
* would claim a window size upstream does not actually offer).
*/
function contextWindowLabelFor(entry, preferMaximumContext) {
	if (!contextWindowIsReal(entry)) return "";
	return formatContextWindow(resolveContextWindow(entry, preferMaximumContext));
}
/**
* The thinking-level map the picker reads.
*
* The same decision the wire makes, expressed for the picker: a model that
* always thinks refuses `enable_thinking: false`, so `off` is reported as
* unsupported for it rather than offered and then rejected upstream.
*
* `off` is a wire spelling, not a switch, and this is where the plugin's
* default-thinking behaviour lives. pi-ai's openai-completions builder has
* two different dispatches that both read this one key:
*
* - **default** (no effort selected in the DSH picker): it sends
*   `reasoning_effort` ONLY when `off` holds a string; an absent key means
*   "supported, send nothing" — so an absent `off` is what makes a bare
*   model selection reach the shim without an effort, and the shim then
*   defaults to the model's own thinking nature (the WorkBuddy/Trae shape:
*   their maps never carry an `off` string, which is why their "Default"
*   thinks while this plugin's used not to — it spelled `off` out, so the
*   default path sent an explicit `reasoning_effort: 'off'` and the shim
*   obeyed it).
* - **an explicit `off` selection**: it falls back to the level's own name
*   (`?? options.reasoningEffort`), so "off" is still offered in the picker
*   and still disables thinking for a model that can disable it. An absent
*   key therefore keeps off functional while changing what "no choice"
*   means — the two states that used to be indistinguishable.
*
* A non-reasoning model gets no map at all, rather than a map of nulls.
*/
function thinkingLevelMapFor(entry) {
	if (entry.isReasoning !== true) return void 0;
	const levels = Array.isArray(entry.effortLevels) ? entry.effortLevels : [];
	const offered = (level) => levels.includes(level) ? level : null;
	return {
		...entry.alwaysThinking !== true ? {} : { off: null },
		minimal: null,
		low: offered("low"),
		medium: offered("medium"),
		high: offered("high"),
		xhigh: offered("xhigh"),
		max: offered("max")
	};
}
/**
* Map a catalog entry onto a pi-ai model descriptor.
*
* `id` is the value DSH shows and the value the shim receives; `upstreamKey`
* rides along as the Qoder-side model key, which the shim needs on the wire.
*
* @param entry - one normalized catalog entry.
* @param baseUrl - the region's loopback shim, with the `/v1` suffix.
* @param providerId - the DSH provider this model belongs to.
* @param preferMaximumContext - advertise the largest offered window.
* @param imageMode - `'auto'`, `'on'`, or `'off'`.
* @param now - the instant the displayed rate is resolved against.
* @returns the pi-ai model descriptor.
*/
function toPiModel(entry, baseUrl, providerId, preferMaximumContext = false, imageMode = "auto", now = /* @__PURE__ */ new Date()) {
	const thinkingLevelMap = thinkingLevelMapFor(entry);
	return {
		id: entry.id,
		name: displayNameFor(entry, now),
		api: "openai-completions",
		provider: providerId,
		baseUrl,
		input: imageEnabled(entry, imageMode) ? ["text", "image"] : ["text"],
		reasoning: entry.isReasoning === true,
		...thinkingLevelMap === void 0 ? {} : { thinkingLevelMap },
		cost: NO_COST,
		contextWindow: resolveContextWindow(entry, preferMaximumContext),
		maxTokens: PROBED_MAX_TOKENS,
		compat: {
			maxTokensField: "max_tokens",
			supportsDeveloperRole: false
		},
		upstreamKey: entry.key
	};
}

//#endregion
//#region src/host/errors.ts
/**
* The `message` of a thrown value, as a string, or `''` when it has none.
*
* A catch block's binding is `unknown` (`useUnknownInCatchVariables` is on), so
* `.message` is not readable without narrowing first. This is that narrowing,
* written once instead of as `String((error as { message?: unknown })?.message ?? error)`
* at each of the two dozen catch sites — a spelling that also quietly loses the
* non-Error throw (a bare string, a rejected non-object) by stringifying
* `undefined` into the word "undefined".
*
* Deliberately narrow: it reads ONE field off a value it does not trust, and
* answers `''` rather than inventing a description. Callers that need the
* original value stringified should use {@link describeThrown}.
*
* @param error - the thrown value.
* @returns its `message` when that is a string, otherwise `''`.
*/
function errorMessage(error) {
	const message = error?.message;
	return typeof message === "string" ? message : "";
}
/**
* A human-readable description of a thrown value, whatever it turned out to be.
*
* The three cases that actually occur, in the order that reads best:
*
* 1. an `Error` (or anything with a string `message`) — its message;
* 2. a bare string thrown by hand — the string itself;
* 3. anything else (a rejection carrying an object, `undefined`) — `String()`.
*
* The reason this is not just `String(error)` is that it turns an `Error` into
* `"Error: the real reason"`, prefixing the noise the caller is trying to read
* past. The reason it is not just `error.message` is that a non-Error throw
* then arrives as the literal text `"undefined"`, which is how a bare string
* rejection reached the account panel as an empty-looking message.
*
* @param error - the thrown value.
* @returns a non-empty description; `'undefined'` only for an actual `undefined` throw.
*/
function describeThrown(error) {
	const message = errorMessage(error);
	if (message !== "") return message;
	if (typeof error === "string") return error;
	return String(error);
}
/**
* Read a flag or field off a thrown value, without trusting its shape.
*
* The shim and the classifier both hang their own flags on errors
* (`retryable`, `dailyLimit`, `signInExpired`, `protocolShapeChanged`) precisely
* because the value crosses a throw boundary and may lose its prototype on the
* way. Reading those flags off an `unknown` binding is the same narrowing every
* time, so it is written once here.
*
* `key` is one of the known flag names, NOT an arbitrary string: a helper that
* accepts any key would let a typo (`'retryble'`) compile and read `undefined`
* forever, which is the failure mode this whole file exists to avoid.
*
* @param error - the thrown value.
* @param key - the field to read.
* @returns the field's value, still `unknown` — callers compare it, never
*   assume it. An absent field and a `null` one both answer `undefined`.
*/
function thrownFlag(error, key) {
	return error?.[key];
}
/** The provider-registration verdict, in the shape the browser may see: a failure is
* recorded rather than thrown (docs/issues/20-llm-handoff-detached.md), so it must be published
* or it is invisible; only `name` is published, never `message` (a thrown value can carry a
* credential-bearing URL), and `errorName` is never empty.
* @param error - the recorded registration error, or `undefined` on success.
* @returns `{ ok: true }`, or `{ ok: false, errorName }` with a non-empty name. */
function providerRegistrationState(error) {
	if (error === void 0) return { ok: true };
	const name = thrownFlag(error, "name");
	return {
		ok: false,
		errorName: typeof name === "string" && name !== "" ? name : "Error"
	};
}
/**
* A refusal that means the sign-in is gone, so the cached credential is stale.
*
* The upstream layer used to build this as `const error: any = new Error(msg)`
* and then hang `signInExpired = true` on it. That worked, and the flag is
* genuinely what {@link isStaleCredentialError} reads — but declaring the local
* `any` meant the assignment itself was never checked, and the two throw sites
* had to agree by hand with a reader in another file.
*
* The property is declared here rather than inferred, so the two sites and the
* reader are tied together by the compiler.
*/
var SignInExpiredError = class extends Error {
	/** Read by {@link isStaleCredentialError}. Always true (see class doc). */
	signInExpired;
	/**
	* @param message - the readable sentence; built by the caller, which knows
	*   which of the two failure shapes produced it.
	*/
	constructor(message) {
		super(message);
		this.signInExpired = true;
	}
};
/**
* Read a Qoder error frame and decide what it actually is.
*
* Codes that arrive here have very different meanings, and conflating them sent
* the user looking at their account for what is really a queue:
*
* - **105 / TOKEN_EXPIRE** — the sign-in is gone. Nothing will succeed until
*   the user signs in to the Qoder app again.
* - **10605** — the request was queued or rate-limited. The body carries
*   `retryAfterSeconds` and `serviceAvailable`, so it is transient and must be
*   treated as retryable rather than as a rejection.
* - **110** — the account's DAILY billing count is spent. Transient in the sense
*   that it clears, but not in the sense that waiting helps within a session: it
*   resets at the day boundary, and the gateway still sends a Retry-After
*   measured in HOURS with it (7350 s in the report this rule is written from).
*   Retrying it produced a user reading "重试延迟：7350 毫秒" for something a
*   queue would have cleared in two seconds. So it is its own kind, never a
*   queue — see the ordering note on the check itself.
* - **protocol shape changes** — not a frame at all but an envelope this code
*   no longer recognises; they arrive as a 200 and are raised separately, as
*   ProtocolShapeChangedError.
*
* Exact code matches decide first, so a sign-in failure is never shadowed by a
* stray field name; the marker regex only fires as a fallback, and only when
* at least two queue markers co-occur, so an auth error that happens to carry
* a `retryAfterSeconds` field is not misread as a queue.
*/
/** The queue descriptor's field names; any two co-occurring mark a queue. */
const QUEUE_MARKERS = [
	"\"queueType\"",
	"\"retryAfterSeconds\"",
	"\"isQueued\"",
	"\"serviceAvailable\""
];
/** How many of the queue markers appear in a payload text. */
function queueMarkerCount(text) {
	let count = 0;
	for (const marker of QUEUE_MARKERS) if (text.includes(marker)) count += 1;
	return count;
}
/** Extract `retryAfterSeconds` from a queue payload, best-effort. */
function queueSeconds(text) {
	let node = text;
	for (let depth = 0; depth < 4; depth++) {
		let parsed;
		try {
			parsed = JSON.parse(node);
		} catch {
			return 0;
		}
		if (parsed === null || typeof parsed !== "object") return 0;
		const descriptor = parsed;
		const seconds = Number(descriptor.retryAfterSeconds);
		if (Number.isFinite(seconds) && seconds > 0) return seconds;
		if (typeof descriptor.message !== "string") return 0;
		node = descriptor.message;
	}
	return 0;
}
function classifyUpstreamError(_chunk, code, detail) {
	const text = String(detail ?? "");
	const normalized = String(code ?? "").replace(/^["']|["']$/g, "");
	if (normalized === "110" || normalized === "daily_limit_exceeded" || /billing daily count|daily count exceeded|daily limit|daily request allowance/i.test(text)) return {
		kind: "daily-limit",
		retryAfterSeconds: queueSeconds(text)
	};
	if (normalized === "10605") return {
		kind: "rate-limit",
		retryAfterSeconds: queueSeconds(text)
	};
	if (/Login expired|TOKEN_EXPIRE|token is not active/i.test(text) || normalized === "105") return { kind: "sign-in-expired" };
	if (queueMarkerCount(text) >= 2) return {
		kind: "rate-limit",
		retryAfterSeconds: queueSeconds(text)
	};
	return { kind: "upstream" };
}
/** The verdict for one non-2xx reply from a one-shot JSON endpoint. The body is
* classified FIRST, as docs/issues/23-upstream-429-daily-limit.md settled for the stream:
* a `daily_limit_exceeded` on a 429 is a spent allowance, not a rate limit, so the
* status is read only when the body says nothing; 403 is NOT a sign-in rejection
* (the campaigns endpoint is machine-identity gated), so only 401 means the sign-in is gone.
* @param status - the HTTP status of the reply.
* @param bodyText - the reply body as text, possibly empty or not JSON.
* @returns the verdict, plus any wait the BODY stated. */
function classifyHttpRefusal(status, bodyText) {
	const classified = classifyUpstreamError({}, httpFailureCode(bodyText), bodyText);
	if (classified.kind === "daily-limit" || classified.kind === "rate-limit" || classified.kind === "sign-in-expired") return {
		kind: classified.kind,
		retryAfterSeconds: classified.retryAfterSeconds ?? 0
	};
	if (status === 429) return {
		kind: "rate-limit",
		retryAfterSeconds: 0
	};
	if (status === 401) return {
		kind: "sign-in-expired",
		retryAfterSeconds: 0
	};
	return {
		kind: "upstream",
		retryAfterSeconds: 0
	};
}
/**
* Pull a failure code out of a non-stream HTTP body, leniently.
*
* The gateways have answered with the code in any of four places — top-level
* `code`, `errorCode`, `type` (which is where the new daily-limit 429 puts it),
* or nested under an OpenAI-shaped `error` object — and with the code as either
* a string or a number. A wrong guess here is not cosmetic: it is the difference
* between "your allowance is spent" and the harness retrying a request that
* resets at the day boundary. A body that is not JSON at all (an HTML SSO page,
* an empty 502) answers `''`, which leaves the status to speak.
*/
function httpFailureCode(bodyText) {
	try {
		const parsed = JSON.parse(bodyText);
		if (parsed === null || typeof parsed !== "object") return "";
		const record = parsed;
		const nested = record.error;
		const nestedRecord = nested !== null && typeof nested === "object" ? nested : void 0;
		const candidates = [
			record.code,
			record.errorCode,
			record.type,
			nestedRecord?.code
		];
		for (const candidate of candidates) {
			if (typeof candidate === "string" && candidate !== "") return candidate;
			if (typeof candidate === "number" && Number.isFinite(candidate)) return String(candidate);
		}
		return "";
	} catch {
		return "";
	}
}
/**
* Read a `Retry-After` hint as seconds, from either spelling the gateway uses.
*
* The header (and the JSON `retryAfterSeconds` field the frame path carries)
* reach this as an `unknown`: it has been a bare number, a numeric string, and
* an HTTP-date string ("Wed, 21 Oct 2026 07:28:00 GMT") across builds. The delta
* form is the wait itself; the date form is resolved against the wall clock, so
* a stale absolute deadline reads as `0` rather than a negative number that a
* caller would then have to clamp again.
*
* It is a pure function with no imports so the throttle gate (see
* `credential-cache.ts`) can honour a platform-stated window without inventing
* one — and so a test can feed it each real spelling.
*
* @param value - the header or field value, still `unknown`.
* @param now - the wall clock the date form is measured against; defaults to now.
* @returns whole seconds to wait (never negative), or `undefined` when the value
*   names no window at all. `undefined` and `0` differ: the first means "the
*   platform said nothing" and a caller falls back to its own backoff; the second
*   means "it said wait zero", which is already open.
*/
function parseRetryAfterSeconds(value, now = Date.now()) {
	if (value === void 0 || value === null) return void 0;
	const asNumber = Number(value);
	if (Number.isFinite(asNumber)) return Math.max(0, Math.round(asNumber));
	if (typeof value === "string") {
		const at = Date.parse(value);
		if (Number.isFinite(at)) return Math.max(0, Math.ceil((at - now) / 1e3));
	}
}
/**
* Whether an upstream failure means the cached credential has gone stale.
*
* A sign-in rejection is the one failure that must invalidate the cached
* credential: the Qoder app owns the token's lifecycle and refreshes it in its
* own store, so a re-sign-in is already on disk and simply not being read.
* Without this the stale entry stays cached for the life of the process and
* every request 401s until DSH is restarted.
*
* It lives here, rather than inline at each of the shim's two catch sites,
* because this module has no imports at all — so a test can import it and
* assert against the real predicate. The test that covers this used to
* re-implement the same expression inside the test file, which meant rewording
* or breaking the regex in production code left that test green; that was
* confirmed by mutation, not assumed.
*
* @param error - the thrown error, or `undefined` from a catch block.
* @returns true when the credential should be re-read on the next request.
*/
function isStaleCredentialError(error) {
	const e = error;
	if (e?.signInExpired === true) return true;
	return /sign-in is no longer valid|sign-in-expired/i.test(String(e?.message ?? ""));
}
/**
* A reply that is not a failure at all, but is not the protocol either.
*
* This plugin clones a private protocol with no version negotiation and no
* contract, so the most likely way it breaks is not a rejection — it is a
* successful HTTP 200 carrying an envelope this code no longer recognises (a
* renamed product-surface group, a new wrapper object, an HTML SSO page where
* JSON used to be). Before this error existed, every one of those arrived as
* "0 models", indistinguishable from an account that genuinely has none, and
* the plugin's own queue budget turned the rejection-shaped variants into a
* long wait instead of a diagnosis.
*
* The class carries `retryable = false` so {@link queueWaitFor} leaves it
* alone: waiting cannot fix a shape, and burning the two-minute budget on it
* is what produced "the plugin needs an update" arriving as a two-minute hang.
*
* The flag is on the error rather than in its name so the classifier can read
* it from a caught value that lost its prototype (a cross-realm throw, a
* re-wrapped error) — the same reason `signInExpired` is a flag.
*/
var ProtocolShapeChangedError = class extends Error {
	/** Whether this is a protocol-shape change rather than a refusal (see class doc). */
	protocolShapeChanged;
	/** Always false: waiting cannot fix a shape (see class doc). */
	retryable;
	/** What was received, in a form a human can act on. */
	detail;
	/**
	* @param detail - what was received, in a form a human can act on.
	*/
	constructor(detail) {
		super(`Qoder replied in a shape this plugin does not recognise (${detail}) — the client API it mirrors has probably changed and the plugin needs an update`);
		this.name = "ProtocolShapeChangedError";
		this.protocolShapeChanged = true;
		this.retryable = false;
		this.detail = detail;
	}
};
/**
* Whether a failure is a protocol-shape change rather than a refusal.
*
* Exported so the classifier reads the real predicate: a copy of this
* expression inside a test would only prove the copy agrees with itself, which
* is the exact failure mode this repository keeps rewriting its tests to
* remove.
*
* @param error - the thrown error, or `undefined` from a catch block.
* @returns true when the plugin should tell the user to update, not to re-sign.
*/
function isProtocolShapeChangedError(error) {
	return error?.protocolShapeChanged === true;
}
/** A refusal from a one-shot OpenAPI read (docs/issues/24-terminal-failure-status-codes.md),
* carrying the verdict the stream path already computes. The message is byte-identical to
* the plain `Error` it replaces, so the classification rides in flags, not in the wording;
* the flags are fields, not the class name, so a prototype-less value still reads
* through `thrownFlag`; no `retryable: false`: no queue ladder runs here, so an absent
* flag already answers "do not wait". */
var UpstreamRefusalError = class extends Error {
	/** The HTTP status of the reply, kept for callers that want to re-derive a verdict. */
	status;
	/** The verdict from {@link classifyHttpRefusal}. */
	upstreamKind;
	/** Seconds to wait: the `Retry-After` header when it stated one, else the body's own. */
	retryAfterSeconds;
	/** True when the verdict is a spent daily allowance — the local exhausted badge's signal. */
	dailyLimit;
	/** True when the verdict is a sign-in rejection — the credential's invalidation signal. */
	signInExpired;
	/**
	* @param message - the user-visible message, unchanged from the plain `Error`.
	* @param status - the HTTP status of the reply.
	* @param bodyText - the reply body as text, for classification.
	* @param retryAfterHeader - the `Retry-After` header, still `unknown` as it
	*   arrives from the fetch layer; it wins over the body's own field because
	*   the header is what HTTP promises and the field is a courtesy the gateway
	*   only sometimes includes (the same precedence the exchange throttle uses).
	*/
	constructor(message, status, bodyText, retryAfterHeader) {
		super(message);
		this.name = "UpstreamRefusalError";
		const verdict = classifyHttpRefusal(status, bodyText);
		this.status = status;
		this.upstreamKind = verdict.kind;
		this.retryAfterSeconds = parseRetryAfterSeconds(retryAfterHeader) ?? verdict.retryAfterSeconds;
		this.dailyLimit = verdict.kind === "daily-limit";
		this.signInExpired = verdict.kind === "sign-in-expired";
	}
};
/**
* Strip credential-shaped substrings out of text that is about to be shown or
* logged.
*
* Why this exists, in the plugin's own terms: the threat model in
* `src/host/handlers.ts` says a credential only ever travels in an
* `Authorization` header and never inside a URL, so a credential should not be
* able to reach a log — and the comment there carries its own tripwire ("if
* some call site ever moves a secret into a URL, this comment is the alarm").
* But the bytes that DO reach a log are the upstream's: an error body is copied
* into a message verbatim in a dozen places, and a gateway or proxy that echoes
* the request headers back (they do) carries the `Authorization` value
* straight into the panel and into `$DSH_HOME/logs`. The rule that keeps a
* credential out of a URL does not keep it out of an echo.
*
* So this is defence in depth rather than a repair of a known leak, and it is
* deliberately conservative: prose like "the token is expired" is left alone,
* because a redaction that eats ordinary words costs more diagnostics than it
* buys. What it matches is the SHAPE a credential takes — a header name, a
* `Bearer`/`Basic` prefix, a JWT, an `sk-`-style prefix, a named secret in a
* key/value or JSON shape.
*
* It is pure and import-free, so a test can feed it the exact strings an
* upstream might send and assert on the result — the same reason the rest of
* this module has no imports.
*
* @param text - the text to scrub.
* @returns the same text with credential-shaped substrings replaced.
*/
function redactSecrets(text) {
	return text.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g, "$1 [REDACTED]").replace(/(\b(?:proxy-)?authorization\s*[:=]\s*)([^\r\n"']+)/gi, "$1[REDACTED]").replace(/\b((?:set-)?cookie\s*:\s*)[^\r\n]+/gi, "$1[REDACTED]").replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, "[REDACTED]").replace(/\b(?:sk|cpk)-[A-Za-z0-9._-]{8,}/g, "[REDACTED]").replace(/("?(?:access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|apikey|client[_-]?secret|token|secret|password)"?\s*[:=]\s*)("?)[^"'\s,}&;]+("?)/gi, "$1$2[REDACTED]$3");
}

//#endregion
//#region src/host/catalog-entry.ts
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
function modelIdFor(entry) {
	const id = String(entry.display_name || "QoderModel").replace(/\s+/g, "");
	return id === "__hide-all__" ? `${id}_model` : id;
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
function priceFactorOf(value) {
	if (value === void 0 || value === null) return void 0;
	const factor = Number(value);
	return Number.isFinite(factor) ? factor : void 0;
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
function normalizeEntry(entry) {
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
		defaultContextWindow: entry.defaultContextWindow ?? 0,
		contextOptions: Array.isArray(entry.contextOptions) ? entry.contextOptions : [],
		priceFactor: priceFactorOf(entry.priceFactor),
		isFree: entry.isFree === true,
		isDefault: entry.isDefault === true,
		promotion: entry.promotion
	};
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
function filterByEnabled(models, enabled) {
	const list = Array.isArray(enabled) ? enabled.filter((id) => typeof id === "string" && id.length > 0) : [];
	if (list.length === 0) return models;
	const allowed = new Set(list);
	return models.filter((entry) => allowed.has(entry.id));
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
function buildModelRowsPayload({ runtimes, settings, now, projectRow, rates, providerRegistrationError }) {
	const models = [];
	const preferMax = unwrapVolatile(settings?.useMaximumContextWindow) === true;
	for (const { runtime } of runtimes) {
		if (regionEnabledFor(settings, runtime.region.id) !== true) continue;
		for (const entry of runtime.catalog.current()) models.push(projectRow(entry, runtime.region, now, rates, preferMax));
	}
	const overrides = unwrapVolatile(settings?.imageOverrides);
	const enabled = unwrapVolatile(settings?.enabledModelIds);
	return {
		models,
		newModelIds: newModelIdsOf(runtimes, settings),
		imageOverrides: overrides !== null && typeof overrides === "object" ? overrides : {},
		useMaximumContextWindow: unwrapVolatile(settings?.useMaximumContextWindow) === true,
		enabledModelIds: enabled !== null && typeof enabled === "object" ? enabled : {},
		refreshedAt: oldestFetchedAtOf(runtimes),
		refreshFailures: refreshFailuresOf(runtimes),
		providerRegistration: providerRegistrationState(providerRegistrationError)
	};
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
function newModelIdsOf(runtimes, settings) {
	const ids = [];
	for (const { runtime } of runtimes) {
		if (regionEnabledFor(settings, runtime.region.id) !== true) continue;
		const read = runtime?.newModelIds;
		if (typeof read !== "function") continue;
		let fresh;
		try {
			fresh = read.call(runtime);
		} catch {
			continue;
		}
		if (!Array.isArray(fresh)) continue;
		const offered = new Set(runtime.catalog.current().map((entry) => entry.id));
		for (const id of fresh) if (typeof id === "string" && id !== "" && offered.has(id)) ids.push(id);
	}
	return ids;
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
function oldestFetchedAtOf(runtimes) {
	let oldest;
	for (const { runtime } of runtimes) {
		const fetchedAt = Number(runtime?.catalog?.fetchedAt);
		if (!Number.isFinite(fetchedAt) || fetchedAt <= 0) continue;
		if (oldest === void 0 || fetchedAt < oldest) oldest = fetchedAt;
	}
	return oldest;
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
function refreshFailuresOf(runtimes) {
	const failures = [];
	for (const { runtime } of runtimes) {
		const failure = runtime?.refreshFailed;
		if (failure === void 0 || failure === null) continue;
		failures.push({
			region: runtime?.region?.id,
			regionName: runtime?.region?.displayName,
			reason: String(failure.reason ?? "fetch"),
			detail: typeof failure.error?.message === "string" ? failure.error.message : void 0
		});
	}
	return failures;
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
function projectModelRow(entry, region, now, rates, preferMax = false) {
	return {
		id: entry.id,
		name: entry.name,
		region: region.id,
		regionName: region.displayName,
		isVL: entry.isVL === true,
		priceFactor: priceFactorOf(entry.priceFactor),
		isFree: entry.isFree === true,
		isDefault: entry.isDefault === true,
		effectiveRate: rates.rateNow(entry, now),
		offPeakActive: rates.offPeakActive(entry, now),
		...entry.promotion !== void 0 ? { promotion: {
			...entry.promotion,
			remainingSeconds: rates.offPeakRemaining(entry, now)
		} } : {},
		contextOptions: Array.isArray(entry.contextOptions) ? entry.contextOptions : [],
		defaultContextWindow: Number(entry.defaultContextWindow) || 0,
		contextWindow: resolveContextWindow(entry, preferMax),
		contextWindowLabel: contextWindowLabelFor(entry, preferMax)
	};
}

//#endregion
//#region src/host/adapter-models.ts
/**
* The model list one region offers DSH — the decisions inside the adapter,
* without the adapter.
*
* `createQoderAdapter` (lib/adapter.js) cannot be imported by a test: it pulls
* in `@earendil-works/pi-ai` and `@deepseek-ai/dsh-llm-pi-ai`, which this
* repository does not install, so the file sat outside the coverage denominator
* (docs/issues/11-coverage-denominator.md) — and the model list, where every
* user-visible curation decision happens, with it. The four decisions are pure,
* and each fails silently: a switch that stops switching hides a provider.
* @module dsh-connect-qoder/adapter-models
*/
/**
* Build the model list a region offers.
*
* @param runtime - `{ region, catalog }`; `shim` is NOT read here, the caller
*   passes the resolved `baseUrl` so this stays free of the shim.
* @param options.baseUrl - the region's OpenAI-compatible base URL.
* @param options.preferMaximumContext - the user's maximum-context switch.
* @param options.enabledIds - the region's allow-list (empty means no filter).
* @param options.regionEnabled - the region's provider switch; only an
*   explicit `true` offers models.
* @param options.imageModeFor - `(modelId) => 'auto' | 'on' | 'off'`.
* @returns the projected pi-ai model descriptors.
*/
function buildModelsFor(runtime, options) {
	if (options.regionEnabled !== true) return [];
	const catalog = typeof runtime.catalog === "function" ? runtime.catalog() : runtime.catalog.current();
	return filterByEnabled(catalog, options.enabledIds).map((entry) => toPiModel(entry, options.baseUrl, runtime.region.id, options.preferMaximumContext === true, options.imageModeFor(entry.id)));
}

//#endregion
//#region src/host/adapter.ts
/**
* The Qoder pi-ai adapter.
*
* One adapter instance serves both Qoder regions, because each region is just
* another profile in the same map — the same way a single `PiAiAdapter` can
* front several providers. Every model's `baseUrl` points at its region's
* loopback shim, so routing a request to a model is enough to select the
* region, the credential, and the signing path.
*
* The profile is assembled by hand rather than through `dsh-llm-pi-ai`'s
* internal resolver: that helper is not part of the package's public export
* surface, so every field it would have supplied has to be named here.
*
* @module dsh-connect-qoder/adapter
*/
/** Idle ceiling while one stream read is outstanding. */
const STREAM_IDLE_TIMEOUT_MS = 3e5;
/**
* Image budgets at the `dsh-llm-pi-ai` defaults. They bound requests to models
* whose catalog entry declares image input; text-only models never see images.
*/
const REQUEST_IMAGE_BUDGETS = {
	maxRequestImageBytes: 20971520,
	requestImagePixelBudget: 4194304,
	requestImageMaxBytes: 1048576
};
/**
* Inert pi-ai auth plane.
*
* This route authenticates only through the shim's shared secret, resolved per
* request by `resolveApiKey`. pi-ai's own credential lifecycle must never
* manufacture a credential for it, so every ambient question answers "nothing
* stored, nothing set".
*/
const INERT_AUTH = {
	credentials: {
		async read() {},
		async list() {
			return [];
		},
		async modify() {
			throw new Error("dsh-connect-qoder: the qoder route has no pi-ai credential lifecycle");
		},
		async delete() {}
	},
	authContext: {
		async env() {},
		async fileExists() {
			return false;
		}
	}
};
/**
* Assemble one adapter covering every region.
*
* A single `PiAiAdapter` serves all regions because `registerAdapter` maps a
* *set* of providers onto one adapter: registering each region in its own call
* would leave only the last one owned, since a later call replaces the previous
* registration rather than adding to it.
*
* @param options.regions - `[{ region, shim, catalog }]`, one entry per region.
* @param options.preferMaximumContext - `() => boolean`, read per model build so
*   the settings switch takes effect on the next `llm/adapters-updated`.
* @param options.imageModeFor - `(modelId) => string`, the user's per-model image
*   choice, read per model build for the same reason: turning a model's image
*   input on or off must reach the picker without re-registering the adapter.
* @param options.enabledIdsFor - `(regionId) => string[]`, the models the user
*   wants offered in that region. An empty list means "no filter", not "none":
*   a fresh install has saved nothing and must still show every model, which is
*   the same convention the WorkBuddy bundle uses. Read per build so curating
*   the roster reaches the picker on the next `llm/adapters-updated`.
* @param options.regionEnabled - `(regionId) => boolean`, whether that region's
*   provider is offered to DSH at all. The account panel's per-region switch is
*   what writes it: a switched-off region contributes an **empty** model list,
*   which is exactly how DSH hides a model group — the same mechanism a
*   not-yet-signed-in region uses. Read per build so the switch takes effect on
*   the next `llm/adapters-updated` without re-registering or restarting. The
*   account, usage and saved allow-list all survive a switch-off, so switching
*   back on restores the region with its previous curation intact.
* @param options.resolveAttachments - `() => AttachmentStore | undefined`, the
*   durable attachment service. **Omitting this breaks every image request.**
*   pi-ai refuses any message carrying an image unless this resolves, so a route
*   registered without it answers `UNSUPPORTED_CONTENT` ("pi-ai image input
*   requires the durable attachment service") for the whole turn — which is what
*   a model does the moment it reads back a screenshot it just produced.
* @param options.resolveImageAccess - `(attachments, ref) => { readonlyPath } | undefined`,
*   maps one durable image reference onto a path the request builder may read.
*   Without it the store is reachable but no image can actually be located.
* @returns `{ adapter, invalidate, providerIds }`.
*/
function createQoderAdapter(options) {
	const runtimes = options.regions;
	if (runtimes.length === 0) throw new Error("dsh-connect-qoder: no regions to adapt");
	const preferMaximumContext = options.preferMaximumContext ?? (() => false);
	const imageModeFor = options.imageModeFor ?? (() => "auto");
	const enabledIdsFor = options.enabledIdsFor ?? (() => []);
	const regionEnabled = options.regionEnabled ?? (() => true);
	const resolveAttachments = options.resolveAttachments;
	const resolveImageAccess = options.resolveImageAccess;
	const buildModels = (runtime) => buildModelsFor(runtime, {
		baseUrl: `${runtime.shim.baseUrl()}/v1`,
		preferMaximumContext: preferMaximumContext(),
		enabledIds: enabledIdsFor(runtime.region.id),
		regionEnabled: regionEnabled(runtime.region.id),
		imageModeFor
	});
	const buildProfiles = () => {
		const profiles = /* @__PURE__ */ new Map();
		for (const runtime of runtimes) {
			const providerId = runtime.region.id;
			const displayName = runtime.region.displayName;
			const provider = {
				...createProvider({
					id: providerId,
					name: displayName,
					auth: { apiKey: {
						name: "Qoder loopback shim token",
						async resolve({ credential }) {
							const apiKey = credential?.key;
							return apiKey === void 0 || apiKey.length === 0 ? void 0 : {
								auth: { apiKey },
								source: displayName
							};
						}
					} },
					models: buildModels(runtime),
					api: openAICompletionsApi()
				}),
				getModels: () => buildModels(runtime)
			};
			profiles.set(providerId, {
				provider: providerId,
				displayName,
				streamIdleTimeoutMs: STREAM_IDLE_TIMEOUT_MS,
				retryPolicy: resolveRetryPolicy(ROUTE_RETRY_POLICY, `dsh-connect-qoder.${providerId}.retryPolicy`),
				configuredMaxTokens: /* @__PURE__ */ new Map(),
				modelErrors: /* @__PURE__ */ new Map(),
				...REQUEST_IMAGE_BUDGETS,
				piProvider: provider
			});
		}
		return profiles;
	};
	let profiles = buildProfiles();
	return {
		adapter: new PiAiAdapter({
			profiles: () => profiles,
			auth: INERT_AUTH,
			resolveApiKey: async (provider) => {
				return runtimes.find((entry) => entry.region.id === provider)?.shim.token();
			},
			...resolveAttachments === void 0 ? {} : { resolveAttachments },
			...resolveImageAccess === void 0 ? {} : { resolveImageAccess }
		}),
		invalidate: () => {
			profiles = buildProfiles();
		},
		providerIds: runtimes.map((runtime) => runtime.region.id)
	};
}

//#endregion
//#region src/host/upstream/client-constants.ts
/**
* client-constants — 自 src/host/upstream.ts 原文搬迁，未改逻辑
*
* 拆分依据 docs/issues/22-upstream-split.md；本文件代码逐字来自拆分前的
* upstream.ts（见 git 历史里拆分前的那一版），只做 import/export 整理与
* 文件头标注。协议事实的原文注释在 crypto.ts 头部。
*/
/** COSY protocol revision the gateway is currently serving. */
const COSY_VERSION = "1.1.38";
/** Data-policy value a non-consenting client sends. */
const DATA_POLICY = "disagree";
/**
* Machine OS string, spelled the way the gateway expects.
*
* The darwin arm was the one PLAN P1-4 (protocol drift) wanted: the whole
* suite had zero references to this constant, so a macOS host silently
* announced itself as `x86_64_linux` and nobody could tell whether the gateway
* cared. Measured, not assumed: `probe/machineos-probe.mjs` sends this exact
* request with only `Cosy-Machineos` varied, and the gateway answers 200 with a
* byte-identical `chat` group for `x86_64_linux`, `aarch64_linux`,
* `x86_64_darwin` and `aarch64_darwin` on both regions — so naming the real
* platform is safe, and a macOS user no longer lies to the gateway about it.
*
* Note the cost of that answer: the gateway does not gate on this field, so it
* cannot be used to detect a wrong-platform bug. It stays a correctness
* statement about what this host is, not a lever.
*/
const MACHINE_OS = process.platform === "win32" ? process.arch === "arm64" ? "aarch64_windows" : "x86_64_windows" : process.platform === "darwin" ? process.arch === "arm64" ? "aarch64_darwin" : "x86_64_darwin" : process.arch === "arm64" ? "aarch64_linux" : "x86_64_linux";

//#endregion
//#region src/host/upstream/crypto.ts
/**
* The Qoder wire protocol.
*
* Qoder is not an OpenAI-compatible endpoint, so three separate mechanisms have
* to be reproduced to talk to it:
*
* 1. **COSY signed headers.** Every gateway request carries a set of `Cosy-*`
*    headers plus an `Authorization: Bearer COSY.<payload>.<sig>` value. The
*    signature is an MD5 over the base64 payload, the RSA-wrapped AES key, the
*    timestamp, the request body, and the signature path.
* 2. **A permuted base64 body.** The `Encode=1` query flag means the JSON body
*    is base64-encoded, its alphabet is permuted, and the resulting string's
*    characters are rotated by thirds.
* 3. **Doubly-wrapped SSE.** Each `data:` frame is an envelope object whose
*    `body` field is *itself* a JSON string holding an OpenAI-style chunk.
*
* The constants below are protocol facts recovered from the client; they are
* not configuration.
*
* @module dsh-connect-qoder/upstream
*/
/**
* 2026-10-17 拆分：上面这段协议事实注释自 upstream.ts 文件头原文整体搬迁，
* 未改一字。它描述的三个机制现在分布在这些文件里：
*
* - COSY 签名头组装与 Authorization 值 → `upstream/cosy-sign.ts`
* - 置换字母表 base64（`Encode=1`）→ 本文件
* - 双层包裹 SSE 解码 → `upstream/sse.ts`
*/
/** Public key the gateway expects the per-request AES key to be wrapped with. */
const QODER_RSA_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDA8iMH5c02LilrsERw9t6Pv5Nc
4k6Pz1EaDicBMpdpxKduSZu5OANqUq8er4GM95omAGIOPOh+Nx0spthYA2BqGz+l
6HRkPJ7S236FZz73In/KVuLnwI8JJ2CbuJap8kvheCCZpmAWpb/cPx/3Vr/J6I17
XcW+ML9FoCI6AOvOzwIDAQAB
-----END PUBLIC KEY-----`;
/** Permuted base64 alphabet used when `Encode=1` is in effect. */
const CUSTOM_ALPHABET = "_doRTgHZBKcGVjlvpC,@aFSx#DPuNJme&i*MzLOEn)sUrthbf%Y^w.(kIQyXqWA!";
/** Standard base64 alphabet, positionally mapped onto the custom one. */
const STD_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
/**
* Positional translation table from standard to custom alphabet.
*
* A `Uint8Array` of exactly 256 entries, so every read below is in bounds by
* construction — but the TYPE cannot know that (`noUncheckedIndexedAccess` is
* on, which is why the reads go through `encodeByteAt` below rather than
* straight at the table). The table maps a character code to its replacement
* code, which is what makes a byte-for-byte translation of the base64 string
* possible without building a new string character by character.
*/
const ENCODE_TABLE = (() => {
	const table = /* @__PURE__ */ new Uint8Array(256);
	for (let i = 0; i < table.length; i++) table[i] = i;
	for (let i = 0; i < 64; i++) table[STD_ALPHABET.charCodeAt(i)] = CUSTOM_ALPHABET.charCodeAt(i);
	table["=".charCodeAt(0)] = "$".charCodeAt(0);
	return table;
})();
/**
* The translation for one already-validated byte.
*
* The `?? byte` is unreachable given a 256-entry table and a byte in 0..255,
* and it is spelled as a fallback rather than a `!` so that the TOTAL
* behaviour is defined: an identity translation is the correct answer for a
* byte the table does not name, whereas a non-null assertion would be a
* promise this function cannot keep if the table ever shrank.
*/
function encodeByteAt(byte) {
	return ENCODE_TABLE[byte] ?? byte;
}
/**
* Encode a request body the way the `Encode=1` flag requires.
*
* The transform is: base64 the bytes, translate each character through the
* permuted alphabet, then rotate the string so the last third comes first and
* the first third goes last.
*
* @param plaintext - the JSON body bytes.
* @returns the encoded bytes to send as the request body.
*/
function encodeBody(plaintext) {
	const std = (Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext)).toString("base64");
	const n = std.length;
	const third = Math.floor(n / 3);
	const out = Buffer.allocUnsafe(n);
	let dst = 0;
	for (let i = n - third; i < n; i++) out[dst++] = encodeByteAt(std.charCodeAt(i));
	for (let i = third; i < n - third; i++) out[dst++] = encodeByteAt(std.charCodeAt(i));
	for (let i = 0; i < third; i++) out[dst++] = encodeByteAt(std.charCodeAt(i));
	return out;
}
/** AES-128-CBC encrypt with the key doubling as the IV, base64-encoded. */
function aesEncryptCBCBase64(plaintext, keyString) {
	const key = Buffer.from(keyString);
	const cipher = crypto.createCipheriv("aes-128-cbc", key, key);
	return cipher.update(plaintext, "utf8", "base64") + cipher.final("base64");
}

//#endregion
//#region src/host/upstream/sign.ts
/**
* sign — 自 src/host/upstream.ts 原文搬迁，未改逻辑
*
* 拆分依据 docs/issues/22-upstream-split.md；本文件代码逐字来自拆分前的
* upstream.ts（见 git 历史里拆分前的那一版），只做 import/export 整理与
* 文件头标注。协议事实的原文注释在 crypto.ts 头部。
*/
/**
* The path the signature covers: the request path with a leading `/algo`
* stripped, because the gateway routes that prefix away before verifying.
*/
function signaturePath(url) {
	let path = new URL(url).pathname;
	if (path.startsWith("/algo")) path = path.slice(5);
	return path;
}

//#endregion
//#region src/host/upstream/cosy-sign.ts
/**
* cosy-sign — 自 src/host/upstream.ts 原文搬迁，未改逻辑
*
* 拆分依据 docs/issues/22-upstream-split.md；本文件代码逐字来自拆分前的
* upstream.ts（见 git 历史里拆分前的那一版），只做 import/export 整理与
* 文件头标注。协议事实的原文注释在 crypto.ts 头部。
*/
/**
* Build the full authenticated header set for one gateway request.
*
* @param body - the exact bytes that will be sent (already encoded).
* @param url - the absolute request URL.
* @param credential - `{ userID, token, name, email, machineID }`.
* @returns the headers to merge into the request.
*/
function authHeaders(body, url, credential) {
	const aesKey = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
	const infoB64 = aesEncryptCBCBase64(JSON.stringify({
		uid: credential.userID,
		security_oauth_token: credential.token,
		name: credential.name ?? "",
		aid: "",
		email: credential.email ?? ""
	}), aesKey);
	const cosyKey = crypto.publicEncrypt({
		key: QODER_RSA_PUBLIC_KEY,
		padding: crypto.constants.RSA_PKCS1_PADDING
	}, Buffer.from(aesKey)).toString("base64");
	const timestamp = Math.floor(Date.now() / 1e3).toString();
	const payloadB64 = Buffer.from(JSON.stringify({
		version: "v1",
		requestId: crypto.randomUUID(),
		info: infoB64,
		cosyVersion: COSY_VERSION,
		ideVersion: ""
	})).toString("base64");
	const path = signaturePath(url);
	const bodyBytes = body ?? Buffer.alloc(0);
	const sig = crypto.createHash("md5").update(payloadB64).update("\n").update(cosyKey).update("\n").update(timestamp).update("\n").update(bodyBytes).update("\n").update(path).digest("hex");
	const machineID = credential.machineID ?? "";
	return {
		Authorization: `Bearer COSY.${payloadB64}.${sig}`,
		"Cosy-Key": cosyKey,
		"Cosy-User": credential.userID,
		"Cosy-Date": timestamp,
		"Cosy-Version": COSY_VERSION,
		"Cosy-Machineid": machineID,
		"Cosy-Machinetoken": machineID,
		"Cosy-Machinetype": "5",
		"Cosy-Machineos": MACHINE_OS,
		"Cosy-Clienttype": "5",
		"Cosy-Clientip": "127.0.0.1",
		"Cosy-Bodyhash": crypto.createHash("md5").update(bodyBytes).digest("hex"),
		"Cosy-Bodylength": String(bodyBytes.length),
		"Cosy-Sigpath": path,
		"Cosy-Data-Policy": DATA_POLICY,
		"Cosy-Organization-Id": "",
		"Cosy-Organization-Tags": "",
		"Login-Version": "v2",
		"X-Request-Id": crypto.randomUUID()
	};
}

//#endregion
//#region src/host/upstream/headers.ts
/**
* headers — 自 src/host/upstream.ts 原文搬迁，未改逻辑
*
* 拆分依据 docs/issues/22-upstream-split.md；本文件代码逐字来自拆分前的
* upstream.ts（见 git 历史里拆分前的那一版），只做 import/export 整理与
* 文件头标注。协议事实的原文注释在 crypto.ts 头部。
*/
/**
* Headers the Qoder IDE itself sends to the OpenAPI host.
*
* `Cosy-ClientType: 10` identifies the desktop app. The quota and campaign
* routes answer without it, but sending what the real client sends keeps this
* from depending on a default the server may tighten later.
*
* The international campaigns endpoint additionally gates the daily
* `CLAIM_BENEFIT` round on the request carrying the app's umid machine
* identity (`Cosy-MachineToken/Code/Type`) — verified 2026-09-27 against the
* live endpoint: a plain-bearer GET lists the evergreen `VIEW_DETAILS`
* banner only, the same GET with the real umid block lists the daily round.
* The block's values come from {@link umidHeadersFor}: the app's embedded
* `runtime-info.exe` mints them, and the app's own `auth.machine-id` value is
* NOT what the endpoint accepts (substituting it silently degrades the
* list back to the banner). CN needs no umid block: its campaigns are
* served complete to a plain-bearer GET.
*/
function openApiHeaders(credential, region) {
	return {
		Accept: "application/json",
		Authorization: `Bearer ${credential.token}`,
		"Cosy-ClientType": "10",
		"User-Agent": "Qoder",
		...umidHeadersFor(region)
	};
}
/** One cached umid read per process: the binary is slow enough to matter, cheap enough to run once. */
let umidInfo;
/**
* Observability seam: whether the umid machine identity is available to this
* process, forcing the same lazy per-process resolution `openApiHeaders`
* performs when the read has not happened yet.
*
* The activation warn in `index.ts` uses it to name the one degradation the
* international edition's check-in depends on — no machine identity, no daily
* round — without waiting for the first OpenAPI call. The test seam
* `__dshQoderUmidProbe` still stands in for the binary read, so the answer is
* deterministic on any machine; the cache stays machine-scoped, region
* independent, exactly like the header builder's.
*/
function __dshQoderUmidState() {
	if (umidInfo === void 0) umidInfo = readUmidInfo(void 0);
	if (umidInfo !== null) return { available: true };
	return {
		available: false,
		reason: "the desktop app machine identity (umid) could not be read (no install, no matching version root, or a silent binary failure)"
	};
}
/**
* The app's umid machine-identity header block, or `{}` when it cannot be
* read. See {@link openApiHeaders} for why the block exists.
*
* The block is read from the install root, not the credential: the values
* are machine-scoped, the same for both regions, and the CN region's
* campaigns never needed them — but reading them when absent (CN-only
* installs) must stay a no-op, never a failure.
*
* The resolution is cached per process in `umidInfo`; the test seam
* `__dshQoderUmidProbe` and the reset hook `__dshQoderUmidCacheReset` let
* the unit tests drive every branch without a real install.
*
* @param {object|undefined} region - the region descriptor.
* @returns `{ 'Cosy-MachineToken', 'Cosy-MachineCode', 'Cosy-MachineType' }` or `{}`.
*/
function umidHeadersFor(region) {
	if (umidInfo === void 0) umidInfo = readUmidInfo(region);
	if (umidInfo === null) return {};
	return {
		"Cosy-MachineToken": umidInfo.machineToken,
		"Cosy-MachineCode": umidInfo.machineCode,
		"Cosy-MachineType": umidInfo.machineType
	};
}
/**
* Validate a candidate umid block; return `null` when any field is missing,
* non-string, or empty. A partial block must not surface partially — the
* header set is all-or-nothing.
*/
function normalizeUmidBlock(answer) {
	const block = answer;
	if (typeof block?.machineToken !== "string" || block.machineToken.length === 0) return null;
	if (typeof block?.machineType !== "string" || block.machineType.length === 0) return null;
	if (typeof block?.machineCode !== "string" || block.machineCode.length === 0) return null;
	return {
		machineToken: block.machineToken,
		machineType: block.machineType,
		machineCode: block.machineCode
	};
}
/**
* Run the app's umid binary and parse its `{ machineToken, machineType,
* machineCode }` answer, or `null` when the binary is absent or uncooperative.
*
* The binary ships at `<install>/resources\umid\runtime-info.exe` — the
* launcher's directory, one level above the versioned resources — and
* answers with no arguments in well under a second. It is run with a 5 s
* timeout and a pipe, never a shell: a hung or missing binary degrades to
* "no machine identity", which on CN is the full answer anyway and on the
* international edition costs only the daily check-in row.
*
* @param {object|undefined} region - the region descriptor; its `id` selects
*   the install root.
* @returns the parsed block or `null`.
*/
function readUmidInfo(region) {
	const probe = globalThis.__dshQoderUmidProbe;
	if (typeof probe === "function") try {
		return normalizeUmidBlock(probe());
	} catch {
		return null;
	}
	if (process.platform !== "win32") return null;
	const roots = umidRootsFor(region);
	for (const root of roots) {
		const binary = join(root, "resources", "umid", "runtime-info.exe");
		if (!existsSync(binary)) continue;
		let output;
		try {
			output = execFileSync(binary, [], {
				timeout: 5e3,
				stdio: [
					"ignore",
					"pipe",
					"ignore"
				]
			}).toString();
		} catch {
			continue;
		}
		try {
			const block = normalizeUmidBlock(JSON.parse(output));
			if (block === null) continue;
			return block;
		} catch {
			continue;
		}
	}
	return null;
}
/**
* Candidate install roots, newest layout first.
*
* The 0.4.x launcher splits each version into `Programs\Qoder\.qoder-versions\<v>\resources`,
* leaving a thin launcher tree at `Programs\Qoder\resources` that carries
* the shared `umid` binary; the CN app keeps its own `Programs\QoderCN` tree.
*
* The version directories are ENUMERATED rather than pinned: the old list
* hard-coded `0.4.3` (the measured value of the day it was written), and a
* pinned list stops matching the moment upstream ships the next desktop
* version — which is exactly when the shared binary may have moved into the
* new version root. Measured 2026-10-03, the `.qoder-versions` directory also
* carries sibling MARKER FILES next to the version directories (`0.4.3.qoder-update-ready.json`
* on this machine), so only directory entries become candidates. Enumeration
* failing (no `.qoder-versions`, a locked directory) answers an empty list —
* not a failure: the launcher-tree root below it remains the fallback, and
* each candidate is still verified with `existsSync` before the binary runs.
*
* The CN tree is enumerated by the same rule by symmetry with the global one.
* It is unmeasured here (no CN install on this machine); the no-op behaviour
* when the directory is absent is what makes the symmetry safe.
*/
function umidRootsFor(region) {
	const localAppData = process.env.LOCALAPPDATA;
	if (localAppData === void 0) return [];
	const programs = join(localAppData, "Programs");
	const roots = [...versionedUmidRoots(join(programs, "Qoder")), join(programs, "Qoder")];
	if (region?.id === "qoder-cn") roots.push(...versionedUmidRoots(join(programs, "QoderCN")), join(programs, "QoderCN"));
	return roots;
}
/**
* The version-split install roots under one launcher tree, newest version first.
*
* Newest-first matters: when two version roots both carry the binary, the
* newer one is the one the app runs against, and its umid values are the
* current machine identity.
*/
function versionedUmidRoots(tree) {
	let names;
	try {
		names = readdirSync(join(tree, ".qoder-versions"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
	} catch {
		return [];
	}
	names.sort((a, b) => versionCompare(b, a));
	return names.map((name) => join(tree, ".qoder-versions", name));
}
/** Compare two dot-separated version strings numerically per part. */
function versionCompare(a, b) {
	const partsA = a.split(".");
	const partsB = b.split(".");
	for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
		const na = Number(partsA[i] ?? 0);
		const nb = Number(partsB[i] ?? 0);
		if (Number.isFinite(na) && Number.isFinite(nb)) {
			if (na !== nb) return na - nb;
			continue;
		}
		const ca = String(partsA[i] ?? "");
		const cb = String(partsB[i] ?? "");
		if (ca !== cb) return ca < cb ? -1 : 1;
	}
	return 0;
}

//#endregion
//#region src/host/upstream/endpoints.ts
/** URL listing the models this account may use. */
function modelListUrl(region) {
	return `${region.baseUrl}algo/api/v2/model/list?Encode=1`;
}
/** URL of the streaming chat endpoint. */
function chatUrl(region) {
	return `${region.baseUrl}algo/api/v2/service/pro/sse/agent_chat_generation?FetchKeys=llm_model_result&AgentId=agent_common&Encode=1`;
}
/** URL exchanging a personal access token for a job token. */
function exchangeUrl(region) {
	return `${region.openApiUrl}/api/v1/jobToken/exchange`;
}
/** URL returning the signed-in account's profile. */
function userInfoUrl(region) {
	return `${region.openApiUrl}/api/v1/userinfo`;
}
/** URL returning the account's quota usage. */
function usageUrl(region) {
	return `${region.openApiUrl}/api/v2/quota/usage`;
}
/**
* URL the Qoder IDE's own "我的用量" panel reads.
*
* The `sash` route is the presentation layer: it answers with a `displayMode`
* wrapper and carries `dedicatedResourcePackages`, the per-model promotional
* allowances the panel lists beside the plan and add-on quotas. The plain
* `quota/usage` route returns only the plan and add-on halves, so this is the
* one to prefer and the other is the fallback.
*/
function usagePresentationUrl(region) {
	return `${region.openApiUrl}/sash/api/v2/me/usage`;
}
/**
* URL listing the account's active campaigns.
*
* The IDE's usage panel renders a campaign's `USAGE` placement as the extra
* promotional row under the quotas — the one carrying a "限时特惠" badge and an
* end date. The quota routes do not carry that text, so it is read separately
* and merged in.
*/
function campaignsUrl(region) {
	return `${region.openApiUrl}/sash/api/v1/me/campaigns`;
}
/**
* URL that claims one campaign's benefit.
*
* The OpenAPI host, not the gateway: this side authenticates with the plain
* bearer token and needs none of the COSY signing or body encoding the model
* routes require.
*
* The id belongs to a round that is live now, which is why the caller reads the
* campaign list immediately before claiming: the daily round is re-issued with
* a new id each day, so an id remembered from an earlier read is a stale one.
*/
function claimCampaignUrl(region, campaignId) {
	return `${region.openApiUrl}/sash/api/v1/me/campaigns/${encodeURIComponent(campaignId)}/claim`;
}

//#endregion
//#region src/host/upstream/retry.ts
/**
* retry — 自 src/host/upstream.ts 原文搬迁，未改逻辑
*
* 拆分依据 docs/issues/22-upstream-split.md；本文件代码逐字来自拆分前的
* upstream.ts（见 git 历史里拆分前的那一版），只做 import/export 整理与
* 文件头标注。协议事实的原文注释在 crypto.ts 头部。
*/
/**
* How long one turn may spend waiting out Qoder's queue, in total.
*
* The gateway answers a queued request with `10605` plus a `retryAfterSeconds`
* hint, and the official client simply waits and tries again. Handing that wait
* to DSH instead does not work: DSH's retry policy is fixed (5 attempts, 500 ms
* doubling to a 10 s ceiling, ~40 s of total budget) and ignores the hint, so a
* queue that clears in 60 s exhausts the budget and the turn fails — after
* which the user has to send the message again, which restarts the turn from
* scratch rather than resuming the wait.
*
* This module therefore owns the wait. The budget stays well under the 300 s
* idle ceiling the adapter declares, so a queued turn is never killed by the
* stream watchdog while it waits.
*/
const QUEUE_WAIT_BUDGET_MS = 12e4;
/** Longest single sleep, so one absurd hint cannot stall a turn indefinitely. */
const QUEUE_WAIT_MAX_SLEEP_MS = 3e4;
/** Sleep before the first retry when the gateway gives no hint at all. */
const QUEUE_WAIT_MIN_SLEEP_MS = 1e3;
/**
* How long ONE attempt may wait for response headers before it is treated as
* a failed try. It bounds the handshake only, never the body: an answer that
* keeps streaming past it is healthy and must not be cut (see `openAttempt`).
*
* Without a per-attempt deadline the queue budget below is fiction: it counts
* only the sleeps between attempts, so a gateway that accepts the connection
* and then never returns response headers hangs `fetch` forever while
* `waitedMs` stays at zero. The loop, the budget check, and the adapter's idle
* watchdog are all bypassed, and the turn never produces a byte of output.
*
* This is sized for the slow-but-progressing case the queue legitimately
* produces, not for a healthy response: the first token of a queued turn can
* take a while to appear, and killing that would throw away real work. It only
* has to be short enough that a *stuck* attempt is charged to the budget and
* retried instead of pinning the turn forever.
*/
const ATTEMPT_TIMEOUT_MS = 6e4;
/** Abortable sleep; resolves early (without throwing) when the signal aborts. */
function sleep(ms, signal) {
	return new Promise((resolve) => {
		if (signal?.aborted) {
			resolve();
			return;
		}
		const timer = setTimeout(finish, Math.max(0, ms));
		function finish() {
			clearTimeout(timer);
			signal?.removeEventListener("abort", finish);
			resolve();
		}
		signal?.addEventListener("abort", finish, { once: true });
	});
}
/**
* Timestamps come in seconds, milliseconds, and RFC 3339 strings across the
* upstream's routes. The single coercion used everywhere is `toEpochMs` in
* `time.js`; this module re-exports nothing of its own.
*/
/**
* How long to wait before retrying a queue rejection, or `undefined` when it is
* not a queue rejection or the wait budget is spent.
*
* The gateway's own `retryAfterSeconds` is the primary signal and is honoured
* as given. It is not always accurate, though: a queue that keeps answering
* "retry in 2s" for a minute would otherwise be polled every two seconds for the
* whole budget, which is both rude and pointless. So once a few consecutive
* rejections have shown the hint is not converging, the pause escalates
* geometrically up to {@link QUEUE_WAIT_MAX_SLEEP_MS}.
*
* @param error - the rejection to judge.
* @param waitedMs - time already spent waiting in this turn.
* @param attempt - 1-based index of the attempt that was just rejected.
* @returns the sleep in milliseconds, or `undefined` when the turn should stop
*   retrying. Exported so the budget invariant ("never more than remains") is
*   asserted against the real function rather than a copy of the arithmetic —
*   the old clamp broke it in a way no reader of `streamChat` could see.
*/
function queueWaitFor(error, waitedMs, attempt) {
	if (error?.retryable !== true) return void 0;
	const remaining = QUEUE_WAIT_BUDGET_MS - waitedMs;
	if (remaining <= 0) return void 0;
	const hinted = Number(error.retryAfterSeconds) > 0 ? Number(error.retryAfterSeconds) * 1e3 : QUEUE_WAIT_MIN_SLEEP_MS;
	const GRACE_ATTEMPTS = 3;
	const escalated = attempt > GRACE_ATTEMPTS ? QUEUE_WAIT_MIN_SLEEP_MS * 2 ** Math.min(attempt - GRACE_ATTEMPTS, 8) : 0;
	const target = Math.max(hinted, escalated) * (.75 + Math.random() * .5);
	return Math.min(Math.max(QUEUE_WAIT_MIN_SLEEP_MS, Math.min(target, QUEUE_WAIT_MAX_SLEEP_MS)), remaining);
}

//#endregion
//#region src/host/upstream/sse.ts
/**
* sse — moved verbatim from `src/host/upstream.ts` during the protocol split
* (docs/issues/22-upstream-split.md); only imports and exports were tidied. The
* protocol facts live in the header of `crypto.ts`.
*/
/**
* Classify one error frame into `{ kind, retryAfterSeconds, code, detail }`.
*
* Shared by the HTTP-status path and the in-band frame path so both agree on
* what a given payload means. A frame that carries no failure at all — no error
* code and no explicit `success: false` — returns `undefined`, which is how the
* frame reader tells a status frame apart from a chunk.
*
* @param chunk - one decoded frame, or a synthetic `{ code, message }` built
*   from a non-2xx HTTP reply.
* @param fallbackCode - code to assume when the payload names none (the HTTP
*   status, on the transport path).
*/
function readFailure(chunk, fallbackCode = "") {
	if (chunk === null || typeof chunk !== "object" || Array.isArray(chunk)) return void 0;
	const frame = chunk;
	const hasCode = frame.code != null || frame.errorCode != null;
	const hasMessage = typeof frame.message === "string" && frame.message.length > 0 || typeof frame.errorMessage === "string" && frame.errorMessage.length > 0;
	if (!hasCode && !hasMessage) {
		if (fallbackCode === "") return void 0;
	}
	const { code, detail } = unwrapFailure(frame);
	const effective = code !== "" ? code : fallbackCode;
	const kind = classifyUpstreamError(chunk, effective, detail);
	return {
		kind: kind.kind,
		retryAfterSeconds: kind.retryAfterSeconds ?? 0,
		code: effective,
		detail
	};
}
/** Note one unreadable frame on the turn's probe; the first is the one kept. */
function noteUnreadableFrame(probe, payload) {
	probe.skipped += 1;
	if (probe.sample === void 0) probe.sample = payload.slice(0, 300);
}
/**
* One chat turn, streamed.
*
* Yields plain objects in the OpenAI chunk vocabulary
* (`{ choices: [{ delta, finish_reason }] }`) so the caller can forward them
* without knowing about Qoder's envelope.
*
* @param region - the region descriptor.
* @param credential - `{ userID, token, name, email, machineID }`.
* @param request - `{ model, messages, tools, maxTokens, enableThinking, alwaysThinking, reasoningEffort, sessionId }`.
*   `alwaysThinking` marks a model that rejects `enable_thinking: false`; for
*   those the flag is omitted entirely rather than sent as `false`.
* @yields OpenAI-shaped chat completion chunks.
*/
async function* streamChat(region, credential, request, signal) {
	const model = request.model;
	const recordID = crypto.randomUUID();
	const lastUser = [...request.messages].reverse().find((m) => m.role === "user");
	const lastText = typeof lastUser?.content === "string" ? lastUser.content : "";
	const parameters = {};
	const maxTokens = request.maxTokens;
	if (maxTokens !== void 0 && Number.isSafeInteger(maxTokens) && maxTokens > 0) parameters.max_tokens = maxTokens;
	if (request.enableThinking === true) {
		parameters.enable_thinking = true;
		if (typeof request.reasoningEffort === "string" && request.reasoningEffort.length > 0) parameters.reasoning_effort = request.reasoningEffort;
	} else if (request.alwaysThinking !== true) parameters.enable_thinking = false;
	const body = {
		request_id: crypto.randomUUID(),
		request_set_id: recordID,
		chat_record_id: recordID,
		session_id: request.sessionId ?? `dsh-${crypto.randomUUID()}`,
		stream: true,
		chat_task: "FREE_INPUT",
		is_reply: true,
		is_retry: false,
		source: 1,
		version: "3",
		session_type: "qodercli",
		agent_id: "agent_common",
		task_id: "common",
		code_language: "",
		chat_prompt: "",
		image_urls: null,
		aliyun_user_type: "",
		system: "",
		messages: request.messages,
		tools: request.tools ?? [],
		parameters,
		chat_context: {
			chatPrompt: "",
			imageUrls: null,
			extra: {
				context: [],
				modelConfig: {
					key: model,
					is_reasoning: request.enableThinking === true
				},
				originalContent: lastText
			},
			features: [],
			text: lastText
		},
		model_config: {
			key: model,
			source: "system",
			is_reasoning: request.enableThinking === true
		},
		business: {
			product: "cli",
			version: "1.0.0",
			type: "agent",
			stage: "start",
			id: crypto.randomUUID(),
			name: lastText.slice(0, 30),
			begin_at: Date.now()
		}
	};
	const url = chatUrl(region);
	const bodyBytes = encodeBody(Buffer.from(JSON.stringify(body)));
	const shapeProbe = {
		skipped: 0,
		sample: void 0
	};
	/**
	* Open one attempt and hand back its frame stream.
	*
	* Nothing is yielded until the first frame arrives, so a queue rejection
	* raised here is still safe to retry: the caller has seen no output yet.
	*/
	async function* readFrames(response, probe) {
		const body = response.body;
		if (body === null) throw new Error(`dsh-connect-qoder: response ${response.status} carried no body to stream`);
		const reader = body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		let streamDone = false;
		let endOfStream = false;
		try {
			while (!streamDone) {
				const { done, value } = await reader.read();
				if (done) {
					endOfStream = true;
					buffer += decoder.decode();
					if (buffer.trim() !== "") buffer += "\n";
				} else buffer += decoder.decode(value, { stream: true });
				let newline;
				while ((newline = buffer.indexOf("\n")) !== -1) {
					const line = buffer.slice(0, newline).trim();
					buffer = buffer.slice(newline + 1);
					if (!line.startsWith("data:")) continue;
					const payload = line.slice(5).trim();
					if (payload.length === 0) continue;
					if (payload === "[DONE]") {
						streamDone = true;
						break;
					}
					let envelope;
					try {
						envelope = JSON.parse(payload);
					} catch {
						noteUnreadableFrame(probe, payload);
						continue;
					}
					let chunk = envelope;
					if (typeof envelope?.body === "string") try {
						chunk = JSON.parse(envelope.body);
					} catch {
						noteUnreadableFrame(probe, payload);
						continue;
					}
					else if (envelope?.body !== void 0 && typeof envelope.body === "object") chunk = envelope.body;
					if (chunk?.choices !== void 0 || chunk?.usage !== void 0 && chunk.usage !== null) {
						yield chunk;
						continue;
					}
					const failure = readFailure(chunk);
					if (failure === void 0) {
						noteUnreadableFrame(probe, payload);
						continue;
					}
					if (failure.kind === "daily-limit") throw new DailyLimitRejection(failure.detail, failure.retryAfterSeconds);
					if (failure.kind === "rate-limit") throw new QueueRejection(failure.retryAfterSeconds, failure.detail);
					const message = failureMessage(failure, region);
					if (failure.kind === "sign-in-expired") throw new SignInExpiredError(message);
					throw new Error(message);
				}
				if (endOfStream) break;
			}
		} finally {
			try {
				await reader.cancel();
			} catch {}
		}
	}
	/** Send one request. Throws for terminal failures, returns the open stream. */
	async function openAttempt() {
		let response;
		const headers = {
			"Content-Type": "application/json",
			Accept: "text/event-stream",
			"Cache-Control": "no-cache",
			"Accept-Encoding": "identity",
			"X-Model-Key": String(model),
			"X-Model-Source": "system",
			...authHeaders(bodyBytes, url, credential)
		};
		const deadline = new AbortController();
		const timer = setTimeout(() => {
			deadline.abort(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
		}, ATTEMPT_TIMEOUT_MS);
		const attemptSignal = signal === void 0 ? deadline.signal : AbortSignal.any([signal, deadline.signal]);
		try {
			response = await fetch(url, {
				method: "POST",
				headers,
				body: bodyBytes,
				redirect: "error",
				signal: attemptSignal
			});
		} catch (error) {
			if (signal?.aborted) throw error;
			if (deadline.signal.aborted) throw new QueueRejection(0, `no response headers within ${Math.round(ATTEMPT_TIMEOUT_MS / 1e3)}s`);
			const cause = thrownFlag(error, "cause");
			const code = thrownFlag(cause, "code") ?? thrownFlag(error, "code") ?? "";
			if (code === "ECONNRESET" || code === "ECONNREFUSED" || code === "EPIPE" || code === "ENOTFOUND" || code === "UND_ERR_SOCKET" || code === "UND_ERR_CONNECT_TIMEOUT" || code === "UND_ERR_HEADERS_TIMEOUT" || String(thrownFlag(error, "message") ?? "").includes("fetch failed")) {
				const detail = errorMessage(cause) !== "" ? errorMessage(cause) : describeThrown(error);
				throw new QueueRejection(0, `network: ${detail}`);
			}
			throw error;
		} finally {
			clearTimeout(timer);
		}
		if (!response.ok) {
			const text = redactSecrets(await response.text()).slice(0, 500);
			const failure = readFailure({
				code: String(response.status),
				message: text
			}, String(response.status));
			if (failure !== void 0 && failure.kind === "daily-limit") throw new DailyLimitRejection(failure.detail, failure.retryAfterSeconds);
			if (response.status === 429 || response.status >= 500) {
				const retryAfter = parseRetryAfterSeconds(response.headers.get("retry-after")) ?? 0;
				throw new QueueRejection(retryAfter, `HTTP ${response.status} — ${text}`);
			}
			if (failure === void 0) throw new Error(`Qoder chat failed: HTTP ${response.status} ${response.statusText} — ${text}`);
			if (failure.kind === "rate-limit") throw new QueueRejection(failure.retryAfterSeconds, failure.detail);
			const message = failureMessage(failure, region, response.status, response.statusText);
			if (failure.kind === "sign-in-expired") throw new SignInExpiredError(message);
			throw new Error(message);
		}
		const contentType = response.headers.get("content-type") ?? "";
		if (/json|html|xml/i.test(contentType)) throw new ProtocolShapeChangedError(`chat answered \`200 ${contentType}\` where \`text/event-stream\` was expected`);
		if (response.body === null) throw new Error("Qoder chat returned no body");
		return response;
	}
	let waitedMs = 0;
	for (let attempt = 1;; attempt++) {
		let stream;
		let first;
		const attemptStartedAt = Date.now();
		try {
			stream = readFrames(await openAttempt(), shapeProbe);
			first = await stream.next();
		} catch (error) {
			waitedMs += Date.now() - attemptStartedAt;
			const queueWaitMs = queueWaitFor(error, waitedMs, attempt);
			if (queueWaitMs === void 0) throw error;
			if (signal?.aborted) throw error;
			await sleep(queueWaitMs, signal);
			waitedMs += queueWaitMs;
			continue;
		}
		waitedMs += Date.now() - attemptStartedAt;
		if (first.done === true) {
			if (shapeProbe.skipped > 0) throw new ProtocolShapeChangedError(`${region.displayName} chat stream: ${shapeProbe.skipped} frame(s) this build does not parse; first: ${shapeProbe.sample ?? "(none kept)"}`);
			throw new Error(`${region.displayName} returned an empty response`);
		}
		try {
			yield first.value;
			for (;;) {
				const step = await stream.next();
				if (step.done === true) break;
				yield step.value;
			}
		} finally {
			await stream.return(void 0).catch(() => {});
		}
		return;
	}
}
/**
* A queue rejection that can be waited out.
*
* `retryable` is what the shim reads to decide between a retryable status and a
* hard failure, so this stays a plain `Error` carrying the same flags the shim
* already understood.
*/
var QueueRejection = class extends Error {
	/** Always true: waiting can clear a queue. */
	retryable;
	/** Seconds to wait before retrying. */
	retryAfterSeconds;
	/** The upstream detail, in a form a human can act on. */
	upstreamDetail;
	constructor(retryAfterSeconds, detail) {
		super(`Qoder is busy — the request was queued${retryAfterSeconds > 0 ? ` (retry in ~${retryAfterSeconds}s)` : ""}`);
		this.name = "QueueRejection";
		this.retryable = true;
		this.retryAfterSeconds = retryAfterSeconds;
		this.upstreamDetail = detail;
	}
};
/**
* The account's daily billing allowance is spent. NOT a queue: the counter resets
* at the day boundary rather than draining, so `retryable: false` stops this
* plugin's own queue ladder; the host's retries need two locks — this route's
* policy (src/host/route-retry-policy.ts, docs/issues/24-terminal-failure-status-codes.md)
* does not retry the verdict, and the message says "daily quota exhausted", the wording the host's quota predicate reads. */
var DailyLimitRejection = class extends Error {
	/** Always false: waiting within the session cannot fix a daily limit. */
	retryable;
	/** Marks this as a daily-limit (not queue) failure. */
	dailyLimit;
	/** Seconds until the counter resets (from the gateway, else 0). */
	retryAfterSeconds;
	/** The upstream detail, in a form a human can act on. */
	upstreamDetail;
	constructor(detail, retryAfterSeconds = 0) {
		super(`Qoder's daily request allowance for this account is used up (daily quota exhausted)${retryAfterSeconds > 0 ? ` — it resets in about ${Math.round(retryAfterSeconds / 3600)}h` : ""}. Waiting within the session will not help; the off-peak price (22:00–08:00 Asia/Shanghai) and the daily check-in both still work.`);
		this.name = "DailyLimitRejection";
		this.retryable = false;
		this.dailyLimit = true;
		this.retryAfterSeconds = retryAfterSeconds;
		this.upstreamDetail = detail;
	}
};
/**
* Build the readable sentence for a non-queue failure.
*
* Both parameters are the real shapes rather than `any`: `failure` is exactly
* what {@link readFailure} returns (the only producer), and `region` is the
* plugin's own `Region`. The `any` here meant the five field reads below —
* including `failure.detail.length`, which throws on a non-string — were never
* checked against the object that actually flows in.
*/
function failureMessage(failure, region, status, statusText) {
	if (failure.kind === "sign-in-expired") return `${region.displayName} sign-in is no longer valid — open the ${region.displayName} app to sign in again, then restart DSH${status !== void 0 ? ` (HTTP ${status}: ${failure.detail})` : ` (upstream ${failure.code || "error"}: ${failure.detail})`}`;
	if (status === 401 || status === 403) return `${region.displayName} was refused by Qoder — check that this account can use this model (HTTP ${status}: ${failure.detail})`;
	if (status !== void 0) return `Qoder chat failed: HTTP ${status} ${statusText ?? ""} — ${failure.detail}`;
	return `Qoder upstream error${failure.code !== "" ? ` ${failure.code}` : ""}${failure.detail.length > 0 ? `: ${failure.detail}` : ""}`;
}
/**
* Parse a string that is expected to hold a JSON object, else `undefined`.
*/
function tryJsonObject(text) {
	const trimmed = text.trim();
	if (!trimmed.startsWith("{")) return void 0;
	try {
		const parsed = JSON.parse(trimmed);
		return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : void 0;
	} catch {
		return;
	}
}
/** Whether a value is a plain (non-array) object. */
function isPlainObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
/**
* Unwrap the gateway's failure envelope to its deepest level.
*
* Qoder nests the real complaint instead of stating it once: an outer
* transport code wraps a `message` that is itself a JSON *string*, which wraps
* another code and message, and the queue descriptor sits at the bottom —
*
* ```
* { code: "403",
*   message: "{\"code\":\"10605\",
*              \"message\":\"{\\\"isQueued\\\":false,\\\"retryAfterSeconds\\\":2,...}\"}" }
* ```
*
* Reading only the first level therefore reports a bare `403` and hides both
* the true code (`10605`) and the retry hint. The whole chain is walked here so
* the deepest code — the one that names the actual problem — wins.
*
* @returns `{ code, detail }`, the most specific code and the most informative
*   detail text found.
*/
function unwrapFailure(chunk) {
	let code = "";
	let detail = "";
	let node = chunk;
	let descended = false;
	for (let depth = 0; depth < 8; depth++) {
		if (!isPlainObject(node)) break;
		const levelCode = node.errorCode ?? node.code;
		if (typeof levelCode === "string" && levelCode.length > 0) code = levelCode;
		else if (typeof levelCode === "number" && Number.isFinite(levelCode)) code = String(levelCode);
		const message = node.message ?? node.errorMessage;
		if (typeof message === "string" && message.length > 0) detail = message;
		const next = (isPlainObject(node.details) ? node.details : isPlainObject(node.error) ? node.error : void 0) ?? (typeof message === "string" ? tryJsonObject(message) : void 0);
		if (next === void 0) break;
		node = next;
		descended = true;
	}
	if (descended && isPlainObject(node) && typeof node.message !== "string") detail = JSON.stringify(node);
	return {
		code,
		detail
	};
}

//#endregion
//#region src/host/upstream/messages.ts
/**
* Normalize a message list into what the Qoder endpoint accepts.
*
* Two vocabularies can arrive here and both must survive the trip:
*
* - **OpenAI shape**, which is what pi-ai actually sends through the shim:
*   `tool_calls` on the assistant message and `role: "tool"` with a
*   `tool_call_id` for the result. Dropping either would break the harness's
*   tool loop on the second turn, which is the single most important thing
*   this translation has to get right.
* - **DSH shape** (`toolCall` content blocks, `toolResult` role), accepted so
*   the function stays usable from a direct caller.
*
* Image parts become `image_url` parts carrying a data URL, which is the only
* image form this endpoint accepts.
*
* @param messages - messages in either vocabulary.
* @returns Qoder-shaped messages.
*/
function toQoderMessages(messages) {
	const out = [];
	for (const raw of messages) {
		const message = raw;
		if (message === null || typeof message !== "object") continue;
		if (message.role === "system" || message.role === "developer") {
			out.push({
				role: "system",
				content: textOf(message.content)
			});
			continue;
		}
		if (message.role === "user") {
			const parts = [];
			let hasImage = false;
			if (Array.isArray(message.content)) {
				for (const block of message.content) if (block?.type === "text") parts.push({
					type: "text",
					text: block.text ?? ""
				});
				else if (block?.type === "image_url" || block?.type === "image") {
					const url = block.image_url?.url ?? (typeof block.data === "string" ? `data:${block.mimeType ?? "image/png"};base64,${block.data}` : void 0);
					if (url !== void 0) {
						hasImage = true;
						parts.push({
							type: "image_url",
							image_url: { url }
						});
					}
				}
			}
			out.push({
				role: "user",
				content: hasImage ? parts : textOf(message.content)
			});
			continue;
		}
		if (message.role === "assistant") {
			let text = "";
			const toolCalls = [];
			if (Array.isArray(message.tool_calls)) for (const call of message.tool_calls) {
				if (call == null || typeof call !== "object") continue;
				const id = call.id;
				if (typeof id !== "string" || id.length === 0) throw new Error("toQoderMessages: assistant tool_call is missing an id; the tool loop cannot match the result back to it");
				const name = call.function?.name ?? call.name;
				if (typeof name !== "string" || name.length === 0) throw new Error(`toQoderMessages: assistant tool_call "${id}" has no function name; the gateway cannot dispatch it`);
				toolCalls.push({
					id,
					type: "function",
					function: {
						name,
						arguments: typeof call.function?.arguments === "string" ? call.function.arguments : JSON.stringify(call.function?.arguments ?? call.arguments ?? {})
					}
				});
			}
			if (Array.isArray(message.content)) {
				for (const block of message.content) if (block?.type === "text") text += block.text ?? "";
				else if (block?.type === "toolCall") {
					const id = block.id;
					if (typeof id !== "string" || id.length === 0) throw new Error("toQoderMessages: assistant toolCall block is missing an id; the tool loop cannot match the result back to it");
					if (typeof block.name !== "string" || block.name.length === 0) throw new Error(`toQoderMessages: toolCall "${id}" has no function name; the gateway cannot dispatch it`);
					toolCalls.push({
						id,
						type: "function",
						function: {
							name: block.name,
							arguments: JSON.stringify(block.arguments ?? {})
						}
					});
				}
			} else text = textOf(message.content);
			const entry = {
				role: "assistant",
				content: text
			};
			if (toolCalls.length > 0) entry.tool_calls = toolCalls;
			out.push(entry);
			continue;
		}
		if (message.role === "toolResult" || message.role === "tool") {
			const toolCallId = message.toolCallId ?? message.tool_call_id;
			if (typeof toolCallId !== "string" || toolCallId.length === 0) throw new Error("toQoderMessages: tool result message is missing tool_call_id; it cannot be linked to the calling assistant turn");
			out.push({
				role: "tool",
				tool_call_id: toolCallId,
				content: textOf(message.content)
			});
		}
	}
	return out;
}
/** Flatten a DSH content value into plain text. */
function textOf(content) {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	let text = "";
	for (const block of content) if (block?.type === "text") text += typeof block.text === "string" ? block.text : "";
	return text;
}
/**
* Normalize tool definitions into the endpoint's function schema.
*
* pi-ai hands the shim tools that are already OpenAI-shaped
* (`{ type: "function", function: { name, description, parameters } }`), so the
* common case is a pass-through. A bare DSH descriptor (`{ name, description,
* parameters }`) is also accepted and wrapped, which keeps this usable from a
* direct caller as well.
*
* @param tools - tool descriptors in either shape.
* @returns OpenAI-shaped tool entries.
*/
function toQoderTools(tools) {
	if (!Array.isArray(tools)) return [];
	return tools.map((tool, index) => {
		if (tool?.function != null && typeof tool.function === "object") {
			const name = tool.function.name;
			if (typeof name !== "string" || name.length === 0) throw new Error(`toQoderTools: tool at index ${index} has no function name; the gateway cannot register it`);
			return {
				type: "function",
				function: {
					name,
					description: tool.function.description ?? "",
					parameters: tool.function.parameters ?? {
						type: "object",
						properties: {}
					}
				}
			};
		}
		const name = tool?.name;
		if (typeof name !== "string" || name.length === 0) throw new Error(`toQoderTools: tool at index ${index} has no name; the gateway cannot register it`);
		return {
			type: "function",
			function: {
				name,
				description: tool?.description ?? "",
				parameters: tool?.parameters ?? {
					type: "object",
					properties: {}
				}
			}
		};
	});
}

//#endregion
//#region src/host/time.ts
/**
* Upstream timestamp coercion, shared by the two modules that read them.
*
* Qoder is not consistent about how it spells a time, even inside one flow:
*
* - The campaign records publish their window as **second-precision integers**
*   (`startAt: 1790388000`).
* - The very claim endpoint for those campaigns answers with **RFC 3339
*   strings** (`"expiresAt":"2026-10-26T03:38:29.310161Z"`).
*
* Both used to be parsed by copies of this function living in `upstream.js` and
* `claim.js`. The copies disagreed — one accepted strings, the other did not,
* and they drew the seconds/milliseconds line at different thresholds — which
* is exactly how a old-as-1973 threshold stays invisible until a field arrives
* in the shape neither copy expected. One definition, one behaviour.
*
* @module dsh-connect-qoder/time
*/
/** Anything below this epoch-millisecond value must be seconds (1e12 ms ≈ 2001). */
const SECONDS_BOUNDARY_MS = 0xe8d4a51000;
/**
* Coerce one upstream timestamp into epoch milliseconds.
*
* @param value - the raw value: seconds, milliseconds, or an RFC 3339 string.
* @returns epoch milliseconds, or `undefined` when it is not a usable time.
*/
function toEpochMs(value) {
	if (value === null || value === void 0) return void 0;
	if (typeof value === "number") {
		if (!Number.isFinite(value) || value <= 0) return void 0;
		return value < SECONDS_BOUNDARY_MS ? Math.floor(value * 1e3) : Math.floor(value);
	}
	if (typeof value === "string") {
		const parsed = Date.parse(value);
		return Number.isFinite(parsed) ? parsed : void 0;
	}
}

//#endregion
//#region src/host/upstream/api-calls.ts
/**
* api-calls — moved verbatim from `src/host/upstream.ts` during the protocol
* split (docs/issues/22-upstream-split.md); only imports and exports were
* tidied. The protocol facts live in the header of `crypto.ts`.
*/
/**
* Parse a JSON body, reporting the content-type when parsing fails.
*
* A 200 reply whose body is not JSON (an HTML login page from a SSO gateway,
* a chunked-proxy error document) would otherwise surface as a cryptic
* `SyntaxError: Unexpected token '<'`. The body is read once and parsed
* directly — so a parseable body passes regardless of how the gateway labelled
* it — and only a genuine parse failure produces the richer message.
*
* @param response - the successful (2xx) response to read.
* @param context - short label for the error message (e.g. "Qoder model list").
* @returns the parsed JSON value.
*/
async function readJson(response, context) {
	const text = await response.text();
	try {
		return JSON.parse(text);
	} catch {
		const ct = response.headers.get("content-type") ?? "no content-type";
		throw new Error(`${context}: response is not valid JSON (${ct}) — ${redactSecrets(text).slice(0, 300)}`);
	}
}
/**
* Narrow a campaigns payload to the envelope {@link projectCampaignRows} reads.
*
* The endpoint is supplementary, but "no offers today" and "the offers envelope
* was renamed" used to be indistinguishable: the panel simply rendered nothing
* and the check-in card vanished, with no hint the plugin was out of step. The
* clone's private protocol has no version negotiation, so this is the failure
* that reaches users first after an upstream release.
*
* Deliberate non-drift cases: an empty object (nothing to misread) and a
* missing `campaigns` value (null/undefined) both stay "no campaigns".
*
* @param payload - the parsed 200 body.
* @returns the campaigns record.
* @throws {ProtocolShapeChangedError} when the body is not a campaigns document.
*/
function readCampaignsShape(payload) {
	if (payload === null || typeof payload !== "object" || Array.isArray(payload)) throw new ProtocolShapeChangedError(`campaigns top level is ${payload === null ? "null" : Array.isArray(payload) ? "an array" : typeof payload}, not a campaigns envelope`);
	const record = payload;
	const keys = Object.keys(record);
	const KNOWN_ENVELOPE_FIELDS = [
		"campaigns",
		"uid",
		"showCampaign",
		"claimable"
	];
	if (keys.length > 0 && !keys.some((key) => KNOWN_ENVELOPE_FIELDS.includes(key))) throw new ProtocolShapeChangedError(`no known campaigns field; keys present: ${keys.slice(0, 12).join(", ")}`);
	if (record.campaigns !== null && record.campaigns !== void 0 && !Array.isArray(record.campaigns)) throw new ProtocolShapeChangedError(`\`campaigns\` is ${typeof record.campaigns}, not an array`);
	return record;
}
/**
* Read the raw campaigns payload once.
*
* Split from the old `fetchCampaigns` (deleted in cleanup #1: it had no
* callers) so one round trip can serve both things the campaign list answers:
* the promotional copy the usage panel renders, and the
* `actionType` / `claimStatus` pair that decides whether there is a daily
* check-in to claim today. Sending two requests for those would be one more
* way for the panel and the button to disagree.
*
* @returns the parsed campaigns document, unvalidated — `readJson` proves only
*   that the body parsed as JSON, so the shape is left `unknown` and
*   {@link projectCampaignRows} is what narrows it. The previous signature
*   claimed `{ campaigns?: Campaign[] }`, which no code had ever checked; it
*   compiled only because the field reads went through an `any`.
*/
async function readCampaigns(region, credential, signal) {
	const response = await fetch(campaignsUrl(region), {
		method: "GET",
		headers: openApiHeaders(credential, region),
		redirect: "error",
		...signal === void 0 ? {} : { signal }
	});
	if (!response.ok) throw new UpstreamRefusalError(`Qoder campaigns failed: HTTP ${response.status}`, response.status, redactSecrets(await response.text()).slice(0, 300), response.headers.get("retry-after"));
	return readCampaignsShape(await readJson(response, "Qoder campaigns"));
}
/**
* Claim one campaign's benefit, returning the raw answer.
*
* The upstream answers a repeat claim idempotently — `replayed: true`, nothing
* granted — rather than failing it, so calling this twice costs no Credits.
* Shape normalisation is a separate pure function (`normalizeClaimResult`) so
* the interesting part is asserted without a network.
*
* @returns the parsed claim response, unvalidated — {@link normalizeClaimResult}
*   is what narrows it, so the shape stays `unknown` here.
*/
async function claimCampaign(region, credential, campaignId, signal) {
	if (typeof campaignId !== "string" || campaignId.length === 0) throw new Error("Qoder check-in failed: no campaign id to claim");
	const response = await fetch(claimCampaignUrl(region, campaignId), {
		method: "POST",
		headers: {
			...openApiHeaders(credential, region),
			"Content-Type": "application/json"
		},
		body: "{}",
		redirect: "error",
		...signal === void 0 ? {} : { signal }
	});
	const text = await response.text();
	if (!response.ok) throw new UpstreamRefusalError(`Qoder check-in failed: HTTP ${response.status} ${redactSecrets(text).slice(0, 200)}`, response.status, redactSecrets(text).slice(0, 300), response.headers.get("retry-after"));
	try {
		return JSON.parse(text);
	} catch {
		const ct = response.headers.get("content-type") ?? "no content-type";
		throw new Error(`Qoder check-in: response is not valid JSON (${ct}) — ${redactSecrets(text).slice(0, 300)}`);
	}
}
/**
* Read the model list's product-surface groups and return the `chat` one. A missing
* sibling group is normal (the global edition has no `developer` group), so only `chat`
* is keyed on; an empty group is `[]`, not an absent key: `chat: []` is the honest "no
* models on this surface", not drift. The three states stay apart: an array is the
* `chat` group, a plain object an unknown wrapper, an absent `chat` a renamed group —
* either drift (docs/issues/04-empty-catalog-freeze.md).
* @param data - the parsed 200 body.
* @param region - the region descriptor, for the error message only.
* @returns the `chat` array of raw rows.
* @throws {ProtocolShapeChangedError} for either drift shape. */
function readModelCatalogShape(data, _region = { displayName: "Qoder" }) {
	if (data === null || typeof data !== "object" || Array.isArray(data)) throw new ProtocolShapeChangedError(`top level is ${Array.isArray(data) ? "an array" : typeof data}, not a group envelope`);
	const envelope = data;
	if (!("chat" in envelope)) throw new ProtocolShapeChangedError(`no \`chat\` group; groups present: ${Object.keys(envelope).slice(0, 12).join(", ") || "(none)"}`);
	const chat = envelope.chat;
	if (!Array.isArray(chat)) throw new ProtocolShapeChangedError(`\`chat\` is ${chat === null ? "null" : typeof chat}, not an array`);
	return chat;
}
/**
* Fetch and normalize the account's model catalog.
*
* The response is grouped by product surface (`chat`, `developer`, `quest`,
* ...). The `chat` group is the one that answers on the `agent_common` route,
* so only it is used.
*
* @returns an array of `{ key, name, isVL, isReasoning, maxInputTokens, ... }`.
* @throws {ProtocolShapeChangedError} when the 200 body is not an envelope
*   this code recognises — see {@link readModelCatalogShape}.
*/
async function fetchModels(region, credential, signal) {
	const url = modelListUrl(region);
	const headers = authHeaders(Buffer.alloc(0), url, credential);
	const response = await fetch(url, {
		method: "GET",
		headers: {
			Accept: "application/json",
			...headers
		},
		redirect: "error",
		...signal === void 0 ? {} : { signal }
	});
	if (!response.ok) {
		const text = redactSecrets(await response.text()).slice(0, 300);
		throw new UpstreamRefusalError(`Qoder model list failed: HTTP ${response.status} ${text}`, response.status, text, response.headers.get("retry-after"));
	}
	const chat = readModelCatalogShape(await readJson(response, "Qoder model list"), region);
	if (chat.length === 0) return [];
	const models = [];
	for (const raw of chat) {
		if (raw === null || typeof raw !== "object") continue;
		const entry = raw;
		if (typeof entry.key !== "string" || entry.key.length === 0) continue;
		if (entry.enable === false) continue;
		if (typeof entry.display_name !== "string" || entry.display_name.length === 0) continue;
		const config = entry.thinking_config;
		const efforts = config?.enabled?.efforts;
		const effortLevels = efforts !== null && typeof efforts === "object" ? Object.keys(efforts) : [];
		const supportsEffort = effortLevels.length > 0;
		const canDisableThinking = config?.disabled !== void 0;
		const windows = entry.context_config;
		const contextOptions = [];
		let defaultContextWindow = 0;
		if (windows !== null && typeof windows === "object") {
			for (const value of Object.values(windows)) {
				const option = value;
				const tokens = Number(option?.token_count);
				if (!Number.isFinite(tokens) || tokens <= 0) continue;
				contextOptions.push(tokens);
				if (option?.is_default === true) defaultContextWindow = tokens;
			}
			contextOptions.sort((left, right) => left - right);
		}
		if (defaultContextWindow === 0) defaultContextWindow = Number(entry.max_input_tokens) || 0;
		models.push({
			key: entry.key,
			name: entry.display_name,
			isVL: entry.is_vl === true,
			isReasoning: entry.is_reasoning === true || config !== void 0,
			supportsEffort,
			alwaysThinking: supportsEffort && !canDisableThinking,
			effortLevels,
			defaultContextWindow,
			contextOptions,
			maxInputTokens: Number(entry.max_input_tokens) || 0,
			isDefault: entry.is_default === true,
			priceFactor: (() => {
				if (entry.price_factor === void 0 || entry.price_factor === null) return void 0;
				const factor = Number(entry.price_factor);
				return Number.isFinite(factor) ? factor : void 0;
			})(),
			isFree: entry.is_free === true,
			promotion: normalizePromotion(entry.promotion)
		});
	}
	return models;
}
/**
* Exchange a personal access token for a job token.
*
* @returns `{ token, refreshToken, expiresAt }`.
*/
async function exchangePat(region, pat, signal) {
	const response = await fetch(exchangeUrl(region), {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json"
		},
		body: JSON.stringify({ personal_access_token: pat }),
		redirect: "error",
		...signal === void 0 ? {} : { signal }
	});
	if (!response.ok) {
		const text = redactSecrets(await response.text()).slice(0, 300);
		const error = /* @__PURE__ */ new Error(`Qoder PAT exchange failed: HTTP ${response.status} ${text}`);
		error.status = response.status;
		let retryAfter = parseRetryAfterSeconds(response.headers.get("retry-after"));
		if (retryAfter === void 0) {
			const bodySeconds = /"retryAfterSeconds"\s*:\s*(\d+)/.exec(text);
			if (bodySeconds?.[1] !== void 0) {
				const parsed = Number(bodySeconds[1]);
				if (Number.isFinite(parsed) && parsed > 0) retryAfter = parsed;
			}
		}
		if (retryAfter !== void 0) error.retryAfterSeconds = retryAfter;
		throw error;
	}
	const data = await readJson(response, "Qoder PAT exchange");
	const payload = data === null || typeof data !== "object" ? {} : data;
	const token = payload.token ?? payload.job_token ?? payload.jobToken;
	if (typeof token !== "string" || token.length === 0) throw new Error("Qoder PAT exchange returned no token");
	return {
		token,
		refreshToken: typeof payload.refresh_token === "string" ? payload.refresh_token : "",
		expiresAt: toEpochMs(payload.expires_at) ?? Date.now() + 36e5
	};
}
/**
* Narrow a userinfo body to the record the identity fields are read from.
*
* Two envelopes occur (the identity sits under `data` or at the top level), and
* the card's 在线校验 turns this call into "your sign-in is valid" — so a body
* that is no longer the profile document must not be reported as a valid
* sign-in with an empty name. An empty object still answers `{}` (no identity
* to show, which the card renders as a plain confirm), but a non-empty body
* carrying no identity field at all is drift.
*
* @param data - the parsed 200 body.
* @returns the identity record.
* @throws {ProtocolShapeChangedError} when the body is not a profile document.
*/
function readUserInfoShape(data) {
	if (data === null || typeof data !== "object" || Array.isArray(data)) throw new ProtocolShapeChangedError(`userinfo top level is ${data === null ? "null" : Array.isArray(data) ? "an array" : typeof data}, not a userinfo envelope`);
	const envelope = data;
	const inner = envelope.data;
	const body = inner === null || typeof inner !== "object" ? envelope : inner;
	const keys = Object.keys(body);
	if (keys.length === 0) return body;
	const IDENTITY_FIELDS = [
		"id",
		"user_id",
		"name",
		"nickname",
		"email"
	];
	if (!keys.some((key) => IDENTITY_FIELDS.includes(key))) throw new ProtocolShapeChangedError(`no identity field; keys present: ${keys.slice(0, 12).join(", ")}`);
	return body;
}
/**
* Fetch the signed-in account's profile.
*
* The request goes through `openApiHeaders` like every other OpenAPI call, so
* the whole route presents one client identity (`Cosy-ClientType`,
* `User-Agent`) to the gateway.
*
* That is consistency, not the cure for a failure seen here: a direct probe of
* `openapi.qoder.com.cn/api/v1/userinfo` with a real CN credential answers
* HTTP 200 for a bare `Authorization: Bearer` as well. The 400 the card once
* showed on 在线确认 came from the account route dereferencing a runtime
* entry's nonexistent `region` field before this call was ever made (see the
* stopped-region check in lib/index.js). Keep the shared header set: it is
* what the real client sends, and the other OpenAPI calls already rely on it.
*
* @returns `{ userID, name, email }`.
*/
async function fetchUserInfo(region, credential, signal) {
	const response = await fetch(userInfoUrl(region), {
		method: "GET",
		headers: openApiHeaders(credential, region),
		redirect: "error",
		...signal === void 0 ? {} : { signal }
	});
	if (!response.ok) {
		const text = redactSecrets(await response.text()).slice(0, 300);
		throw new UpstreamRefusalError(`Qoder userinfo failed: HTTP ${response.status} ${text}`, response.status, text, response.headers.get("retry-after"));
	}
	const body = readUserInfoShape(await readJson(response, "Qoder userinfo"));
	return {
		userID: String(body.id ?? body.user_id ?? ""),
		name: String(body.name ?? body.nickname ?? ""),
		email: String(body.email ?? "")
	};
}

//#endregion
//#region src/host/claim.ts
/**
* The daily check-in: deciding whether the upstream has anything to claim,
* and reading back what a claim returned.
*
* Qoder hands each account a fresh campaign every day at 10:00 (UTC+8) — a
* new `campaignId` each round, always carrying a 100-Credit benefit — and the
* account claims it once per round. Everything this module needs is already
* answered by the route the usage panel reads (`GET /sash/api/v1/me/campaigns`),
* so no extra shape of request is invented here: the same payload that feeds
* the promotional copy also carries `actionType` and `claimStatus`.
*
* Two filters matter, and field evidence (2026-09-27, both regions) is why:
*
* - **`actionType`** must be `CLAIM_BENEFIT`. The very same account carries a
*   second campaign of type `VIEW_DETAILS` (a subscription promotion with no
*   benefit at all) that nevertheless reports `claimStatus: "CLAIMED"`. Judging
*   by status alone would send a claim POST at a campaign that has nothing to
*   hand out.
* - **`claimStatus`** is what distinguishes a claimable round from a claimed
*   one. The payload's own top-level `claimable` flag answers `false` for both
*   "already claimed today" and "nothing is running", and `claimable` on the
*   campaign itself does not exist as a field at all, so neither can be trusted
*   as the gate.
*
* An unknown `claimStatus` is treated as claimable rather than as claimed.
* The upstream makes claiming idempotent (a repeat answers `replayed: true`
* and grants nothing), so the cost of being optimistic is one wasted request,
* while the cost of being pessimistic is hiding the feature permanently the
* day Qoder renames its statuses.
*
* A list that carries no `CLAIM_BENEFIT` round at all reads as
* `active: false` by design — that is not a missing feature the selector
* failed to find. The international campaigns endpoint answers requests
* without the desktop app's umid machine identity with the evergreen
* `VIEW_DETAILS` banner only (verified 2026-09-27 against the live endpoint);
* the daily round lists itself to machine-identified reads, which is what
* `readCampaigns` now sends (`lib/upstream.js`, `openApiHeaders`). A reduced
* list is therefore the upstream's answer to a request it could not bind to
* a machine, not a selector bug; this module cannot distinguish the two, and
* must not pretend to.
*
* Nothing here touches the network, and nothing here carries a campaign id to
* the caller that would let it claim a stale round: the claim route re-reads
* the campaigns for itself, which is the order the upstream requires.
*
* @module dsh-connect-qoder/claim
*/
/** MIME-free label for the one campaign type that actually pays out. */
const CLAIM_BENEFIT_ACTION = "CLAIM_BENEFIT";
/** Status of a round this account has already collected. */
const CLAIMED_STATUS = "CLAIMED";
/**
* The benefit a campaign would pay out.
*
* Amounts the upstream may carry elsewhere describe what was granted, not what
* is left, so only the benefit attached to a `CLAIM_BENEFIT` action is read —
* the same restraint the usage panel applies to promotional amounts.
*
* @param {object} campaign - one raw campaign record.
* @returns `{ amount, kind, validDays }` when it has a numeric amount.
*/
function benefitOf(campaign) {
	const benefit = campaign?.benefit;
	if (benefit === null || typeof benefit !== "object") return void 0;
	const amount = Number(benefit.amount);
	if (!Number.isFinite(amount) || amount <= 0) return void 0;
	const validityDays = Number(benefit.validity?.days);
	return {
		amount,
		kind: typeof benefit.kind === "string" ? benefit.kind : "CREDITS",
		...Number.isFinite(validityDays) && validityDays > 0 ? { validDays: validityDays } : {}
	};
}
/**
* Is this campaign's window open at `nowMs`?
*
* A campaign whose window has closed is not claimable even though the upstream
* still lists it: the previous round stays visible until the next one is
* published. A record with no usable window is treated as open, because an
* absent window means the upstream is not gating the round rather than that
* the round has ended.
*/
function windowOpenAt(campaign, nowMs) {
	const record = campaign;
	const startAt = toEpochMs(record?.startAt ?? record?.beginAt);
	const endAt = toEpochMs(record?.endAt);
	if (startAt !== void 0 && nowMs < startAt) return false;
	if (endAt !== void 0 && nowMs > endAt) return false;
	return true;
}
/**
* The one campaign that pays out and is open right now.
*
* @param {unknown} payload - the raw `GET /sash/api/v1/me/campaigns` body.
* @param {number} [nowMs] - clock, injected for testing.
* @returns the raw record, or `undefined` when there is none.
*/
function claimableCampaignOf(payload, nowMs = Date.now()) {
	const list = payload?.campaigns;
	if (!Array.isArray(list)) return void 0;
	for (const campaign of list) {
		if (campaign === null || typeof campaign !== "object") continue;
		if (campaign.actionType !== "CLAIM_BENEFIT") continue;
		if (!windowOpenAt(campaign, nowMs)) continue;
		return campaign;
	}
}
/**
* Whether this account has already collected the current round.
*
* @param {object} campaign - the record from {@link claimableCampaignOf}.
* @returns true when its status says so.
*/
function campaignIsClaimed(campaign) {
	return campaign?.claimStatus === CLAIMED_STATUS;
}
/**
* The card-facing check-in state.
*
* Shaped after `dsh-connect-workbuddy`'s `status.checkin`, which is the
* contract this family of cards already reads: `active` says the upstream has
* a round running, `todayCheckedIn` says this account collected it. The card
* renders a button and never derives either one itself — see the "one fact, one
* place" rule that off-peak pricing cost this plugin once already.
*
* No campaign id is published. The host re-reads the campaigns before every
* claim, so a stale id could never be clicked from this state even if it were
* shown.
*
* @param {unknown} payload - the raw campaigns body.
* @param {number} [nowMs] - clock, injected for testing.
* @returns `{ active, todayCheckedIn, amount?, unit?, validDays?, endsAt? }`.
*/
function checkinStateFrom(payload, nowMs = Date.now()) {
	const campaign = claimableCampaignOf(payload, nowMs);
	if (campaign === void 0) return {
		active: false,
		todayCheckedIn: false
	};
	const benefit = benefitOf(campaign);
	const endsAt = toEpochMs(campaign.endAt);
	return {
		active: true,
		todayCheckedIn: campaignIsClaimed(campaign),
		...benefit !== void 0 ? {
			amount: benefit.amount,
			unit: benefit.kind === "CREDITS" ? "credits" : benefit.kind.toLowerCase(),
			...benefit.validDays !== void 0 ? { validDays: benefit.validDays } : {}
		} : {},
		...endsAt !== void 0 ? { endsAt } : {}
	};
}
/**
* Read back what a claim answered.
*
* The upstream distinguishes a fresh grant (`replayed: false`) from a repeat
* that granted nothing (`replayed: true`) rather than failing the second call,
* so both are success — they just mean different things to the person pressing
* the button. The amount is taken from the response, falling back to what the
* campaign advertised, so "received 100 Credits" is never printed from memory
* when the upstream said otherwise.
*
* @param {unknown} payload - the raw claim response body.
* @param {object|undefined} [campaign] - the campaign that was claimed.
* @returns `{ claimed, replayed, amount?, expiresAt? }`. `amount` is present
*   only when this call actually paid out: a `replayed` answer granted nothing,
*   so reporting what the campaign advertises would claim a gain that did not
*   happen.
*/
function normalizeClaimResult(payload, campaign) {
	const payloadRecord = payload;
	const body = payloadRecord?.data !== null && typeof payloadRecord?.data === "object" ? payloadRecord.data : payload;
	const status = typeof body?.status === "string" ? body.status : "";
	const replayed = body?.replayed === true;
	const granted = status === "CLAIMED" || replayed || body?.success === true;
	const amountValue = Number(body?.benefit?.amount ?? (typeof campaign !== "undefined" ? benefitOf(campaign)?.amount : void 0));
	const expiresAt = toEpochMs(body?.expiresAt);
	return {
		claimed: granted,
		replayed,
		...!replayed && Number.isFinite(amountValue) && amountValue > 0 ? { amount: amountValue } : {},
		...expiresAt !== void 0 ? { expiresAt } : {}
	};
}

//#endregion
//#region src/host/upstream/fetch-usage.ts
/**
* fetch-usage — the account's usage and campaign snapshot.
*
* Moved verbatim from `src/host/upstream.ts` when the protocol was split
* (docs/issues/22-upstream-split.md); only imports and exports were tidied. The
* protocol facts' original notes live at the head of `upstream/crypto.ts`.
*
* One deliberate behaviour change: `fetchUsage` used to swallow a failed
* campaigns read (AGENTS.md red line 1); the failure now lands in the snapshot's
* `campaignsError` field and the card renders it, so a vanished promo row is
* distinguishable from a day with no campaign.
*/
/**
* The `used` / `remaining` / `percentage` / `unit` four-tuple, from a raw bucket.
*
* Shared by {@link normalizeQuotaBucket} and {@link normalizeDedicatedPackage}
* because the two used to carry this block verbatim — the same guess about
* percentages, the same clamp, the same default unit — and a heuristic that
* exists twice is a heuristic that can be corrected once. That is not
* hypothetical here: this plugin has already been bitten by two copies of a
* time comparison drifting apart, and the fix then was to merge them into one
* function (`time.ts`). Same shape, same fix.
*
* The `> 1 means percent` rule is a GUESS about an undeclared upstream field.
* It is kept as-is (it is what the IDE panel agrees with) but it is stated in
* one place now, so if the upstream ever starts sending `0.5` to mean 50% there
* is one line to change and one comment to correct.
*
* @param source - the raw bucket or package object.
* @param total - the already-validated total (> 0), used for the fallbacks.
* @returns the four display fields.
*/
function quotaAmountsOf(source, total) {
	const used = Number(source.used);
	const safeUsed = Number.isFinite(used) ? Math.max(0, used) : 0;
	const remainingRaw = Number(source.remaining);
	const remaining = Number.isFinite(remainingRaw) ? Math.max(0, remainingRaw) : Math.max(0, total - safeUsed);
	const percentageRaw = Number(source.percentage);
	const percentage = Number.isFinite(percentageRaw) ? percentageRaw > 1 ? percentageRaw / 100 : percentageRaw : safeUsed / total;
	return {
		used: safeUsed,
		remaining,
		percentage: Math.min(1, Math.max(0, percentage)),
		unit: typeof source.unit === "string" && source.unit.length > 0 ? source.unit : "credits"
	};
}
/** Coerce one quota bucket into `{ total, used, remaining, percentage, unit }`. */
function normalizeQuotaBucket(value) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return void 0;
	const bucket = value;
	const total = Number(bucket.total);
	if (!Number.isFinite(total) || total <= 0) return void 0;
	return {
		total,
		...quotaAmountsOf(bucket, total)
	};
}
function normalizeDedicatedPackage(value) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return void 0;
	const pkg = value;
	const id = typeof pkg.id === "string" ? pkg.id.trim() : "";
	const total = Number(pkg.total);
	if (id === "" || !Number.isFinite(total) || total <= 0) return void 0;
	const expiresAt = toEpochMs(pkg.expiresAt);
	return {
		id,
		name: typeof pkg.name === "string" ? pkg.name : "",
		description: typeof pkg.description === "string" ? pkg.description : "",
		total,
		...quotaAmountsOf(pkg, total),
		...expiresAt !== void 0 ? { expiresAt } : {},
		available: pkg.available !== false
	};
}
/**
* The fields whose presence proves the body is still a usage document.
*
* Both spellings of each key are accepted: the plain route answers snake_case,
* the presentation route has been seen with camelCase, and the panel has always
* read either. This is a triage list, not a schema — a field the upstream adds
* is invisible here and must stay that way; what it rules out is the OTHER
* reading, a body that parsed as JSON but is no longer about usage at all.
*/
const USAGE_FIELDS = [
	"user_quota",
	"userQuota",
	"add_on_quota",
	"addOnQuota",
	"dedicated_resource_packages",
	"dedicatedResourcePackages",
	"is_quota_exceeded",
	"isQuotaExceeded",
	"user_type",
	"userType",
	"expires_at",
	"expiresAt",
	"upgrade_url",
	"upgradeUrl",
	"display_mode",
	"displayMode"
];
/**
* Narrow a usage payload to the record the snapshot fields are read from.
*
* The two routes answer the same body differently — `usagePresentationUrl`
* wraps it under `qoderUsage`, `usageUrl` returns it directly — so the unwrap
* has to happen somewhere. It used to happen by assumption: `qoderUsage ??
* data ?? payload`, then one `typeof === 'object'` test, and anything else
* became `undefined`, which the card rendered as "usage unavailable". After the
* clone's private protocol changes (it has no version negotiation) a renamed
* envelope therefore read as an account with nothing to show, and nothing told
* the user the plugin needs updating. That is the silent-failure shape red line
* 1 forbids, and the same triage the model list and chat already report.
*
* Three deliberate non-drift cases, because a false "update the plugin" is its
* own incident:
*
* - an empty object stays "no data" — it carries no evidence either way;
* - unknown fields alongside a known one are fine — the upstream may add;
* - the `usage` body is read from `qoderUsage` OR `data` OR the top level, so
*   either route's layout is accepted.
*
* @param payload - the parsed 200 body.
* @returns the envelope (for `displayMode`) and the usage record.
* @throws {ProtocolShapeChangedError} when the body is not a usage document.
*/
function readUsageShape(payload) {
	if (payload === null || typeof payload !== "object" || Array.isArray(payload)) throw new ProtocolShapeChangedError(`top level is ${payload === null ? "null" : Array.isArray(payload) ? "an array" : typeof payload}, not a usage envelope`);
	const envelope = payload;
	const usage = envelope.qoderUsage ?? envelope.data ?? payload;
	if (usage === null || typeof usage !== "object" || Array.isArray(usage)) throw new ProtocolShapeChangedError(`usage body is ${usage === null ? "null" : Array.isArray(usage) ? "an array" : typeof usage}, not an object`);
	const record = usage;
	const keys = Object.keys(record);
	if (keys.length === 0) return {
		envelope,
		record
	};
	if (!keys.some((key) => USAGE_FIELDS.includes(key))) throw new ProtocolShapeChangedError(`no known usage field; keys present: ${keys.slice(0, 12).join(", ")}`);
	return {
		envelope,
		record
	};
}
/**
* Project the campaigns payload onto the rows the usage panel renders.
*
* @param {unknown} payload - the raw campaigns document.
* @returns `[{ key, title, description, detailUrl, endsAt }]`.
*/
function projectCampaignRows(payload) {
	const list = Array.isArray(payload?.campaigns) ? payload.campaigns : [];
	const rows = [];
	for (const raw of list) {
		if (raw === null || typeof raw !== "object") continue;
		const campaign = raw;
		const usage = (Array.isArray(campaign.placements) ? campaign.placements : []).find((entry) => entry?.type === "USAGE");
		if (usage === void 0) continue;
		const content = usage.content?.zh ?? usage.content?.["zh-CN"] ?? usage.content?.en ?? {};
		const endsAt = toEpochMs(campaign.endAt);
		rows.push({
			key: String(campaign.campaignKey ?? campaign.campaignId ?? ""),
			title: typeof content.title === "string" ? content.title : "",
			description: typeof content.description === "string" ? content.description : "",
			detailUrl: typeof content.detailUrl === "string" ? content.detailUrl : "",
			...endsAt !== void 0 ? { endsAt } : {}
		});
	}
	return rows;
}
/**
* Normalize one model's time-of-day discount.
*
* Qoder discounts some models during an off-peak window (the catalog's own copy
* reads "错峰 4 折" — 22:00 to 08:00, Asia/Shanghai). The block carries the
* window, the discounted multiplier, and the multiplier that applies outside it,
* so the effective rate depends on **when** the model is used, not just on the
* catalog entry.
*
* The upstream `active` field is a moment-in-time answer — "is the discount
* applying right now" — NOT a campaign switch. Measured live at 14:02 UTC+8:
* all three discounted models reported `active:false` while still carrying
* their badges, descriptions and 22:00–08:00 windows; the window was simply
* closed. Read verbatim as a campaign switch it silenced the entire off-peak
* UI for the whole day — no card badge, no countdown, no discounted-rate hint,
* exactly the "does the discount only exist after 22:00?" confusion it is
* normalized away here. So a `false` is only honored as a kill when the window
* was OPEN at the moment the server told us it (the one reading that can only
* mean switched off); a `false` fetched outside the window is uninformative
* and the campaign stands. Every consumer keeps treating the normalized
* `active:false` as the kill signal it always meant.
*
* @param value - the raw upstream promotion block.
* @param now - the fetch instant the moment-in-time flag was observed at.
* @returns `{ active, windowStart, windowEnd, timezone, discountFactor,
*   beforePromotionPriceFactor, badge, description }`, or `undefined` when the
*   model carries no promotion.
*/
function normalizePromotion(value, now = /* @__PURE__ */ new Date()) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return void 0;
	const promotion = value;
	const discountFactor = Number(promotion.discount_factor);
	const before = Number(promotion.before_promotion_price_factor);
	const windowStart = typeof promotion.window_start === "string" ? promotion.window_start : "";
	const windowEnd = typeof promotion.window_end === "string" ? promotion.window_end : "";
	const hasWindow = /^\d{2}:\d{2}$/.test(windowStart) && /^\d{2}:\d{2}$/.test(windowEnd);
	if (!Number.isFinite(discountFactor) && !Number.isFinite(before) && !hasWindow) return void 0;
	const timezone = typeof promotion.timezone === "string" && promotion.timezone.length > 0 ? promotion.timezone : "Asia/Shanghai";
	const pick = (field) => {
		const source = promotion[field];
		if (source === null || typeof source !== "object") return "";
		const text = source.zh ?? source["zh-CN"] ?? source.en;
		return typeof text === "string" ? text : "";
	};
	return {
		active: promotion.active === true || promotion.active === false && hasWindow && !windowIsOpen(windowStart, windowEnd, timezone, now),
		windowStart: hasWindow ? windowStart : "",
		windowEnd: hasWindow ? windowEnd : "",
		timezone,
		...Number.isFinite(discountFactor) ? { discountFactor } : {},
		...Number.isFinite(before) ? { beforePromotionPriceFactor: before } : {},
		badge: pick("badge"),
		description: pick("description")
	};
}
/**
* Read the account's usage, shaped the way the IDE's panel presents it.
*
* Two routes are tried because they carry different halves of the picture: the
* `sash` presentation route includes the per-model dedicated packages, while
* `quota/usage` is the older, narrower shape. Either alone is enough to render
* something useful, so a failure of the first falls back to the second rather
* than failing the whole read.
*
* @returns `{ displayMode, userType, expiresAt, upgradeUrl, userQuota, addOnQuota,
*   dedicatedPackages, campaigns, checkin, isQuotaExceeded, source }`, or
*   `undefined` when neither route answered. `campaignsError` is present only
*   when the supplementary campaigns read failed.
*/
async function fetchUsage(region, credential, signal) {
	const headers = openApiHeaders(credential, region);
	const read = async (url) => {
		const response = await fetch(url, {
			method: "GET",
			headers,
			redirect: "error",
			...signal === void 0 ? {} : { signal }
		});
		if (!response.ok) throw new UpstreamRefusalError(`HTTP ${response.status}`, response.status, (await response.text()).slice(0, 300), response.headers.get("retry-after"));
		return readJson(response, "Qoder usage");
	};
	let payload;
	let source = "presentation";
	try {
		payload = await read(usagePresentationUrl(region));
	} catch (error) {
		if (signal?.aborted) throw error;
		source = "quota";
		payload = await read(usageUrl(region));
	}
	const { envelope, record } = readUsageShape(payload);
	const userQuota = normalizeQuotaBucket(record.user_quota ?? record.userQuota);
	const addOnQuota = normalizeQuotaBucket(record.add_on_quota ?? record.addOnQuota);
	const rawPackages = record.dedicated_resource_packages ?? record.dedicatedResourcePackages;
	const dedicatedPackages = Array.isArray(rawPackages) ? rawPackages.map(normalizeDedicatedPackage).filter((entry) => entry !== void 0) : [];
	let campaigns = [];
	let checkin;
	let campaignsError;
	let campaignsShapeChanged = false;
	try {
		const raw = await readCampaigns(region, credential, signal);
		campaigns = projectCampaignRows(raw);
		checkin = checkinStateFrom(raw);
	} catch (error) {
		if (signal?.aborted) throw error;
		campaignsError = describeThrown(error);
		campaignsShapeChanged = isProtocolShapeChangedError(error);
	}
	const expiresAt = toEpochMs(record.expires_at ?? record.expiresAt);
	const isQuotaExceeded = record.is_quota_exceeded ?? record.isQuotaExceeded;
	if (userQuota === void 0 && addOnQuota === void 0 && dedicatedPackages.length === 0) return void 0;
	return {
		displayMode: typeof envelope.displayMode === "string" ? envelope.displayMode : "qoder",
		userType: String(record.user_type ?? record.userType ?? ""),
		...expiresAt !== void 0 ? { expiresAt } : {},
		upgradeUrl: String(record.upgrade_url ?? record.upgradeUrl ?? ""),
		...userQuota !== void 0 ? { userQuota } : {},
		...addOnQuota !== void 0 ? { addOnQuota } : {},
		dedicatedPackages,
		campaigns,
		...campaignsError !== void 0 ? { campaignsError } : {},
		...campaignsShapeChanged ? { campaignsShapeChanged: true } : {},
		...checkin !== void 0 ? { checkin } : {},
		isQuotaExceeded: isQuotaExceeded === true,
		source
	};
}

//#endregion
//#region src/host/http-utils.ts
/**
* Write one JSON body.
*
* `Cache-Control: no-store` is set so the browser never caches the response.
* The card polls these endpoints on every render, and a cached response would
* show stale model lists, usage, or account state.
*
* @param res - the Node HTTP response.
* @param status - the HTTP status code.
* @param value - the value to serialize as JSON.
* @param extraHeaders - headers this response must also carry. They are passed
*   to `writeHead` rather than set separately, because `writeHead`'s object
*   REPLACES the header set — a `res.setHeader('Allow', …)` before a
*   `sendJson` call would otherwise be silently dropped, which is exactly the
*   bug the 405 path had when it tried to advertise `Allow` that way.
*/
function sendJson(res, status, value, extraHeaders = void 0) {
	const payload = JSON.stringify(value);
	res.writeHead(status, {
		"Content-Type": "application/json",
		"Content-Length": Buffer.byteLength(payload),
		"Cache-Control": "no-store",
		...extraHeaders ?? {}
	});
	res.end(res.req?.method === "HEAD" ? void 0 : payload);
}
/**
* Write one OpenAI-shaped error body.
*
* Used by the shim to answer with a structured error the host can parse.
*
* @param res - the Node HTTP response.
* @param status - the HTTP status code.
* @param code - the error type string.
* @param message - the human-readable error message.
* @param extraHeaders - optional additional headers (e.g., Retry-After).
*/
function writeError(res, status, code, message, extraHeaders = void 0) {
	const payload = JSON.stringify({ error: {
		message,
		type: code,
		code
	} });
	res.writeHead(status, {
		"Content-Type": "application/json",
		"Content-Length": Buffer.byteLength(payload),
		...extraHeaders ?? {}
	});
	res.end(payload);
}

//#endregion
//#region src/host/routes.ts
/**
* The gates every card route passes through, and the body reader they share.
*
* WHY THIS IS A MODULE
*
* These four functions used to live inside `lib/index.js`, which cannot be
* imported by a test — it pulls in the Cordis peer dependencies, and this
* repository installs none of them. That made the whole request-authentication
* surface untestable: the method check, the origin check, the body cap, and the
* 405/403 responses could all be wrong with the suite fully green
* (docs/KNOWN_GAPS.md item 1（`adapter.ts` 的 Cordis 接线与 profile 构造）and item 2（`RegionRuntime` 本身与 `activate` 的 Cordis 接线）).
*
* The alternative considered and rejected first was
* `--experimental-test-module-mocks`. It was implemented and measured, and it
* does not work here: `mock.module()` requires the specifier to be RESOLVABLE
* before it can stub it, and the whole point is that these packages are not
* installed. A resolver hook cannot help either — `lib/index.js` imports
* `adapter.js` statically at module scope, which is resolved before the hook
* chain sees it. KNOWN_GAPS claimed this route was "verified feasible"; on this
* machine it is not, and that claim is corrected there.
*
* So the gates are here, dependency-free and importable, and `lib/index.js`
* imports them. The handlers themselves stay where they are: what is worth
* asserting is that every route passes the same gates with the same
* parameters, and that is now a matter of reading five call sites rather than
* re-deriving a whole module.
*
* @module dsh-connect-qoder/routes
*/
/**
* Read a JSON request body, capped.
*
* The cap is enforced WHILE reading rather than after: a body larger than the
* limit is rejected and the request destroyed rather than drained, so an
* oversized upload cannot be accumulated in memory first. An empty body parses
* as `undefined` from `JSON.parse`'s standpoint, so callers that accept "no
* body" do so explicitly — the cap is enforced regardless.
*
* @param req - the Node request.
* @param maxBytes - the largest body accepted, in bytes.
* @returns the parsed value, or `undefined` for an empty body.
*/
async function readJsonBody$1(req, maxBytes = 65536) {
	const chunks = [];
	let size = 0;
	await new Promise((resolve, reject) => {
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > maxBytes) {
				reject(/* @__PURE__ */ new Error(`body exceeds ${maxBytes} bytes`));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", resolve);
		req.on("error", reject);
	});
	const text = Buffer.concat(chunks).toString("utf8");
	if (text.length === 0) return void 0;
	return JSON.parse(text);
}
/**
* Read a JSON body and answer a bad one properly, instead of throwing.
*
* `readJsonBody` rejects on malformed JSON and on an over-cap body. A route that
* awaits it bare lets that rejection escape the handler, and the web server's
* catch-all answers a **bodyless 400** — which the card can only render as
* "HTTP 400". That is undiagnosable from the browser: the same status would mean
* a malformed request, a request that was too large, or a bug in the route, and
* the user is told none of which.
*
* So the failure is turned into a response here: a 400 carrying `errorName` and
* the parse message, matching what the save route already does with its own
* failures (`lib/settings-save.js` reports `read-back-mismatch` the same way).
* The route then simply returns, and every caller gets the same shape.
*
* @param req - the Node request.
* @param res - the Node response, used to answer a failure.
* @param maxBytes - the largest body accepted, in bytes. Optional, and
* deliberately left `undefined` when the caller does not care: `readJsonBody`
* owns the 64 KiB cap, and a default here would quietly override it.
* @returns `{ ok: true, body }`, or `{ ok: false }` once a 400 has been sent.
*/
async function readJsonBodyOr400(req, res, maxBytes) {
	try {
		return {
			ok: true,
			body: await readJsonBody$1(req, maxBytes)
		};
	} catch (error) {
		sendJson(res, 400, {
			error: "invalid request body",
			errorName: thrownFlag(error, "name") ?? "Error",
			detail: describeThrown(error).slice(0, 200)
		}, { Allow: "POST" });
		return {
			ok: false,
			body: void 0
		};
	}
}
/**
* Whether a card request came from this machine, same-origin.
*
* The routes expose model metadata, not credentials, but they stay loopback-only
* anyway: they are an internal read path for a browser page this host itself
* served, and a missing Origin (a same-origin GET) is the normal case.
*
* WHAT WAS WRONG, AND WHY IT WAS NOT JUST COSMETIC
*
* The rule used to be "the Origin's host NAME is loopback" — the port was not
* compared at all, with a comment saying that was a deliberate trade. It was not
* a trade, it was a hole, and the three POST routes made it expensive:
*
*   /save           change which models appear in DSH's picker, and per-model
*                   image input
*   /checkin        claim the daily Credits — a real account mutation
*   /account/reload bring a region online and re-read the credential store
*
* Any HTTP server the user visits on their own machine could have its JavaScript
* call these. A page at `http://127.0.0.1:anything` posting to
* `http://127.0.0.1:19387/…` sends `Origin: http://127.0.0.1:anything`, which
* passed a name-only check. The browser would not stop it either: the response
* is not readable cross-origin, but the SIDE EFFECT has already happened.
*
* THE RULE NOW: same-origin, verified against the request's own `Host` header.
*
* `Host` is what the client actually dialled, so comparing Origin's authority to
* it needs no configured port and cannot drift when DSH picks a different one at
* runtime — which is why this is right where "hardcode the web port" would not
* be. The host must ALSO be loopback, because a same-origin check alone would
* trust a DSH served on a real interface, and this plugin's routes are an
* internal surface whether or not the front end is.
*
* @param req - the Node request.
* @returns true when the request may proceed.
*/
function loopbackRequest(req) {
	const origin = req.headers.origin;
	if (origin === void 0) return true;
	if (typeof origin !== "string") return false;
	let authority;
	try {
		authority = new URL(origin).host;
	} catch {
		return false;
	}
	if (!isLoopbackAuthority(authority)) return false;
	const host = req.headers.host;
	if (typeof host !== "string" || host.length === 0) return true;
	return authority.toLowerCase() === host.toLowerCase();
}
/**
* Whether an `host[:port]` authority names this machine.
*
* The port is irrelevant here and stripped: what is being asked is "is this
* address on this box", and the exact port is settled by the same-origin
* comparison in {@link loopbackRequest}. Exported so the loopback set is one
* list rather than a condition repeated in two places.
*/
function isLoopbackAuthority(authority) {
	const text = String(authority).toLowerCase();
	const withoutPort = text.startsWith("[") ? text.indexOf("]") === -1 ? text : text.slice(0, text.indexOf("]") + 1) : text.split(":")[0] ?? text;
	const bare = withoutPort.startsWith("[") && withoutPort.endsWith("]") ? withoutPort.slice(1, -1) : withoutPort;
	return bare === "127.0.0.1" || bare === "localhost" || bare === "::1" || bare.startsWith("127.");
}
/**
* Assert the request method is one of the allowed methods.
*
* Every card route starts with this check. Extracts the 405 response so each
* handler's first line is the check and the rest is the handler logic.
*
* Two details that were both wrong before, and both are what an HTTP client
* reads to decide what it is allowed to try next:
*
* - **A 405 must carry `Allow`** (RFC 9110 §15.5.6). Without it the response is
*   technically malformed, and a client has nothing to go on but a bare status.
* - **`HEAD` is answered by the `GET` path, not rejected.** HEAD is GET without
*   a body: the server computes the same headers and sends no payload. Treating
*   it as "not allowed" made a correct request to a read-only route fail, and it
*   was the only route family where a HEAD probe was plausible.
*
* @returns true if the method is allowed, false if the response was sent.
*/
function methodAllowed(req, res, ...methods) {
	if (req.method === "HEAD" && methods.includes("GET")) return true;
	if (methods.includes(req.method)) return true;
	const advertised = methods.includes("GET") ? [...methods, "HEAD"] : methods;
	sendJson(res, 405, {
		error: "method not allowed",
		allow: advertised
	}, { Allow: advertised.join(", ") });
	return false;
}
/**
* Assert the request came from this machine.
*
* Every card route calls this after the method check. Extracts the 403
* response so each handler's second line is the check and the rest is the
* handler logic.
*
* @returns true if the origin is trusted, false if the response was sent.
*/
function originAllowed(req, res) {
	if (loopbackRequest(req)) return true;
	sendJson(res, 403, { error: "origin-not-trusted" });
	return false;
}

//#endregion
//#region src/host/shim.ts
/**
* The loopback shim.
*
* `PiAiAdapter` drives providers through pi-ai's OpenAI-completions API, but
* Qoder needs COSY signing, a permuted body encoding, and its own SSE envelope.
* Rather than teach pi-ai those three things, this module runs a private HTTP
* server on `127.0.0.1` that *speaks* OpenAI and translates to Qoder on the way
* out — the same shape the Trae and WorkBuddy bundles use.
*
* The server is bound to an ephemeral loopback port and requires a per-process
* random bearer token, so nothing outside this process can use it as a proxy.
* The real Qoder token never reaches pi-ai: it stays on this side of the shim.
*
* @module dsh-connect-qoder/shim
*/
/** Reject anything that is not addressed to the loopback interface. */
function hostIsLoopback(host) {
	if (typeof host !== "string") return false;
	return isLoopbackAuthority(host);
}
/** Reject any request that claims a non-loopback origin. */
function originIsLoopback(origin) {
	if (origin === void 0) return true;
	if (typeof origin !== "string") return false;
	try {
		return isLoopbackAuthority(new URL(origin).hostname);
	} catch {
		return false;
	}
}
/**
* The `Retry-After` a retryable failure should advertise, or `undefined`.
*
* The gateway's queue hint (`error.retryAfterSeconds`, set by `QueueRejection`)
* is honoured as given, clamped to {@link RETRY_AFTER_MAX_SECONDS}. The host
* parses an HTTP `Retry-After` and waits it out, capped at 20 000 ms — so a
* hint larger than that would be believed-but-clamped anyway, and advertising
* the clamped number keeps both sides sleeping the same amount. A hint of zero
* or a non-numeric one answers `undefined`, because "retry immediately" is what
* the caller already does on any 503.
*/
const RETRY_AFTER_MAX_SECONDS = 20;
/**
* The effort the unselected "Default" pins a reasoning model to.
*
* Why pin a level at all: the gateway's own no-effort default is not
* thinking — for the Qwen 3.8 family, `enable_thinking: true` with NO
* `reasoning_effort` answers without reasoning. "Hand the default to the
* gateway" would therefore read as "thinking off", which is exactly what the
* unselected selection should NOT mean. The pin makes "Default" think for
* real, and the level is always one the model's catalog advertised, so it
* can never fail validation upstream.
*/
const DEFAULT_THINKING_EFFORT = "low";
/** The level order, cheapest first — the fallback walks it to find the
*  cheapest level a model actually offers. */
const THINKING_LEVEL_RANK = [
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max"
];
/**
* The effort an unselected "Default" pins to, per model.
*
* - a model offering `DEFAULT_THINKING_EFFORT` gets it;
* - a model that offers only costlier levels gets its cheapest offered
*   level rather than "no effort", because "no effort" is the gateway's
*   thinking-off state;
* - a model with NO advertised levels (the off-only shape) gets no pin —
*   it cannot be offered a wire value the catalog never advertised;
* - an always-thinking model gets no pin: it is only ever requested
*   positively, and the gateway already tunes its own default.
*
* The result is always either `undefined` or a level the model's own
* `effortLevels` list contains, so it can never trip the host's
* `UNSUPPORTED_REASONING_EFFORT` validation.
*/
function defaultEffortFor(catalogEntry, alwaysThinking) {
	if (alwaysThinking === true) return void 0;
	const supported = Array.isArray(catalogEntry?.effortLevels) ? catalogEntry.effortLevels : [];
	if (supported.length === 0) return void 0;
	if (supported.includes(DEFAULT_THINKING_EFFORT)) return DEFAULT_THINKING_EFFORT;
	return THINKING_LEVEL_RANK.find((level) => supported.includes(level)) ?? supported[0];
}
function retryAfterHeader(error) {
	const seconds = Number(error?.retryAfterSeconds);
	if (!Number.isFinite(seconds) || seconds <= 0) return void 0;
	return { "Retry-After": String(Math.min(Math.max(Math.ceil(seconds), 1), RETRY_AFTER_MAX_SECONDS)) };
}
/**
* Read a request body fully, refusing anything past the cap.
*
* The shim serves one in-process client, but an unbounded reader is still an
* OOM handle on the whole host: one run-away request (or a future, wider
* exposure) could accumulate gigabytes before `JSON.parse` ever sees the
* string. Chat bodies are small in practice, so the cap is generous, and a
* breach answers with a 413 instead of growing.
*/
const MAX_BODY_BYTES = 20971520;
function readBody(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let total = 0;
		let settled = false;
		req.on("data", (chunk) => {
			if (settled) return;
			total += chunk.length;
			if (total > MAX_BODY_BYTES) {
				settled = true;
				reject(Object.assign(/* @__PURE__ */ new Error("request body exceeds the 20 MiB limit"), { name: "BodyTooLargeError" }));
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => {
			if (settled) return;
			settled = true;
			resolve(Buffer.concat(chunks));
		});
		req.on("error", (error) => {
			if (settled) return;
			settled = true;
			reject(error);
		});
	});
}
/**
* Start the shim.
*
* @param options.resolveCredential - async `() => credential`, called per
*   request so a re-sign-in is picked up without a restart.
* @param options.resolveModels - `() => model[]`, the live catalog.
* @param options.resolveEnabledIds - `() => string[]`, the models the user has
*   enabled for this region. Read per request so a change in settings reaches
*   the picker on the next listing without restarting anything.
* @param options.invalidateCredential - optional `() => void`, called when the
*   upstream rejects a request with a sign-in failure; the next
*   `resolveCredential` re-reads the app's store so a fresh sign-in is
*   picked up without a DSH restart.
* @param options.logger - optional logger for upstream failures.
* @returns `{ ready, baseUrl, token, close }`.
*/
function createQoderShim(options) {
	const { resolveCredential, resolveModels, resolveUpstreamKey, resolveAlwaysThinking, resolveEnabledIds, invalidateCredential, region, logger, runChat = streamChat, requestCounter, tokenCounter } = options;
	const SHARED_SECRET = randomBytes(32).toString("base64url");
	/** Constant-time bearer check. */
	function bearerOk(req) {
		const header = req.headers.authorization;
		if (typeof header !== "string") return false;
		const match = /^Bearer\s+(.+)$/i.exec(header.trim());
		if (match === null) return false;
		const token = match[1];
		if (token === void 0) return false;
		const presented = Buffer.from(token);
		const expected = Buffer.from(SHARED_SECRET);
		if (presented.length !== expected.length) return false;
		return timingSafeEqual(presented, expected);
	}
	const server = createServer((req, res) => {
		handle(req, res).catch((error) => {
			if (!res.headersSent) writeError(res, 500, "internal", String(error));
			else res.end();
		});
	});
	const ready = new Promise((resolve, reject) => {
		server.once("listening", () => resolve());
		server.once("error", reject);
	});
	server.listen(0, "127.0.0.1");
	const baseUrl = () => {
		const address = server.address();
		if (address === null || typeof address === "string") throw new Error("qoder shim has no listening address");
		return `http://127.0.0.1:${address.port}`;
	};
	async function handle(req, res) {
		if (!hostIsLoopback(req.headers.host)) {
			writeError(res, 403, "host_not_allowed", "Host header must name the loopback interface");
			return;
		}
		if (!originIsLoopback(req.headers.origin)) {
			writeError(res, 403, "origin_not_allowed", "Origin must be a loopback origin");
			return;
		}
		if (!bearerOk(req)) {
			writeError(res, 401, "unauthorized", "missing or invalid Authorization bearer");
			return;
		}
		const url = req.url ?? "/";
		if (req.method === "GET" && (url === "/healthz" || url === "/healthz/")) {
			sendJson(res, 200, { ok: true });
			return;
		}
		if (req.method === "GET" && (url === "/v1/models" || url === "/v1/models/")) {
			const enabled = typeof resolveEnabledIds === "function" ? resolveEnabledIds() : void 0;
			const data = filterByEnabled(resolveModels(), enabled).map((model) => ({
				id: model.id,
				object: "model",
				created: 0,
				owned_by: region.id
			}));
			sendJson(res, 200, {
				object: "list",
				data
			});
			return;
		}
		if (req.method === "POST" && (url === "/v1/chat/completions" || url === "/v1/chat/completions/")) {
			await chatCompletions(req, res);
			return;
		}
		writeError(res, 404, "not_found", `no such route: ${req.method} ${url}`);
	}
	async function chatCompletions(req, res) {
		let credential;
		try {
			credential = await resolveCredential();
		} catch (error) {
			writeError(res, 401, "not_signed_in", String(error));
			return;
		}
		if (!credential) {
			writeError(res, 401, "not_signed_in", `${region.displayName} is not signed in on this machine`);
			return;
		}
		let body;
		try {
			body = JSON.parse((await readBody(req)).toString("utf8"));
		} catch (error) {
			if (thrownFlag(error, "name") === "BodyTooLargeError") {
				writeError(res, 413, "payload_too_large", "request body exceeds the 20 MiB limit");
				return;
			}
			writeError(res, 400, "invalid_request", `body is not JSON: ${String(error)}`);
			return;
		}
		const controller = new AbortController();
		req.on("close", () => controller.abort());
		const displayModel = typeof body.model === "string" ? body.model : "";
		const catalogEntry = resolveModels().find((model) => model.id === displayModel);
		const alwaysThinking = resolveAlwaysThinking?.(displayModel) ?? catalogEntry?.alwaysThinking === true;
		const enableThinking = resolveThinking(body, catalogEntry);
		const explicitEffort = typeof body.reasoning_effort === "string" && body.reasoning_effort.length > 0 ? body.reasoning_effort : void 0;
		const request = {
			model: resolveUpstreamKey?.(displayModel) ?? body.model,
			messages: toQoderMessages(body.messages ?? []),
			tools: toQoderTools(body.tools),
			maxTokens: typeof body.max_tokens === "number" ? body.max_tokens : void 0,
			enableThinking,
			alwaysThinking,
			reasoningEffort: enableThinking ? explicitEffort ?? defaultEffortFor(catalogEntry, alwaysThinking) : void 0,
			sessionId: typeof body.user === "string" ? body.user : void 0
		};
		const wantStream = body.stream !== false;
		let iterator;
		let first;
		try {
			requestCounter?.bump(region.id);
			iterator = runChat(region, credential, request, controller.signal);
			first = await iterator.next();
		} catch (error) {
			logger?.warn?.(`dsh-connect-qoder: ${region.displayName} upstream failed`, error);
			if (isStaleCredentialError(error)) invalidateCredential?.();
			if (thrownFlag(error, "retryable") === true) {
				writeError(res, 503, "rate_limit", describeThrown(error), retryAfterHeader(error));
				return;
			}
			if (thrownFlag(error, "dailyLimit") === true) {
				requestCounter?.markExhausted(region.id);
				writeError(res, 429, "daily_limit_exceeded", describeThrown(error));
				return;
			}
			writeError(res, 502, "upstream_error", describeThrown(error));
			return;
		}
		if (!wantStream) {
			const content = [];
			const toolCalls = /* @__PURE__ */ new Map();
			let finish = "stop";
			let usage;
			for (let step = first; !step.done; step = await iterator.next()) {
				if (step.value?.usage !== void 0 && step.value.usage !== null) {
					usage = step.value.usage;
					tokenCounter?.addUsage(region.id, step.value.usage);
				}
				absorb(step.value, content, toolCalls, (f) => {
					finish = f;
				});
			}
			const message = {
				role: "assistant",
				content: content.join("")
			};
			if (toolCalls.size > 0) message.tool_calls = [...toolCalls.values()];
			sendJson(res, 200, {
				id: `chatcmpl-${randomBytes(8).toString("hex")}`,
				object: "chat.completion",
				created: Math.floor(Date.now() / 1e3),
				model: displayModel,
				choices: [{
					index: 0,
					message,
					finish_reason: finish
				}],
				...usage !== void 0 ? { usage } : {}
			});
			return;
		}
		res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
			"X-Accel-Buffering": "no"
		});
		const id = `chatcmpl-${randomBytes(8).toString("hex")}`;
		const created = Math.floor(Date.now() / 1e3);
		let sentRole = false;
		try {
			for (let step = first; !step.done; step = await iterator.next()) {
				const chunk = step.value;
				if (chunk?.usage !== void 0 && chunk.usage !== null) {
					tokenCounter?.addUsage(region.id, chunk.usage);
					writeSse(res, {
						id,
						object: "chat.completion.chunk",
						created,
						model: displayModel,
						choices: [],
						usage: chunk.usage
					});
				}
				const choice = chunk?.choices?.[0];
				if (choice === void 0) continue;
				const delta = choice.delta ?? choice.message ?? {};
				const out = { role: "assistant" };
				if (typeof delta.content === "string" && delta.content.length > 0) out.content = delta.content;
				const reasoning = delta.reasoning_content ?? delta.reasoning;
				if (typeof reasoning === "string" && reasoning.length > 0) out.reasoning_content = reasoning;
				if (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) out.tool_calls = delta.tool_calls;
				const finish = choice.finish_reason;
				if (!sentRole) sentRole = true;
				else if (Object.keys(out).length === 1 && finish === void 0) continue;
				writeSse(res, {
					id,
					object: "chat.completion.chunk",
					created,
					model: displayModel,
					choices: [{
						index: 0,
						delta: out,
						finish_reason: finish ?? null
					}]
				});
			}
		} catch (error) {
			logger?.warn?.(`dsh-connect-qoder: ${region.displayName} stream broke`, error);
			const retryable = thrownFlag(error, "retryable") === true;
			const kind = retryable ? "rate_limit" : thrownFlag(error, "dailyLimit") === true ? "daily_limit_exceeded" : "upstream_error";
			const message = describeThrown(error);
			if (isStaleCredentialError(error)) invalidateCredential?.();
			if (retryable) logger?.warn?.(`dsh-connect-qoder: ${region.displayName} queued by Qoder; reporting 503 so DSH retries: ${message}`);
			res.write(`data: ${JSON.stringify({ error: {
				message,
				type: kind,
				code: kind
			} })}\n\n`);
			res.write("data: [DONE]\n\n");
			res.end();
			return;
		}
		res.write("data: [DONE]\n\n");
		res.end();
	}
	/**
	* Decide whether the caller asked for reasoning output.
	*
	* The fallback is model-aware on purpose: when nothing explicit reaches the
	* shim (no `reasoning_effort`, no `thinking` field — which is exactly what
	* DSH's "Default" selection is, now that the thinking map stops spelling
	* `off` out), a reasoning model is treated as THINKING, instead of being
	* silently switched off. A concrete level for that default is not decided
	* here — it is `defaultEffortFor`, which pins the per-model value. A
	* non-reasoning model still sends `enable_thinking: false`, because it
	* cannot think at all and the flag must not be invented for it.
	*
	* @param body - the decoded request body.
	* @param catalogEntry - the model's catalog entry, when the catalog knows it.
	*/
	function resolveThinking(body, catalogEntry) {
		if (typeof body.reasoning_effort === "string" && body.reasoning_effort.length > 0) return body.reasoning_effort !== "off" && body.reasoning_effort !== "none";
		if (body.thinking !== void 0) return body.thinking !== false && body.thinking !== "off";
		return catalogEntry?.isReasoning === true;
	}
	let closed = false;
	let closedPromise;
	return {
		ready,
		baseUrl,
		token: () => SHARED_SECRET,
		close: () => {
			if (closed) return closedPromise ?? Promise.resolve();
			closed = true;
			closedPromise = new Promise((resolve, reject) => {
				server.closeAllConnections();
				server.close((err) => {
					if (err && err.code !== "ERR_SERVER_NOT_RUNNING") reject(err);
					else resolve();
				});
			});
			return closedPromise;
		}
	};
}
/** Accumulate one non-streaming chunk into the final message. */
function absorb(chunk, content, toolCalls, setFinish) {
	const choice = chunk?.choices?.[0];
	if (choice === void 0) return;
	const delta = choice.delta ?? choice.message ?? {};
	if (typeof delta.content === "string") content.push(delta.content);
	if (Array.isArray(delta.tool_calls)) for (const call of delta.tool_calls) {
		if (call === null || typeof call !== "object") continue;
		const index = call.index ?? 0;
		const current = toolCalls.get(index) ?? {
			id: "",
			type: "function",
			function: {
				name: "",
				arguments: ""
			}
		};
		if (call.id) current.id = call.id;
		if (call.function?.name) current.function.name = call.function.name;
		if (call.function?.arguments) current.function.arguments += call.function.arguments;
		toolCalls.set(index, current);
	}
	if (typeof choice.finish_reason === "string") setFinish(choice.finish_reason);
}
/** Write one SSE frame. */
function writeSse(res, value) {
	res.write(`data: ${JSON.stringify(value)}\n\n`);
}

//#endregion
//#region src/host/oscrypt-unwrap.ts
/**
* The OSCrypt key chain: unwrap the desktop app's master key, decrypt its
* secret rows with it, and reclaim what a crash left in the temp dir.
*
* On Windows the wrapper is DPAPI scoped to the current user. Node has no
* DPAPI binding, so the unwrap runs through PowerShell and hands the key over
* in a temp file (a sandbox may forbid piped stdio). That file is the weakest
* link: exclusive handle, user ACL, absolute interpreter path, whitelisted
* child env (a `QODER_PAT` never reaches the child), zero before unlink, sweep.
*
* @module dsh-connect-qoder/oscrypt-unwrap
*/
/** Chunk size for zeroing a file: large enough to be quick, small enough to be cheap to allocate. */
const ZERO_BLOCK_BYTES = 65536;
/** Base delay between zeroing retries; attempt N waits N × this. */
const ZERO_RETRY_BACKOFF_MS = 50;
/** Name of the identity marker file written into every unwrap temp dir. */
const OSCRYPT_MARKER = ".dsh-oscrypt";
/** PowerShell that unwraps the OSCrypt key and writes it to `$env:QODER_KEY_OUT`. */
const DPAPI_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class QoderDpapi {
  [StructLayout(LayoutKind.Sequential)] public struct B { public int cbData; public IntPtr pbData; }
  [DllImport("Crypt32.dll", SetLastError=true)]
  static extern bool CryptUnprotectData(ref B i, IntPtr d, IntPtr e, IntPtr r, IntPtr p, int f, ref B o);
  [DllImport("Kernel32.dll")] static extern IntPtr LocalFree(IntPtr h);
  public static byte[] U(byte[] data) {
    B i = new B(); i.cbData = data.Length; i.pbData = Marshal.AllocHGlobal(data.Length);
    Marshal.Copy(data, 0, i.pbData, data.Length);
    B o = new B();
    try {
      if (!CryptUnprotectData(ref i, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 0, ref o))
        throw new Exception("DPAPI error " + Marshal.GetLastWin32Error());
      byte[] r = new byte[o.cbData]; Marshal.Copy(o.pbData, r, 0, o.cbData); return r;
    } finally { Marshal.FreeHGlobal(i.pbData); if (o.pbData != IntPtr.Zero) LocalFree(o.pbData); }
  }
}
'@
$statePath = Join-Path $env:QODER_APP_DIR 'Local State'
$json = Get-Content $statePath -Raw | ConvertFrom-Json
$raw = [Convert]::FromBase64String($json.os_crypt.encrypted_key)
if ($raw.Length -le 5) { throw 'encrypted_key too short' }
$key = [QoderDpapi]::U($raw[5..($raw.Length - 1)])
# Hand the key off through an exclusive handle (no other process on the box
# can read it while it is on disk) and, before any secret byte touches the
# file, restrict its ACL to the current user: the default inherited ACL of
# the temp directory follows the machine's policy, shared-drive TEMP included.
#
# The ACL is applied with the static File.SetAccessControl after the handle
# that created the file is closed. Applying it THROUGH the open handle (the
# previous shape) always fails: that handle was opened ReadWrite, which does
# not carry WRITE_DAC, so the driver answers ACCESS_DENIED — and widening the
# handle's access would let another process open the file in the gap anyway.
# The file is still EMPTY when the ACL lands, so no key byte exists before
# the restriction is in force; the handle is then reopened exclusive for the
# write. The type is FileSystemAccessRule — there is no "FileAccessRule" in
# .NET, and resolving a non-existent type aborts the script before the unwrap.
$fs = New-Object System.IO.FileStream($env:QODER_KEY_OUT, [System.IO.FileMode]::Create, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
$fs.Dispose()
$acl = New-Object System.Security.AccessControl.FileSecurity
$acl.SetAccessRuleProtection($true, $false)
$acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
  [System.Security.Principal.WindowsIdentity]::GetCurrent().User,
  [System.Security.AccessControl.FileSystemRights]::FullControl,
  [System.Security.AccessControl.InheritanceFlags]::None,
  [System.Security.AccessControl.PropagationFlags]::None,
  [System.Security.AccessControl.AccessControlType]::Allow)))
[System.IO.File]::SetAccessControl($env:QODER_KEY_OUT, $acl)
$fs = New-Object System.IO.FileStream($env:QODER_KEY_OUT, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
try {
  $payload = [System.Text.Encoding]::ASCII.GetBytes([Convert]::ToBase64String($key))
  $fs.Write($payload, 0, $payload.Length)
  $fs.Flush()
} finally {
  $fs.Dispose()
}
`;
/**
* Per-app OSCrypt key cache; the unwrap is not free, so do it once. Only a
* successful unwrap is remembered — a failure is usually transient, and caching
* it would pin "not signed in" for the life of the process. An entry is bound to
* the `Local State` identity, so a rewrite invalidates it (docs/issues/08-keycache-staleness.md).
*/
const keyCache = /* @__PURE__ */ new Map();
/**
* The reason the most recent unwrap of one app directory failed, and when: the
* card's account route reads the cause back, so a stuck region can say why. It
* is cleared on the next successful unwrap, and blocks retries only for
* {@link UNWRAP_FAILURE_TTL_MS} — a transient fault is retried, not remembered.
*/
const lastUnwrapFailure = /* @__PURE__ */ new Map();
/**
* How long a failed unwrap is remembered before another is attempted.
*
* 60 s: long enough that opening, switching and re-opening the card panel costs
* one subprocess rather than one per render, short enough that a user who
* re-signed-in-and-retried is not told "unreadable" for a minute.
*/
const UNWRAP_FAILURE_TTL_MS = 6e4;
/**
* The last unwrap failure recorded for one app directory, or `undefined`.
*
* `undefined` covers two cases and they are not distinguished: the directory
* never attempted an unwrap, and it last succeeded. Both mean "no reason to
* show" from the card's side.
*
* A failure is still returned while it is fresh, so the card keeps saying *why*
* between retries; only the *attempt* is suppressed.
*
* @param appDir - the app's user-data directory.
* @param now - the current instant, injectable for tests.
* @returns the recorded reason, or `undefined`.
*/
function describeUnwrapFailure(appDir, now = Date.now()) {
	const entry = lastUnwrapFailure.get(appDir);
	if (entry === void 0) return void 0;
	if (now - entry.at >= 6e4) return void 0;
	return entry.reason;
}
/**
* Where an unwrap failure is reported, set by the plugin entry at activation.
*
* This module has no Cordis context of its own, so it cannot reach a logger
* directly. Without somewhere to send it, a failed unwrap is the silent failure
* the plugin used to have; the entry installs the host logger here so the cause
* lands in the same stream as every other plugin message.
*/
let diagnosticSink;
function setCredentialDiagnosticSink(sink) {
	diagnosticSink = typeof sink === "function" ? sink : void 0;
}
/**
* Block for a few milliseconds without spinning.
*
* `oscryptKeyFor` is synchronous (it wraps `execFileSync`), so it cannot await a
* backoff. `Atomics.wait` on a shared int is the one way to sleep on the main
* thread without a busy loop; the wait is in microseconds and the timeout is in
* milliseconds, so the value itself is irrelevant.
*/
function sleepSync(ms) {
	try {
		Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
	} catch {}
}
/**
* Report a cleanup that could not be completed.
*
* A temp file left holding the unwrapped key is the one failure in this module
* that outlives the process, so it must not be silent even though cleanup is
* best-effort by design. The diagnostic sink is the same channel used for
* unwrap failures, which the plugin entry installs at activation; before that,
* and when nobody is listening, it falls back to a process warning so the
* condition is still observable.
*/
function reportCleanupFailure(message) {
	(diagnosticSink ?? ((text) => process.emitWarning(text)))(`dsh-connect-qoder: ${message}`);
}
process.on("exit", () => {
	for (const cached of keyCache.values()) cached?.key?.fill(0);
});
/**
* Identify the `Local State` file a cached key was unwrapped from.
*
* Returns `undefined` when the file is absent, and that `undefined` is itself a
* valid identity: "there is no file" is also how the cache must read when the
* file is deleted, so a cached key is correctly retired in that case too (an app
* being uninstalled under a running host is rare, but the old key would then
* outlive the store it decrypts).
*
* @param statePath - absolute path to the app's `Local State`.
* @returns `"<mtimeMs>:<size>"`, or `undefined` when the file cannot be stat'd.
*/
function localStateIdentity(statePath) {
	try {
		const stats = statSync(statePath);
		return `${stats.mtimeMs}:${stats.size}`;
	} catch {
		return;
	}
}
/**
* Whether a cached key may be reused; both sides must be present and equal.
* @param cached - the cache entry `{ key, identity }`, or `undefined`.
* @param identity - the current file identity, or `undefined` when absent.
* @returns the reusable key, or `undefined` when a fresh unwrap is required.
*/
function cachedKeyFor(cached, identity) {
	if (cached === void 0 || cached === null) return void 0;
	const entry = cached;
	if (entry.key === void 0 || entry.key === null) return void 0;
	if (entry.identity === void 0 || identity === void 0) return void 0;
	if (entry.identity !== identity) return void 0;
	return entry.key;
}
/**
* Whether a recorded failure still suppresses an attempt: age AND identity.
* @param entry - the recorded `{ reason, at, identity }`, or `undefined`.
* @param identity - the current `Local State` identity.
* @returns true when the attempt should be skipped.
*/
function failureStillBlocks(entry, identity, now = Date.now()) {
	if (entry === void 0 || entry === null) return false;
	if (now - entry.at >= 6e4) return false;
	if (entry.identity !== void 0 && entry.identity !== identity) return false;
	return true;
}
/**
* Unwrap one app's OSCrypt key.
*
* The cache hit is conditional on `Local State` being byte-for-byte the same
* file the cached key came from (see `keyCache`); anything else is a miss and
* re-unwraps.
*
* SYNCHRONOUS, and that is a documented cost rather than an oversight: the
* PowerShell child blocks the host's event loop for as long as it runs
* (measured: ~0.5 s per region on the success path, and up to the 30 s timeout
* when it cannot succeed). `oscryptKeyForAsync` is the version every request
* path should use; this one is kept for the callers that genuinely cannot await
* — the process-startup sweep and the `probe/` scripts — and for the rare
* `cachedOnly` read, which by construction answers from the cache and never
* spawns the child at all.
*
* @param appDir - absolute Electron user-data directory for the app.
* @param options.force - ignore the failure window and unwrap again. Reserved
*   for the explicit user action ("重读登录"), where suppressing the attempt
*   would make the button a no-op; every automatic caller leaves it unset.
* @param spawn - the child-process runner. Injectable so the whole unwrap can
*   be exercised without a PowerShell child: the seam exists because the code
*   between "temp dir created" and "key read back" is where a plaintext key
*   escapes the process, and it used to be reachable only on a Windows machine
*   with a signed-in Qoder.
* @returns the 32-byte AES key, or `undefined` when it cannot be obtained.
*/
function oscryptKeyFor(appDir, options = {}, spawn = spawnUnwrapSync) {
	return runUnwrap(appDir, options, spawn);
}
/**
* Unwrap one app's OSCrypt key without blocking the event loop.
*
* Same rules, same caches, same failure classification as
* {@link oscryptKeyFor} — the two share `runUnwrap` and differ ONLY in how the
* child process is spawned, which is what makes that claim checkable rather
* than a promise: there is one implementation of the temp-dir handling, the
* zeroing, the identity binding and the failure recording, so an async version
* that diverged would have to diverge by re-implementing one of them.
*
* @param appDir - absolute Electron user-data directory for the app.
* @param options.force - see {@link oscryptKeyFor}.
* @param spawn - the child-process runner; see {@link oscryptKeyFor}.
* @returns a promise of the 32-byte AES key, or `undefined` when it cannot be
*   obtained.
*/
async function oscryptKeyForAsync(appDir, options = {}, spawn = spawnUnwrapAsync) {
	return runUnwrap(appDir, options, spawn);
}
/**
* The shared body of both unwrap paths.
*
* `spawn` receives `(powershell, args, options)` and either returns (sync) or
* returns a promise of it (async); everything around it — the cache lookup, the
* failure window, the temp directory, the marker, the zeroing, the reporting —
* is identical by construction.
*
* @param appDir - the app's user-data directory.
* @param options - `{ force, platform }`.
* @param spawn - the child-process runner.
* @returns the key, or a promise of it, depending on `spawn`.
*/
function runUnwrap(appDir, options, spawn) {
	const platform = options.platform ?? process.platform;
	const identity = localStateIdentity(join(appDir, "Local State"));
	const cached = cachedKeyFor(keyCache.get(appDir), identity);
	if (cached !== void 0) return cached;
	if (options.force !== true && failureStillBlocks(lastUnwrapFailure.get(appDir), identity)) return;
	if (identity === void 0) return recordUnwrapFailure(appDir, "no Local State file", identity);
	if (platform !== "win32") return recordUnwrapFailure(appDir, `this plugin can only read the Qoder sign-in on Windows; ${platform} has no supported keychain path yet`, identity);
	let dir;
	let key;
	let lastFailure;
	/**
	* Zero the hand-off file and remove the directory, then hand back the key.
	*
	* Takes the key as an argument rather than closing over it, because the
	* async path discovers the key AFTER the child exits: a closure would capture
	* `undefined` and the cleanup would return the wrong answer.
	*/
	const settle = (found) => {
		key = found;
		if (dir !== void 0) {
			zeroOutFile(join(dir, "key.b64"));
			try {
				rmSync(dir, {
					recursive: true,
					force: true
				});
			} catch (error) {
				reportCleanupFailure(`could not remove the credential temp dir ${dir}: ${describeThrown(error)}`);
			}
		}
		return key;
	};
	try {
		dir = mkdtempSync(join(tmpdir(), "qoder-oscrypt-"));
		writeFileSync(join(dir, OSCRYPT_MARKER), "");
		const outFile = join(dir, "key.b64");
		const spawned = spawn(systemPowershell(), [
			"-NoProfile",
			"-NonInteractive",
			"-Command",
			DPAPI_SCRIPT
		], {
			stdio: "ignore",
			windowsHide: true,
			timeout: 3e4,
			env: unwrapEnv(appDir, outFile)
		});
		if (spawned !== void 0 && typeof spawned.then === "function") return spawned.then(() => {
			let read;
			try {
				read = readUnwrappedKey(outFile);
			} catch (error) {
				return finishUnwrap(appDir, settle(void 0), describeUnwrapError(error), identity);
			}
			if (read.failure !== void 0) lastFailure = read.failure;
			return finishUnwrap(appDir, settle(read.key), lastFailure, identity);
		}, (error) => {
			return finishUnwrap(appDir, settle(void 0), describeUnwrapError(error), identity);
		});
		const read = readUnwrappedKey(outFile);
		if (read.failure !== void 0) lastFailure = read.failure;
		return finishUnwrap(appDir, settle(read.key), lastFailure, identity);
	} catch (error) {
		lastFailure = describeUnwrapError(error);
	}
	return finishUnwrap(appDir, settle(key), lastFailure, identity);
}
/**
* Read the hand-off file the child wrote.
*
* @param outFile - where the child wrote the base64 key.
* @returns `{ key }` when it decoded to a real 32-byte master key, or
*   `{ failure }` naming why it did not. The two are separate fields rather
*   than one value because a wrong-size key is a DIFFERENT failure from an
*   empty file, and both are reported.
*/
function readUnwrappedKey(outFile) {
	const text = readFileSync(outFile, "utf8").trim();
	if (text.length === 0) return { failure: "the unwrap produced an empty key file" };
	const candidate = Buffer.from(text, "base64");
	if (candidate.length !== 32) return { failure: `Local State unwrapped to ${candidate.length} bytes, expected 32` };
	return { key: candidate };
}
/**
* Record a failure, emit the diagnostic, and answer `undefined`.
*
* Split out so the "no `Local State`" early return and the post-spawn failure
* path cannot drift on when they report: the first is the normal outcome of
* probing several app names and stays out of the log, everything else is a real
* problem the user has to see.
*/
function recordUnwrapFailure(appDir, reason, identity) {
	lastUnwrapFailure.set(appDir, {
		reason: String(reason),
		at: Date.now(),
		identity
	});
	if (reason !== "no Local State file") reportCleanupFailure(`could not unwrap the OSCrypt key for ${appDir}: ${reason}`);
}
/** The one place a fresh key replaces a remembered failure, and vice versa. */
function finishUnwrap(appDir, key, lastFailure, identity) {
	if (key === void 0) return recordUnwrapFailure(appDir, lastFailure, identity);
	lastUnwrapFailure.delete(appDir);
	keyCache.set(appDir, {
		key,
		identity
	});
	return key;
}
/** Name the cause of a failed child, keeping enough to diagnose it. */
function describeUnwrapError(error) {
	const failure = error;
	return failure?.status !== void 0 ? `PowerShell exited ${String(failure.status)}${failure.signal ? ` (${String(failure.signal)})` : ""}` : String(failure?.message ?? error);
}
/** Run the DPAPI child, blocking. */
function spawnUnwrapSync(powershell, args, options) {
	execFileSync(powershell, args, options);
}
/** Run the DPAPI child without blocking the event loop. */
function spawnUnwrapAsync(powershell, args, options) {
	return new Promise((resolve, reject) => {
		execFile(powershell, args, options, (error) => {
			if (error) reject(error);
			else resolve(void 0);
		});
	});
}
/**
* The system Windows PowerShell, by absolute path.
*
* A bare `powershell.exe` resolves through CWD/PATH, so a same-user program
* could plant a fake interpreter in the working directory or ahead on PATH
* and hijack the entire unwrap — running with the hand-off environment in
* hand. Pinning the system binary closes that; on a machine without it the
* call fails and the unwrap degrades to "key unavailable" like any other.
*/
function systemPowershell() {
	return join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}
/**
* The environment of the unwrap child process: a minimal whitelist plus the
* two hand-off variables.
*
* Expanding the whole `process.env` (the old behaviour) carried every
* user-supplied secret — a `QODER_PAT` fallback token among them — into the
* child's environment block, readable by every same-user process; next to the
* fake-`powershell.exe` vector that was a free credential hand-off. The
* DPAPI script itself consults only `QODER_APP_DIR`, `QODER_KEY_OUT` and the
* system variables PowerShell and its C# compiler need.
*/
const PS_ENV_ALLOWLIST = [
	"SYSTEMDRIVE",
	"SystemRoot",
	"WINDIR",
	"TEMP",
	"TMP",
	"COMSPEC",
	"PATHEXT",
	"PATH",
	"OS",
	"PROCESSOR_ARCHITECTURE",
	"PROCESSOR_IDENTIFIER",
	"NUMBER_OF_PROCESSORS",
	"USERNAME",
	"USERPROFILE",
	"LOGONSERVER"
];
function unwrapEnv(appDir, outFile) {
	const allowed = new Set(PS_ENV_ALLOWLIST.map((name) => name.toLowerCase()));
	const env = {};
	for (const [name, value] of Object.entries(process.env)) if (allowed.has(name.toLowerCase())) env[name] = value;
	env.QODER_APP_DIR = appDir;
	env.QODER_KEY_OUT = outFile;
	return env;
}
/**
* Overwrite a file's bytes with zeros, best-effort, with a short retry.
*
* A failed overwrite used to be swallowed outright, which turned a real hazard
* into a silent one. The caller that can hit a lock is {@link oscryptKeyFor}
* running right after a timeout killed the PowerShell child. A killed process
* never runs its `finally` — its handles are closed by the kernel tearing the
* process object down, and that teardown is asynchronous. So the `finally` can
* arrive while the child's exclusive (`FileShare.None`) handle on `key.b64` is
* still open: on Windows the open then fails with EBUSY, and so does the
* unlink that follows. Zeroing used to drop that error, the `rmSync` used to
* throw into a bare catch, and the app's 32-byte master key sat in `%TEMP%` as
* plain base64 — readable by any same-user process — with no report, until the
* next plugin start, because `sweepStaleOscryptDirs` runs once at startup, not
* on a timer.
*
* The retry waits out the kernel teardown, which normally finishes within a
* few hundred milliseconds; what remains is reported rather than dropped, so a
* surviving key file is a logged hazard, never an inferred one.
*
* @param file - the path to overwrite.
* @param attempts - how many times to try; each retry waits a little longer,
*   since the usual cause is a killed child whose teardown has not finished.
* @returns `true` when the file is gone or was fully zeroed, `false` when it
*   still exists with its bytes intact, or is not a plain file to begin with.
*/
function zeroOutFile(file, attempts = 4) {
	let stat;
	try {
		stat = lstatSync(file);
	} catch {
		return true;
	}
	if (!stat.isFile()) {
		reportCleanupFailure(`refused to zero ${file}: not a plain file (mode ${(stat.mode & 4095).toString(8)})`);
		return false;
	}
	if (stat.size <= 0) return true;
	const size = stat.size;
	let lastError;
	for (let attempt = 0; attempt < attempts; attempt++) {
		if (attempt > 0) sleepSync(ZERO_RETRY_BACKOFF_MS * attempt);
		let fd;
		try {
			fd = openSync(file, "r+");
		} catch (error) {
			if (!existsSync(file)) return true;
			lastError = error;
			continue;
		}
		try {
			const block = Buffer.alloc(Math.min(ZERO_BLOCK_BYTES, size));
			let offset = 0;
			while (offset < size) {
				const length = Math.min(block.length, size - offset);
				writeSync(fd, block, 0, length, offset);
				offset += length;
			}
			return true;
		} catch (error) {
			lastError = error;
		} finally {
			try {
				closeSync(fd);
			} catch {}
		}
	}
	try {
		truncateSync(file, 0);
	} catch {}
	if (existsSync(file) && currentSize(file) > 0) {
		reportCleanupFailure(`could not zero ${file} after ${attempts} attempts (${lastError?.message ?? "unknown"})`);
		return false;
	}
	return true;
}
/** The current byte length of a file, or 0 when it cannot be stat'd (gone). */
function currentSize(file) {
	try {
		return lstatSync(file).size;
	} catch {
		return 0;
	}
}
/**
* Decrypt one Chromium OSCrypt blob.
*
* @param blob - the raw stored bytes, including the `v10` prefix.
* @param key - the 32-byte AES key from {@link oscryptKeyFor}.
* @returns the plaintext, or `undefined` when authentication fails.
*/
function decryptOscrypt(blob, key) {
	if (blob.length < 31) return void 0;
	if (blob.subarray(0, 3).toString("latin1") !== "v10") return void 0;
	const body = blob.subarray(3);
	const nonce = body.subarray(0, 12);
	const tag = body.subarray(body.length - 16);
	const ciphertext = body.subarray(12, body.length - 16);
	try {
		const decipher = createDecipheriv("aes-256-gcm", key, nonce);
		decipher.setAuthTag(tag);
		return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
	} catch {
		return;
	}
}
/**
* The 32-byte AES key of one app, if one is already cached and current.
*
* This variant is honest about what it knows: it answers from the cache or not
* at all. The caller then reports `needs-app` with whatever reason the unwrap
* layer already recorded, which is the same thing the user needs to see, and
* the next scheduled refresh retries the unwrap on its own schedule rather
* than on a card render.
*
* @param appDir - absolute Electron user-data directory for the app.
* @returns the 32-byte AES key if one is already cached and current, else
*   `undefined`.
*/
function cachedOscryptKeyFor(appDir) {
	return cachedKeyFor(keyCache.get(appDir), localStateIdentity(join(appDir, "Local State")));
}
/**
* Reclaim the `qoder-oscrypt-*` dirs a crash left in the temp dir; the name is only a
* candidate — a dir is touched only when it is a real directory (never a junction or
* symlink) with our marker and a 32-byte `key.b64`, and is older than `maxAgeMs`.
* @returns the number of directories reclaimed.
*/
function sweepStaleOscryptDirs(maxAgeMs = 3e5) {
	let names;
	try {
		names = readdirSync(tmpdir());
	} catch {
		return 0;
	}
	const cutoff = Date.now() - maxAgeMs;
	let reclaimed = 0;
	for (const name of names) {
		if (!name.startsWith("qoder-oscrypt-")) continue;
		const dir = join(tmpdir(), name);
		let link;
		try {
			link = lstatSync(dir);
		} catch {
			continue;
		}
		if (link.isSymbolicLink()) {
			reportCleanupFailure(`refused to sweep ${dir}: it is a symbolic link, not a credential temp dir`);
			continue;
		}
		if (!link.isDirectory() || link.mtimeMs > cutoff) continue;
		let entries;
		try {
			entries = readdirSync(dir);
		} catch {
			continue;
		}
		if (!entries.includes(".dsh-oscrypt")) continue;
		if (entries.length !== 2 || !entries.includes("key.b64")) {
			reportCleanupFailure(`left ${dir} alone: it carries our marker but its contents are ${JSON.stringify(entries)}`);
			continue;
		}
		const keyFile = join(dir, "key.b64");
		let unlockedBytes;
		try {
			unlockedBytes = Buffer.from(readFileSync(keyFile, "utf8").trim(), "base64").length;
		} catch {
			unlockedBytes = 32;
		}
		if (unlockedBytes !== 32) {
			reportCleanupFailure(`left ${keyFile} alone: it decodes to ${unlockedBytes} bytes, not a 32-byte master key`);
			continue;
		}
		try {
			zeroOutFile(keyFile);
			zeroOutFile(join(dir, OSCRYPT_MARKER));
			rmSync(dir, {
				recursive: true,
				force: true
			});
			reclaimed += 1;
		} catch (error) {
			reportCleanupFailure(`could not reclaim the stale credential temp dir ${dir}: ${describeThrown(error)}`);
		}
	}
	return reclaimed;
}

//#endregion
//#region src/host/credentials.ts
/**
* Qoder credential acquisition — the store half: probe the candidate app
* directories, open the VS Code style SQLite sign-in store (`state.vscdb`)
* read-only, decode the secret rows.
*
* The OSCrypt unwrap, key cache, zeroing and startup sweep live in
* `oscrypt-unwrap.ts`: that half is the only part of credential acquisition
* that writes a secret outside the process, spawns a child and deletes things.
* Nothing here writes to the Qoder apps' files — the store is opened read-only.
*
* @module dsh-connect-qoder/credentials
*/
/** SQLite key holding the sign-in identity, including its access token. */
const USER_INFO_KEY = "secret://aicoding.auth.userInfo";
/** SQLite key holding the plan summary (tier, validity window). */
const USER_PLAN_KEY = "secret://aicoding.auth.userPlan";
/** SQLite key holding the credit/quota snapshot. */
const CREDIT_USAGE_KEY = "secret://aicoding.auth.creditUsage";
/**
* One Qoder region.
*
* `providerId` is the DSH provider route this region registers. The CN and
* global regions are separate providers so both can be online at once, exactly
* as the Trae bundle does for its two editions.
*
* `appDirs` is the ordered list of Electron user-data directory names that may
* hold this region's sign-in; the first one that yields a readable credential
* wins. `appNames` is the matching list of `%APPDATA%` roots.
*
* Typed as `Region[]` (from `domain.ts`) rather than left to infer: these two
* entries ARE the only instances of that interface in the whole plugin, so
* naming the type here is what makes a missing or misspelled URL family a
* compile error at the definition instead of `undefined` at the request.
*/
const REGIONS = [{
	id: "qoder-cn",
	mode: "cn",
	displayName: "Qoder CN",
	appNames: [
		"QoderCN",
		"Qoder CN",
		"QoderWork CN"
	],
	newAppNames: ["com.qodercn.app.stable"],
	baseUrl: "https://gateway.qoder.com.cn/",
	openApiUrl: "https://openapi.qoder.com.cn",
	centerUrl: "https://gateway.qoder.com.cn",
	manageUrl: "https://qoder.com.cn",
	downloadUrl: "https://qoder.com.cn/download",
	patEnvNames: [
		"QODERCN_API_KEY",
		"QODERCN_PERSONAL_ACCESS_TOKEN",
		"QODERCN_PAT"
	]
}, {
	id: "qoder",
	mode: "global",
	displayName: "Qoder",
	appNames: ["Qoder", "QoderWork"],
	newAppNames: ["com.qoder.app.stable"],
	baseUrl: "https://api3.qoder.sh/",
	openApiUrl: "https://openapi.qoder.sh",
	centerUrl: "https://center.qoder.sh",
	manageUrl: "https://qoder.com",
	downloadUrl: "https://qoder.com/download",
	patEnvNames: [
		"QODER_API_KEY",
		"QODER_PERSONAL_ACCESS_TOKEN",
		"QODER_PAT"
	]
}];
/**
* The per-user application-data root that Qoder's Electron apps live under.
*
* Every platform names it differently, and reading `process.env.APPDATA`
* directly is why this plugin has never worked off Windows: on macOS that
* variable does not exist, so the code probed `''`, found no app directory, and
* reported "not signed in" for a user who plainly was. The path itself was never
* the hard part — the fallback to the documented per-platform location is.
*
* The UNWRAP is still Windows-only (see `oscryptKeyFor`), so resolving the
* directory on macOS or Linux does not make a sign-in readable yet. It is fixed
* first because it is the half that is unambiguously correct, it is what lets
* the account panel say "the app is installed here, but this build cannot read
* its key" instead of "you are not signed in", and it removes the first thing
* that has to be right when the keystore side lands.
*
* The order is the documented one per platform:
* - Windows: `%APPDATA%` (roaming — Electron's `userData` default).
* - macOS: `~/Library/Application Support`.
* - Linux/other: `$XDG_CONFIG_HOME`, else `~/.config` (Electron's default there).
*
* @param platform - the Node platform string, injectable for tests.
* @param env - the environment, injectable for tests.
* @param home - the home directory, injectable for tests.
* @returns an absolute path, or `''` when it cannot be determined — which every
*   reader already treats as "no app here".
*/
function appDataRootFor(platform = process.platform, env = process.env, home = homedir()) {
	if (platform === "win32") return env.APPDATA ?? "";
	if (platform === "darwin") return join(home, "Library", "Application Support");
	const xdg = env.XDG_CONFIG_HOME;
	if (typeof xdg === "string" && xdg.length > 0) return xdg;
	return join(home, ".config");
}
/**
* Read one secret row from a VS Code style `state.vscdb`.
*
* The value column is a JSON envelope (`{"type":"Buffer","data":[...]}`) for
* secret rows; anything else is returned as-is.
*
* @returns the raw bytes for a Buffer row, a string for a plain row, or
*   `undefined` when the key is absent.
*/
function readItem(dbPath, key) {
	const db = new DatabaseSync(dbPath, { readOnly: true });
	try {
		const row = db.prepare("SELECT value FROM ItemTable WHERE key = ?").get(key);
		if (row === void 0 || row.value === null || row.value === void 0) return void 0;
		const value = row.value;
		const text = value instanceof Uint8Array ? Buffer.from(value).toString("utf8") : String(value);
		if (text.startsWith("{") && text.includes("\"type\":\"Buffer\"")) try {
			return Buffer.from(JSON.parse(text).data);
		} catch {
			return text;
		}
		return text;
	} finally {
		db.close();
	}
}
/** Decode one JSON secret row, or `undefined` when absent/undecryptable. */
function readJsonSecret(dbPath, key, oscryptKey) {
	const raw = readItem(dbPath, key);
	if (raw === void 0 || typeof raw === "string") return void 0;
	const plain = decryptOscrypt(raw, oscryptKey);
	if (plain === void 0) return void 0;
	try {
		return JSON.parse(plain);
	} catch {
		return;
	}
}
/** Candidate `state.vscdb` paths for one app's Electron user-data directory. */
function stateDbCandidates(appDir) {
	return [join(appDir, "User", "globalStorage", "state.vscdb"), join(appDir, "User", "globalStorage", "state.vscdb.backup")];
}
/**
* The machine id Qoder binds its session to.
*
* The legacy layout keeps it in `machineid`; 0.3.x renamed the file to
* `auth.machine-id`. Both are checked because the id is sent to the gateway
* alongside the token, and a wrong one is indistinguishable from a hijacked
* session. When neither exists a stable value is derived from the app directory
* so repeated runs still agree with each other.
*/
function machineIdFor(appDir, fallback) {
	for (const name of [
		"auth.machine-id",
		"machineid",
		"machineId"
	]) {
		const p = join(appDir, name);
		if (!existsSync(p)) continue;
		const value = readFileSync(p, "utf8").trim();
		if (value.length > 0) return value;
	}
	return fallback;
}
/**
* Read the 0.3.x credential file.
*
* From 0.3.x the apps keep their sign-in in
* `<userData>/auth.v1.dat` — a Chromium OSCrypt blob whose plaintext is the
* session JSON directly, rather than a row inside a VS Code `state.vscdb`:
*
* ```json
* { "schemaVersion": 1, "token": "dt-…", "refreshToken": "drt-…",
*   "expiresAt": "2026-10-19T07:44:22Z", "refreshTokenExpiresAt": "…",
*   "user": { "id": "…", "name": "…", "email": "…" } }
* ```
*
* The envelope is unchanged (`v10` + AES-256-GCM under the DPAPI-wrapped key),
* so {@link oscryptKeyFor} and {@link decryptOscrypt} are reused as they are.
*
* @returns a credential record, or `undefined` when the file is absent or
*   cannot be decoded.
*/
function loadNewCredential(region, appDir, oscryptKey) {
	const file = join(appDir, "auth.v1.dat");
	if (!existsSync(file)) return void 0;
	const plain = decryptOscrypt(readFileSync(file), oscryptKey);
	if (plain === void 0) return void 0;
	let session;
	try {
		session = JSON.parse(plain);
	} catch {
		return;
	}
	if (session === null || typeof session !== "object") return void 0;
	const record = session;
	if (typeof record.token !== "string" || record.token.length === 0) return void 0;
	const user = record.user !== null && typeof record.user === "object" ? record.user : {};
	const userID = typeof user.id === "string" ? user.id : "";
	if (userID.length === 0) return void 0;
	const expiresAt = Date.parse(String(record.expiresAt));
	const refreshExpiresAt = Date.parse(String(record.refreshTokenExpiresAt));
	return {
		region: region.id,
		appName: basename(appDir),
		userID,
		name: typeof user.name === "string" ? user.name : "",
		email: typeof user.email === "string" ? user.email : "",
		token: record.token,
		refreshToken: typeof record.refreshToken === "string" ? record.refreshToken : "",
		refreshTokenExpiresAt: Number.isFinite(refreshExpiresAt) ? refreshExpiresAt : 0,
		expiresAt: Number.isFinite(expiresAt) ? expiresAt : 0,
		expired: Number.isFinite(expiresAt) && expiresAt > 0 ? expiresAt <= Date.now() : false,
		userType: "",
		userTag: "",
		machineID: machineIdFor(appDir, `dsh-connect-qoder-${region.id}`),
		source: "app",
		plan: void 0,
		usage: void 0
	};
}
function loadCredential(region, appDataRoot, options = {}) {
	return loadCredentialWith(region, appDataRoot, options.cachedOnly === true ? cachedOscryptKeyFor : options.force === true ? (appDir) => oscryptKeyFor(appDir, {
		force: true,
		platform: options.platform
	}) : (appDir) => oscryptKeyFor(appDir, { platform: options.platform }));
}
/**
* Load one region's credential without blocking the event loop.
*
* Identical in every rule to {@link loadCredential} — same layouts probed in
* the same order, same "first that decrypts wins", same `expired` semantics —
* because both delegate to `loadCredentialWith` and differ only in which unwrap
* they await. `cachedOnly` is honoured here too, and stays synchronous in
* effect: it answers from the cache and never spawns anything.
*
* @returns a promise of a credential record, or `undefined`.
*/
async function loadCredentialAsync(region, appDataRoot, options = {}) {
	return loadCredentialWith(region, appDataRoot, options.cachedOnly === true ? cachedOscryptKeyFor : options.force === true ? (appDir) => oscryptKeyForAsync(appDir, {
		force: true,
		platform: options.platform
	}) : (appDir) => oscryptKeyForAsync(appDir, { platform: options.platform }));
}
/**
* The shared probe loop, parameterised by how a key is obtained.
*
* `keyFor` may return a key or a promise of one, and this awaits either — which
* is what lets the two public entries share one implementation instead of
* keeping two copies of the layout order in step by hand.
*
* @param region - the region descriptor.
* @param appDataRoot - the application-data root to probe.
* @param keyFor - `(appDir) => key | Promise<key | undefined>`.
* @returns a credential record or `undefined`, or a promise of one when
*   `keyFor` is asynchronous.
*/
function loadCredentialWith(region, appDataRoot, keyFor) {
	for (const appName of region.newAppNames ?? []) {
		const appDir = join(appDataRoot ?? "", appName);
		if (!existsSync(appDir)) continue;
		const pending = keyFor(appDir);
		if (pending !== void 0 && typeof pending.then === "function") return pending.then((key) => finishCandidate(region, appDataRoot, keyFor, appDir, key));
		const credential = finishCandidate(region, appDataRoot, keyFor, appDir, pending);
		if (credential !== void 0) return credential;
	}
	return credentialFromLegacyLayouts(region, appDataRoot, keyFor);
}
/**
* Use one app directory's key, falling through to the remaining layouts.
*
* @returns a credential record, or a promise of one when the key was a promise.
*/
function finishCandidate(region, appDataRoot, keyFor, appDir, key) {
	if (key === void 0) return credentialFromLegacyLayouts(region, appDataRoot, keyFor);
	const credential = safeRead(() => loadNewCredential(region, appDir, key));
	if (credential !== void 0) return credential;
	return credentialFromLegacyLayouts(region, appDataRoot, keyFor);
}
/**
* The legacy `<AppName>/User/globalStorage/state.vscdb` layouts.
*/
function credentialFromLegacyLayouts(region, appDataRoot, keyFor) {
	for (const appName of region.appNames) {
		const appDir = join(appDataRoot ?? "", appName);
		if (!existsSync(appDir)) continue;
		const pending = keyFor(appDir);
		if (pending !== void 0 && typeof pending.then === "function") return pending.then((key) => readLegacyCredential(region, appDir, appName, key));
		const credential = readLegacyCredential(region, appDir, appName, pending);
		if (credential !== void 0) return credential;
	}
}
/**
* Read one legacy store, or `undefined` when this app holds nothing usable.
*/
function readLegacyCredential(region, appDir, appName, oscryptKey) {
	if (oscryptKey === void 0) return void 0;
	for (const dbPath of stateDbCandidates(appDir)) {
		if (!existsSync(dbPath)) continue;
		let userInfo;
		try {
			const decoded = readJsonSecret(dbPath, USER_INFO_KEY, oscryptKey);
			userInfo = decoded !== null && typeof decoded === "object" ? decoded : void 0;
		} catch {
			continue;
		}
		if (userInfo === void 0 || typeof userInfo.token !== "string" || userInfo.token.length === 0) continue;
		if (typeof userInfo.id !== "string" || userInfo.id.length === 0) continue;
		const expiresAt = Number(userInfo.expireTime);
		return {
			region: region.id,
			appName,
			userID: userInfo.id,
			name: typeof userInfo.name === "string" ? userInfo.name : "",
			email: typeof userInfo.email === "string" ? userInfo.email : "",
			token: userInfo.token,
			refreshToken: typeof userInfo.refreshToken === "string" ? userInfo.refreshToken : "",
			refreshTokenExpiresAt: Number(userInfo.refreshTokenExpireTime) || 0,
			expiresAt: Number.isFinite(expiresAt) ? expiresAt : 0,
			expired: Number.isFinite(expiresAt) && expiresAt > 0 ? expiresAt <= Date.now() : false,
			userType: typeof userInfo.userType === "string" ? userInfo.userType : "",
			userTag: typeof userInfo.userTag === "string" ? userInfo.userTag : "",
			machineID: machineIdFor(appDir, `dsh-connect-qoder-${region.id}`),
			source: "app",
			plan: safeRead(() => readJsonSecret(dbPath, USER_PLAN_KEY, oscryptKey)),
			usage: safeRead(() => readJsonSecret(dbPath, CREDIT_USAGE_KEY, oscryptKey))
		};
	}
}
/** Run a reader, mapping any failure to `undefined`. */
function safeRead(fn) {
	try {
		return fn();
	} catch {
		return;
	}
}
/**
* A credential supplied through the environment instead of the desktop app.
*
* The Qoder personal access token is the officially documented integration
* path, so it is honoured as a fallback when no app sign-in is present. The
* token is exchanged for a job token by {@link module:dsh-connect-qoder/upstream}.
*/
function loadEnvCredential(region, env = process.env) {
	for (const name of region.patEnvNames) {
		const value = env[name];
		if (typeof value === "string" && value.trim().length > 0) return {
			region: region.id,
			appName: name,
			userID: "",
			name: "",
			email: "",
			token: value.trim(),
			refreshToken: "",
			refreshTokenExpiresAt: 0,
			expiresAt: 0,
			expired: false,
			userType: "",
			userTag: "",
			machineID: `dsh-connect-qoder-${region.id}`,
			source: "env-pat",
			plan: void 0,
			usage: void 0
		};
	}
}
/**
* Whether a cached credential may still be served, or must be re-read.
*
* The two sources expire on different clocks, and conflating them is what made
* this worth extracting:
*
* - An **app** credential carries an `expired` flag computed when it was read
*   from disk. The Qoder app refreshes the token in its own store, so once this
*   says expired the only way to learn about a re-sign-in is to read again.
* - An **env PAT** is exchanged for a job token with its own `expiresAt`; the
*   raw PAT never expires, so the exchange result does, and it is a wall-clock
*   comparison rather than a stored flag.
* - A **device** credential is this plugin's own, and it is the one source it
*   can renew: it carries the same wall-clock `expiresAt` the service stated,
*   and an expired one is not the end of the story — the refresh token is what
*   the loader reaches for. Reporting it as unusable here is precisely what
*   lets `CredentialCache.resolve` re-enter the loader and rotate it, so this
*   comparison is a trigger for a refresh, not a verdict of death.
*
* @param cached - the cached record, or `undefined` when nothing is cached.
* @param now - current epoch milliseconds.
* @returns true when the cached value may be reused.
*/
function isCredentialUsable(cached, now = Date.now()) {
	if (cached === void 0 || cached === null) return false;
	if (cached.source === "env-pat" || cached.source === "device") return Number(cached.expiresAt) > now;
	return cached.expired !== true;
}

//#endregion
//#region src/host/account-state.ts
/**
* What sign-in state one Qoder region is in, from local evidence only.
*
* The states, in the order a machine can be:
*
* - **`ok`** — a credential is readable and not expired: either an app
*   sign-in whose store says so, or an env PAT (the PAT never expires on its
*   own, so presence is the whole test).
* - **`expired`** — an app sign-in is readable but its store says the access
*   token has lapsed. The fix is to sign in again in the app; nothing this
*   module does can cure it.
* - **`needs-app`** — an app directory for the region exists but yields no
*   credential: the OSCrypt key could not be unwrapped, or the app is
*   installed without a sign-in yet. `detail` carries the recorded unwrap
*   reason when there is one, so the card can say *why* rather than showing a
*   blank.
* - **`signed-out`** — no app directory and no PAT: there is simply nothing
*   to use on this machine.
*
* Two rules keep the module honest:
*
* - **No network.** Every state is decidable from local files (and the
*   recorded unwrap outcome). The optional online confirmation the card
*   offers is a separate route that calls `fetchUserInfo`; it refines an
*   `ok`/`expired` state but is not what produces these states.
* - **No credential.** The record hands back `name` / `email` / `expiresAt`
*   — identity, for display — and never the token or its refresh half. The
*   card is a browser surface; a token reaching it is a leak, and this
*   module's output is the only account payload the card ever receives.
*
* Split out like `lib/credential-cache.js`: the decision has no Cordis
* context of its own, so it can be asserted against the real code with the
* store readers injected.
*
* @module dsh-connect-qoder/account-state
*/
/**
* The app data directories a region probes, new layout first.
*
* The region descriptor lists two spellings (`newAppNames` for the 0.3.x
* `com.<vendor>.app.<channel>` layout, `appNames` for the legacy
* `<AppName>` one) and `loadCredential` tries them in that order; a present
* directory is a present directory in either layout, so both are checked.
*/
function probeDirs(region, appDataRoot) {
	return [...region.newAppNames ?? [], ...region.appNames].map((name) => ({
		name,
		path: join(appDataRoot, name)
	})).filter((entry) => existsSync(entry.path));
}
function readAccountState(region, appDataRoot, options = {}) {
	const loadCred = options.loadCredential ?? (options.cachedOnly === true ? (r, root) => loadCredential(r, root, { cachedOnly: true }) : options.force === true ? (r, root) => loadCredential(r, root, { force: true }) : loadCredential);
	const loadEnv = options.loadEnvCredential ?? loadEnvCredential;
	const unwrapFailure = options.describeUnwrapFailure ?? describeUnwrapFailure;
	const appData = typeof appDataRoot === "string" ? appDataRoot : appDataRootFor();
	const base = {
		region: region.id,
		regionName: region.displayName,
		manageUrl: region.manageUrl,
		downloadUrl: region.downloadUrl
	};
	return Promise.resolve(loadCred(region, appData)).then((credential) => credential ?? loadEnv(region)).then((credential) => credential === void 0 ? signedOutOrNeedsApp(region, appData, base, unwrapFailure) : signedIn(base, credential));
}
/**
* {@link readAccountState} with a store reader that may be asynchronous.
*
* Exists so the call sites read as what they are: the account panel's forced
* re-read DOES unwrap, and on the synchronous path that froze DSH's event loop
* for ~0.5 s per region (measured; up to 30 s when the machine cannot unwrap at
* all). Naming the async case separately means a future call site cannot pick
* the blocking one by accident.
*
* @param region - the region descriptor.
* @param appDataRoot - the application-data root, or `undefined` to resolve it.
* @param options - the same as {@link readAccountState}, except that
*   `loadCredential` may return a promise.
* @returns a promise of the state record.
*/
function readAccountStateAsync(region, appDataRoot, options = {}) {
	return readAccountState(region, appDataRoot, {
		...options,
		loadCredential: options.loadCredential ?? (options.cachedOnly === true ? (r, root) => loadCredentialAsync(r, root, { cachedOnly: true }) : options.force === true ? (r, root) => loadCredentialAsync(r, root, { force: true }) : loadCredentialAsync)
	});
}
/** The `ok` / `expired` verdict, given a readable credential. */
function signedIn(base, credential) {
	const cred = credential ?? {};
	const identity = {
		name: typeof cred.name === "string" ? cred.name : "",
		email: typeof cred.email === "string" ? cred.email : "",
		...Number(cred.expiresAt) > 0 ? { expiresAt: Number(cred.expiresAt) } : {}
	};
	return {
		...base,
		state: cred.expired === true ? "expired" : "ok",
		source: typeof cred.source === "string" ? cred.source : void 0,
		appName: typeof cred.appName === "string" ? cred.appName : void 0,
		identity,
		detail: void 0
	};
}
/** The `needs-app` / `signed-out` verdict, from directory presence alone. */
function signedOutOrNeedsApp(region, appData, base, unwrapFailure) {
	const present = probeDirs(region, appData);
	const first = present[0];
	if (first !== void 0) {
		const detail = present.map((entry) => unwrapFailure(entry.path)).find((reason) => reason !== void 0);
		return {
			...base,
			state: "needs-app",
			source: void 0,
			appName: basename(first.path),
			identity: void 0,
			detail: detail ?? "the app is present but holds no sign-in"
		};
	}
	return {
		...base,
		state: "signed-out",
		source: void 0,
		appName: void 0,
		identity: void 0,
		detail: void 0
	};
}

//#endregion
//#region src/host/account-payload.ts
/**
* The payload behind the account panel's three routes.
*
* WHY THIS IS A MODULE AND NOT A CLOSURE IN lib/index.js
*
* It used to be a local arrow function there, and it stayed invisible to the
* test suite for exactly as long as it stayed broken. `lib/index.js` imports the
* Cordis peer packages, which this repository deliberately does not install, so
* nothing in it can be imported by a test — and this payload called
* `readAccountStateAsync` while the file's import line named only the
* synchronous `readAccountState`. Every render of the account panel answered
* `ReferenceError: readAccountStateAsync is not defined`, which escaped the
* request handler into the host's catch-all and came back to the browser as a
* bodyless 400 — the single line "读取账号状态失败" on an otherwise working
* card, with nothing logged anywhere. The user saw it first. Nothing else
* noticed: the model list, usage panel and generation were all fine because they
* never touch this function.
*
* Moving it here puts the call where a test can execute it for real. The three
* dependencies it needs are all peer-free already (`account-state`,
* `credentials`, `preferences`), so this module has no Cordis contact at all —
* same reasoning the README's table gives for every other extracted module.
* `lib/index.js` now passes only what it uniquely owns: the regions and the
* live settings snapshot.
*
* @module dsh-connect-qoder/account-payload
*/
async function buildAccountPayload({ regions, settings, force = false, readAccountState = readAccountStateAsync, appDataRoot = appDataRootFor(), regionEnabled = regionEnabledFor, deviceStatus, credentialKind } = {}) {
	const enabledRegions = Object.fromEntries(regions.map((region) => [region.id, regionEnabled(settings, region.id)]));
	const mode = force === true ? { force: true } : { cachedOnly: true };
	return {
		regions: await Promise.all(regions.map(async (region) => {
			const kind = credentialKind?.(region.id);
			return {
				...await readAccountState(region, appDataRoot, mode),
				enabled: enabledRegions[region.id],
				...deviceStatus === void 0 ? {} : { device: deviceStatus(region.id) },
				...kind === void 0 ? {} : { credentialKind: kind }
			};
		})),
		enabledRegions
	};
}

//#endregion
//#region src/host/credential-kind.ts
/**
* The kind of the credential a region is being served by.
*
* @param credential - the credential that was resolved, or `undefined` when
*   this machine has none.
* @returns the path it came from, or `undefined` when there is no credential.
*/
function credentialKindOf(credential) {
	if (credential === void 0) return void 0;
	switch (credential.source) {
		case "app": return "desktop";
		case "device": return "device";
		case "env-pat": return "env";
	}
}

//#endregion
//#region src/host/credential-cache.ts
/**
* The per-region credential cache.
*
* Split out of lib/index.js so the behaviour this plugin sells — "a re-sign-in
* is picked up without restarting DSH" — can be asserted against the real code.
* The two predicates on that path (`isStaleCredentialError`, `isCredentialUsable`)
* were already testable, but the wiring between them was not: the flag that
* turns a sign-in rejection into a re-read lived in a class that cannot be
* imported, because lib/index.js pulls in the Cordis peer dependencies. Two
* tested parts and one untested connection is still no test.
*
* Everything external is injected, so this module has no imports beyond
* `isCredentialUsable` and no peer dependencies.
*
* @module dsh-connect-qoder/credential-cache
*/
/**
* The default wait imposed on an exchange refusal the platform gave no window
* for. Doubles from here on each consecutive refusal and is capped at
* `EXCHANGE_BACKOFF_CAP_MS`, so a persistently refused exchange settles at the
* cap instead of producing a steady one-minute trickle of POSTs for as long as
* the panel stays open.
*/
const DEFAULT_EXCHANGE_BACKOFF_MS = 6e4;
/**
* Cap on a self-imposed exchange wait.
*
* Applies ONLY to a wait this cache invented. A window the platform stated
* itself (a real `Retry-After`) is never truncated by it: capping that is what
* walks back into a lockout that is still in force.
*/
const EXCHANGE_BACKOFF_CAP_MS = 18e5;
/**
* How long an unstated window should wait, doubling per consecutive refusal.
*
* @param attempt - how many consecutive refusals there have been (1 for the first).
* @returns milliseconds, capped at `EXCHANGE_BACKOFF_CAP_MS`.
*/
function localExchangeBackoffMs(attempt) {
	const doubled = DEFAULT_EXCHANGE_BACKOFF_MS * 2 ** Math.max(0, attempt - 1);
	return Math.min(doubled, EXCHANGE_BACKOFF_CAP_MS);
}
/**
* Classify an exchange failure into a throttle, or `undefined` to not gate on it.
*
* The status code is the whole distinction. A `429` is a rate limit that may
* carry the platform's own window (`Retry-After`); honour it at face value, and
* fall back to {@link localExchangeBackoffMs} only when none was stated. A
* `401`/`403` is a dead credential with no useful window — keep polling it and
* every exchange is a fresh attempt against a token that will never work, so it
* parks until a deliberate re-read replaces it. Anything else (a 5xx, or a
* network throw with no status) is transient and is NOT gated: the gate exists
* for the two states a poll loop can turn permanent, not to hide a momentary
* upstream hiccup behind a backoff.
*
* @param error - the thrown exchange error; its `.status` and `.retryAfterSeconds`
*   are read as plain flags, since a thrown error may reach here having lost its
*   prototype across the throw boundary.
* @param now - the wall clock a stated window is measured against.
* @param attempt - the consecutive-refusal count *after* this one.
* @returns the throttle to hold, or `undefined` when this failure is not one
*   the gate should stand for.
*/
function throttleForExchangeError(error, now, attempt) {
	const status = Number(error?.status);
	const stated = Number(error?.retryAfterSeconds);
	const statedWindow = Number.isFinite(stated) && stated > 0 ? stated : void 0;
	if (status === 429) return {
		kind: "rate-limit",
		parked: false,
		until: now + (statedWindow !== void 0 ? statedWindow * 1e3 : localExchangeBackoffMs(attempt)),
		attempt
	};
	if (status === 401 || status === 403) return {
		kind: "dead-credential",
		parked: true,
		until: null,
		attempt
	};
}
var CredentialCache = class {
	/** Reads the app's credential store (see {@link CredentialCacheOptions.loadApp}). */
	loadApp;
	/** The PAT fallback reader. */
	loadEnv;
	/** The plugin's own vault reader (device login); absent when unwired. */
	loadDevice;
	/**
	* Exchanges a PAT for a job token; absent when PATs are unsupported.
	*
	* The parameter and the answer are both `LoadedCredential`-derived rather
	* than `any`: the call below reads `credential.source` to decide whether to
	* exchange at all, and then copies three named fields off the answer. With
	* `any` neither the discriminant nor the three field names was checked, so a
	* rename on either side would have surfaced as `undefined` at runtime.
	*/
	exchangePat;
	/**
	* The cached record: an app credential as read, or a PAT after exchange —
	* which is that same credential with its three token fields replaced, so it
	* is still a `LoadedCredential`.
	*/
	cached;
	/** Set when a request was rejected with a sign-in failure. */
	invalid;
	/** How many times the underlying store was actually read. */
	reads;
	/** How many times a PAT was exchanged for a job token. */
	exchanges;
	/**
	* The exchange throttle currently in force, or `null`.
	*
	* Loaded lazily from the injected store on the first resolve that needs it,
	* so an app-credential path (the common one) never touches the throttle seam.
	*
	* @type {ExchangeThrottle | null}
	*/
	throttle;
	/** Whether the throttle has been read from the store yet this process. */
	throttleLoaded;
	/** Optional throttle persistence; see {@link CredentialCacheOptions.throttleStore}. */
	throttleStore;
	/** The wall clock, for honouring windows and running tests. */
	now;
	/**
	* @param options.loadApp - `() => credential | undefined`, reading the app's store.
	* @param options.loadEnv - `() => credential | undefined`, the PAT fallback.
	* @param options.loadDevice - `() => credential | undefined`, this plugin's
	*   own vault (see {@link CredentialCacheOptions.loadDevice}).
	* @param options.exchangePat - `(credential) => { token, refreshToken, expiresAt }`,
	*   called only for a PAT source; absent when PATs are not supported.
	* @param options.throttleStore - optional persistence for the exchange throttle.
	* @param options.now - the wall clock; injectable for tests.
	*/
	constructor({ loadApp, loadEnv, loadDevice, exchangePat, throttleStore, now = () => Date.now() }) {
		this.loadApp = loadApp;
		this.loadEnv = loadEnv;
		this.loadDevice = loadDevice;
		this.exchangePat = exchangePat;
		this.throttleStore = throttleStore;
		this.now = now;
		/**
		* The cached record: an app credential as read, or a PAT after exchange.
		* Named `cached` rather than `credential` because the plugin's own field was
		* written on every resolve and read by nothing.
		*/
		this.cached = void 0;
		/**
		* Set when a request is rejected with a sign-in failure, so the next
		* `resolve` forces a re-read from disk. Without this, a cached app
		* credential whose token has expired stays cached for the process's life —
		* its `expired` flag was computed when it was read, not at request time —
		* and every request 401s until DSH is restarted.
		*/
		this.invalid = false;
		/** How many times the underlying store was actually read; asserted in tests. */
		this.reads = 0;
		/** How many times a PAT was exchanged for a job token; asserted in tests. */
		this.exchanges = 0;
		this.throttle = null;
		this.throttleLoaded = false;
	}
	/**
	* Resolve the current throttle from the store, once per process.
	*
	* A store that throws reads as "no throttle": a throttle that cannot be
	* remembered must not wedge credential resolution — the poll retries the
	* exchange, which is the pre-fix behaviour and no worse.
	*/
	async loadThrottle() {
		if (this.throttleLoaded) return this.throttle;
		this.throttleLoaded = true;
		if (this.throttleStore === void 0) return this.throttle;
		try {
			const held = await this.throttleStore.read();
			if (held !== null && held !== void 0) this.throttle = held;
		} catch {}
		return this.throttle;
	}
	/** How much longer a held throttle is in force; `Infinity` for a parked one. */
	waitRemainingMs(held) {
		if (held.parked) return Number.POSITIVE_INFINITY;
		if (held.until === null) return 0;
		return Math.max(0, held.until - this.now());
	}
	/**
	* Resolve the credential to use for a request.
	*
	* A cached value is reused while it is still usable (see
	* `isCredentialUsable`); otherwise the app store is read, falling back to a
	* PAT, and a PAT is exchanged once for a job token — unless a previous
	* exchange was refused and its throttle window is still in force, in which
	* case this throws without reaching the platform.
	*
	* @returns the credential, or `undefined` when this machine has no sign-in.
	* @throws when an exchange is gated by the throttle, or when the exchange
	*   itself fails.
	*/
	async resolve() {
		if (this.invalid) {
			this.invalid = false;
			this.cached = void 0;
			await this.clearThrottle();
		}
		if (isCredentialUsable(this.cached)) return this.cached;
		this.reads += 1;
		const fromApp = await this.loadApp();
		const appUsable = fromApp !== void 0 && fromApp.expired !== true;
		const fromDevice = !appUsable && this.loadDevice !== void 0 ? await this.loadDevice() : void 0;
		const credential = (appUsable ? fromApp : void 0) ?? fromDevice ?? this.loadEnv() ?? fromApp;
		if (credential === void 0) {
			this.cached = void 0;
			return;
		}
		if (credential.source === "env-pat") {
			if (this.exchangePat === void 0) {
				this.cached = credential;
				return credential;
			}
			const held = await this.loadThrottle();
			if (held !== null) {
				if (this.waitRemainingMs(held) > 0) throw this.throttleError(held);
				this.throttle = null;
			}
			this.exchanges += 1;
			try {
				const exchanged = await this.exchangePat(credential);
				await this.clearThrottle();
				this.cached = {
					...credential,
					token: exchanged.token,
					refreshToken: exchanged.refreshToken,
					expiresAt: exchanged.expiresAt
				};
				return this.cached;
			} catch (error) {
				const attempt = (held?.attempt ?? 0) + 1;
				const next = throttleForExchangeError(error, this.now(), attempt);
				if (next !== void 0) {
					this.throttle = next;
					try {
						await this.throttleStore?.write(next);
					} catch {}
				}
				throw error;
			}
		}
		this.cached = credential;
		return credential;
	}
	/**
	* The path the cached credential came from.
	*
	* `undefined` when nothing is cached yet, or when the cached credential was
	* cleared. The card used to infer this from the account payload's `source`
	* field, which describes what the panel could see rather than what the
	* runtime resolved; here the answer comes from the credential actually in
	* hand, so "the desktop app is serving this region" and "the plugin's own
	* sign-in is serving it" stop being guesses.
	*/
	get kind() {
		return credentialKindOf(this.cached);
	}
	/**
	* The refusal an in-force throttle stands for.
	*
	* Carries `retryAfterSeconds` — the wait still remaining — so the card can
	* render a countdown instead of a bare "could not sign in", the same shape a
	* queue rejection already travels in. It is a fresh `Error` (not a rethrow of
	* the original, which is gone) because the gate produced this answer, not a
	* new platform reply: these are the plugin's own words about a wait it is
	* honouring.
	*/
	throttleError(held) {
		const error = /* @__PURE__ */ new Error(held.parked ? "Qoder PAT exchange is not being retried: this credential was refused and needs to be re-entered" : "Qoder PAT exchange is waiting out a rate-limit window before it retries");
		if (!held.parked && held.until !== null) error.retryAfterSeconds = Math.ceil(this.waitRemainingMs(held) / 1e3);
		return error;
	}
	/**
	* Drop the exchange throttle so the next resolve may retry.
	*
	* Called on a deliberate re-read (see {@link CredentialCache.invalidate}) and
	* after a successful exchange. It clears both the in-memory gate and the
	* persisted one.
	*/
	async clearThrottle() {
		this.throttle = null;
		this.throttleLoaded = true;
		try {
			await this.throttleStore?.clear();
		} catch {}
	}
	/**
	* Invalidate the cached credential after an upstream sign-in rejection.
	*
	* The next `resolve` re-reads the app's store, so a re-sign-in is picked up
	* without a restart. Called from the shim when the upstream answers with a
	* sign-in failure, and from the account-reload route when the user presses
	* "重读登录" — and, in both cases, it also clears the exchange throttle: a
	* deliberate re-read is the one event that says "the credential may have
	* changed, try again", which is what a stale gate must step aside for.
	*/
	invalidate() {
		this.invalid = true;
	}
};

//#endregion
//#region src/host/credential-vault.ts
/**
* The plugin's own credential file, one per region — the storage half of the
* device-login credential source (docs/issues/21-device-login-credential-source.md).
*
* It is the plugin's only secret of its own: the file is `0o600` in a `0o700`
* directory, writes go to a sibling `.tmp` renamed onto the target, and
* `update()` serializes the read-decide-write and re-reads first, so another
* profile's record is never stomped. Nothing throws: a failure the user must
* see comes back through the return value (docs/issues/16-silent-failure-policy.md).
*
* @module dsh-connect-qoder/credential-vault
*/
/** On-disk format this reader accepts; other versions read as absent. */
const VAULT_FORMAT_VERSION = 1;
/**
* How long one of a writer's `.tmp` leftovers must have sat untouched before a
* save treats it as crash debris rather than an in-flight write. Far above any
* real write (the rename follows the write in microseconds), far below a crash
* nobody is cleaning up after.
*/
const STALE_TEMP_MS = 6e4;
/**
* A field of a parsed record, read defensively.
*
* Records written by an older build, or edited by hand, must not be able to
* produce a credential with `undefined` where a string is expected: the
* signature is built from these, and a `undefined` there surfaces upstream as
* an authentication failure rather than as the shape problem it is.
*/
function text(value) {
	return typeof value === "string" ? value : void 0;
}
/** A timestamp field, in epoch ms. The on-disk form is a number; seconds are not accepted. */
function stamp(value) {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : void 0;
}
/**
* Whether two candidate records carry the same credential.
*
* Used only by the commit-time re-read inside `update`, so the fields that
* matter are the ones a competing writer changes: the tokens, the identity
* and expiry stamps, and `savedAt` — the guard's own yardstick. Two records
* differing in none of these are the same credential for the race's purposes
* even if a future build grows a display-only field this comparison ignores.
*/
function recordsEqual(a, b) {
	if (a === void 0 || b === null) return false;
	return a.token === b.token && a.refreshToken === b.refreshToken && a.expiresAt === b.expiresAt && a.refreshTokenExpiresAt === b.refreshTokenExpiresAt && a.userID === b.userID && a.machineID === b.machineID && a.savedAt === b.savedAt;
}
/**
* Read one value out of a parsed record into a {@link VaultRecord}.
*
* Returns `undefined` for anything that is not a whole, plausible record. The
* bar is deliberately high — a `token` and a non-empty `userID` are the two
* fields without which the credential cannot be used at all, and a record
* missing either is treated as absent rather than as a credential that will
* fail upstream.
*/
function vaultRecordFrom(value) {
	if (value === null || typeof value !== "object") return void 0;
	const record = value;
	if (record.version !== 1) return void 0;
	const token = text(record.token);
	const userID = text(record.userID);
	const refreshToken = text(record.refreshToken);
	if (token === void 0 || token === "" || userID === void 0 || userID === "") return void 0;
	return {
		token,
		refreshToken: refreshToken ?? "",
		expiresAt: stamp(record.expiresAt) ?? 0,
		refreshTokenExpiresAt: stamp(record.refreshTokenExpiresAt) ?? 0,
		userID,
		name: text(record.name) ?? "",
		email: text(record.email) ?? "",
		machineID: text(record.machineID) ?? "",
		savedAt: stamp(record.savedAt) ?? 0
	};
}
/**
* One region's credential file, with serialized read-modify-write.
*
* @see module:dsh-connect-qoder/credential-vault for why each rule exists.
*/
var CredentialVault = class {
	/** Where the vault file lives. */
	path;
	/** The wall clock, stamped into `savedAt` and used for the quarantine name. */
	now;
	/** Optional logger for a failed write or an unreadable file. */
	logger;
	/**
	* The tail of the write chain; see {@link CredentialVault.update}.
	*
	* Every mutation is appended here, so two mutations can never interleave
	* their read-decide-write. It is a promise chain rather than a boolean "busy"
	* flag because the work is synchronous: a caller must still be able to queue.
	*/
	chain = Promise.resolve();
	constructor({ path, now = () => Date.now(), logger }) {
		this.path = path;
		this.now = now;
		this.logger = logger;
	}
	/**
	* Read the stored credential, or `null`.
	*
	* `null` covers every "there is nothing usable here" case on purpose: no
	* file, an unreadable file, a foreign version, or a record missing the fields
	* a signature needs. The caller's answer to all of them is the same — treat
	* this region as having no device credential — and keeping them distinct here
	* would invite a caller to invent a second, differently-worded version of
	* that answer.
	*
	* A file that exists but cannot be PARSED is quarantined (see
	* {@link CredentialVault.quarantine}) so the next write does not overwrite
	* it. A file that parses but is the wrong shape is left alone: it is
	* evidence of a version skew, not of damage, and the next write replaces it.
	*/
	read() {
		const result = this.readResult();
		return result.kind === "ok" ? result.record : null;
	}
	/**
	* Read the credential and say WHY, where {@link CredentialVault.read} says
	* only "nothing usable".
	*
	* `read` is the right call for control flow: every empty answer has the same
	* consequence (this region has no device credential). This is the call for
	* the panel, where "you have not signed in on this machine" and "your
	* credential file is damaged" are different sentences with different next
	* steps, and telling a user the wrong one is the class of failure this repo's
	* first red line exists for.
	*/
	readResult() {
		if (!existsSync(this.path)) return { kind: "absent" };
		let parsed;
		try {
			parsed = JSON.parse(readFileSync(this.path, "utf8"));
		} catch (error) {
			this.quarantine(error);
			return { kind: "unreadable" };
		}
		const record = vaultRecordFrom(parsed);
		if (record !== void 0) return {
			kind: "ok",
			record
		};
		return { kind: "unrecognised" };
	}
	/**
	* Move an unparseable file aside, keeping the bytes.
	*
	* The name carries the clock so repeated failures accumulate rather than
	* overwrite each other — the point is to lose nothing that a human might
	* recover a token from. Failing to move it is not worth an error: the next
	* write replaces the file either way, and the caller is already being told
	* there is no credential.
	*/
	quarantine(error) {
		try {
			renameSync(this.path, `${this.path}.corrupt-${this.now()}`);
			this.logger?.warn?.(`dsh-connect-qoder: kept an unreadable credential file as ${this.path}.corrupt-*`);
		} catch (renameError) {
			this.logger?.warn?.(`dsh-connect-qoder: could not set aside an unreadable credential file ${this.path}`, renameError);
		}
		this.logger?.warn?.(`dsh-connect-qoder: could not read credential file ${this.path}`, error);
	}
	/**
	* Write a record atomically, with owner-only permissions.
	*
	* @returns whether the bytes actually landed. A `false` is a fact the caller
	*   must surface: a credential that could not be saved still works for this
	*   process, but the user has signed in for nothing unless they are told.
	*/
	save(record) {
		const tmp = `${this.path}.${process.pid}.tmp`;
		this.sweepStaleTemps();
		try {
			mkdirSync(dirname(this.path), {
				recursive: true,
				mode: 448
			});
			writeFileSync(tmp, JSON.stringify({
				version: 1,
				...record
			}, null, 2), {
				encoding: "utf8",
				mode: 384
			});
			renameSync(tmp, this.path);
			return true;
		} catch (error) {
			try {
				if (existsSync(tmp)) unlinkSync(tmp);
			} catch {}
			this.logger?.warn?.(`dsh-connect-qoder: could not save credential file ${this.path}`, error);
			return false;
		}
	}
	/**
	* Clear temp files from interrupted writes.
	*
	* The catch above can only clean up when this process still gets to run it:
	* a kill between the write and the rename leaves the token in cleartext next
	* to the vault with nothing to reclaim it. Sweeping at the start of every
	* save bounds that window. The candidate set is deliberately narrow — this
	* vault's own directory, names starting with this vault's own basename plus
	* a dot and ending in `.tmp`, older than STALE_TEMP_MS, never including the
	* name currently being written — so a live writer's temp, this process or
	* another machine profile, is never yanked out from under it, and no name
	* this vault could not have written is ever a candidate. unlink does not
	* follow links: a planted symlink goes, its target anywhere else does not.
	* Every removal is best-effort: a temp that will not die today is retried
	* on the next save, never a save failure.
	*/
	sweepStaleTemps() {
		const dir = dirname(this.path);
		const prefix = `${basename(this.path)}.`;
		const own = `${prefix}${process.pid}.tmp`;
		const now = this.now();
		let names;
		try {
			names = readdirSync(dir);
		} catch {
			return;
		}
		for (const name of names) {
			if (!name.startsWith(prefix) || !name.endsWith(".tmp") || name === own) continue;
			const path = join(dir, name);
			try {
				if (now - statSync(path).mtimeMs < STALE_TEMP_MS) continue;
				unlinkSync(path);
			} catch {}
		}
	}
	/** Remove the stored credential. An absent file is a no-op, not an error. */
	remove() {
		try {
			if (existsSync(this.path)) unlinkSync(this.path);
			return true;
		} catch (error) {
			this.logger?.warn?.(`dsh-connect-qoder: could not remove credential file ${this.path}`, error);
			return false;
		}
	}
	/**
	* Atomically apply one change to the stored credential.
	*
	* The mutator receives the CURRENT stored record (re-read inside the chain,
	* not passed in by the caller) and returns the record to store, or `null` to
	* remove the file. Because the read, the decision and the write all happen
	* inside one chain step, a concurrent `update` cannot land between another
	* one's read and its write.
	*
	* This is the whole reason the class exists rather than callers doing
	* `read()`/`save()` themselves: a sign-out and a token refresh are both
	* ordinary events, and interleaved they resurrect a signed-out credential.
	*
	* Cross-process writers (a second DSH profile over the same Harness home)
	* do not go through this chain, so just before committing, the step re-reads
	* the file and refuses to write unless the disk still holds the record the
	* decision was based on — see the module header for the refusal cases and
	* the window that honestly remains. A deletion (`null`) always commits: the
	* user pressed sign-out, and no concurrent refresh may outrank that.
	*
	* @returns whether the file's contents ended up as requested. A rejected
	*   promise is never used to report a storage failure — the caller needs to
	*   distinguish "the disk refused" from "the operation threw". `false`
	*   covers the disk refusing AND the commit-time re-read finding that
	*   another process changed the record under us; both are facts the caller
	*   must surface, never smooth over.
	*/
	update(mutator) {
		const step = this.chain.then(() => {
			const current = this.read();
			const next = mutator(current);
			if (next === null) return this.remove();
			if (!this.diskStillHolds(current, next)) return false;
			return this.save(next);
		});
		this.chain = step.catch(() => void 0);
		return step;
	}
	/**
	* Whether the disk still holds the record this chain step decided on.
	*
	* A second DSH profile (web and desktop share one Harness home, hence one
	* vault file per region) writes this file with its OWN chain, so a record
	* can land between this step's read and its rename. Re-reading immediately
	* before the commit narrows the race to the re-read→rename pair of syscalls
	* and, more importantly, turns "my write silently overwrote theirs" into
	* "my write is refused and the caller says so":
	*
	* - a record newer than the one decided on (the other profile refreshed or
	*   re-signed-in) is left standing — a diverged disk is never overwritten,
	*   whichever side claims to be newer, because "newer" across two processes
	*   is last-writer-wins wearing a timestamp;
	* - a file that vanished (the other profile signed out) is not resurrected;
	* - a file that changed shape under us (unreadable, or a foreign version)
	*   is never stomped by a build that cannot even parse it;
	* - the decided-on state itself — including "absent", for the first-ever
	*   sign-in — passes through.
	*
	* Deletions never reach here (`update` commits them unconditionally), so
	* `next` is always a record to store.
	*/
	diskStillHolds(decidedOn, next) {
		const fresh = this.readResult();
		if (decidedOn === null) return fresh.kind === "absent" || recordsEqual(fresh.kind === "ok" ? fresh.record : void 0, next);
		if (fresh.kind !== "ok") return false;
		const disk = fresh.record;
		return recordsEqual(disk, next) || recordsEqual(disk, decidedOn);
	}
	/**
	* Forget the stored credential, serialized against in-flight updates.
	*
	* Goes through the same chain as {@link CredentialVault.update} so that a
	* refresh which has already read the record cannot write it back after the
	* sign-out lands.
	*/
	clear() {
		return this.update(() => null);
	}
};

//#endregion
//#region src/host/device-login.ts
/**
* Qoder's device login: authorize URL, poll, refresh — a pure protocol layer.
*
* The protocol is reverse-engineered from a shipping client: every constant,
* URL shape and error rule is copied from `probe/qoder-device-login.mjs`.
*
* The loop, the persistence and the request budget belong to the caller.
* Background: docs/issues/21-device-login-credential-source.md
*
* @module dsh-connect-qoder/device-login
*/
/** The PKCE verifier alphabet: RFC 7636's unreserved characters. */
const PKCE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
/** The shortest verifier RFC 7636 allows; the measured length formula starts here. */
const PKCE_MIN_LENGTH = 43;
/** How many further characters the measured formula may add (43..128). */
const PKCE_LENGTH_SPAN = 86;
/** Paths on the auth host, the region's OpenAPI host, and again on OpenAPI. */
const DEVICE_SELECT_PATH = "/device/selectAccounts";
const POLL_PATH = "/api/v1/deviceToken/poll";
const REFRESH_PATH = "/api/v1/deviceToken/refresh";
/**
* The per-request budget, matching the reference implementation's 30 s.
*
* It is a signal, not a wrapper: `AbortSignal.timeout` aborts the fetch itself,
* so a socket that never answers cannot hold the caller's loop forever. The
* resulting rejection is reported as `{ kind: 'failed', name: 'TimeoutError' }`
* — an outcome the caller can tell the user about, never a rejection out of
* this module.
*/
const REQUEST_TIMEOUT_MS = 3e4;
/**
* The two products, keyed by region id.
*
* Both values are measured, not read off a specification: each clientId
* completed a real authorization against its own host. They are also NOT
* interchangeable — a clientId presented to the other region's authorize page
* redirects and renders fine, and only fails after the user approves, which is
* why the two ids are pinned by a test rather than merely declared here.
*
* `openApiBase` duplicates the host `credentials.ts` already names for each
* region on purpose: this module imports nothing (see the header), so it cannot
* read that table, and a test asserts the two agree rather than trusting two
* constants to drift together.
*/
const DEVICE_PRODUCTS = {
	"qoder-cn": {
		region: "qoder-cn",
		authBase: "https://qoder.cn",
		openApiBase: "https://openapi.qoder.com.cn",
		clientId: "732aef47-9cf2-46a2-95fe-4cebb5d0d1fa",
		clientMetadata: {
			client_type: "5",
			business_product: "cli",
			business_type: "agent",
			scene: "assistant"
		}
	},
	qoder: {
		region: "qoder",
		authBase: "https://qoder.com",
		openApiBase: "https://openapi.qoder.sh",
		clientId: "e883ade2-e6e3-4d6d-adf7-f92ceff5fdcb",
		clientMetadata: {
			client_type: "5",
			business_product: "cli",
			business_type: "agent",
			scene: "assistant"
		}
	}
};
/**
* The product for a region id, or `undefined` for anything else.
*
* `Object.hasOwn` rather than a bare index: a plain lookup answers
* `productForRegion('toString')` with a function inherited from
* `Object.prototype` — an object that looks product-shaped, whose `authBase` and
* `clientId` are `undefined`, and which would send the user to
* `undefined/device/selectAccounts`. A wrong answer that looks like a right one
* is worse than no answer.
*/
function productForRegion(regionId) {
	return Object.hasOwn(DEVICE_PRODUCTS, regionId) ? DEVICE_PRODUCTS[regionId] : void 0;
}
/**
* A fresh PKCE pair (RFC 7636 S256).
*
* The LENGTH is drawn from `rand`, because that is the measured formula
* (`43 + floor(86 * rand())`, i.e. 43..128) and the reference implementation
* picks it the same way. The CHARACTERS never are: a verifier drawn from
* `Math.random` is not a secret, and this verifier is the only thing standing
* between a guessable poll URL and somebody else's credential. The bytes come
* from `node:crypto` and are mapped onto the unreserved alphabet — the same
* construction the probe has been running against both live regions.
*
* @param rand - the random source for the LENGTH only; injectable for tests.
*/
function createPkce(rand = Math.random) {
	const length = PKCE_MIN_LENGTH + Math.floor(PKCE_LENGTH_SPAN * rand());
	const bytes = randomBytes(length);
	let verifier = "";
	for (const byte of bytes) verifier += PKCE_ALPHABET.charAt(byte % 66);
	const challenge = createHash("sha256").update(verifier).digest().toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
	return {
		verifier,
		challenge
	};
}
/**
* A fresh login attempt for one region.
*
* @param machineID - the machine identity the credential is issued against.
*   Defaults to a fresh UUID. The caller must remember it: the poll envelope
*   carries no machine id at all, so this value — not the payload — is what
*   {@link refreshOnce} has to send back later.
* @throws when the region has no product. A session for a region nothing can
*   build a URL for is not a session, and handing one back would defer the
*   mistake to a request that cannot be made. The caller resolves the product
*   with {@link productForRegion} first and reports the unknown region to the
*   user; this is the load-bearing second half of that check, not a substitute
*   for it.
*/
function createDeviceSession(regionId, machineID) {
	const product = productForRegion(regionId);
	if (product === void 0) throw new Error(`dsh-connect-qoder: no device-login product for region ${regionId}`);
	const pkce = createPkce();
	return {
		region: product.region,
		verifier: pkce.verifier,
		challenge: pkce.challenge,
		nonce: randomUUID(),
		machineID: machineID ?? randomUUID()
	};
}
/**
* `{authBase}/device/selectAccounts?…` — the page the user is sent to.
*
* Every parameter goes through `URLSearchParams` rather than a template string:
* the challenge is derived material and the nonce is caller-supplied, and one
* unescaped `&` would silently truncate the query into a request for a
* different login.
*/
function buildAuthUrl(product, session) {
	const query = new URLSearchParams({
		challenge: session.challenge,
		challenge_method: "S256",
		nonce: session.nonce,
		machine_id: session.machineID,
		client_id: product.clientId
	});
	return `${product.authBase}${DEVICE_SELECT_PATH}?${query.toString()}`;
}
/**
* `{openApiBase}/api/v1/deviceToken/poll?…` — where the credential arrives, if
* it can.
*
* Note the host: `openApiBase`, NOT `authBase`. The two differ in both regions
* (`qoder.cn` vs `openapi.qoder.com.cn`), so a poll built against the auth host
* is a live failure mode rather than a theoretical one, and a test asserts each
* region polls its own host.
*
* The verifier goes out in the clear, which is what PKCE prescribes: it is
* bound to the challenge the user approved, and it is the only proof that this
* caller is the one that started the attempt. It must still never be logged —
* whoever holds it can claim the pending credential.
*/
function buildPollUrl(product, session) {
	const query = new URLSearchParams({
		nonce: session.nonce,
		verifier: session.verifier,
		challenge_method: "S256"
	});
	return `${product.openApiBase}${POLL_PATH}?${query.toString()}`;
}
/** The first key that holds a non-empty string, or `''`. */
function readString(record, keys) {
	for (const key of keys) {
		const candidate = record[key];
		if (typeof candidate === "string" && candidate !== "") return candidate;
	}
	return "";
}
/**
* A timestamp as epoch ms, or `undefined` when the value carries none.
*
* Three forms arrive in practice and all three are accepted: epoch ms (the
* vault's own shape), epoch seconds (what the platform mints — read as
* milliseconds, `1750000000` is 1970), and an ISO-8601 string (qoder.cn answered
* one, and the desktop app's `auth.v1.dat` stores one). The alternative to
* accepting all three is a perfectly good credential whose `expiresAt` reads as
* `0` — i.e. permanently expired — because the envelope picked a unit this
* parser did not know.
*
* The 1e12 threshold is the discriminator: no second-based timestamp in this
* system's lifetime reaches it, and no millisecond one is below it.
*/
function asEpochMs(value) {
	if (typeof value === "number") {
		if (!Number.isFinite(value) || value <= 0) return void 0;
		return value < 0xe8d4a51000 ? value * 1e3 : value;
	}
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (trimmed === "") return void 0;
		const numeric = Number(trimmed);
		if (Number.isFinite(numeric) && numeric > 0) return numeric < 0xe8d4a51000 ? numeric * 1e3 : numeric;
		const parsed = Date.parse(trimmed);
		return Number.isFinite(parsed) ? parsed : void 0;
	}
}
/** The first key that holds a readable timestamp, or `0`. */
function readEpochMs(record, keys) {
	for (const key of keys) {
		const converted = asEpochMs(record[key]);
		if (converted !== void 0) return converted;
	}
	return 0;
}
/**
* Read one response envelope into a payload, or `undefined` when it carries no
* access token at all.
*
* Two envelopes arrive here and they are NOT the same shape: the poll response
* calls the access token `token` and carries `user_id`, while the refresh
* response calls it `device_token`, carries six fields and no uid. Every field
* is therefore a spelling LIST, and a field that is absent becomes `''`/`0`
* rather than `undefined` — a caller that signs a request with these must never
* send the literal string "undefined" (`docs/history` records that exact
* incident).
*
* `undefined` means "no credential here", which for a poll is the ordinary
* "not approved yet" state; a caller must not confuse it with a body it could
* not read (see the outcome types below).
*
* Never throws, on any input, including the hostile ones: it is fed a network
* body, and a body may be a Proxy with a throwing accessor as easily as it may
* be a string.
*/
function parseDeviceTokenPayload(value) {
	try {
		if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
		const record = value;
		const token = readString(record, [
			"token",
			"device_token",
			"access_token"
		]);
		if (token === "") return void 0;
		return {
			token,
			refreshToken: readString(record, ["refresh_token", "refreshToken"]),
			expiresAt: readEpochMs(record, ["expires_at", "expiresAt"]),
			refreshTokenExpiresAt: readEpochMs(record, ["refresh_token_expires_at", "refreshTokenExpiresAt"]),
			userID: readString(record, ["user_id", "userId"]),
			name: readString(record, ["user_name", "userName"]),
			email: readString(record, ["email", "user_email"])
		};
	} catch {
		return;
	}
}
/** A string field of the rotation, or the original when the rotation has none. */
function keepText(original, rotated) {
	return rotated === "" ? original : rotated;
}
/**
* A timestamp of the rotation, or the original when the rotation has none.
*
* `> 0`, not `!== ''`: `parseDeviceTokenPayload` answers `0` for a field the
* response omitted, and a rule that only skips empty strings would overwrite a
* live expiry with `0` — turning a perfectly good credential into one that
* reads as expired. Same loss as the uid trap below, arriving from the other
* side.
*/
function keepStamp(original, rotated) {
	return rotated > 0 ? rotated : original;
}
/**
* Overlay a rotation onto the credential it rotated — never replace it.
*
* This is not a stylistic choice, it is the whole point of `refreshOnce`, and it
* is measured on both regions. A refresh response carries six fields
* (`created_at`, `device_token`, `expires_at`, `refresh_token`,
* `refresh_token_expires_at`, `token_type`), renames the access token to
* `device_token`, and does NOT carry `user_id`. The credential's uid is
* encrypted into the request signature (`authHeaders` in `upstream.ts`), so a
* credential rebuilt from the response alone signs an empty uid and the gateway
* answers `403 {"code":"101","message":"Signature invalid"}` — exactly what the
* probe measured before `121805c` taught it to merge, and what would reproduce
* verbatim the moment this gets wired into the host.
*
* The fields are listed one by one rather than looped over with a key cast: a
* loop would let a field added to the payload later be silently dropped from the
* merge (or silently carried over), and this is the one function in the file
* where being explicit is the point.
*/
function mergeRotation(original, rotated) {
	return {
		token: keepText(original.token, rotated.token),
		refreshToken: keepText(original.refreshToken, rotated.refreshToken),
		expiresAt: keepStamp(original.expiresAt, rotated.expiresAt),
		refreshTokenExpiresAt: keepStamp(original.refreshTokenExpiresAt, rotated.refreshTokenExpiresAt),
		userID: keepText(original.userID, rotated.userID),
		name: keepText(original.name, rotated.name),
		email: keepText(original.email, rotated.email)
	};
}
/**
* Parse a response body, contributing nothing but its shape.
*
* The two failures are named literals and the exception is not forwarded: V8
* embeds a slice of its input in a `JSON.parse` syntax error, so rethrowing or
* quoting one would print part of a live device token — which is how the probe
* destroyed its own first successful run (`43edbd7`). The byte count is
* deliberately not reported either; the caller has the status, and the probe is
* the instrument that prints shapes.
*/
function readJsonBody(text) {
	if (text.trim() === "") return {
		ok: false,
		name: "EmptyBody"
	};
	try {
		return {
			ok: true,
			value: JSON.parse(text)
		};
	} catch {
		return {
			ok: false,
			name: "UnparseableBody"
		};
	}
}
/**
* A stable name for a thrown failure.
*
* An aborted request arrives as `TimeoutError` and a dead socket as `TypeError`;
* both names are more use to the caller than a generic word. Only the NAME
* travels: an error's message can quote the request URL, and the poll URL
* carries the verifier.
*/
function errorName(error) {
	if (typeof error === "object" && error !== null) {
		const candidate = error.name;
		if (typeof candidate === "string" && candidate !== "") return candidate;
	}
	return "UnknownError";
}
/**
* One poll request.
*
* The outcome vocabulary is the measured one, and each branch is a decision:
*
* - **404 is `pending`, not an error.** It is "this nonce has not been approved
*   yet" — the healthy answer every second until the user clicks. Reporting it
*   as a failure is what would turn an ordinary sign-in into "登录流程坏了".
* - **A 2xx whose envelope carries no token is `pending` too**, including an
*   empty body: the service answers before authorisation lands, and the 300 s
*   budget the caller owns is the backstop for a body that never gains a token.
* - **Any other non-2xx is `failed` with the status in the name** (`Http500`).
*   A refused clientId or a broken gateway must reach the user as a failure
*   (red line 1: no silent failure branches), never as "you have not signed in".
* - **A non-empty body that will not parse is `failed`, not `pending`.** `{}` is
*   an envelope with no token yet; `"<html>"` is the protocol having changed,
*   and retrying it for the full budget would report the user's approval as the
*   problem. The probe — the measuring instrument — stops hard on the same
*   distinction.
* - **Nothing rejects.** The caller is a host loop that has to be able to say
*   something to the user even when the network is gone, so a throw is an
*   outcome here like any other.
*
* @param fetchImpl - injectable so tests (and a future probe) never touch the
*   network; defaults to the global `fetch`.
*/
async function pollOnce(product, session, fetchImpl = fetch) {
	try {
		const response = await fetchImpl(buildPollUrl(product, session), {
			method: "GET",
			headers: { Accept: "application/json" },
			redirect: "error",
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
		});
		if (response.status === 404) return { kind: "pending" };
		if (response.status < 200 || response.status >= 300) return {
			kind: "failed",
			name: `Http${response.status}`
		};
		const read = readJsonBody(await response.text());
		if (!read.ok) return read.name === "EmptyBody" ? { kind: "pending" } : {
			kind: "failed",
			name: read.name
		};
		const payload = parseDeviceTokenPayload(read.value);
		return payload === void 0 ? { kind: "pending" } : {
			kind: "authorized",
			payload
		};
	} catch (error) {
		return {
			kind: "failed",
			name: errorName(error)
		};
	}
}
/**
* One refresh request.
*
* @param machineID - the machine identity to sign the request with. It is a
*   parameter rather than a field of `current` because the payload has none: the
*   poll envelope never publishes a machine id, so the only source of it is the
*   session that produced the credential. Pass that session's `machineID`; a
*   different value signs a request the platform did not issue.
*
* The refusals mean different things and are kept apart:
*
* - **401/403 is `expired`**, not a failure. It is the one refusal with a
*   specific user action attached — the refresh token is gone, sign in again —
*   and a caller that cannot tell it from a 500 will keep retrying a credential
*   that can never work.
* - **Any other non-2xx is `failed`** with the status in the name, and a
*   transport throw or an unreadable body is `failed` with the error's name or a
*   stable literal. Neither rejects.
* - **Success is `{ merged }`**, never the parsed response — see
*   {@link mergeRotation} for why that distinction cost a 403 on both regions.
*/
async function refreshOnce(product, current, machineID, fetchImpl = fetch) {
	if (current.refreshToken === "") return { kind: "expired" };
	try {
		const response = await fetchImpl(`${product.openApiBase}${REFRESH_PATH}`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json"
			},
			body: JSON.stringify({
				refresh_token: current.refreshToken,
				machine_id: machineID
			}),
			redirect: "error",
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
		});
		if (response.status === 401 || response.status === 403) return { kind: "expired" };
		if (response.status < 200 || response.status >= 300) return {
			kind: "failed",
			name: `Http${response.status}`
		};
		const read = readJsonBody(await response.text());
		if (!read.ok) return {
			kind: "failed",
			name: read.name
		};
		const rotated = parseDeviceTokenPayload(read.value);
		if (rotated === void 0) return {
			kind: "failed",
			name: "NoToken"
		};
		return {
			kind: "refreshed",
			payload: mergeRotation(current, rotated)
		};
	} catch (error) {
		return {
			kind: "failed",
			name: errorName(error)
		};
	}
}

//#endregion
//#region src/host/device-credential.ts
/**
* How long a refused (or failed) renewal is honoured before trying again.
*
* This exists because `CredentialCache.resolve` runs on every request that
* reaches the gateway. Without a window, a refresh token the service has
* revoked would be re-POSTed once per chat turn — a rate-limit ending in a
* lockout. The value matches `UNWRAP_FAILURE_TTL_MS` in `credentials.ts`, which
* memoises the other unrecoverable failure in this same chain for the same
* reason and the same length of time.
*/
const REFRESH_FAILURE_TTL_MS = 6e4;
/**
* The `appName` a device credential reports.
*
* `LoadedCredential.appName` names where a credential was found — the PAT source
* puts the environment variable's name there. There is no directory to name
* here, so it names the source itself, which is what a diagnostic reader wants
* to see.
*/
const DEVICE_APP_NAME = "device-login";
/**
* The reason a `save-failed` state reports.
*
* Stable text, because the panel renders it verbatim as the note's detail —
* like every other reason in this module, changing it is a copy change, not a
* refactor.
*/
const DEVICE_SAVE_FAILED_REASON = "the renewed credential could not be written to its file";
/** The vault record as the request-signing payload the service expects. */
function payloadOf(record) {
	return {
		token: record.token,
		refreshToken: record.refreshToken,
		expiresAt: record.expiresAt,
		refreshTokenExpiresAt: record.refreshTokenExpiresAt,
		userID: record.userID,
		name: record.name,
		email: record.email
	};
}
/** The payload back into a record. `savedAt` moves because the file changed. */
function recordOf(payload, machineID, savedAt) {
	return {
		token: payload.token,
		refreshToken: payload.refreshToken,
		expiresAt: payload.expiresAt,
		refreshTokenExpiresAt: payload.refreshTokenExpiresAt,
		userID: payload.userID,
		name: payload.name,
		email: payload.email,
		machineID,
		savedAt
	};
}
/**
* The record as the shape the rest of the plugin already consumes.
*
* Structural, not a conversion: `LoadedCredential` is what every downstream
* layer reads, and a device credential differs from an app credential only in
* its `source` tag and in who can renew it.
*/
function credentialOf(record, region, now) {
	return {
		region,
		appName: DEVICE_APP_NAME,
		userID: record.userID,
		name: record.name,
		email: record.email,
		token: record.token,
		refreshToken: record.refreshToken,
		refreshTokenExpiresAt: record.refreshTokenExpiresAt,
		expiresAt: record.expiresAt,
		expired: Number(record.expiresAt) <= now,
		userType: "",
		userTag: "",
		machineID: record.machineID,
		source: "device",
		plan: void 0,
		usage: void 0
	};
}
/**
* One region's device credential, renewed when its access token has lapsed.
*/
var DeviceCredentialSource = class {
	region;
	vault;
	fetchImpl;
	now;
	logger;
	last = { state: "none" };
	/** When a renewal was last refused/failed, and what the service said. */
	refusedAt;
	refusedReason = "";
	/**
	* The last record this process renewed but could not write to disk.
	*
	* Exists for `save-failed`: the disk copy is already spent, so without this
	* every cache miss after the failed write would re-post the refresh — a
	* request storm over a storage problem. Cleared when a write lands, when the
	* disk shows bytes at least as new, or when a sign-out deletes the file.
	*/
	memRecord;
	constructor({ region, vault, fetchImpl, now = () => Date.now(), logger }) {
		this.region = region;
		this.vault = vault;
		this.fetchImpl = fetchImpl;
		this.now = now;
		this.logger = logger;
	}
	/** What the panel should say; reflects the most recent {@link load}. */
	get status() {
		return this.last;
	}
	/**
	* Forget the failure window, so the next `load` tries again.
	*
	* Called on the same signal that invalidates the credential cache (a request
	* came back rejected). Without it, a credential the user has just fixed by
	* signing in again would stay invisible for the rest of the window — the same
	* mistake, from the other side, that the window exists to prevent.
	*/
	retry() {
		this.refusedAt = void 0;
		this.refusedReason = "";
	}
	/**
	* Store what a completed sign-in obtained, and make it usable at once.
	*
	* Rejects when the file could not be written. The caller is the sign-in flow,
	* which turns that into "signed in but could not store it" — the alternative,
	* resolving `undefined` and calling it a success, would hand the user a
	* session that silently vanishes at the next restart.
	*/
	async remember(payload, machineID) {
		const record = recordOf(payload, machineID, this.now());
		if (!await this.vault.update(() => record)) throw new Error(`the credential file ${this.vault.path} could not be written`);
		this.retry();
		this.last = { state: "ok" };
	}
	/**
	* Delete the saved credential: this machine is signed out.
	*
	* Goes through the vault's serialised `clear` rather than around it, so a
	* renewal that has already read the record cannot write it back after the
	* sign-out lands — the resurrection the vault's chain exists to prevent.
	*
	* Answers whether the file is gone. `false` is reported as a failure rather
	* than smoothed over: telling someone they are signed out while the
	* credential is still on disk is a false confirmation, and it is also what
	* would make the next resolve quietly sign them back in.
	*/
	async forget() {
		this.retry();
		const cleared = await this.vault.clear();
		if (cleared) {
			this.memRecord = void 0;
			this.last = { state: "none" };
		}
		return cleared;
	}
	/**
	* The credential to sign a request with, or `undefined` when this machine has
	* none it can use.
	*
	* Never throws: every failure has a state the panel can render, and a
	* credential chain that throws would turn a login problem into a broken
	* region. A renewal that the service refused is reported as such rather than
	* silently retried, because "sign in again" and "we could not reach the
	* service" are different instructions.
	*/
	async load() {
		const read = this.vault.readResult();
		if (read.kind === "absent") {
			this.memRecord = void 0;
			this.last = { state: "none" };
			return;
		}
		if (read.kind === "unreadable") {
			this.last = {
				state: "unreadable",
				reason: "the saved credential file could not be read"
			};
			return;
		}
		if (read.kind === "unrecognised") {
			this.last = {
				state: "unreadable",
				reason: "the saved credential file was written by a different version of this plugin"
			};
			return;
		}
		const record = read.record;
		const now = this.now();
		if (this.memRecord !== void 0 && Number(record.savedAt) >= Number(this.memRecord.savedAt)) this.memRecord = void 0;
		if (this.memRecord !== void 0 && Number(this.memRecord.expiresAt) > now) {
			this.last = {
				state: "save-failed",
				reason: DEVICE_SAVE_FAILED_REASON
			};
			return credentialOf(this.memRecord, this.region, now);
		}
		if (Number(record.expiresAt) > now) {
			this.last = { state: "ok" };
			return credentialOf(record, this.region, now);
		}
		if (!(Number(record.refreshTokenExpiresAt) > now)) {
			this.last = { state: "expired" };
			return;
		}
		if (this.refusedAt !== void 0 && now - this.refusedAt < 6e4) {
			this.last = {
				state: "refresh-failed",
				reason: this.refusedReason
			};
			return;
		}
		const product = productForRegion(this.region);
		if (product === void 0) {
			this.last = {
				state: "unreadable",
				reason: `no device-login product is known for ${this.region}`
			};
			return;
		}
		const outcome = await refreshOnce(product, payloadOf(record), record.machineID, this.fetchImpl);
		if (outcome.kind === "expired") {
			this.last = { state: "expired" };
			return;
		}
		if (outcome.kind === "failed") {
			this.refusedAt = now;
			this.refusedReason = outcome.name;
			this.last = {
				state: "refresh-failed",
				reason: outcome.name
			};
			return;
		}
		const rotated = outcome.payload;
		const rotatedRecord = recordOf(rotated, record.machineID, this.now());
		let displaced = false;
		let superseded;
		const saved = await this.vault.update((current) => {
			if (current === null) {
				displaced = true;
				return null;
			}
			if (current.token !== record.token) {
				superseded = current;
				return current;
			}
			return rotatedRecord;
		});
		this.refusedAt = void 0;
		this.refusedReason = "";
		if (displaced) {
			this.memRecord = void 0;
			this.last = { state: "none" };
			return;
		}
		if (superseded !== void 0) {
			this.memRecord = void 0;
			if (Number(superseded.expiresAt) > now) {
				this.last = { state: "ok" };
				return credentialOf(superseded, this.region, now);
			}
			return;
		}
		if (!saved) {
			this.memRecord = rotatedRecord;
			this.logger?.warn?.("dsh-connect-qoder: renewed a device credential but could not store it; it is held in memory only and will not survive a restart");
			this.last = {
				state: "save-failed",
				reason: DEVICE_SAVE_FAILED_REASON
			};
			return credentialOf(rotatedRecord, this.region, now);
		}
		this.memRecord = void 0;
		this.last = { state: "ok" };
		return credentialOf(rotatedRecord, this.region, now);
	}
};

//#endregion
//#region src/host/throttle-store.ts
/**
* The on-disk exchange throttle.
*
* The throttle gate lives in `CredentialCache`; this is only its persistence,
* so a rate-limit window the platform stated is still honoured after a DSH
* restart rather than forgotten the moment the process dies. That matters
* because the lockout the window describes is a platform-side fact measured in
* wall-clock time, not a fact about this process: forget it across a restart
* and the first poll walks straight back into a lockout still in force, which
* is precisely the runaway the gate exists to stop.
*
* Split from `credential-cache.ts` for the same reason the catalog store was:
* it depends only on `node:fs`/`node:path` once the path is injected, so it can
* be tested against a real temporary directory, and the atomicity of its write
* must be checked on the platform rather than assumed.
*
* Persistence policy, and the two kinds it distinguishes:
*
* - a **rate-limit** window (`parked: false`, an `until` in the future) is
*   written and read back: it is time-boxed and a restart must not resume the
*   re-probe before the platform's own clock says the window has closed;
* - a **parked** refusal (a dead credential — `parked: true`, no deadline) is
*   deliberately NOT persisted. It is released only by a deliberate re-read
*   (`invalidate`), and a restart is treated as exactly that: a fresh process
*   gets one exchange attempt so a corrected env PAT is picked up. Keeping the
*   park in memory is still enough to stop the within-process poll loop, which
*   is the failure the sibling plugin's fix was written against.
*
* The record carries only `{ kind, parked, until, attempt }` — never a token.
*
* @module dsh-connect-qoder/throttle-store
*/
/** On-disk format this reader accepts; other versions are discarded. */
const THROTTLE_FORMAT_VERSION = 1;
/**
* A {@link ThrottleStore} backed by one JSON file, written atomically.
*
* Reads and writes never throw out of this class: a store that cannot be
* reached must degrade to "no persisted throttle", not wedge credential
* resolution. A failure is logged and otherwise ignored, because the in-memory
* gate in `CredentialCache` already holds the wait for this process — the file
* is only an extension of it across restarts.
*/
var FileThrottleStore = class {
	/** Where the throttle file lives. */
	path;
	/** The wall clock, for dropping an expired window on read. */
	now;
	/** Optional logger for a failed write. */
	logger;
	constructor({ path, now = () => Date.now(), logger }) {
		this.path = path;
		this.now = now;
		this.logger = logger;
	}
	/**
	* Read the persisted rate-limit window.
	*
	* Returns `null` (rather than a throttle) for anything that is not a live,
	* non-parked window: no file, a damaged file, a foreign version, a parked
	* refusal, or a window that has already closed. Each of those means "nothing
	* to honour here", which is the safe answer for a lock this is only extending
	* across restarts.
	*/
	read() {
		if (!existsSync(this.path)) return null;
		try {
			const parsed = JSON.parse(readFileSync(this.path, "utf8"));
			if (parsed?.version !== 1) return null;
			if (parsed.parked !== false) return null;
			const until = Number(parsed.until);
			if (!Number.isFinite(until)) return null;
			if (until <= this.now()) return null;
			const attempt = Number(parsed.attempt);
			return {
				kind: typeof parsed.kind === "string" ? parsed.kind : "rate-limit",
				parked: false,
				until,
				attempt: Number.isFinite(attempt) && attempt > 0 ? attempt : 1
			};
		} catch {
			return null;
		}
	}
	/**
	* Persist a rate-limit window.
	*
	* A parked refusal is not written at all (see the persistence policy): the
	* next restart is meant to be free to try once. Only a future window is
	* worth keeping across the restart.
	*/
	write(throttle) {
		if (throttle.parked) return;
		if (throttle.until === null || throttle.until <= this.now()) return;
		const tmp = `${this.path}.tmp`;
		try {
			mkdirSync(dirname(this.path), { recursive: true });
			writeFileSync(tmp, JSON.stringify({
				version: 1,
				kind: throttle.kind,
				parked: throttle.parked,
				until: throttle.until,
				attempt: throttle.attempt
			}, null, 2), "utf8");
			renameSync(tmp, this.path);
		} catch (error) {
			try {
				if (existsSync(tmp)) unlinkSync(tmp);
			} catch {}
			this.logger?.warn?.(`dsh-connect-qoder: could not save exchange throttle ${this.path}`, error);
		}
	}
	/**
	* Remove the persisted window.
	*
	* Called after a deliberate re-read and after a successful exchange. An
	* absent file is a no-op, not an error.
	*/
	clear() {
		try {
			if (existsSync(this.path)) unlinkSync(this.path);
		} catch (error) {
			this.logger?.warn?.(`dsh-connect-qoder: could not clear exchange throttle ${this.path}`, error);
		}
	}
};

//#endregion
//#region src/host/settings-save.ts
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
/**
* The fields a save may write, and the merge rule each one uses.
*
* `regions` shape (`{ [regionId]: [...ids] }`): merge the incoming region keys
* into the field's authoritative value, so saving one region's allow-list can
* never delete the other region's. `whole` shape: replace the field outright
* (the card always posts its complete value).
*/
const SAVE_FIELDS = {
	enabledModelIds: "regions",
	enabledRegions: "regions",
	imageOverrides: "whole",
	useMaximumContextWindow: "whole"
};
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
function findSettingsRow(rows, candidates) {
	for (const candidate of candidates) {
		const exact = rows.find((entry) => String(entry.ns) === candidate);
		if (exact !== void 0) return exact;
	}
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
function settingsNamespaceOf(ctx, fallback) {
	const id = ctx?.fiber?.entry?.options?.id;
	return typeof id === "string" && id !== "" ? id : fallback;
}
/**
* Merge an incoming value with what the document already holds.
*
* @param shape - `'regions'` or `'whole'`, from {@link SAVE_FIELDS}.
* @param incoming - the value the card posted.
* @param stored - the document's current value, already unwrapped.
* @returns the value to write.
*/
function mergeForShape(shape, incoming, stored) {
	if (shape !== "regions") return incoming;
	const base = stored !== null && typeof stored === "object" ? stored : {};
	const target = incoming !== null && typeof incoming === "object" ? incoming : {};
	return {
		...base,
		...target
	};
}
/**
* Read a field back out of a row, unwrapping a volatile reference.
*
* @param row - a row from `settings.describe()`.
* @param field - the field name.
* @returns the value the host actually holds.
*/
function readField(row, field) {
	const value = row?.value;
	if (value === null || typeof value !== "object") return void 0;
	return unwrapVolatile(value[field]);
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
async function applySettingsSave({ settings, field, value, candidates, equals }) {
	if (typeof field !== "string" || !Object.hasOwn(SAVE_FIELDS, field)) return {
		status: 400,
		body: { error: `field must be one of ${Object.keys(SAVE_FIELDS).join(", ")}` }
	};
	const shape = SAVE_FIELDS[field];
	const rows = settings.describe();
	const row = findSettingsRow(rows, candidates);
	if (row === void 0) return {
		status: 503,
		body: { error: `${candidates.join("/")} namespace missing from describe(); known: ${rows.map((entry) => String(entry.ns)).join(", ")}` }
	};
	const merged = mergeForShape(shape, value, readField(row, field));
	const ns = String(row.ns);
	await settings.mutate(ns, [{
		op: "set",
		path: [field],
		value: merged
	}], void 0);
	const readBack = readField(settings.describe().find((entry) => String(entry.ns) === row.ns), field);
	if (!(equals ?? deepEqual)(readBack, merged)) return {
		status: 200,
		body: {
			ok: false,
			errorName: "read-back-mismatch",
			error: "settings.mutate returned but the value did not land in the document",
			value: merged,
			readBack
		}
	};
	return {
		status: 200,
		body: {
			ok: true,
			value: merged,
			readBack
		}
	};
}
/**
* The `__save` route's verdict, factored out so the service-absent case is
* assertable in a test.
*
* {@link applySettingsSave} assumes a live settings service. This is the OTHER
* failure: the host has no `settings` service for this fiber, so there is
* nothing to write through. It must answer 503 — a body the client can read —
* and not 404: the client tells the two apart and refuses to paper over a 404
* with an unverified snapshot, which is what showed a false "已保存" before the
* route was registered under `webServer` alone. See
* docs/issues/06-save-route-and-false-saved.md
*
* @param settings - the settings service, or `undefined`/`null` when absent.
* @param rawBody - the parsed request body; `field` and `value` are read off it
*   as `unknown`, exactly as the handler does.
* @param options.candidates - the namespaces to try, in priority order.
* @param options.equals - deep equality, injected so the module stays peer-free.
* @returns `{ status, body }` — the HTTP status and JSON payload the route sends.
*/
async function saveFieldOutcome(settings, rawBody, { candidates, equals }) {
	if (settings === void 0 || settings === null) return {
		status: 503,
		body: { error: "settings service unavailable to this fiber" }
	};
	const posted = rawBody ?? {};
	return applySettingsSave({
		settings,
		field: posted.field,
		value: posted.value,
		candidates,
		equals
	});
}
/**
* A structural deep-equality, used when the caller injects none.
*
* `node:util`'s `isDeepStrictEqual` is the real implementation used in
* production; this exists so the module can be exercised without importing it,
* and it is only ever reached when a test omits `equals`.
*/
function deepEqual(a, b) {
	if (a === b) return true;
	if (typeof a !== typeof b) return false;
	if (a === null || b === null) return false;
	if (typeof a !== "object") return Number.isNaN(a) && Number.isNaN(b);
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	const left = a;
	const right = b;
	const aKeys = Object.keys(left);
	const bKeys = Object.keys(right);
	if (aKeys.length !== bKeys.length) return false;
	return aKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && deepEqual(left[key], right[key]));
}

//#endregion
//#region src/host/single-flight.ts
/**
* Wrap `task` so only one run of it is active at a time.
*
* Generic over the task's arguments and result, so a caller keeps the real
* signature: `createSingleFlight((force) => …)` still takes a boolean and still
* answers with the catalog, rather than degrading to `(…args: any[]) => any`
* and throwing that away at every call site.
*
* Note the contract this implies for JOINERS: a caller that arrives while a run
* is active joins it and receives THAT run's result, whatever arguments the
* joiner passed. The arguments of the run that started first win. A caller for
* which that is wrong — because its own argument changes what the answer must
* be — has to {@link SingleFlight.reset} first, or hold its own short-circuit.
*
* @param task - the async operation; receives the starting caller's arguments.
* @returns a function with `task`'s call signature, plus `reset`. Concurrent
*   calls share the first call's promise; once a run settles, the next call
*   starts a fresh one with its own arguments. A rejection is handed to every
*   joined caller and clears the slot, so a failed run never blocks future
*   ones.
*/
function createSingleFlight(task) {
	/** The active run, if any. */
	let inFlight = void 0;
	const start = (...args) => {
		if (inFlight !== void 0) return inFlight;
		const run = (async () => task(...args))().finally(() => {
			if (inFlight === run) inFlight = void 0;
		});
		inFlight = run;
		return run;
	};
	return Object.assign(start, { reset: () => {
		inFlight = void 0;
	} });
}

//#endregion
//#region src/host/catalog-store.ts
/**
* The on-disk catalog cache.
*
* Split out of lib/index.js for two reasons. It depends on nothing but `node:fs`
* and `node:path` once the path is injected, so it can be tested against a real
* temporary directory — and the atomicity claim in `save()` is exactly the kind
* of thing that must be checked on the platform it runs on rather than assumed.
* A restart must not drop the user to an empty model group when a good catalog
* was fetched minutes earlier, and a temporary upstream failure must not either.
*
* Only model metadata is stored here — never a token.
*
* @module dsh-connect-qoder/catalog-store
*/
/** How long a fetched catalog stays fresh before it is refetched. */
const CATALOG_TTL_MS$1 = 18e5;
/** On-disk format this reader accepts; other versions are discarded. */
const CATALOG_FORMAT_VERSION = 1;
var CatalogStore = class {
	/** Where the catalog file lives. */
	path;
	/** How long a fetch stays fresh, in ms. */
	ttlMs;
	/** Optional logger for a failed save. */
	logger;
	/**
	* Parsed catalog entries, unvalidated.
	*
	* `unknown[]` rather than `any[]`, to match `replace()`'s own parameter and
	* the fact that the array comes straight off `JSON.parse` of a file this
	* plugin wrote earlier — so it is exactly as trustworthy as the disk. No
	* caller reads into an entry without narrowing: the roster is projected
	* through `readModelCatalogShape`, which takes `unknown`.
	*/
	entries;
	/** Epoch ms of the last successful fetch. */
	fetchedAt;
	/** The error from the last failed `save()`, or `undefined`. */
	lastSaveError;
	/**
	* @param options.path - where the catalog file lives.
	* @param options.ttlMs - how long a fetch stays fresh; injectable for tests.
	* @param options.logger - optional, for a failed save.
	*/
	constructor({ path, ttlMs = CATALOG_TTL_MS$1, logger }) {
		this.path = path;
		this.ttlMs = ttlMs;
		this.logger = logger;
		this.entries = [];
		this.fetchedAt = 0;
		/**
		* The error from the last failed `save()`, or `undefined`.
		*
		* Its comment used to promise "so a caller can report it", and no caller
		* did: reporting goes through `logger.warn` inside `save()`. The field was
		* kept rather than deleted for two reasons — it is asserted by
		* `test/catalog-store.test.js` as the observable proof that a failed write
		* was noticed at all, and it distinguishes "the last save worked" from
		* "nothing has ever tried to save", which a timestamp alone cannot. The
		* comment is corrected to say what it actually is: state, not a channel.
		*
		* @type {unknown}
		*/
		this.lastSaveError = void 0;
		this.load();
	}
	load() {
		const tmp = `${this.path}.tmp`;
		try {
			if (existsSync(tmp)) unlinkSync(tmp);
		} catch {}
		if (!existsSync(this.path)) return;
		try {
			const parsed = JSON.parse(readFileSync(this.path, "utf8"));
			if (parsed?.version !== 1) return;
			if (!Array.isArray(parsed.entries)) return;
			this.entries = parsed.entries;
			this.fetchedAt = Number(parsed.fetchedAt) || 0;
		} catch {}
	}
	save() {
		this.lastSaveError = void 0;
		const tmp = `${this.path}.tmp`;
		try {
			mkdirSync(dirname(this.path), { recursive: true });
			writeFileSync(tmp, JSON.stringify({
				version: 1,
				fetchedAt: this.fetchedAt,
				entries: this.entries
			}, null, 2), "utf8");
			renameSync(tmp, this.path);
		} catch (error) {
			this.lastSaveError = error;
			try {
				if (existsSync(tmp)) unlinkSync(tmp);
			} catch {}
			this.logger?.warn?.(`dsh-connect-qoder: could not save catalog ${this.path}`, error);
		}
	}
	/**
	* The roster as the readers want it: `CatalogEntry[]`.
	*
	* The store holds `unknown[]`, because `load()` parses a JSON file this
	* plugin wrote in an earlier run — the disk is exactly as trustworthy as the
	* last writer, and nothing re-validates it on read. The narrowing therefore
	* happens here, once, at the one boundary where a caller asks for the roster
	* in the shape the rest of the plugin speaks. `replace()` is fed by
	* `normalizeEntry` (see the refresh path), which is what actually guarantees
	* `id`/`key`/`name`; a hand-edited cache file is the one way a malformed row
	* reaches a reader, and it fails the same way it did before this change.
	*/
	current() {
		return this.entries;
	}
	fresh(now = Date.now()) {
		return now - this.fetchedAt < this.ttlMs;
	}
	replace(entries, now = Date.now()) {
		this.entries = entries;
		this.fetchedAt = now;
		this.save();
	}
};

//#endregion
//#region src/host/roster-seen-store.ts
/**
* When each model in a region's catalog was FIRST seen — this plugin's OWN
* state file, one per region (`.qoder-roster-seen.<region>.json`), following
* the same per-region convention as the catalog cache.
*
* Why the history has to be persisted at all: Qoder's catalog rows carry no
* "listed since" fact (`display_name` / `key` / price fields and nothing
* else), so "this model is new to the user" is only knowable by diffing
* today's roster against a roster this plugin wrote down. In memory would do
* for one process; the marker has to survive restarts to be worth rendering.
*
* Semantics, stated once because the pill and the route read them:
*  - the FIRST ever write SEEDS: it records the roster as already seen
*    (stamped one window back) and announces nothing — an upgrade must not
*    tell every existing user that the whole roster is brand new;
*  - an id that leaves the roster is dropped, so a model that comes back later
*    counts as new again (a re-listing IS a change the user may want to see);
*  - "new" is a WINDOW, not a tick: an id first seen less than
*    {@link ROSTER_NEW_WINDOW_MS} ago stays new across reads, so the marker
*    does not vanish between two five-minute pill polls;
*  - a file whose shape/version this build does not know is REFUSED, not
*    stomped: reads answer "no history" and writes are refused, so an older
*    build can never silently reset a newer build's history. The marker
*    degrades to absent, never to wrong. A file that does not PARSE at all is a
*    different case and is rebuilt instead: garbage has no owner, and refusing
*    forever would disable the marker for the life of the install after one
*    truncated write;
*  - a roster larger than {@link ROSTER_SEEN_MAX_IDS} is a SHAPE-DRIFT guard,
*    not a queue: nothing is written and nothing is announced for its
*    duration. Evicting an id that is still in the live roster makes it look
*    unseen on the next read and re-announce, oscillating — a history file
*    that invents new models is worse than none.
*
* A failed read or write is not a failed route: the caller keeps serving rows
* and the marker is simply absent. That direction is deliberate (a marker is a
* suggestion, not a fact the panel needs), and the logger line is what keeps
* the degradation visible to a maintainer rather than silent.
*
* @module dsh-connect-qoder/roster-seen-store
*/
/** Shape version, bumped when the persisted form changes incompatibly. */
const ROSTER_SEEN_VERSION = 1;
/** Every persisted shape THIS build can read (the write-side whitelist). */
const KNOWN_ROSTER_SEEN_VERSIONS = [1];
/**
* How long a first sighting keeps reading as "new".
*
* Seven days: long enough that a user who opens the panel twice a week still
* catches it, short enough that a stale marker cannot outlive the model it
* announces. A shorter window is invisible to the weekly user; a longer one
* turns the marker into permanent furniture.
*/
const ROSTER_NEW_WINDOW_MS = 6048e5;
/**
* The largest roster one file will track.
*
* Qoder lists a handful of chat models per region today; the cap is a
* shape-drift guard, not a queue (see the module comment). It deliberately does
* NOT "keep the newest N".
*/
const ROSTER_SEEN_MAX_IDS = 200;
/**
* Read one persisted map, keeping only well-formed entries.
*
* A hand-edited or half-written file must not poison the answer: a non-numeric
* stamp is dropped rather than coerced (a coerced `0` would read as "seen since
* 1970" and mark nothing new forever). An array is rejected like any other
* unrecognised shape — its numeric indices would otherwise become model ids.
* @param raw - the persisted or posted value.
* @returns the usable entries (possibly empty).
*/
function normalizeRosterSeen(raw) {
	const source = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
	const seen = {};
	for (const [id, stamp] of Object.entries(source)) {
		if (id === "" || typeof stamp !== "number" || !Number.isFinite(stamp) || stamp <= 0) continue;
		seen[id] = stamp;
	}
	return seen;
}
var RosterSeenStore = class {
	/** Where the history file lives. */
	path;
	/** Optional logger for a refused or failed write. */
	logger;
	/** The loaded map, or `null` when this store has no usable history. */
	seen;
	/**
	* The file exists but this build cannot read its shape. Set on load and
	* never cleared for the life of this instance: the file belongs to a build
	* that knows more than this one, and stomping it would reset that build's
	* history (see the module comment).
	*/
	refused;
	/** The error from the last failed save, or `undefined`. */
	lastSaveError;
	constructor({ path, logger }) {
		this.path = path;
		this.logger = logger;
		this.seen = null;
		this.refused = false;
		this.lastSaveError = void 0;
		this.load();
	}
	/** Read the file once, at construction; a crash mid-save leaves a `.tmp` sibling to clean. */
	load() {
		const tmp = `${this.path}.tmp`;
		try {
			if (existsSync(tmp)) unlinkSync(tmp);
		} catch {}
		if (!existsSync(this.path)) return;
		let parsed;
		try {
			parsed = JSON.parse(readFileSync(this.path, "utf8"));
		} catch (error) {
			this.seen = null;
			this.logger?.warn?.(`dsh-connect-qoder: could not read roster history ${this.path}; it will be rebuilt`, error);
			return;
		}
		if (parsed === null || typeof parsed !== "object" || !KNOWN_ROSTER_SEEN_VERSIONS.includes(Number(parsed.version))) {
			this.seen = null;
			this.refused = true;
			this.logger?.warn?.(`dsh-connect-qoder: roster history ${this.path} has an unknown shape; leaving it untouched`);
			return;
		}
		this.seen = normalizeRosterSeen(parsed.seen);
	}
	/** Whether this store has ever written a history (distinguishes seed from growth). */
	isSet() {
		return this.seen !== null;
	}
	/**
	* Persist one map atomically (temp file + rename), matching CatalogStore's
	* Windows-verified discipline. A failed write is recorded and logged; the
	* in-memory view stays correct for this process, and the next restart simply
	* re-seeds (announcing nothing), which is the safe direction.
	*/
	save(seen) {
		this.lastSaveError = void 0;
		const tmp = `${this.path}.tmp`;
		try {
			mkdirSync(dirname(this.path), { recursive: true });
			const payload = {
				version: 1,
				seen,
				updatedAt: (/* @__PURE__ */ new Date()).toISOString()
			};
			writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf8");
			renameSync(tmp, this.path);
		} catch (error) {
			this.lastSaveError = error;
			try {
				if (existsSync(tmp)) unlinkSync(tmp);
			} catch {}
			this.logger?.warn?.(`dsh-connect-qoder: could not save roster history ${this.path}`, error);
		}
	}
	/**
	* Record today's roster and answer which ids still read as new.
	*
	* One call both diffs and persists, because the two must agree: a caller that
	* diffed a cached map and wrote later could announce a model that another
	* read had already recorded.
	* @param ids - the FULL roster as the region's catalog just listed it.
	* @param nowMs - the clock (tests inject it).
	* @returns ids first seen inside the window, oldest first; empty on the
	*   seeding write, on an empty roster, on a refused file and on shape drift.
	*/
	note(ids, nowMs = Date.now()) {
		const list = Array.isArray(ids) ? ids.filter((id) => typeof id === "string" && id !== "") : [];
		const unique = [...new Set(list)];
		if (unique.length === 0) return { newIds: [] };
		const now = Number.isFinite(nowMs) ? nowMs : Date.now();
		if (this.refused) return { newIds: [] };
		const previous = normalizeRosterSeen(this.seen ?? {});
		const seeded = this.seen === null;
		const next = {};
		for (const id of unique) {
			const first = previous[id];
			next[id] = typeof first === "number" && first > 0 ? Math.min(first, now) : seeded ? now - ROSTER_NEW_WINDOW_MS : now;
		}
		if (Object.keys(next).length > 200) return { newIds: [] };
		if (seeded || Object.keys(previous).length !== Object.keys(next).length || Object.keys(next).some((id) => previous[id] !== next[id])) this.save(next);
		this.seen = next;
		return { newIds: seeded ? [] : Object.entries(next).filter(([, first]) => now - first < ROSTER_NEW_WINDOW_MS).sort((left, right) => left[1] - right[1]).map(([id]) => id) };
	}
	/**
	* The ids still inside the freshness window, oldest first — a read with no
	* write. Used by the models route, which must not touch the disk on a GET.
	*/
	fresh(nowMs = Date.now()) {
		if (this.seen === null) return [];
		const now = Number.isFinite(nowMs) ? nowMs : Date.now();
		return Object.entries(this.seen).filter(([, first]) => now - first < ROSTER_NEW_WINDOW_MS).sort((left, right) => left[1] - right[1]).map(([id]) => id);
	}
};

//#endregion
//#region src/host/domain.ts
/**
* The reasons a refresh can leave the catalog unrefreshed.
*
* The array is the source of truth and the type is DERIVED from it, rather than
* the two being written out separately. They had already drifted: the list was
* declared in `catalog-refresh.ts` and referenced nowhere, while this interface
* typed `reason` as a bare `string` — so the client's `refreshNoticeKey` fell
* through to its `default` (which says "temporary, try again") for anything it
* did not recognise, and a sixth reason could be introduced with no compile
* error and no failing test anywhere.
*
* `as const` is what makes the derivation work: it keeps the element type as the
* literal union rather than widening to `string`.
*/
const REFRESH_FAILURE_REASONS = [
	"credential",
	"no-credential",
	"fetch",
	"persist",
	"protocol-shape-changed",
	"daily-limit"
];

//#endregion
//#region src/host/catalog-refresh.ts
/**
* What one catalog refresh does with its answer.
*
* Pure decision logic extracted from `RegionRuntime.doRefreshCatalog`
* (lib/index.js), which a test checkout cannot import (Cordis peer deps).
*
* The rule: an answer is committed even when EMPTY — only a failure keeps the
* previous catalog, and each failure names its own reason. Committed is not
* persisted: a swallowed disk write is reported as a `persist` failure.
*
* @module dsh-connect-qoder/catalog-refresh
*/
/**
* Whether a refresh that finished after a dispose may still touch the runtime.
*
* `doRefreshCatalog` can be in flight when the fiber disposes — a plugin
* toggle, a hot reload, an upgrade. The fetch already had its answer, and the
* code that follows used to run anyway: `catalog.replace()` wrote to disk and
* emitted `llm/adapters-updated` on a fiber that had been torn down. Neither is
* catastrophic, and both are invisible — the failure shape this repository
* keeps finding. The `disposed` flag could not prevent it, because it was only
* consulted by the caller that installs the refresh TIMER, never by the refresh
* itself.
*
* Pure so it can be asserted without a Cordis context: the scenario is a boolean
* over two values, and both ways to get it wrong — checking before the await
* rather than after, or checking on the failure path only — are silent.
*
* @param runtime - the runtime, carrying `disposed`.
* @returns true when the runtime is gone and the result must be dropped.
*/
function isRefreshObsolete(runtime) {
	return runtime?.disposed === true;
}
/**
* Every reason the fold will record, as a value list plus a type guard.
*
* The list itself lives in `domain.ts` (the `RefreshFailure` interface needs it
* and cannot import from here), and this is the runtime half: the union type
* stops a bad reason at compile time for typed callers, and the guard stops one
* arriving from an untyped edge — a `CatalogOutcome` built from parsed JSON, or
* a test double.
*/
function refreshFailureReasonOf(reason) {
	return REFRESH_FAILURE_REASONS.includes(reason) ? reason : "fetch";
}
/**
* Fold one refresh's outcome into a runtime.
*
* Split by outcome so each branch can be asserted on its own, because the bug
* was a branch that did not exist at all.
*
* @param runtime - the target: `catalog` (anything with `replace`), plus the
*   optional `invalidate` hook the picker refreshes through.
* @param outcome - `{ ok: true, entries }` for an answer, or
*   `{ ok: false, reason, error }` for a failure.
* @returns `{ committed, previousFailure }` — whether the catalog was replaced,
*   and the failure marker that was displaced (so a caller that owns the
*   runtime can log the transition rather than only the end state).
*/
function applyCatalogOutcome(runtime, outcome) {
	const previousFailure = runtime.refreshFailed;
	if (outcome.ok !== true) {
		runtime.refreshFailed = {
			reason: refreshFailureReasonOf(outcome.reason),
			error: outcome.error
		};
		return {
			committed: false,
			previousFailure
		};
	}
	runtime.catalog?.replace(outcome.entries);
	const persistError = runtime.catalog?.lastSaveError;
	if (persistError !== void 0) runtime.refreshFailed = {
		reason: "persist",
		error: persistError
	};
	else runtime.refreshFailed = void 0;
	runtime.invalidate?.();
	return {
		committed: true,
		previousFailure
	};
}

//#endregion
//#region src/host/lifecycle.ts
/** Remember a route registration's release so dispose can undo it; the host's
* reclaim semantics are unreadable from a plugin, so only a callable result is
* released — correct under both host behaviours. Incident: docs/issues/13-lifecycle-dispose.md.
* @param sink - the array collecting releases for this fiber.
* @param result - whatever `webServer.register(...)` returned.
* @returns the release, or `undefined` when there was nothing to keep. */
function rememberRouteRelease(sink, result) {
	if (typeof result === "function") {
		sink.push(result);
		return result;
	}
}
/**
* Call every remembered release, tolerating a host that already reclaimed.
*
* All of them run even if one throws: a release that fails must not strand the
* ones after it, because those are the ones holding the ports. Disposal
* therefore never throws — it runs on the way out, and an exception there would
* surface as a failed fiber cleanup in a place the user cannot act on.
*
* @param sink - the array collected by {@link rememberRouteRelease}.
* @returns how many releases ran, for logging or a test.
*/
function releaseRoutes(sink) {
	let released = 0;
	for (const release of sink ?? []) try {
		release();
		released += 1;
	} catch {}
	if (Array.isArray(sink)) sink.length = 0;
	return released;
}

//#endregion
//#region src/host/route-mount.ts
/**
* Mounting the card routes, as one decision instead of seven.
*
* @module dsh-connect-qoder/route-mount
*/
/**
* Register a GROUP of routes that are meant to stand or fall together.
*
* The grouping is the point: a card that can read its account state but not
* re-read it or confirm it looks alive and silently does nothing on two of
* its buttons — the silent-failure shape of
* docs/issues/16-silent-failure-policy.md
*
* So a group is all-or-nothing: if any registration throws, every release the
* group already obtained is run before returning, and the caller is told the
* group failed. Each release runs inside its own `try`, so one that throws
* cannot strand the ones after it and leak them.
*
* @param registrar - the `webServer` service, already obtained by the caller.
* @param routes - the routes to mount, in order.
* @param sink - the array collecting releases for this fiber.
* @param logger - where the failure line goes; optional, like the host's.
* @returns what the attempt registered, or `[]` if the group failed.
*/
function mountRouteGroup(registrar, routes, sink, logger) {
	const paths = [];
	const taken = [];
	for (const route of routes) {
		let result;
		try {
			result = registrar.register({
				kind: "exact",
				path: route.path,
				handler: route.handler
			});
		} catch (error) {
			releaseTaken(taken, logger, route.path);
			logger?.warn?.(`dsh-connect-qoder: ${route.path} route unavailable; the routes mounted with it were released too`, error);
			return {
				registered: 0,
				paths: []
			};
		}
		rememberRouteRelease(taken, result);
		paths.push(route.path);
	}
	sink.push(...taken);
	return {
		registered: paths.length,
		paths
	};
}
/**
* Run the releases a failed group collected, without letting one strand the
* next.
*/
function releaseTaken(taken, logger, failedPath) {
	for (const release of taken) try {
		release();
	} catch (error) {
		logger?.warn?.(`dsh-connect-qoder: releasing the ${failedPath} route group's earlier registration failed`, error);
	}
	taken.length = 0;
}

//#endregion
//#region src/host/injected.ts
/**
* The one guard that converts an `inject` callback's promise into a type.
*
* Extracted from `activate()` (where it closed the loop over seven call sites)
* so the guarantee it encodes is a test rather than a comment — the same
* rule-by-extraction the repo already applies to `region-gate.ts`,
* `publish-regions.ts` and `route-mount.ts`.
*
* THE GUARANTEE
*
* `ctx.inject(['webServer'], cb)` is Cordis's way of saying "do not call `cb`
* until `webServer` exists" — so inside `cb` the service is present. That fact
* lives in the `inject` call rather than in the type of `webCtx.webServer`
* (which must stay optional: a Host without the service never runs this
* callback at all, and `apply` still has to compile for it).
*
* Rather than sprinkle `!` at the seven registrations, or `?.` on code that
* cannot be reached without the service, the guarantee is converted once per
* call here. The throw is unreachable under a correct Host; it exists so that
* a Host which fires the callback WITHOUT the service fails loudly at
* activation instead of registering routes into `undefined` — the silent
* shape red line 1 (AGENTS.md) forbids.
*
* @module dsh-connect-qoder/injected
*/
/**
* Return the injected service, or throw naming the service when the Host ran
* an `inject` callback without it.
*
* Only `undefined` is refused: the callers hand in values typed
* `T | undefined`, and a present-but-falsy service (a host that answers with
* `null`, say) is the host's own contract violation to keep, not this guard's
* to reinterpret — rewriting it here would hide the host's answer.
*/
function requireInjected(service, name) {
	if (service === void 0) throw new Error(`dsh-connect-qoder: ctx.inject ran for '${name}' without the service`);
	return service;
}

//#endregion
//#region src/host/dispose-order.ts
/**
* Undo one fiber's registrations, routes, runtimes and shims, in that order.
*
* The order is the whole content of this function. Three steps are load-bearing:
*
* 1. **The provider registrations go first** — they are the only thing a user
*    can see: until they are gone, DSH still offers two providers whose
*    loopback ports are about to close.
* 2. **The routes go before the runtimes are torn down** — a route left
*    reachable while its runtime is half-closed starts a shim and a refresh
*    interval nothing will ever clean up.
* 3. **`disposed` is set BEFORE the interval is cleared** — the interval is
*    installed from a `refreshCatalog().then` microtask, so clearing the timer
*    first lets a `then` running in between install a FRESH interval on a
*    runtime that no longer has one to clear: a zombie credential-resolution
*    loop that outlives the plugin.
*
* Background: docs/issues/13-lifecycle-dispose.md
*
* A disposal given a rejecting `close()` still finishes: `close()` is
* documented idempotent, swallows `ERR_SERVER_NOT_RUNNING`, and `allSettled`
* keeps one failed close from stranding the others — the port that failed to
* release is the host's to report, not something to throw over on the way out.
*
* @param deps - everything this needs; see {@link DisposeDeps}.
* @returns what was undone, for the caller's own logging.
*/
async function disposeFiber(deps) {
	deps.releaseAdapter?.();
	deps.releaseDirectory?.();
	const releasedRoutes = deps.releaseRoutes(deps.routeSink);
	for (const runtime of deps.runtimes) {
		runtime.disposed = true;
		runtime.refreshAbort?.abort();
		if (runtime.refreshTimer !== void 0) {
			deps.timers.clearInterval(runtime.refreshTimer);
			runtime.refreshTimer = void 0;
		}
	}
	await Promise.allSettled(deps.shims.map((shim) => shim.close()));
	return {
		releasedRoutes,
		runtimes: deps.runtimes.length,
		closed: deps.shims.length
	};
}
/**
* Release a region start that landed AFTER the fiber was disposed.
*
* A start joins the `started` list only once `await startRegion` resolves, so
* a start that was in flight when the fiber was torn down lands after
* `disposeFiber` has taken its snapshot of that list. Nothing else will ever
* release it: its shim's HTTP server keeps serving and its catalog interval
* keeps firing for the life of the process.
*
* The late entry gets the same treatment a normal one gets — marked dead
* BEFORE its interval is cleared, aborting whatever it had in flight, then its
* shim closed — but it touches nothing else: the provider registrations and
* the card routes belong to the fiber, and the fiber already released them.
*
* @param deps - the clock handles; see {@link DisposeDeps}.
* @param entry - the start that landed too late.
* @returns what was undone, for the caller's own logging.
*/
async function disposeLateEntry(deps, entry) {
	return disposeFiber({
		releaseAdapter: void 0,
		releaseDirectory: void 0,
		releaseRoutes: () => 0,
		routeSink: [],
		runtimes: [entry.runtime],
		shims: [entry.shim],
		timers: deps.timers
	});
}

//#endregion
//#region src/host/publish-regions.ts
/** Nothing registered, nothing to invalidate. */
const nothingPublished = () => ({
	releaseAdapter: void 0,
	releaseDirectory: void 0,
	invalidate: () => {}
});
/**
* Register `target`, releasing whatever was registered before, and restore the
* previous pair if the new registration fails.
*
* The ordering matters and is deliberate: the old pair is released *before* the
* new one is registered, because the host is being asked to offer the same
* provider ids and holding both at once is the state the host has no way to
* represent. That makes the failure window real, which is why the restore path
* exists at all.
*
* On failure the host is left in one of exactly two end states, and which one is
* chosen never depends on what threw:
*
* - The previous pair could be re-registered → it is, and the caller keeps
*   serving what it was serving. A region that worked before a reload keeps
*   working after a *failed* reload.
* - It could not → **nothing** is left registered, and `invalidate` becomes a
*   no-op. This is the honest outcome. Re-claiming releases for a registration
*   that does not exist would leave the host offering a provider that cannot
*   answer, which is the silent failure this module exists to prevent.
*
* Every restore step is attempted even if an earlier one threw, because a
* half-restored host is harder to reason about than an empty one; a step that
* fails is reported through `onRollbackFailed` and never swallowed.
*
* @param target - the registration to make current.
* @param previous - the pair in force before this call, if any.
* @param deps - the host calls and the rollback reporter.
* @returns the surviving state, plus `ok: false` and the error when publishing failed.
*/
function publishRegions(target, previous, previousReleases, deps) {
	if (target === void 0) return {
		ok: true,
		releaseAdapter: previousReleases.releaseAdapter,
		releaseDirectory: previousReleases.releaseDirectory,
		invalidate: previous?.invalidate ?? nothingPublished().invalidate
	};
	const { releaseAdapter: oldAdapterRelease, releaseDirectory: oldDirectoryRelease } = previousReleases;
	const stale = [];
	for (const release of [oldAdapterRelease, oldDirectoryRelease]) {
		if (release === void 0) continue;
		try {
			release();
		} catch (error) {
			stale.push(describe(error));
		}
	}
	let releaseAdapter;
	let releaseDirectory;
	try {
		releaseAdapter = deps.registerAdapter(target.providerIds, target.adapter);
		releaseDirectory = deps.registerConfigurableProviders(target.directory);
	} catch (error) {
		if (releaseAdapter !== void 0) try {
			releaseAdapter();
		} catch (cleanupError) {
			stale.push(describe(cleanupError));
		}
		if (previous === void 0) {
			report(stale, deps);
			return {
				ok: false,
				error,
				...nothingPublished()
			};
		}
		let restoredAdapter;
		try {
			restoredAdapter = deps.registerAdapter(previous.providerIds, previous.adapter);
		} catch (restoreError) {
			stale.push(describe(restoreError));
			report(stale, deps);
			return {
				ok: false,
				error,
				...nothingPublished()
			};
		}
		try {
			const restoredDirectory = deps.registerConfigurableProviders(previous.directory);
			report(stale, deps);
			return {
				ok: false,
				error,
				releaseAdapter: restoredAdapter,
				releaseDirectory: restoredDirectory,
				invalidate: previous.invalidate
			};
		} catch (restoreError) {
			try {
				if (restoredAdapter !== void 0) restoredAdapter();
			} catch (cleanupError) {
				stale.push(describe(cleanupError));
			}
			stale.push(describe(restoreError));
			report(stale, deps);
			return {
				ok: false,
				error,
				...nothingPublished()
			};
		}
	}
	report(stale, deps);
	return {
		ok: true,
		releaseAdapter,
		releaseDirectory,
		invalidate: target.invalidate
	};
}
/** Reduce a throwable to a loggable line. */
function describe(error) {
	if (error instanceof Error) return error.message;
	return String(error);
}
/**
* Report the rollback steps that did not complete.
*
* A swallowed release is a leak the user cannot see, so it is never silent:
* with no reporter installed the step is still counted, and installing one is
* how the caller turns it into a log line.
*/
function report(stale, deps) {
	if (stale.length === 0) return;
	const onRollbackFailed = deps.onRollbackFailed;
	if (onRollbackFailed === void 0) return;
	for (const step of stale) try {
		onRollbackFailed(/* @__PURE__ */ new Error(`release or rollback step failed: ${step}`));
	} catch {}
}

//#endregion
//#region src/host/request-counter.ts
/**
* The local daily count of conversation turns this client sends upstream.
*
* Upstream never publishes "sent today / limit", so the count is local only:
* this client's calls through this plugin, desktop and web counted apart. One
* JSON file per region and local date (Asia/Shanghai) under `$DSH_HOME`,
* written atomically; the date key is recomputed on every read/write, so a day
* rollover starts a new file instead of accumulating. Never throws: a failed
* read or write degrades to `count === null`; the path is injected and the name
* components whitelist-checked, so it stays inside `$DSH_HOME` (docs/issues/01-sweep-junction-zeroing.md).
* @module dsh-connect-qoder/request-counter
*/
/** 落盘 JSON 的版本号；与 `throttle-store.ts` 同款约定，读错版本即丢弃。 */
const COUNTER_FORMAT_VERSION = 1;
/**
* 把 region / 日期各段收敛成安全文件名分量。
*
* 只允许 ASCII 字母数字、连字符、下划线——region 是受控枚举（`qoder-cn` /
* `qoder`），日期是 `YYYY-MM-DD`，理论上都不需要过滤；但凡是拼进文件路径的东西
* 都必须过一道白名单，否则一旦上游/配置里冒出 `../` 或 `:` 就变成越界写盘。
* 含任何非法字符即返回 `null`（调用方据此放弃本次计数，不拼路径）。
*
* @param value - 待校验的分量。
* @returns 安全分量，或 `null`。
*/
function sanitizeComponent(value) {
	return /^[A-Za-z0-9_-]+$/.test(value) ? value : null;
}
/**
* 把 epoch 毫秒拆成 Asia/Shanghai 的本地日历日 `YYYY-MM-DD`。
*
* 用 `Intl.DateTimeFormat` 的 `timeZone` 选项拿本地年月日，避免自己算时区偏移
* （夏时制、历史偏移都会错）。返回 null 表示环境不支持该时区——这时放弃本地口径
* 计数，不强行用 UTC 冒充（那会让「零点翻页」和上游的日界对不上）。
*
* @param ms - epoch 毫秒。
* @param timeZone - 目标时区，默认上海。
* @returns `YYYY-MM-DD`，或 `null`。
*/
function localDayKey(ms, timeZone = "Asia/Shanghai") {
	try {
		const parts = new Intl.DateTimeFormat("en-CA", {
			timeZone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit"
		}).formatToParts(new Date(ms));
		const year = parts.find((p) => p.type === "year")?.value;
		const month = parts.find((p) => p.type === "month")?.value;
		const day = parts.find((p) => p.type === "day")?.value;
		if (typeof year !== "string" || typeof month !== "string" || typeof day !== "string" || !/^\d{4}$/.test(year) || !/^\d{2}$/.test(month) || !/^\d{2}$/.test(day)) return null;
		return `${year}-${month}-${day}`;
	} catch {
		return null;
	}
}
/**
* 本客户端每日请求计数器。
*
* 一个 region 一个实例；文件按 `region + 本地日` 分文件，零点翻页自动切文件。
* 所有磁盘操作吞错降级，绝不把计数失败传导到对话链路。
*/
var RequestCounter = class {
	basePath;
	now;
	logger;
	keepDays;
	/** gc 的「每本地日至多一次真扫」节流标记（与 TokenCounter.lastGcDay 同款）。 */
	lastGcDay = null;
	constructor({ basePath, now = () => Date.now(), logger, keepDays = 7 }) {
		this.basePath = basePath;
		this.now = now;
		this.logger = logger;
		this.keepDays = keepDays;
	}
	/**
	* 当前 region + 本地日的计数文件路径；任一分量非法返回 `null`（越界防护）。
	*
	* @param region - region id（受控枚举，仍过白名单）。
	*/
	pathFor(region) {
		const safeRegion = sanitizeComponent(region);
		if (safeRegion === null) return null;
		const day = localDayKey(this.now());
		if (day === null) return null;
		return this.basePath(`.qoder-request-count.${safeRegion}.${day}.json`);
	}
	/**
	* 读今日计数（不出错）。
	*
	* @param region - region id。
	* @returns 读数；文件不存在 / 损坏 / 越界 / 时区不可用 → `count: null`。
	*/
	read(region) {
		const path = this.pathFor(region);
		if (path === null) return {
			count: null,
			day: null
		};
		const day = localDayKey(this.now());
		if (!existsSync(path)) return {
			count: null,
			day
		};
		try {
			const record = JSON.parse(readFileSync(path, "utf8"));
			if (record?.version !== COUNTER_FORMAT_VERSION) return {
				count: null,
				day
			};
			const count = Number(record.count);
			if (!Number.isFinite(count) || count < 0) return {
				count: null,
				day
			};
			return {
				count: Math.floor(count),
				day
			};
		} catch {
			return {
				count: null,
				day
			};
		}
	}
	/**
	* 今日 +1，返回 +1 后的读数（不出错）。
	*
	* 与 `read` 不同：bump 是用户真正关心的「发了一发」的落盘，所以即使读失败也
	* 尝试以 `count: 1` 起写（而非静默丢数）。写失败则降级 `count: null`——这发
	* 请求已经发生，只是本插件没记下，客户端会显示「本地口径不可用」而不是假 0。
	*
	* @param region - region id。
	*/
	bump(region) {
		return this.write(region, (prev) => Math.floor(prev) + 1);
	}
	/**
	* 标记今日「本地判定额度疑似用尽」。
	*
	* 由 shim 在收到上游 `daily_limit_exceeded` 时调用。这**不是**上游给的官方状态
	* —— 上游只报「用完了」，从不给剩余/上限；本插件据此在本地记一个标记，供卡片
	* 诚实标注「今日额度疑似已用尽（本地统计，仅供参考）」。零点翻页到新文件后该标记
	* 自然消失（每个本地日一个文件）。写失败只降级、不阻塞对话（红线 1）。
	*
	* @param region - region id。
	*/
	markExhausted(region) {
		this.write(region, (prev) => prev, true);
	}
	/**
	* 读今日是否已被本地标记为「额度疑似用尽」。
	*
	* @param region - region id。
	* @returns 标记状态；文件不可用 / 越界 → `false`（宁可漏标也不误报）。
	*/
	readExhausted(region) {
		const path = this.pathFor(region);
		if (path === null) return false;
		if (!existsSync(path)) return false;
		try {
			const record = JSON.parse(readFileSync(path, "utf8"));
			if (record?.version !== COUNTER_FORMAT_VERSION) return false;
			return record.dailyLimitHit === true;
		} catch {
			return false;
		}
	}
	/**
	* 计数 + 标记的底层落盘：读旧值 → 套用 `nextCount` 得到新计数 → 合并
	* `dailyLimitHit` → 原子写。读失败以 `1`/`false` 起写（不丢数、不裸抛）。
	*
	* @param region - region id。
	* @param nextCount - 由旧计数算新计数的函数（旧值已 clamp 为非负整数）。
	* @param dailyLimitHit - 是否把今日标记为已撞每日限流（默认沿用旧值）。
	*/
	write(region, nextCount, dailyLimitHit) {
		const path = this.pathFor(region);
		if (path === null) return {
			count: null,
			day: null
		};
		const day = localDayKey(this.now());
		let count = 0;
		let hit = false;
		if (existsSync(path)) try {
			const record = JSON.parse(readFileSync(path, "utf8"));
			if (record?.version === COUNTER_FORMAT_VERSION) {
				const prev = Number(record.count);
				if (Number.isFinite(prev) && prev >= 0) count = Math.floor(prev);
				if (record.dailyLimitHit === true) hit = true;
			}
		} catch {}
		count = nextCount(count);
		if (dailyLimitHit !== void 0) hit = dailyLimitHit;
		const tmp = `${path}.tmp`;
		try {
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(tmp, JSON.stringify({
				version: COUNTER_FORMAT_VERSION,
				count,
				day,
				dailyLimitHit: hit
			}, null, 2), "utf8");
			renameSync(tmp, path);
			return {
				count,
				day
			};
		} catch (error) {
			try {
				if (existsSync(tmp)) unlinkSync(tmp);
			} catch {}
			this.logger?.warn?.(`dsh-connect-qoder: could not persist request count ${path}`, error);
			return {
				count: null,
				day
			};
		}
	}
	/**
	* 清理过期旧文件（GC）。
	*
	* 只删除**本插件命名且日期早于保留窗口**的计数文件，绝不碰目录里其它文件
	* （越界防护）。扫描以 basePath 目录为单位，按文件名日期分量判断——日期分量
	* 白名单过，非本插件格式的文件名（缺 `.qoder-request-count.` 前缀或分量非法）
	* 一律跳过，杜绝误删目录外/目录内无关文件。
	*
	* 窗口语义：`keepDays: 7` 保留今天与过去 6 天，删除第 7 天之前的文件——与
	* `readHistory(region, 7)` 的扫描范围逐日对齐。早期实现用 `-keepDays` 天做
	* cutoff（`keepDays=1` 时连昨天的文件都删），历史窗口比读路径短一天。这里取
	* `-(keepDays - 1)`：`keepDays=1` 只留今天，`keepDays=7` 留今天起 7 天。
	* 用 Date 日历减法（setDate）而非固定 24h 步进，避免 DST 时区错位（与
	* `token-counter.ts` 的 gc 同一套算法，两计数器行为一致）。
	*
	* @param now - 基准时间；默认用构造时钟。
	*/
	gc(now = this.now()) {
		const dir = dirname(this.basePath("x"));
		if (!existsSync(dir)) return;
		const keepDays = this.keepDays;
		if (keepDays < 1) return;
		const todayKey = localDayKey(now);
		if (todayKey !== null && todayKey === this.lastGcDay) return;
		const cutoffDate = new Date(now);
		cutoffDate.setDate(cutoffDate.getDate() - (keepDays - 1));
		const cutoffDay = localDayKey(cutoffDate.getTime());
		if (cutoffDay === null) return;
		let names;
		try {
			names = readDirFiltered(dir);
		} catch (error) {
			this.logger?.warn?.(`dsh-connect-qoder: could not scan request-count dir ${dir}`, error);
			return;
		}
		this.lastGcDay = todayKey;
		for (const name of names) {
			const match = /^\.qoder-request-count\.([A-Za-z0-9_-]+)\.(\d{4}-\d{2}-\d{2})\.json(\.tmp)?$/.exec(name);
			if (match === null) continue;
			if (match[2] < cutoffDay) try {
				unlinkSync(`${dir}/${name}`);
			} catch (error) {
				this.logger?.warn?.(`dsh-connect-qoder: could not remove stale request-count ${name}`, error);
			}
		}
	}
};
/**
* 列出目录内**普通文件**（仅文件名），跳过目录/符号链接，越界读即抛由调用方处理。
*
* 通过 `withFileTypes` 只取普通文件，避免把子目录当文件删（越界防护的一环）。
*
* @param dir - 目录路径。
* @returns 文件名数组。
*/
function readDirFiltered(dir) {
	return readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name);
}

//#endregion
//#region src/host/token-counter.ts
/**
* 本地 token 消耗累加器 — 本客户端经本插件发往上游、每轮对话上游明确下发的
* token 数（prompt / completion / total / 缓存命中），按 region + 上海本地日
* 在本地累加落盘。
*
* 与「本地请求计数器」（`request-counter.ts`）的区别与边界：
*
* - 请求计数上游**根本不给**每日上限，只能本地自计「发了几发」——那一条是纯粹的
*   本地口径，不画比例条（画 N/上限 等于发明上游没公布的口径）。
* - token 数则是**上游每轮对话都明确下发**的（见 `shim.ts` 抓 `chunk.usage`
*   的 `total_tokens` / `prompt_tokens_details.cached_tokens` 并转发给 DSH）。
*   所以这里做的是「本地聚合一份已经公开的数据」，不是编造——可以做、也
*   **应该**画出来，否则用户在插件卡里看不到自己消耗了多少 token。
* - 桌面端与 Web 端各记各的（同 request-counter 的「本客户端口径」），官方口径
*   以 DSH 宿主侧的会话记账为准；此处只是把同样的数据在插件卡里也呈现一份。
*
* 落盘契约（踩红线 1 / 凭据清理那套纪律，与 `request-counter.ts` 同款）：
*
* - 一个 JSON 文件、按 region + 本地日期（Asia/Shanghai 日历日）命名，落在
*   `$DSH_HOME/.qoder-token-count.<region>.<YYYY-MM-DD>.json`。沿用
*   `throttle-store.ts` 的「写临时文件再 rename 覆盖」原子套路。
* - 计数发生在 shim 抓到 usage 帧时（`chatCompletions` 遍历流，累加该轮的
*   `totalTokens`），与请求计数的「发了一发 +1」同源但不互相耦合：token 数
*   上游直接给，重试同一轮只在那一轮的统计里加一次（流内的 usage 帧也只有
*   一个，不会重复加）。
* - **零点翻页**：每次读/写都重新算本地日期 key，落到不同文件，旧文件按 GC 清理。
* - **越界防护**：region / 日期分量过 `sanitizeComponent` 白名单，任何非法
*   分量返回 `null`（不计数、不写盘），绝不拼出目录外的路径。
* - **永不抛**：读不到 / 写失败一律降级为「不可用」（`count === null`），不
*   阻塞对话、不给用户假的成功读数。
* - **原子性（有边界）**：所有 fs 操作为同步，Node.js 单线程模型保证单次
*   `addUsage` 的读-改-写在同一 tick 内完成——**同一进程内**两条并发流不会互相
*   打断。但 web 与 desktop 两个 profile 可以同时激活、共用同一个 `$DSH_HOME`，
*   那是两个进程读改写同一个文件，后写的 rename 会整体覆盖前一次的累加（丢更
*   新）。这与 credential-vault 登记的跨进程缺口同类（见 `docs/KNOWN_GAPS.md`）：
*   桌面端与 Web 端「各记各的」在本插件内的语义是**各写各的文件**才成立，而这里
*   的文件名只按 region + 日 分段、不含 profile，所以两边会互相盖。真实用户几乎
*   不会同时跑两个 profile，故不做进程锁（那要引依赖、要处理死锁），但**不许把
*   注释写成「不存在并发竞态」**——那句话在读代码时会被当成已论证过的结论。
*   `readHistory` 的 7 天窗口同理：跨进程覆盖只丢最近一天的量，历史窗口本身不坏。
*
* @module dsh-connect-qoder/token-counter
*/
/** 落盘 JSON 的版本号；与 `request-counter.ts` 同约定，读错版本即丢弃。 */
const TOKEN_FORMAT_VERSION = 1;
/**
* 读取并解析单个日文件。所有读路径（read / readHistory / write）共用此函数，
* 避免重复的 version 检查 + Number 收敛 + floor 逻辑。
*
* @param path - 文件绝对路径。
* @returns 解析后的 {total, cached}；文件不存在 / 版本不符 / 损坏 / 非有限数 → `null`。
*/
function parseDayFile(path) {
	if (!existsSync(path)) return null;
	try {
		const record = JSON.parse(readFileSync(path, "utf8"));
		if (record?.version !== TOKEN_FORMAT_VERSION) return null;
		const total = Number(record.total);
		const cached = Number(record.cached);
		if (!Number.isFinite(total) || total < 0) return null;
		return {
			total: Math.floor(total),
			cached: Number.isFinite(cached) && cached >= 0 ? Math.floor(cached) : 0
		};
	} catch {
		return null;
	}
}
/**
* 把上游 usage 帧里的 token 数收敛成本累加器认识的增量。
*
* Qoder 的 usage 块是 OpenAI 同款 `stream_options.include_usage` 形状：
* `{ prompt_tokens, completion_tokens, total_tokens, prompt_tokens_details:
* { cached_tokens } }`。只取**上游实际下发**的字段，缺则按 0 计（不编造）。
* 任一值不是有限非负数即整体返回 `null`（该帧坏掉，宁可不加也不加错）。
*
* @param usage - 上游 usage 帧（任意形状，缺失字段按 0）。
* @returns 可累加的增量，或 `null`。
*/
function tokensFromUsage(usage) {
	if (usage === null || typeof usage !== "object") return null;
	const u = usage;
	const total = Number(u.total_tokens);
	const cachedRaw = u.prompt_tokens_details?.cached_tokens;
	const cached = Number(cachedRaw);
	if (!Number.isFinite(total) || total < 0) return null;
	return {
		total: Math.floor(total),
		cached: Number.isFinite(cached) && cached >= 0 ? Math.floor(cached) : 0
	};
}
/**
* 本客户端每日 token 消耗累加器。
*
* 一个 region 一个实例；文件按 `region + 本地日` 分文件，零点翻页自动切文件。
* 所有磁盘操作吞错降级，绝不把计数失败传导到对话链路。
*
* fs 全同步，单次 addUsage 的读-改-写在同一 tick 内完成——这是**同进程内**的
* 保证；跨进程（web / desktop 两个 profile 共用 `$DSH_HOME`）的竞态见文件头注释，
* 此处不重复论证。
*/
var TokenCounter = class {
	basePath;
	now;
	logger;
	keepDays;
	/** 本实例实际完成 gc 扫描的本地日；同日再入短路（usage 轮询热路径节流）。 */
	lastGcDay = null;
	constructor({ basePath, now = () => Date.now(), logger, keepDays = 7 }) {
		this.basePath = basePath;
		this.now = now;
		this.logger = logger;
		this.keepDays = keepDays;
	}
	/**
	* 当前 region + 本地日的计数文件路径与日期 key；任一分量非法返回 `null`。
	* 一次取 day，避免 read() 里两次独立调用 localDayKey 在 23:59:59.999 跨零点时
	* path 是旧日文件、返回的 day 是新日的错位。
	*/
	pathFor(region) {
		const safeRegion = sanitizeComponent(region);
		if (safeRegion === null) return null;
		const day = localDayKey(this.now());
		if (day === null) return null;
		return {
			path: this.basePath(`.qoder-token-count.${safeRegion}.${day}.json`),
			day
		};
	}
	/**
	* 读今日 token 计数（不出错）。
	*
	* @param region - region id。
	* @returns 读数；文件不存在 / 损坏 / 越界 / 时区不可用 → 全部 `null`。
	*/
	read(region) {
		const resolved = this.pathFor(region);
		if (resolved === null) return {
			total: null,
			cached: null,
			day: null
		};
		const { path, day } = resolved;
		const parsed = parseDayFile(path) ?? parseDayFile(`${path}.tmp`);
		if (parsed === null) return {
			total: null,
			cached: null,
			day
		};
		return {
			total: parsed.total,
			cached: parsed.cached,
			day
		};
	}
	/**
	* 读取过去 N 天的 token 消耗历史（多日统计用）。
	*
	* 从 `now` 向前逐天扫描本地日历日文件（含今天自己），**只收真实存在过数据的日子**：
	* 没有文件的日期（本客户端那天没用过 / 文件已被 GC）不出现在返回值里。早期版本
	* 给缺失日补 `{total: 0}`，于是「没有数据」与「消耗为 0」在数组里不可区分——客户
	* 端把两种日子画成同一根贴地柱子，日均也按 7 天恒等分母摊薄，读出来比实际低。
	*
	* 返回值按 day 升序排列（最早在前）。
	*
	* 使用 Date 日历减法（setDate）而非固定 24h 步进，避免 DST 时区在一天扫描重复或跳过。
	*
	* @param region - region id。
	* @param days - 回溯天数，默认 7；上限由 `keepDays` 隐式决定。
	* @returns 历史记录数组（可能为空；长度 ≤ min(days, keepDays)）。
	*/
	readHistory(region, days = 7) {
		const safeRegion = sanitizeComponent(region);
		if (safeRegion === null) return [];
		const records = [];
		const scannedDays = Math.min(days, this.keepDays);
		const dateObj = new Date(this.now());
		for (let i = 0; i < scannedDays; i++) {
			const day = localDayKey(dateObj.getTime());
			if (day !== null) {
				const path = this.basePath(`.qoder-token-count.${safeRegion}.${day}.json`);
				const parsed = parseDayFile(path) ?? parseDayFile(`${path}.tmp`);
				if (parsed !== null) records.push({
					day,
					total: parsed.total,
					cached: parsed.cached
				});
			}
			dateObj.setDate(dateObj.getDate() - 1);
		}
		return records.reverse();
	}
	/**
	* 把上游某轮的 token 增量累加进今日文件（不出错）。
	*
	* 与 `bump` 不同：这里累加的是「上游下发的真实 token 数」，缺字段按 0，坏
	* 帧整体跳过（返回 `null` 而非写脏数据）。读失败以 0 起写——这一轮的消耗
	* 已经发生，只是本插件没记下，降级即可，不丢数也不造数。
	*
	* @param region - region id。
	* @param usage - 上游 usage 帧。
	* @returns 累加后的读数；帧无效 / 越界 / 写失败 → `null`。
	*/
	addUsage(region, usage) {
		const delta = tokensFromUsage(usage);
		if (delta === null) return {
			total: null,
			cached: null,
			day: null
		};
		return this.write(region, (prevTotal, prevCached) => ({
			total: prevTotal + delta.total,
			cached: prevCached + delta.cached
		}));
	}
	/**
	* 计数累加 + 合并的底层落盘：读旧值 → 套用 `next` 得到新计数 → 原子写。读失败
	* 以 `{0,0}` 起写（不丢数、不裸抛）。失败清 tmp 不裸抛、warn 降级。
	*/
	write(region, next) {
		const resolved = this.pathFor(region);
		if (resolved === null) return {
			total: null,
			cached: null,
			day: null
		};
		const { path, day } = resolved;
		const prev = parseDayFile(path) ?? parseDayFile(`${path}.tmp`) ?? {
			total: 0,
			cached: 0
		};
		const result = next(prev.total, prev.cached);
		const tmp = `${path}.tmp`;
		try {
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(tmp, JSON.stringify({
				version: TOKEN_FORMAT_VERSION,
				total: result.total,
				cached: result.cached,
				day
			}, null, 2), "utf8");
			renameSync(tmp, path);
			return {
				total: result.total,
				cached: result.cached,
				day
			};
		} catch (error) {
			try {
				if (existsSync(tmp)) unlinkSync(tmp);
			} catch {}
			this.logger?.warn?.(`dsh-connect-qoder: could not persist token count ${path}`, error);
			return {
				total: null,
				cached: null,
				day
			};
		}
	}
	/**
	* 清理过期旧文件（GC）。只删除**本插件命名且日期早于保留窗口**的 token 文件，
	* 绝不碰目录里其它文件（越界防护）。`.tmp` 残留一并收（写崩溃时 rename 没跑到）。
	*
	* 窗口语义：`keepDays: 7` 保留今天与过去 6 天，删除第 7 天之前的文件——与
	* `readHistory(region, 7)` 的扫描范围逐日对齐。早期实现用 `-keepDays` 天做
	* cutoff，会把「昨天」这种还在窗口内的日子也算成过期（keepDays=1 时连昨天的
	* 文件都删），历史窗口比读路径短一天。这里取 `-(keepDays - 1)`：
	* `keepDays=1` 只留今天，`keepDays=7` 留今天起 7 天。
	*/
	gc(now = this.now()) {
		const dir = dirname(this.basePath("x"));
		if (!existsSync(dir)) return;
		if (this.keepDays < 1) return;
		const todayKey = localDayKey(now);
		if (todayKey !== null && todayKey === this.lastGcDay) return;
		const cutoffDate = new Date(now);
		cutoffDate.setDate(cutoffDate.getDate() - (this.keepDays - 1));
		const cutoffDay = localDayKey(cutoffDate.getTime());
		if (cutoffDay === null) return;
		let names;
		try {
			names = readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name);
		} catch (error) {
			this.logger?.warn?.(`dsh-connect-qoder: could not scan token-count dir ${dir}`, error);
			return;
		}
		this.lastGcDay = todayKey;
		for (const name of names) {
			const match = /^\.qoder-token-count\.([A-Za-z0-9_-]+)\.(\d{4}-\d{2}-\d{2})\.json(\.tmp)?$/.exec(name);
			if (match === null) continue;
			if (match[2] < cutoffDay) try {
				unlinkSync(`${dir}/${name}`);
			} catch (error) {
				this.logger?.warn?.(`dsh-connect-qoder: could not remove stale token-count ${name}`, error);
			}
		}
	}
};

//#endregion
//#region src/host/handlers.ts
/**
* The card route handlers, extracted from `src/host/index.ts`.
*
* WHY THIS IS A MODULE
*
* `index.ts` pulls in the Cordis peer dependencies at module scope, so a test
* cannot import it — which meant every route's business decisions (which status
* an unknown region answers with, what a refused save looks like, how a
* protocol shape change is reported) could be wrong with the suite fully green
* (docs/KNOWN_GAPS.md item 2（`RegionRuntime` 本身与 `activate` 的 Cordis 接线）).
*
* The request gates already live in `lib/routes.ts`; this module is the second
* half of the same cut: the HANDLERS, shaped as `(req, res, deps) => Promise<void>`
* with every non-peer dependency injected through `deps`. `index.ts` keeps only
* the `webServer.register` calls and the deps assembly, so each handler here is
* importable and directly assertable — the same `(input) => result` shape
* `applySettingsSave` established for the settings pipeline.
*
* The bodies are verbatim moves from `activate()`; nothing here re-decides
* anything. `claimTodayFor` (the check-in's interesting half) is extracted the
* same way the account reload route was.
*
* @module dsh-connect-qoder/handlers
*/
/**
* Serve the card's model roster.
*
* `refresh=1` re-reads the catalog from upstream. It matters because both the
* roster and the rates move on their own: Qoder adds and retires models, and an
* off-peak discount flips the effective price at 22:00 and 08:00 Asia/Shanghai.
* Without this the picker would keep showing whatever was true at process
* start.
*/
async function modelsHandler(req, res, deps) {
	if (!methodAllowed(req, res, "GET")) return;
	if (!originAllowed(req, res)) return;
	if (new URL(req.url ?? "/", "http://127.0.0.1").searchParams.get("refresh") === "1") for (const { runtime } of deps.started) try {
		await runtime.refreshCatalog();
	} catch (error) {
		deps.logger.warn?.(`dsh-connect-qoder: ${runtime.region.displayName} catalog refresh failed`, error);
	}
	const now = /* @__PURE__ */ new Date();
	sendJson(res, 200, buildModelRowsPayload({
		runtimes: deps.started,
		settings: deps.currentSettings(),
		now,
		projectRow: projectModelRow,
		rates: deps.rates,
		providerRegistrationError: deps.providerRegistrationError
	}));
}
/**
* Write one settings field through the authoritative Host endpoint.
*
* `webServer` alone is the point: the route mounts whether or not the settings
* service exists, so the service-absent 503 is a real answer the client can
* distinguish from a 404 (a host that does not serve this route at all) — the
* false-"已保存" this closed, docs/issues/06.
*/
async function saveHandler(req, res, deps) {
	if (!methodAllowed(req, res, "POST")) return;
	if (!originAllowed(req, res)) return;
	try {
		const body = await readJsonBody$1(req);
		const outcome = await saveFieldOutcome(deps.getSettings(), body, {
			candidates: [deps.settingsNs, deps.fallbackNs],
			equals: isDeepStrictEqual
		});
		if (outcome.body.ok !== true) return sendJson(res, outcome.status, outcome.body);
		deps.refreshPicker();
		return sendJson(res, outcome.status, outcome.body);
	} catch (error) {
		sendJson(res, 500, {
			ok: false,
			errorName: error?.name ?? "unknown",
			error: describeThrown(error)
		});
	}
}
/** 建一个空的进程内历史缓存（host 启动时一个）。 */
function createTokenHistoryCache() {
	const entries = /* @__PURE__ */ new Map();
	return {
		get(region) {
			return entries.get(region);
		},
		set(region, value) {
			entries.set(region, value);
		}
	};
}
/**
* Serve the credential-free usage summary.
*
* The quota lives upstream behind a bearer token the browser must never hold,
* so the host reads it and hands the card a summary. Each region is read
* independently and a failing region is reported as unavailable rather than
* failing the panel, so one dead sign-in cannot hide the other region's
* numbers.
*/
async function usageHandler(req, res, deps) {
	if (!methodAllowed(req, res, "GET")) return;
	if (!originAllowed(req, res)) return;
	const force = new URL(req.url ?? "/", "http://127.0.0.1").searchParams.get("refresh") === "1";
	const regions = await Promise.all(deps.started.map(async ({ runtime }) => {
		const base = {
			region: runtime.region.id,
			regionName: runtime.region.displayName,
			manageUrl: runtime.region.manageUrl,
			downloadUrl: runtime.region.downloadUrl
		};
		try {
			const usage = await runtime.readUsage(force);
			const counter = deps.requestCounter;
			const requestsField = {};
			if (counter === void 0) requestsField.requestsUnavailable = true;
			else {
				requestsField.requestsToday = counter.read(runtime.region.id).count ?? 0;
				if (counter.readExhausted(runtime.region.id) === true) requestsField.requestsExhausted = true;
			}
			const tokenCounter = deps.tokenCounter;
			if (tokenCounter !== void 0) {
				const tokens = tokenCounter.read(runtime.region.id);
				requestsField.tokensToday = tokens.total ?? 0;
				if (tokens.cached !== null && tokens.cached > 0) requestsField.tokensCachedToday = tokens.cached;
				const cache = deps.tokenHistoryCache;
				const summary = {
					day: tokens.day,
					total: tokens.total
				};
				const cached = cache?.get(runtime.region.id);
				let history = cached?.records;
				if (history === void 0 || cached === void 0 || cached.day !== summary.day || cached.total !== summary.total) {
					history = tokenCounter.readHistory(runtime.region.id, 7);
					cache?.set(runtime.region.id, {
						...summary,
						records: history
					});
				}
				if (history.length > 0) requestsField.tokensHistory = history;
			}
			return usage === void 0 ? {
				...base,
				available: false,
				...requestsField
			} : {
				...base,
				available: true,
				...usage,
				...requestsField
			};
		} catch (error) {
			deps.logger.warn?.(`dsh-connect-qoder: ${runtime.region.displayName} usage read failed`, error);
			const dailyLimit = thrownFlag(error, "upstreamKind") === "daily-limit";
			if (dailyLimit) deps.requestCounter?.markExhausted?.(runtime.region.id);
			return {
				...base,
				available: false,
				unavailableReason: isProtocolShapeChangedError(error) ? "protocol-shape-changed" : dailyLimit ? "daily-limit" : "read-failed"
			};
		}
	}));
	deps.tokenCounter?.gc();
	deps.requestCounter?.gc();
	sendJson(res, 200, {
		regions,
		...checkinAvailability(deps)
	});
}
/**
* Whether this machine can claim the international edition's daily round.
*
* Upstream gates `GET /campaigns` on the desktop app's umid machine identity:
* without it the endpoint serves only the promotional banner and NO claimable
* round, so `checkinStateFrom` reports `active: false` and the card correctly
* renders nothing (KNOWN_GAPS §8). Nothing was ever wrong with the card — but
* "the panel is simply absent" is indistinguishable from "there is no check-in
* today", which is the silent-failure shape this plugin keeps paying for.
*
* So the reason travels with the usage response and the card can say it. It is
* reported at the top level rather than per region because it is a property of
* the MACHINE, and because only the international edition is gated: the CN
* endpoint serves rounds to a bare bearer, so a CN-only user must not be shown
* a machine-identity warning (index.ts's warn is conditioned the same way).
*
* @param deps - the route's dependencies.
* @returns `{}` when the caller supplied no probe, or a `checkin` hint otherwise.
*/
function checkinAvailability(deps) {
	if (deps.umidState === void 0) return {};
	const state = deps.umidState();
	if (state.available === true) return {};
	return { checkin: {
		umidAvailable: false,
		reason: state.reason ?? "the Qoder machine identity is unavailable on this machine"
	} };
}
/** The real upstream calls, used when a test injects no `io`. */
const realClaimIo = {
	readCampaigns,
	claimCampaign
};
/**
* Claim one region's daily check-in, reporting what actually happened.
*
* Extracted from the route so the interesting part — which round gets claimed
* and what the answer means — is assertable without a Cordis context. Same
* `(input) => result` shape `applySettingsSave` established for the settings
* pipeline.
*/
async function claimTodayFor(runtime, io = realClaimIo) {
	const credential = await runtime.resolveCredential();
	if (credential === void 0) throw new Error("no usable sign-in on this machine");
	const campaigns = await io.readCampaigns(runtime.region, credential);
	const campaign = claimableCampaignOf(campaigns);
	if (campaign === void 0) throw new Error("Qoder is not running a check-in for this account today");
	if (campaignIsClaimed(campaign)) return {
		region: runtime.region.id,
		claimed: false,
		replayed: true,
		alreadyClaimed: true,
		checkin: checkinStateFrom(campaigns)
	};
	const campaignId = campaign.campaignId;
	if (typeof campaignId !== "string") throw new Error("campaign record carries no campaign id");
	const raw = await io.claimCampaign(runtime.region, credential, campaignId);
	const result = normalizeClaimResult(raw, campaign);
	if (result.claimed !== true) throw new Error("Qoder did not confirm this check-in");
	runtime.invalidateUsage();
	let checkin = {
		...checkinStateFrom(campaigns),
		todayCheckedIn: true
	};
	try {
		checkin = checkinStateFrom(await io.readCampaigns(runtime.region, credential));
	} catch {}
	return {
		region: runtime.region.id,
		...result,
		alreadyClaimed: false,
		checkin
	};
}
/**
* Claim the daily check-in for one named region.
*
* Nothing about it is automatic and nothing about it is guessed: the card names
* the region, this host re-reads Qoder's own campaign list, and only a round
* that is open and unclaimed is ever posted at. The card therefore cannot claim
* a stale round even if it were to render one.
*/
async function checkinHandler(req, res, deps) {
	if (!methodAllowed(req, res, "POST")) return;
	if (!originAllowed(req, res)) return;
	const requested = new URL(req.url ?? "/", "http://127.0.0.1").searchParams.get("region");
	const entry = deps.started.find((candidate) => candidate.region.id === requested);
	if (entry === void 0) return sendJson(res, 404, { error: "unknown-region" });
	try {
		const claim = deps.claim ?? ((runtime) => claimTodayFor(runtime));
		sendJson(res, 200, await claim(entry.runtime));
	} catch (error) {
		deps.logger.warn?.(`dsh-connect-qoder: ${entry.region.displayName} check-in failed`, error);
		sendJson(res, 502, { error: error instanceof Error ? error.message : String(error) });
	}
}
/**
* Serve the account panel: which sign-in drives each region, and in which state
* it is — all from local evidence, so reading it costs no network.
*
* The guard the RELOAD route carries, and this one did not: a throw from the
* handler reaches the web server's catch-all, which answers a bodyless 400, and
* the card can only render that as "读取账号状态失败" — with nothing anywhere
* saying WHY. Crashing to a 500 with the reason at least names the step that
* failed.
*/
async function accountHandler(req, res, deps) {
	if (!methodAllowed(req, res, "GET")) return;
	if (!originAllowed(req, res)) return;
	try {
		sendJson(res, 200, await deps.payload());
	} catch (error) {
		deps.logger.error?.("dsh-connect-qoder: account state read failed", error);
		sendJson(res, 500, {
			error: "account state read failed",
			errorName: error?.name ?? "Error",
			detail: describeThrown(error).slice(0, 300)
		});
	}
}
/**
* Report whether this plugin finished activating, and at which step it did not.
*
* The route exists so that "the card's other routes 404" stops being ambiguous
* between "this host serves no such route" and "this plugin failed while coming
* up". It always answers 200 when the route itself is reachable: the answer IS
* the status, so a 5xx here would collapse the two states again — an
* always-200 body with `providerRegistration.ok: false` is what makes the
* failure legible to a card that can only render a response.
*
* Only the error's NAME is published, never its message: this surface is
* browser-visible, and `describeThrown` returns the message verbatim — an
* arbitrary thrown value can carry a credential-bearing URL, and a provider
* registration error is not a place to bet that it does not. The name still
* names the failure kind (`TypeError`, `Error`), and the full error is already
* in the host log, where the recording block in `activate()` put it. That split
* is deliberate: log the whole thing, publish the shape.
*
* The shaping itself lives in {@link providerRegistrationState}, shared with the
* models payload, so the two surfaces that publish this fact cannot drift into
* two vocabularies for it.
*/
async function statusHandler(req, res, deps) {
	if (!methodAllowed(req, res, "GET")) return;
	if (!originAllowed(req, res)) return;
	const providerRegistration = providerRegistrationState(deps.providerRegistrationError);
	sendJson(res, 200, {
		activated: providerRegistration.ok,
		startedRegions: deps.startedCount,
		providerRegistration,
		...deps.regions === void 0 ? {} : { regions: deps.regions.map((region) => ({
			id: region.id,
			...region.credentialKind === void 0 ? {} : { credentialKind: region.credentialKind }
		})) }
	});
}
/**
* Re-read the sign-ins, now.
*
* A sign-in that was missing or expired at activation never produced a runtime
* for its region, so the fix is not just to invalidate the caches — it is to
* (re)start the regions that are readable now and publish them. Answers with
* the fresh account states so the card can re-render without a second round
* trip.
*/
async function reloadHandler(req, res, deps) {
	if (!methodAllowed(req, res, "POST")) return;
	if (!originAllowed(req, res)) return;
	const read = await readJsonBodyOr400(req, res);
	if (read.ok !== true) return;
	const posted = read.body ?? {};
	const wanted = typeof posted.region === "string" && deps.regions.some((region) => region.id === posted.region) ? posted.region : void 0;
	for (const { runtime } of deps.started) {
		if (wanted !== void 0 && runtime.region.id !== wanted) continue;
		runtime.invalidateCredential();
		runtime.refreshCatalog();
	}
	try {
		await deps.startStoppedRegions(wanted);
	} catch (error) {
		deps.logger.error?.("dsh-connect-qoder: account re-read failed to start a stopped region", error);
	}
	sendJson(res, 200, await deps.payload({ force: true }));
}
/**
* Confirm one region's sign-in is still valid, online.
*
* The card's confirm button. Calls `fetchUserInfo` with the region's credential
* and reports whether the upstream still accepts it — the one network call in
* the account flow, kept behind its own route so an account render stays
* network-free.
*/
async function confirmHandler(req, res, deps) {
	if (!methodAllowed(req, res, "POST")) return;
	if (!originAllowed(req, res)) return;
	const read = await readJsonBodyOr400(req, res);
	if (read.ok !== true) return;
	const posted = read.body ?? {};
	const region = deps.regions.find((entry) => entry.id === posted.region);
	if (region === void 0) return sendJson(res, 400, { error: "unknown region" });
	const runtime = deps.started.find((entry) => entry.region.id === region.id)?.runtime;
	let credential;
	try {
		const read = deps.readCredential ?? ((id) => loadCredentialAsync(id, appDataRootFor()));
		credential = runtime !== void 0 ? await runtime.resolveCredential() : await read(region) ?? loadEnvCredential(region);
	} catch (error) {
		return sendJson(res, 200, {
			region: region.id,
			available: false,
			detail: describeThrown(error).slice(0, 300)
		});
	}
	if (credential === void 0) return sendJson(res, 200, {
		region: region.id,
		available: false
	});
	try {
		const info = await (deps.confirmUserInfo ?? fetchUserInfo)(region, credential);
		return sendJson(res, 200, {
			region: region.id,
			available: true,
			confirmed: true,
			identity: {
				name: info.name,
				email: info.email
			}
		});
	} catch (error) {
		if (isProtocolShapeChangedError(error)) return sendJson(res, 200, {
			region: region.id,
			available: true,
			confirmed: false,
			kind: "protocol-shape-changed",
			detail: describeThrown(error).slice(0, 300)
		});
		const message = describeThrown(error);
		const kind = classifyUpstreamError({ message }, "", message).kind;
		if (kind === "sign-in-expired" && runtime !== void 0) runtime.invalidateCredential();
		return sendJson(res, 200, {
			region: region.id,
			available: true,
			confirmed: false,
			kind: kind === "sign-in-expired" ? "sign-in-expired" : "unavailable",
			detail: message.slice(0, 300)
		});
	}
}
/** The region a request names, but only if it is one this plugin knows. */
function namedRegion(value, regions) {
	const posted = value ?? {};
	if (typeof posted.region !== "string") return void 0;
	return regions.some((region) => region.id === posted.region) ? posted.region : void 0;
}
/** The region a query string names, on the routes a GET cannot put one in a body. */
function queriedRegion(req, regions) {
	const requested = new URL(req.url ?? "/", "http://127.0.0.1").searchParams.get("region");
	if (requested === null) return void 0;
	return regions.some((region) => region.id === requested) ? requested : void 0;
}
/**
* Begin a device sign-in and hand back the URL the user must approve.
*
* The attempt is tracked host-side and answered with a URL rather than
* completed here: waiting up to five minutes inside one request would occupy a
* route per attempt and lose the attempt if the panel was reloaded. The card
* polls {@link deviceLoginPollHandler} instead.
*
* An unknown region is a 404 with the same `unknown-region` code the check-in
* route uses, so the card has one shape to read across the account surface.
*/
async function deviceLoginStartHandler(req, res, deps) {
	if (!methodAllowed(req, res, "POST")) return;
	if (!originAllowed(req, res)) return;
	const read = await readJsonBodyOr400(req, res);
	if (read.ok !== true) return;
	const regionId = namedRegion(read.body, deps.regions);
	if (regionId === void 0) return sendJson(res, 404, { error: "unknown-region" });
	const started = deps.flow.start(regionId);
	if (started.kind !== "started") {
		deps.logger.warn?.(`dsh-connect-qoder: no device-login product for region ${regionId}`);
		return sendJson(res, 404, { error: "unknown-region" });
	}
	return sendJson(res, 200, {
		region: started.region,
		authUrl: started.authUrl,
		expiresAt: started.expiresAt
	});
}
/**
* One poll of a region's attempt.
*
* The answer is a state the card can render directly, and the states are kept
* distinct on purpose: `idle` means the card is polling something that is not
* there (a reloaded panel), `expired` means the user waited too long and must
* start again, and `failed` carries the reason. Collapsing them into "not
* signed in yet" would leave the user polling a dead attempt forever.
*
* A GET with the region in the query string: it changes no state the caller
* cares about beyond redeeming the code, and the card issues it on a timer.
*/
async function deviceLoginPollHandler(req, res, deps) {
	if (!methodAllowed(req, res, "GET")) return;
	if (!originAllowed(req, res)) return;
	const regionId = queriedRegion(req, deps.regions);
	if (regionId === void 0) return sendJson(res, 404, { error: "unknown-region" });
	const result = await deps.flow.poll(regionId);
	if (result.kind === "failed") {
		deps.logger.warn?.(`dsh-connect-qoder: device sign-in for ${regionId} failed: ${result.reason}`);
		return sendJson(res, 200, {
			state: "failed",
			reason: result.reason
		});
	}
	if (result.kind === "unsupported-region") return sendJson(res, 404, { error: "unknown-region" });
	return sendJson(res, 200, { state: result.kind });
}
/**
* Abandon an attempt.
*
* Deliberately not an error when there was nothing to cancel: a card that
* unloads twice, or a user who closed the panel after the attempt expired, both
* land here, and neither is a problem worth a sentence.
*/
async function deviceLoginCancelHandler(req, res, deps) {
	if (!methodAllowed(req, res, "POST")) return;
	if (!originAllowed(req, res)) return;
	const read = await readJsonBodyOr400(req, res);
	if (read.ok !== true) return;
	const regionId = namedRegion(read.body, deps.regions);
	if (regionId === void 0) return sendJson(res, 404, { error: "unknown-region" });
	return sendJson(res, 200, {
		region: regionId,
		cancelled: deps.flow.cancel(regionId)
	});
}
/**
* Sign this machine out of the plugin's own credential.
*
* Only the plugin's file is deleted; the desktop application's login, a PAT in
* the environment, and the other region's file are all untouched. Saying so in
* the answer is the point — "signed out" that silently also dropped a PAT would
* be a surprise the user cannot undo from the panel.
*
* A `false` from `forget` is a 500, not a cheerful 200: the credential is still
* on disk, so the next request would sign the user straight back in, and the
* only honest thing to report is that the sign-out did not happen.
*/
async function deviceLoginSignOutHandler(req, res, deps) {
	if (!methodAllowed(req, res, "POST")) return;
	if (!originAllowed(req, res)) return;
	const read = await readJsonBodyOr400(req, res);
	if (read.ok !== true) return;
	const regionId = namedRegion(read.body, deps.regions);
	if (regionId === void 0) return sendJson(res, 404, { error: "unknown-region" });
	deps.flow.cancel(regionId);
	let forgotten;
	try {
		forgotten = await deps.forget(regionId);
	} catch (error) {
		deps.logger.error?.(`dsh-connect-qoder: could not sign out of the device credential for ${regionId}`, error);
		return sendJson(res, 500, {
			error: "sign-out-failed",
			detail: describeThrown(error).slice(0, 300)
		});
	}
	if (!forgotten) return sendJson(res, 500, {
		error: "sign-out-failed",
		detail: "the credential file could not be removed, so it is still in use"
	});
	return sendJson(res, 200, {
		region: regionId,
		signedOut: true,
		device: deps.status(regionId)
	});
}

//#endregion
//#region src/host/device-login-flow.ts
/**
* The sign-in conversation a user actually has: start one, poll it, cancel it.
*
* The probe (`probe/qoder-device-login.mjs`) proved the protocol by driving it
* to completion in a single process. This module is the same protocol split
* into the steps a browser can drive — because the alternative, a Host that
* holds the request open for up to five minutes waiting for the user to tap
* "authorize", would tie up a route per attempt and lose the attempt entirely
* if the panel was closed or DSH restarted.
*
* So the session lives here, in memory, keyed by region, and the card polls it
* every two seconds (`POLL_MS` in `src/client/device-login-panel.tsx`).
* Nothing about the pending session is written to disk: a
* half-finished sign-in is not worth surviving a restart, and the verifier is a
* secret that does not need a persistence story. An attempt that is never
* finished ages out instead.
*
* The module knows nothing about vaults or credentials. It answers one
* question — "has this attempt been authorized yet, and if not, why not" — and
* hands what it obtains to its caller, which is what makes the flow itself
* testable without a Host, a disk, or a network.
*/
/**
* How long one attempt stays alive before the user is asked to start again.
*
* The service's own window is what this mirrors; the probe's default is the
* same five minutes. It is enforced host-side rather than left to the card so
* that a card which stops polling — closed tab, reloaded panel — cannot leave a
* session behind forever.
*/
const LOGIN_ATTEMPT_TTL_MS = 3e5;
var DeviceLoginFlow = class {
	attempts = /* @__PURE__ */ new Map();
	deps;
	now;
	ttlMs;
	constructor(deps) {
		this.deps = deps;
		this.now = deps.now ?? Date.now;
		this.ttlMs = deps.ttlMs ?? 3e5;
	}
	/** Whether an attempt is in flight for a region. Read by the account panel. */
	pending(regionId) {
		return this.live(regionId) !== void 0;
	}
	/**
	* Begin an attempt, replacing any previous one for the region.
	*
	* Replacing rather than refusing is deliberate: a user whose first window
	* expired has no other way forward than to ask again, and two live verifiers
	* for one region would make "which one is being polled" ambiguous.
	*/
	start(regionId) {
		const product = productForRegion(regionId);
		if (product === void 0) return { kind: "unsupported-region" };
		const session = createDeviceSession(regionId);
		const startedAt = this.now();
		this.attempts.set(regionId, {
			session,
			startedAt
		});
		return {
			kind: "started",
			region: regionId,
			authUrl: buildAuthUrl(product, session),
			expiresAt: startedAt + this.ttlMs
		};
	}
	/**
	* One poll. The card calls this on its own cadence and decides when to stop.
	*
	* A single poll rather than a loop inside: the card already owns a timer, and
	* a loop here would make "the user closed the panel" and "the service is
	* slow" indistinguishable to the code trying to end the attempt.
	*/
	async poll(regionId) {
		const attempt = this.live(regionId);
		if (attempt === void 0) return this.attempts.has(regionId) ? { kind: "expired" } : { kind: "idle" };
		const product = productForRegion(regionId);
		if (product === void 0) return { kind: "unsupported-region" };
		const outcome = await pollOnce(product, attempt.session, this.deps.fetchImpl ?? fetch);
		if (outcome.kind === "pending") return { kind: "pending" };
		if (outcome.kind === "failed") {
			this.attempts.delete(regionId);
			return {
				kind: "failed",
				reason: outcome.name
			};
		}
		this.attempts.delete(regionId);
		try {
			await this.deps.onAuthorized(regionId, outcome.payload, attempt.session.machineID);
		} catch (error) {
			const reason = error instanceof Error && error.message !== "" ? error.message : "the credential could not be stored";
			this.deps.logger?.warn?.(`dsh-connect-qoder: signed in but could not store the credential (${reason})`);
			return {
				kind: "failed",
				reason
			};
		}
		return { kind: "authorized" };
	}
	/** Drop an attempt without waiting for its TTL. Returns whether one existed. */
	cancel(regionId) {
		return this.attempts.delete(regionId);
	}
	/** Drop every attempt, for dispose. */
	clear() {
		this.attempts.clear();
	}
	live(regionId) {
		const attempt = this.attempts.get(regionId);
		if (attempt === void 0) return void 0;
		if (this.now() - attempt.startedAt >= this.ttlMs) return void 0;
		return attempt;
	}
};

//#endregion
//#region src/host/region-gate.ts
/**
* Decide from a resolved credential.
*
* @param credential - the resolved credential, or `undefined` when none exists.
* @param region - the region descriptor, for the message.
* @returns `{ ok: true }`, or `{ ok: false, level, message }` where `level` is
*   `'warn'` for something the user must act on and `'info'` for the ordinary
*   "not signed in yet" case.
*/
function regionPublishDecision(credential, region) {
	if (credential === void 0 || credential === null) return {
		ok: false,
		level: "info",
		message: `dsh-connect-qoder: ${region.displayName} has no local sign-in; region not registered`
	};
	if (credential.expired === true) return {
		ok: false,
		level: "warn",
		message: `dsh-connect-qoder: ${region.displayName} sign-in has expired; region not registered (open the ${region.displayName} app to renew it, then re-read from the Qoder card or restart DSH)`
	};
	return { ok: true };
}
/**
* The refusal for a sign-in that could not even be read.
*
* Separate from {@link regionPublishDecision} because it is a THROW, not an
* absent credential: the unwrap layer failed in a way it could report, and the
* error object is the diagnosis. The two are deliberately not merged — a
* missing sign-in is the normal state of a fresh install and is logged at info,
* while an unreadable one is a problem the user has to see.
*
* @param region - the region descriptor, for the message.
* @returns the `{ level, message }` pair describing the refusal.
*/
function unreadableSignInDecision(region) {
	return {
		level: "warn",
		message: `dsh-connect-qoder: ${region.displayName} sign-in is unusable; region not registered`
	};
}

//#endregion
//#region src/host/index.ts
/**
* DSH Connect Qoder — bring locally signed-in Qoder models into DeepSeek
* Harness.
*
* The Qoder desktop apps (Qoder CN and the international Qoder) already hold a
* valid sign-in on this machine. This bundle reads that sign-in, registers one
* DSH provider per region, and routes each region's traffic through a private
* loopback shim that speaks OpenAI to pi-ai and COSY-signed Qoder on the way
* out.
*
* Both regions register unconditionally and independently: whichever apps are
* signed in produce a visible model group, and a region with no credential
* simply contributes no models. Nothing here starts an OAuth flow, and nothing
* writes to the Qoder apps' own files.
*
* @module dsh-connect-qoder
*/
/** Loader row id; also the plugin's identity in the composition. */
const name = "llm-qoder";
/** The model registry that must exist before a provider can register. */
const inject = ["llm"];
/**
* Settings namespace owning this plugin's section.
*
* A namespace only becomes configurable once a section is installed into it —
* `registerConfigurableProviders` merely *addresses* the namespace. Without the
* section there is no schema, so no configuration surface can render a control
* for this route at all.
*/
const QODER_SETTINGS_NS = "dsh-connect-qoder";
/**
* The settings fields a `__save` request may write, and the merge rule each
* one uses, live in lib/settings-save.js — alongside the write-and-verify logic
* that uses them, which is what the tests exercise.
*/
/** Plugin-owned route the settings card's save button writes through. */
const QODER_SAVE_PATH = "/plugins/dsh-connect-qoder/__save";
/**
* Why every settings field in this module ends in `.volatile()`.
*
* A volatile field hands the Host a live reference (`{get()}`) that
* re-resolves on every `loader/volatile-update` — that is how settings
* edits reach a running host without a restart. The Host's `__save` route
* unwraps the reference before merging and mutating, and the live
* `current()` below resolves it the same way. This plugin targets the 0.2
* host line, whose bundled schemastery (≥ 3.18.3) always carries
* `Schema.volatile()`, so the fields call it directly; there is no no-op
* fallback for an older schemastery to degrade to.
*/
/**
* The `id` of a catalog entry, or `undefined` when it has none.
*
* `CatalogLike.current()` is `unknown[]` (see its doc), and every lookup by
* model id goes through here rather than reading `entry.id` directly. An entry
* that is not an object, or whose `id` is not a string, matches nothing —
* which is the same "not this model" answer the old `entry.id === modelId`
* gave, except that it no longer throws on a malformed row.
*/
function idOf(entry) {
	const id = entry?.id;
	return typeof id === "string" ? id : void 0;
}
/**
* Prefer the largest context window the catalog declares for a model.
*
* Qoder's catalog offers 200K/400K/1M for most models and flags one as its own
* default. This switch decides whether this plugin advertises the largest
* offered window or the one Qoder itself starts on.
*/
const USE_MAXIMUM_CONTEXT_WINDOW_FIELD = z.boolean().default(false).description("Advertise each model's largest declared context window instead of Qoder's own default window").volatile();
/** One model's image preference. */
const IMAGE_OVERRIDES_FIELD = z.dict(z.union([
	"auto",
	"on",
	"off"
])).default({}).description("Per-model image input: \"auto\" follows the catalog, \"on\"/\"off\" force it").volatile();
/**
* Which models the picker offers, per region.
*
* An **empty list means "no filter"**, not "nothing": that is the same
* convention the WorkBuddy bundle uses, and it is what keeps a fresh install
* working — a new user has saved nothing yet, and must still see every model.
* Once a list is non-empty it becomes an allow-list for that region.
*
* Keyed by region id (`qoder-cn`, `qoder`) so the two editions can be curated
* independently; the CN and global rosters share no model ids.
*/
const ENABLED_MODEL_IDS_FIELD = z.dict(z.array(z.string())).default({}).description("Per-region allow-list of model ids; an empty list shows every model").volatile();
/**
* Which editions offer their models to DSH at all, per region.
*
* The account panel's per-region "models" switch writes this field through the
* settings pipeline. Declaring it here is not optional: the host validates
* every `settings.mutate` field against this schema and accepts only fields
* that are declared AND volatile — an undeclared field is refused with
* `Config field "enabledRegions" is not volatile`, and the card's switch dies
* with that error. Opt-out semantics match `regionEnabledFor` in
* lib/preferences.js: a missing key (or a missing map) means offered, and only
* an explicit `false` turns a region's models off.
*/
const ENABLED_REGIONS_FIELD = z.dict(z.boolean()).default({}).description("Per-region provider switch; a missing key is offered, only an explicit false disables").volatile();
/** The plugin's whole configuration schema. */
const Config = z.object({
	useMaximumContextWindow: USE_MAXIMUM_CONTEXT_WINDOW_FIELD,
	imageOverrides: IMAGE_OVERRIDES_FIELD,
	enabledModelIds: ENABLED_MODEL_IDS_FIELD,
	enabledRegions: ENABLED_REGIONS_FIELD
});
/** Plugin-owned read-only route the settings card reads its model rows from. */
const QODER_MODELS_PATH = "/plugins/dsh-connect-qoder/models";
/**
* Plugin-owned read-only route that answers "did this plugin finish coming up,
* and if not, at which step".
*
* It always exists and always answers, so "still activating" and "this plugin
* serves no such route" stay distinguishable — a failed `llm` registration used
* to look like the latter (docs/issues/20). It reports the provider-registration
* step only: the one step whose failure does not stop the card from being
* available.
*/
const QODER_STATUS_PATH = "/plugins/dsh-connect-qoder/status";
/**
* The rate helpers `projectModelRow` resolves against, passed in rather than
* imported there so that projection stays a pure, directly testable function.
*/
const MODEL_RATES = {
	rateNow,
	offPeakActive,
	offPeakRemaining
};
/**
* Plugin-owned read-only route the card reads its usage panel from.
*
* Kept separate from the model route so the panel can be refreshed on its own:
* quota moves with every turn, while the catalog changes rarely.
*/
const QODER_USAGE_PATH = "/plugins/dsh-connect-qoder/usage";
/**
* Plugin-owned write route: "claim today's check-in".
*
* The one route in this plugin that changes something on Qoder's side, and the
* reason it is shaped the way `dsh-connect-workbuddy`'s own check-in route is:
* region-scoped, POST-only, loops back through this host rather than letting
* the card talk to Qoder directly.
*
* Every claim re-reads the campaign list first. Qoder publishes a new round —
* and therefore a new campaign id — each day, so nothing about today's round
* may be carried over from an earlier render.
*/
const QODER_CHECKIN_PATH = "/plugins/dsh-connect-qoder/checkin";
/**
* Plugin-owned read-only route the card reads its account panel from.
*
* Answers with one state record per region from `lib/account-state.js`:
* which sign-in drives this machine, in which state it is, and — for the
* "cannot read" state — the recorded cause. Identity only, no credential:
* this is a browser-visible surface.
*/
const QODER_ACCOUNT_PATH = "/plugins/dsh-connect-qoder/account";
/**
* Plugin-owned write route: "re-read the sign-ins, now".
*
* The card's reload button. A sign-in that was missing or expired at
* activation never produced a runtime for its region, so the fix is not just
* to invalidate the caches — it is to (re)start the regions that are readable
* now and publish them. Answers with the fresh account states so the card
* can re-render without a second round trip.
*/
const QODER_ACCOUNT_RELOAD_PATH = "/plugins/dsh-connect-qoder/account/reload";
/**
* Plugin-owned write route: "is this region's sign-in still valid, online?".
*
* The card's confirm button. Calls `fetchUserInfo` with the region's
* credential and reports whether the upstream still accepts it — the one
* network call in the account flow, kept behind its own route so an
* account render stays network-free.
*/
const QODER_ACCOUNT_CONFIRM_PATH = "/plugins/dsh-connect-qoder/account/confirm";
/**
* Begin a device sign-in: answers with the URL the user approves in a browser.
*
* The Plugin's own sign-in, not the desktop application's. Four routes rather
* than one because the user's part takes up to five minutes: holding a request
* open for that long would occupy a route per attempt and lose the attempt if
* the panel was reloaded. The card polls.
*/
const QODER_DEVICE_LOGIN_START_PATH = "/plugins/dsh-connect-qoder/device-login/start";
/** One poll of a pending attempt; the card repeats it until it resolves. */
const QODER_DEVICE_LOGIN_POLL_PATH = "/plugins/dsh-connect-qoder/device-login/poll";
/** Abandon a pending attempt (the user closed the panel, or changed their mind). */
const QODER_DEVICE_LOGIN_CANCEL_PATH = "/plugins/dsh-connect-qoder/device-login/cancel";
/**
* Delete this plugin's stored credential.
*
* Only the plugin's own file: the desktop application's login, a PAT in the
* environment, and the other region's file are untouched, and the answer says
* so rather than leaving the user to discover it.
*/
const QODER_DEVICE_LOGIN_SIGNOUT_PATH = "/plugins/dsh-connect-qoder/device-login/signout";
/**
* How long a fetched usage reading stays fresh.
*
* Quota moves only when a turn runs, so a short cache keeps the panel honest
* without turning every card render into an upstream round trip. The refresh
* button bypasses it.
*/
const USAGE_TTL_MS = 2e4;
/** How long a fetched catalog stays fresh before it is refetched. */
const CATALOG_TTL_MS = CATALOG_TTL_MS$1;
/** Plugin-owned catalog path inside the Harness home. */
function qoderCatalogPath(filename = ".qoder-catalog.json") {
	return join(resolveDshHome(), filename);
}
/**
* One region's own credential file, and the reader/rotator over it.
*
* The path follows the catalog's and the PAT throttle's convention
* (`.qoder-*.<region>.json`): one file per region, so switching tabs cannot
* cross credentials and signing out of one edition cannot delete the other's.
* It lives under the Harness home rather than the application's data root on
* purpose — this file is the plugin's, not the application's, and it is the one
* credential the user obtained through the plugin.
*
* Returned to every caller that needs THE instance for a region (the runtime
* that resolves with it, the routes that read and clear it), because two
* instances over one path would mean two failure windows and two stale caches.
*/
function deviceSourceFor(region, ctx) {
	return new DeviceCredentialSource({
		region: region.id,
		vault: new CredentialVault({
			path: qoderCatalogPath(`.qoder-auth.${region.id}.json`),
			logger: ctx.logger
		}),
		logger: ctx.logger
	});
}
/**
* One region's credential cache: the desktop store, the plugin's own
* credential and the PAT, in that order, with the PAT exchange and its
* throttle.
*
* Built here rather than inside {@link RegionRuntime} so the confirm route can
* resolve a credential for a region that has no runtime yet, through the SAME
* cache that runtime would use — one store read, one PAT exchange and one
* invalidation per region, instead of two caches over one credential.
*/
function credentialCacheFor(region, ctx, device) {
	return new CredentialCache({
		loadApp: () => loadCredentialAsync(region, appDataRootFor()),
		loadDevice: () => device.load(),
		loadEnv: () => loadEnvCredential(region),
		exchangePat: async (credential) => exchangePat(region, credential.token),
		throttleStore: new FileThrottleStore({
			path: qoderCatalogPath(`.qoder-exchange-throttle.${region.id}.json`),
			logger: ctx.logger
		})
	});
}
/**
* Owns one region: its credential, catalog, shim, adapter, and registration.
*/
var RegionRuntime = class {
	/** The region descriptor this runtime owns. */
	region;
	/** The Cordis context this runtime was activated with. */
	ctx;
	/** The plugin logger. */
	logger;
	/** The on-disk catalog cache for this region. */
	catalog;
	/**
	* When each model in this region's roster was first seen, so the composer
	* pill can mark the ones that arrived recently.
	*
	* It is the plugin's OWN history, not a gateway fact: Qoder's catalog rows
	* carry no "listed since" field, so "new to this user" can only mean "absent
	* from the roster this plugin wrote down last time". The wording downstream
	* says exactly that ("本机首次见到"), never "网关新增".
	*
	* Written on the refresh commit path only — never by the models route, which
	* is a GET and documents itself as not changing state. See
	* {@link RegionRuntime.noteRoster}.
	*/
	rosterSeen;
	/** The per-region credential cache. */
	credentials;
	/**
	* The region's own credential — the one device login obtained — kept in a
	* file this plugin owns under DSH home.
	*
	* Held as a field rather than closed over inside the cache so the account
	* routes and the status surface can ask what happened to it: "the file is
	* damaged" and "nobody has signed in here" are different sentences to a user
	* even though both resolve to no credential. See `device-credential.ts`.
	*/
	device;
	/** The refresh interval handle, or `undefined` when stopped. */
	refreshTimer;
	/** The last usage reading, or `undefined` before the first read. */
	usage;
	/** Epoch ms of the last usage reading. */
	usageAt;
	/**
	* Bumped by {@link RegionRuntime.invalidateUsage}, and captured by a read
	* before it awaits so a superseded answer can tell it is superseded.
	*
	* This is the half of invalidation the cache fields alone cannot express:
	* clearing `usage`/`usageAt` says nothing to a fetch that is already in
	* flight, and that fetch would otherwise write its pre-invalidation answer
	* back with a fresh timestamp. See {@link RegionRuntime.doReadUsage}.
	*/
	usageGeneration;
	/** One live catalog run, shared across triggers. */
	catalogFlight;
	/** One live usage run, shared across triggers. */
	usageFlight;
	/** Whether this runtime has been disposed. */
	disposed;
	/** The controller for the catalog fetch currently in flight. */
	refreshAbort;
	/** Why the last refresh did not produce a catalog, or `undefined`. */
	refreshFailed;
	/**
	* Re-advertise the provider after a catalog change.
	*
	* Assigned by {@link wireRuntime} once the adapter pair exists, and read by
	* `applyCatalogOutcome` — hence optional: a refresh that lands before the
	* adapter is registered has nothing to tell, and the `?.` there is what
	* makes that a no-op instead of a crash. It is a field rather than a method
	* because the behaviour it triggers (rebuild the adapter, emit the Host
	* event) belongs to the activation scope, not to the region.
	*/
	invalidate;
	constructor(region, ctx, device, credentials) {
		this.region = region;
		this.ctx = ctx;
		this.logger = ctx.logger;
		this.catalog = new CatalogStore({
			path: qoderCatalogPath(`.qoder-catalog.${region.id}.json`),
			logger: ctx.logger
		});
		/**
		* The roster history. Per region, like the catalog it describes: the two
		* editions list different models, so one shared file would have each
		* region's refresh mark the other's models as "gone" and re-announce them
		* on the next poll.
		*/
		this.rosterSeen = new RosterSeenStore({
			path: qoderCatalogPath(`.qoder-roster-seen.${region.id}.json`),
			logger: ctx.logger
		});
		/**
		* The region's own credential file, and the reader/rotator over it.
		*
		* Handed in rather than built here because the sign-in routes write a
		* credential for regions that have not started. The fallback exists only so
		* a runtime can still be constructed standalone (the tests do that); every
		* activation path passes the shared instance, which is what keeps "the
		* panel's sign-out" and "this region's resolve" talking about one file.
		*/
		this.device = device ?? deviceSourceFor(region, ctx);
		/**
		* The credential cache, holding the app-store reader, the PAT fallback and
		* the exchange. It carries the "a re-sign-in needs no restart" rule, which
		* lives in its own module so it can be tested without a Cordis context.
		*
		* Handed in for the same reason the device source is: the confirm route
		* resolves a credential for a region that has not started, and it must go
		* through the SAME cache — one PAT exchange and one invalidation per
		* region, not two caches over one credential.
		*/
		this.credentials = credentials ?? credentialCacheFor(region, ctx, this.device);
		this.refreshTimer = void 0;
		/** Last usage reading and when it was taken; see {@link RegionRuntime.readUsage}. */
		this.usage = void 0;
		this.usageAt = 0;
		this.usageGeneration = 0;
		/** @type {() => Promise<void>} one live catalog run, shared. */
		this.catalogFlight = createSingleFlight(() => this.doRefreshCatalog());
		/** @type {(force?: boolean) => Promise<unknown>} one live usage run, shared. */
		this.usageFlight = createSingleFlight((force) => this.doReadUsage(force));
		this.disposed = false;
		/**
		* The controller for the catalog fetch currently in flight, so a dispose can
		* cut the request instead of only ignoring its answer. See
		* {@link RegionRuntime.doRefreshCatalog}.
		*
		* @type {AbortController | undefined}
		*/
		this.refreshAbort = void 0;
		/**
		* Why the last refresh did not produce a catalog, or `undefined` when the
		* current catalog IS the last upstream answer.
		*
		* "the fetch failed" and "the plugin is out of date" are different facts
		* that used to render alike — and one of them (docs/issues/05) let the card
		* announce a fresh "已更新" for a refresh that never happened. `reason` is
		* one of `credential` / `no-credential` / `fetch` /
		* `protocol-shape-changed`; the card maps the last to "update the plugin",
		* never to "sign in".
		*
		* @type {{ reason: string, error?: unknown } | undefined}
		*/
		this.refreshFailed = void 0;
	}
	/**
	* Resolve the current credential, exchanging a PAT when that is the source.
	*
	* The caching and invalidation rules live in `CredentialCache`, which takes
	* its store readers as arguments so they can be exercised without a
	* Cordis context or the desktop app's files.
	*/
	async resolveCredential() {
		return this.credentials.resolve();
	}
	/**
	* Invalidate the cached credential after an upstream sign-in rejection.
	*
	* The next {@link RegionRuntime.resolveCredential} call re-reads the app's
	* store, so a re-sign-in is picked up without a restart. This is called
	* from the shim when the upstream answers with a sign-in failure.
	*
	* The device source is told too, so that a rejection clears its 60 s "that
	* renewal was refused" window: a gateway rejection is independent evidence
	* that the credential on disk is no longer the whole story, and without this
	* a user who signs in again would still be held back by the window for up to
	* a minute. The reverse leak — a device rejection clearing the PAT throttle's
	* parked state — is deliberate and harmless: the parked state is this
	* region's, both live credentials are this region's, and the next resolve
	* re-reads whichever source wins anyway.
	*/
	invalidateCredential() {
		this.credentials.invalidate();
		this.device.retry();
	}
	/**
	* Refresh the model catalog from upstream, keeping the last good one on failure.
	*
	* Concurrent calls coalesce: while one run is live, later callers join its
	* promise instead of starting a second fetch. Joining is safe because a fetch
	* that began milliseconds ago is fresher than anything a duplicate would
	* return.
	*
	* There is no "refresh only when stale" mode on purpose: the refresh timer's
	* period IS the TTL cadence, and every trigger (timer, the card's
	* `?refresh=1`, the account reload) asks for a real fetch. A `catalog.fresh()`
	* early return used to guard a `force = false` that nothing ever passed —
	* a dead branch, gone.
	*/
	refreshCatalog() {
		return this.catalogFlight();
	}
	/** The actual refresh work behind {@link RegionRuntime.refreshCatalog}. */
	async doRefreshCatalog() {
		let credential;
		try {
			credential = await this.resolveCredential();
		} catch (error) {
			this.logger?.warn?.(`dsh-connect-qoder: ${this.region.displayName} credential resolution failed`, error);
			this.applyOutcome({
				ok: false,
				reason: "credential",
				error
			});
			return;
		}
		if (credential === void 0) {
			this.applyOutcome({
				ok: false,
				reason: "no-credential",
				error: void 0
			});
			return;
		}
		this.refreshAbort?.abort();
		this.refreshAbort = new AbortController();
		const { signal } = this.refreshAbort;
		try {
			const raw = await fetchModels(this.region, credential, signal);
			if (isRefreshObsolete(this)) return;
			const entries = raw.map((entry) => normalizeEntry(entry));
			if (this.applyOutcome({
				ok: true,
				entries
			}).committed) this.noteRoster(entries);
		} catch (error) {
			if (isRefreshObsolete(this)) return;
			this.logger?.warn?.(`dsh-connect-qoder: ${this.region.displayName} catalog refresh failed`, error);
			this.applyOutcome({
				ok: false,
				reason: isProtocolShapeChangedError(error) ? "protocol-shape-changed" : thrownFlag(error, "upstreamKind") === "daily-limit" ? "daily-limit" : "fetch",
				error
			});
		}
	}
	/**
	* Record one refresh outcome on this runtime.
	*
	* The rule itself lives in `lib/catalog-refresh.js` so it can be tested
	* without the Cordis peer dependencies; this is the seam that lets the
	* untestable runtime delegate to it.
	*
	* NEVER THROWS, and that is the contract rather than a convenience. Every
	* caller runs inside a `catch` or at the tail of an error path, and three of
	* the four call sites are not themselves guarded — so a throw from here would
	* escape `doRefreshCatalog` entirely, and every caller of THAT is a bare
	* `void runtime.refreshCatalog()` with no `.catch`. The consequences are
	* worse than a lost log line: `beginCatalogUpdates` installs its refresh
	* interval in a `.then`, so a rejection means the timer is never installed
	* and this region silently stops updating for the life of the plugin — the
	* exact staleness `catalog-refresh.ts` exists to report.
	*
	* Failing to record an outcome is therefore logged, not propagated: the
	* caller has already handled the failure being recorded, and this is the
	* second-order failure of *describing* it.
	*
	* @param outcome - `{ ok: true, entries }` or `{ ok: false, reason, error }`.
	*/
	applyOutcome(outcome) {
		try {
			return applyCatalogOutcome(this, outcome);
		} catch (error) {
			this.logger?.error?.(`dsh-connect-qoder: ${this.region.displayName} could not record a catalog refresh outcome`, error);
			return {
				committed: false,
				previousFailure: void 0
			};
		}
	}
	/**
	* Record the roster a committed refresh just served, and let the history
	* answer which models are new.
	*
	* Called from {@link RegionRuntime.doRefreshCatalog} only, so the models route
	* stays a pure read (docs/ROUTES.md row 1: `改状态 否`). A failure here is
	* logged and swallowed: the marker is a suggestion, and the alternative —
	* failing the refresh over a history file — would take the model list down
	* with it. The visible degradation is the marker's absence, which is the same
	* screen a first-ever run shows.
	*
	* @param entries - the entries the refresh committed.
	*/
	noteRoster(entries) {
		try {
			this.rosterSeen.note(entries.map((entry) => entry.id));
		} catch (error) {
			this.logger?.warn?.(`dsh-connect-qoder: ${this.region.displayName} roster history update failed`, error);
		}
	}
	/**
	* The ids still reading as "first seen recently", oldest first.
	*
	* A read with no write, so the models route can call it on every GET.
	*/
	newModelIds() {
		try {
			return this.rosterSeen.fresh();
		} catch (error) {
			this.logger?.warn?.(`dsh-connect-qoder: ${this.region.displayName} roster history unreadable`, error);
			return [];
		}
	}
	/**
	* Look up the upstream key for a user-facing model id.
	*
	* `catalog.current()` is `unknown[]` on purpose — `CatalogLike` is declared
	* as the minimum every consumer reads, so the offline suite's stand-in with
	* only `current()`/`replace()` still satisfies it, and the entries came off
	* `JSON.parse` of a file on disk. That makes narrowing the caller's job, and
	* this is it: an entry that is not an object, or has no string `id`, simply
	* does not match.
	*/
	upstreamKey(modelId) {
		const found = this.catalog.current().find((entry) => idOf(entry) === modelId);
		return typeof found?.key === "string" ? found.key : void 0;
	}
	/** The catalog entry behind a user-facing model id. */
	entryFor(modelId) {
		return this.catalog.current().find((entry) => idOf(entry) === modelId);
	}
	/**
	* Read the account's usage, with a short cache.
	*
	* The card is the only consumer and it can be expanded repeatedly, so a
	* reading taken moments ago is reused; `force` is what the panel's refresh
	* button asks for. A failure is never cached, so a transient upstream problem
	* does not pin the panel to an error state. Concurrent calls coalesce onto
	* one in-flight fetch, so mashing the button costs the upstream one request
	* per completed reading rather than one per click.
	*/
	readUsage(force = false) {
		return this.usageFlight(force);
	}
	/** The actual fetch behind {@link RegionRuntime.readUsage}. */
	async doReadUsage(force) {
		if (!force && this.usage !== void 0 && Date.now() - this.usageAt < USAGE_TTL_MS) return this.usage;
		const generation = this.usageGeneration;
		const credential = await this.resolveCredential();
		if (credential === void 0) return void 0;
		const usage = await fetchUsage(this.region, credential);
		if (generation === this.usageGeneration) {
			this.usage = usage;
			this.usageAt = Date.now();
		}
		return usage;
	}
	/**
	* Drop the cached usage reading, including any read already in flight.
	*
	* Claiming puts Credits into the very add-on quota this panel shows, so the
	* next render has to re-read rather than serve a number taken before the
	* claim. {@link RegionRuntime.doReadUsage}'s own freshness window would
	* otherwise keep the old balance on screen for its full TTL.
	*
	* Three things have to move together, and the first two alone were not
	* enough:
	*
	* 1. The generation, so a fetch already in flight — one that started before
	*    this claim and would otherwise write its pre-claim answer back with a
	*    fresh timestamp — is refused the cache write (see `doReadUsage`).
	* 2. The cache fields, so the next caller does not short-circuit on them.
	* 3. The flight slot itself. Without this the claim handler's own
	*    `readUsage(true)` simply JOINS the doomed pre-claim fetch and is handed
	*    the old balance — coalescing wins over `force`, because a joiner always
	*    receives the starting run's result. Releasing the slot is what makes
	*    the forced re-read actually start a new fetch.
	*/
	invalidateUsage() {
		this.usageGeneration += 1;
		this.usage = void 0;
		this.usageAt = 0;
		this.usageFlight.reset();
	}
};
/**
* Start one region's shim and catalog lifecycle.
*
* @param enabledIdsFor - `(regionId) => string[]`, the user's roster choice. The
*   shim needs it so `GET /v1/models` — the endpoint the picker's discovery
*   reads — narrows the catalog the same way the adapter does.
* @returns the runtime plus its shim, or `undefined` when the shim could not
*   listen (the region is then simply absent rather than fatal).
*/
async function startRegion(region, ctx, enabledIdsFor, sources, requestCounter, tokenCounter) {
	const runtime = new RegionRuntime(region, ctx, sources?.device, sources?.credentials);
	let credential;
	try {
		credential = await runtime.resolveCredential();
	} catch (error) {
		const refusal = unreadableSignInDecision(region);
		ctx.logger[refusal.level]?.(refusal.message, error);
		return;
	}
	const decision = regionPublishDecision(credential, region);
	if (decision.ok !== true) {
		ctx.logger[decision.level]?.(decision.message);
		return;
	}
	const shim = createQoderShim({
		region,
		resolveCredential: () => runtime.resolveCredential(),
		resolveModels: () => runtime.catalog.current(),
		resolveUpstreamKey: (id) => runtime.upstreamKey(id),
		resolveAlwaysThinking: (id) => runtime.entryFor(id)?.alwaysThinking === true,
		resolveEnabledIds: () => enabledIdsFor(region.id),
		invalidateCredential: () => runtime.invalidateCredential(),
		logger: ctx.logger,
		requestCounter,
		tokenCounter
	});
	try {
		await shim.ready;
	} catch (error) {
		try {
			await shim.close();
		} catch (closeError) {
			ctx.logger.warn?.(`dsh-connect-qoder: ${region.displayName} loopback endpoint could not be closed after a failed start`, closeError);
		}
		ctx.logger.error?.(`dsh-connect-qoder: ${region.displayName} loopback endpoint failed to start`, error);
		return;
	}
	return {
		region,
		runtime,
		shim
	};
}
/**
* Register every Qoder region.
*
* All regions are published through one adapter and one registration pair:
* `registerAdapter` maps a set of providers onto a single adapter, so calling
* it once per region would leave only the last provider owned.
*
* Activation is best-effort by design: this plugin contributes optional model
* routes, and a failure to do so must never take the profile down with it. The
* whole body is therefore guarded, so a fault here degrades to "Qoder models
* are absent" rather than a profile that cannot boot.
*
* @param ctx - the plugin context, with `llm` injected.
* @param config - the resolved plugin configuration.
*/
async function apply(ctx, config = {}) {
	try {
		await activate(ctx, config);
	} catch (error) {
		ctx.logger.error?.("dsh-connect-qoder: activation failed; Qoder models will be unavailable", error);
	}
}
/** The real activation sequence, called under {@link apply}'s guard. */
async function activate(ctx, config) {
	let preferences = config;
	const livePreferences = () => {
		const next = { ...config };
		for (const [key, value] of Object.entries(next)) if (value !== null && typeof value === "object" && typeof value.get === "function") next[key] = value.get();
		return next;
	};
	let invalidateAdapter = () => {};
	/**
	* The namespace the HOST actually serves this plugin's settings under.
	*
	* On the 0.2 line the host derives it from the Loader entry — `describe()`
	* reports `ns: entry.options.id`, which for this bundle is `llm-qoder`, not
	* the `dsh-connect-qoder` the plugin used to name. The models settings page
	* resolves a provider's configuration row by **exact** match on this value
	* (`namespaces.get(entry.settingsNs)`), so declaring the constant here drops
	* the Qoder rows from that page entirely: the configuration surface and the
	* model-discovery entry point both go missing, silently, with the plugin
	* itself still registered and answering. See `settingsNamespaceOf`.
	*/
	const settingsNs = settingsNamespaceOf(ctx, QODER_SETTINGS_NS);
	/** Resolve the live preferences, unwrapping the Loader's live-reference source. */
	const current = () => resolvePreferences(preferences, livePreferences);
	/**
	* The three settings taking effect needs the picker to rebuild: `invalidate`
	* re-snapshots the model list, and the emit is what makes every reader of the
	* catalog — DSH's model picker included — drop the stale copy.
	*/
	const refreshPicker = () => {
		invalidateAdapter();
		ctx.emit("llm/adapters-updated");
	};
	/** The models the user enabled for one region; empty means "no filter". */
	const enabledIdsFor$1 = (regionId) => enabledIdsFor(current(), regionId);
	setCredentialDiagnosticSink((message) => ctx.logger.warn?.(message));
	try {
		const reclaimed = sweepStaleOscryptDirs();
		if (reclaimed > 0) ctx.logger.info?.(`dsh-connect-qoder: reclaimed ${reclaimed} stale credential temp dir(s)`);
	} catch (error) {
		ctx.logger.warn?.("dsh-connect-qoder: stale credential temp sweep failed", error);
	}
	/**
	* Every region's sources, built once and shared with its runtime.
	*
	* Built here rather than inside {@link RegionRuntime} because the sign-in
	* routes must be able to WRITE a credential for a region that has not started
	* — which is the whole point: a machine with no desktop app has no started
	* region, and signing in is what creates one. A source owned by the runtime
	* would not exist yet at the moment the credential arrives.
	*
	* The credential cache lives in the same map for the same reason: the confirm
	* route resolves a credential for a region that has no runtime, and it has to
	* go through the SAME cache — one store read, one PAT exchange and one
	* invalidation per region, instead of two caches over one credential.
	*/
	const regionSources = /* @__PURE__ */ new Map();
	for (const region of REGIONS) {
		const device = deviceSourceFor(region, ctx);
		const credentials = credentialCacheFor(region, ctx, device);
		regionSources.set(region.id, {
			device,
			credentials,
			credentialKind: () => credentials.kind
		});
	}
	/**
	* The sign-in conversation, driven by the card.
	*
	* Stored host-side because the PKCE verifier must not travel to the browser;
	* see `device-login-flow.ts`.
	*/
	const loginFlow = new DeviceLoginFlow({
		onAuthorized: async (regionId, payload, machineID) => {
			const source = regionSources.get(regionId)?.device;
			if (source === void 0) throw new Error(`no device credential source for region ${regionId}`);
			await source.remember(payload, machineID);
		},
		logger: ctx.logger
	});
	/**
	* What the four sign-in routes read.
	*
	* `forget` and `status` go through the shared map rather than through a
	* runtime, because signing out of a region that never started is a case that
	* has to work: that region has a file on disk and no runtime at all.
	*/
	const deviceDeps = {
		regions: REGIONS,
		flow: loginFlow,
		forget: async (regionId) => await regionSources.get(regionId)?.device.forget() ?? false,
		status: (regionId) => regionSources.get(regionId)?.device.status ?? { state: "none" },
		logger: ctx.logger
	};
	const started = [];
	/**
	* Region ids whose start is currently in flight.
	*
	* Held separately from `started` because `started` records COMPLETION, and the
	* window that matters is the one before it: `startStoppedRegions` awaits a
	* credential read and `shim.ready` before it pushes, so the array alone
	* cannot witness a concurrent start. See the guard there.
	*/
	const pendingStarts = /* @__PURE__ */ new Set();
	/**
	* Whether this fiber's dispose effect has run.
	*
	* A region start that is STILL IN FLIGHT when the fiber is torn down lands
	* after `disposeFiber` has read `started` — the entry is pushed only once
	* `await startRegion` resolves — so nothing else would ever release it: the
	* shim's HTTP server would keep serving and its catalog interval would keep
	* firing for the life of the process. This flag is how a late start learns
	* that it must release its own entry instead of joining `started`.
	*/
	let disposed = false;
	const globalRequestCounter = new RequestCounter({
		basePath: (filename) => qoderCatalogPath(filename),
		logger: ctx.logger
	});
	const globalTokenCounter = new TokenCounter({
		basePath: (filename) => qoderCatalogPath(filename),
		logger: ctx.logger
	});
	const globalTokenHistoryCache = createTokenHistoryCache();
	for (const region of REGIONS) {
		const entry = await startRegion(region, ctx, enabledIdsFor$1, regionSources.get(region.id), globalRequestCounter, globalTokenCounter);
		if (entry !== void 0) started.push(entry);
	}
	if (started.length === 0) ctx.logger.warn?.("dsh-connect-qoder: no Qoder region could start; card routes stay up so the account panel can explain it");
	if (started.some((entry) => entry.region.id === "qoder")) {
		const umid = __dshQoderUmidState();
		if (umid.available !== true) ctx.logger.warn?.(`dsh-connect-qoder: ${umid.reason}; the international edition's daily check-in round cannot be claimed on this machine until it can`);
	}
	/**
	* Releases for the card routes this fiber registered, in registration order.
	*
	* Every `webServer.register` result goes through `rememberRouteRelease`, and
	* the fiber's cleanup calls `releaseRoutes`. Whether the host needs this is
	* not answerable from a plugin checkout (docs/issues/13) — see the module
	* header of lib/lifecycle.js for why collecting is correct either way.
	*
	* @type {(() => void)[]}
	*/
	const routeReleases = [];
	const buildAdapter = () => createQoderAdapter({
		regions: started.map(({ runtime, shim }) => ({
			region: runtime.region,
			shim,
			catalog: () => runtime.catalog.current()
		})),
		preferMaximumContext: () => preferMaximumContext(current()),
		imageModeFor: (modelId) => imageModeFor(current(), modelId),
		enabledIdsFor: enabledIdsFor$1,
		regionEnabled: (regionId) => regionEnabledFor(current(), regionId),
		resolveAttachments: () => ctx.get?.("attachments"),
		resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(attachments, (hostPath) => (ctx.get?.("fs"))?.processPathFromHostPath?.(hostPath), ref)
	});
	let adapter = started.length > 0 ? buildAdapter() : void 0;
	let releaseAdapter;
	let releaseDirectory;
	/**
	* Make the host offer the current set of started regions, replacing any
	* earlier registration.
	*
	* The adapter is rebuilt rather than mutated: it was constructed from the
	* region set that existed at that moment, and its region list is not a
	* mutable input. This matters for the account reload route — a region that
	* failed to start at activation (no sign-in, or an expired one) can come
	* online later, and only a re-built and re-registered pair offers it.
	*
	* On failure the previous registration is restored, so a bad re-publish can
	* never take down regions that were already serving. The previous pair's
	* own release functions are captured before the new registration replaces
	* them, and re-invoking a release twice is harmless — both `registerAdapter`
	* and `registerConfigurableProviders` return idempotent releases.
	*
	* @returns `{ ok, error }`
	*/
	/**
	* One region's registration row for `registerConfigurableProviders`.
	*
	* `settingsPath` is the empty list rather than a path: this plugin serves its
	* own settings section under {@link settingsNs}, so it registers no
	* configurable sub-schema for the host to walk. `declared: false` says the
	* same thing from the other side. Both are stated explicitly because an empty
	* array here is a deliberate "none", not an unfinished value.
	*/
	const providerRowFor = (runtime) => ({
		provider: runtime.region.id,
		displayName: runtime.region.displayName,
		settingsNs,
		settingsPath: [],
		declared: false
	});
	function publishRegions$1() {
		const previousAdapter = adapter;
		const previousReleases = {
			releaseAdapter,
			releaseDirectory
		};
		const previousProviderIds = started.map(({ runtime }) => runtime.region.id);
		const previousDirectory = started.map(({ runtime }) => providerRowFor(runtime));
		if (started.length === 0) return { ok: true };
		adapter = buildAdapter();
		const result = publishRegions({
			providerIds: started.map(({ runtime }) => runtime.region.id),
			adapter: adapter.adapter,
			directory: started.map(({ runtime }) => providerRowFor(runtime)),
			invalidate: adapter.invalidate
		}, previousAdapter === void 0 ? void 0 : {
			providerIds: previousProviderIds,
			adapter: previousAdapter.adapter,
			directory: previousDirectory,
			invalidate: previousAdapter.invalidate
		}, previousReleases, {
			registerAdapter: (providerIds, adapter) => ctx.llm.registerAdapter(providerIds, adapter),
			registerConfigurableProviders: (rows) => ctx.llm.registerConfigurableProviders(rows),
			onRollbackFailed: (error) => ctx.logger.error?.("dsh-connect-qoder: a release did not complete", error)
		});
		releaseAdapter = result.releaseAdapter;
		releaseDirectory = result.releaseDirectory;
		invalidateAdapter = result.invalidate;
		return {
			ok: result.ok,
			error: result.error
		};
	}
	/** Wire one runtime's invalidation to the current adapter pair. */
	const wireRuntime = (runtime) => {
		runtime.invalidate = () => {
			invalidateAdapter();
			ctx.emit("llm/adapters-updated");
		};
	};
	for (const { runtime } of started) wireRuntime(runtime);
	const initial = publishRegions$1();
	let providerRegistrationError;
	if (initial.ok !== true) {
		providerRegistrationError = initial.error;
		ctx.logger.error?.("dsh-connect-qoder: provider registration failed; the card stays available and reports this on its status route", initial.error);
	}
	ctx.effect(() => async () => {
		disposed = true;
		const report = await disposeFiber({
			releaseAdapter,
			releaseDirectory,
			releaseRoutes,
			routeSink: routeReleases,
			runtimes: started.map(({ runtime }) => runtime),
			shims: started.map(({ shim }) => shim),
			timers: { clearInterval: (timer) => clearInterval(timer) }
		});
		if (report.releasedRoutes > 0) ctx.logger.debug?.(`dsh-connect-qoder: released ${report.releasedRoutes} card route registration(s)`);
		loginFlow.clear();
	});
	ctx.on?.("loader/volatile-update", () => {
		const next = current();
		if (next !== preferences) preferences = next;
		refreshPicker();
	});
	/**
	* Start the regions that are not running yet, publishing the widened set.
	*
	* Called from the account reload route: a region that could not start at
	* activation (no sign-in, or an expired one) left no runtime behind, so
	* there is nothing to invalidate — it must be started, which means building
	* a new shim and re-publishing the provider registration. A region that
	* still cannot start is left exactly as it was: no runtime, no route, and
	* the account panel keeps showing its state.
	*/
	async function startStoppedRegions(onlyRegionId) {
		let changed = false;
		for (const region of REGIONS) {
			if (onlyRegionId !== void 0 && region.id !== onlyRegionId) continue;
			if (started.some((entry) => entry.region.id === region.id)) continue;
			if (pendingStarts.has(region.id)) continue;
			pendingStarts.add(region.id);
			let entry;
			try {
				entry = await startRegion(region, ctx, enabledIdsFor$1, regionSources.get(region.id), globalRequestCounter, globalTokenCounter);
			} finally {
				pendingStarts.delete(region.id);
			}
			if (entry === void 0) continue;
			if (disposed) {
				await disposeLateEntry({ timers: { clearInterval: (timer) => clearInterval(timer) } }, {
					runtime: entry.runtime,
					shim: entry.shim
				});
				return;
			}
			started.push(entry);
			wireRuntime(entry.runtime);
			beginCatalogUpdates(entry.runtime);
			changed = true;
		}
		if (!changed) return;
		const outcome = publishRegions$1();
		if (outcome.ok !== true) {
			ctx.logger.error?.("dsh-connect-qoder: re-publishing the region set after reload failed; the previous registration is kept", outcome.error);
			return;
		}
		refreshPicker();
	}
	const accountPayload = (options = {}) => buildAccountPayload({
		regions: REGIONS,
		settings: current(),
		deviceStatus: deviceDeps.status,
		credentialKind: (regionId) => regionSources.get(regionId)?.credentialKind(),
		...options
	});
	/**
	* Everything the card routes need, handed over explicitly.
	*
	* The seven registrations below are top-level functions, so what they touch
	* has to be named somewhere they can see. Before this scope existed they were
	* inline `ctx.inject` blocks inside this function, and each one closed over a
	* different handful of the locals above — a route that needed a ninth thing
	* had no way to say so, it just reached for it, and the set of reachable
	* names changed with every edit above.
	*
	* A scope is that set, written down: a route that needs something it is not
	* given fails to compile instead of answering with `undefined`.
	*/
	const scope = {
		ctx,
		settingsNs,
		current,
		refreshPicker,
		regionSources,
		started,
		startStoppedRegions,
		deviceDeps,
		routeReleases,
		providerRegistrationError: () => providerRegistrationError,
		requestCounter: globalRequestCounter,
		tokenCounter: globalTokenCounter,
		tokenHistoryCache: globalTokenHistoryCache,
		accountPayload
	};
	registerSettingsSection(scope);
	registerStatusRoute(scope);
	registerModelsRoute(scope);
	registerSaveRoute(scope);
	registerUsageRoute(scope);
	registerCheckinRoute(scope);
	registerAccountRoutes(scope);
	for (const { runtime } of started) beginCatalogUpdates(runtime);
}
/**
* Start a region's first catalog fetch and its refresh timer.
*
* Extracted from the activation tail so a region that comes online later —
* through the account reload route, not at process start — gets exactly the
* same treatment, including the dispose guard:
*
* The first refresh may still be in flight when the fiber disposes (disable,
* hot reload, upgrade). Without this guard the timer installs onto a dead
* runtime and is never cleared again — a zombie credential-resolution loop
* that outlives the plugin.
*/
function beginCatalogUpdates(runtime) {
	runtime.refreshCatalog().catch((error) => {
		runtime.logger?.error?.(`dsh-connect-qoder: ${runtime.region.displayName} catalog refresh threw out of its own error handling`, error);
	}).then(() => {
		if (runtime.disposed) return;
		runtime.refreshTimer = setInterval(() => {
			runtime.refreshCatalog().catch((error) => {
				runtime.logger?.error?.(`dsh-connect-qoder: ${runtime.region.displayName} catalog refresh threw out of its own error handling`, error);
			});
		}, CATALOG_TTL_MS);
		runtime.refreshTimer.unref?.();
	});
}
/**
* Publish the settings surface.
*
* Without this the namespace a provider directory entry points at holds no
* schema, and no configuration surface can render a control for this route —
* context-window choice included. The 0.2 line serves it as an auto-form
* derived from the Loader entry's config schema: `configure({auto:true})`
* registers that presentation and nothing else — it does NOT hand the plugin a
* live source. The live seam is the Config object the Loader hands `apply`,
* whose volatile fields are updated in place after every `settings.mutate` and
* announced with `loader/volatile-update` (the listener in the activation).
* The 0.1.6 host used to publish a hand-built section through
* `installSection` and hand back its own document reference through
* `setSource`; that line no longer exists, and with it the second registration
* shape this used to probe for. A host without a settings service still gets
* working models, just no configuration surface.
*/
function registerSettingsSection(scope) {
	const { ctx } = scope;
	ctx.inject(["settings"], (settingsCtx) => {
		const settings = requireInjected(settingsCtx.settings, "settings");
		try {
			if (typeof settings.configure === "function") settings.configure({ auto: true }, ctx.fiber);
			else ctx.logger.warn?.("dsh-connect-qoder: settings service has no configure(); the configuration surface is unavailable");
		} catch (error) {
			ctx.logger.warn?.("dsh-connect-qoder: settings section unavailable", error);
		}
	});
}
/**
* Activation health, on a route that is mounted no matter how the provider
* registration went. See QODER_STATUS_PATH for why this exists, and the
* recording block in the activation for why the failure no longer unwinds it.
*
* `started` is reported as a count rather than a region list: this is a
* browser-visible surface, and how many regions came up is diagnostic while
* which sign-ins exist is the account panel's job (and has its own route).
* Which CREDENTIAL PATH each region is served by rides along, though: the
* count says how many came up, and this says whether the desktop application
* or the plugin's own sign-in is the one actually being used — the first
* question when the answer looks wrong.
*/
function registerStatusRoute(scope) {
	const { ctx, started, routeReleases, regionSources } = scope;
	ctx.inject(["webServer"], (webCtx) => {
		const webServer = requireInjected(webCtx.webServer, "webServer");
		mountRouteGroup(webServer, [{
			path: QODER_STATUS_PATH,
			handler: (req, res) => statusHandler(req, res, {
				startedCount: started.length,
				providerRegistrationError: scope.providerRegistrationError(),
				regions: REGIONS.map((region) => ({
					id: region.id,
					credentialKind: regionSources.get(region.id)?.credentialKind()
				}))
			})
		}], routeReleases, ctx.logger);
	});
}
/**
* The settings card needs the live model roster to render one row per model,
* and it cannot read the host catalog directly. This route is the only path,
* so it is mounted on the optional webServer context and answers with the
* catalog the adapter already holds — metadata only, never a credential.
*/
function registerModelsRoute(scope) {
	const { ctx, started, current, routeReleases } = scope;
	ctx.inject(["webServer"], (webCtx) => {
		const webServer = requireInjected(webCtx.webServer, "webServer");
		mountRouteGroup(webServer, [{
			path: QODER_MODELS_PATH,
			handler: (req, res) => modelsHandler(req, res, {
				started,
				currentSettings: current,
				logger: ctx.logger,
				rates: MODEL_RATES,
				providerRegistrationError: scope.providerRegistrationError()
			})
		}], routeReleases, ctx.logger);
	});
}
/**
* The card's save button writes through this authoritative Host endpoint
* (same pattern as the WorkBuddy bundle's `__save`): the settings document
* lives in the Host process, and on the DSH 0.2 line the client-side
* settings scope `set()` can settle WITHOUT persisting — the Host's
* atomic-write retries exhaust on a locked file, the scope reloads Host
* state, and returns success anyway. A read-back check catches that, but
* the only writer that actually lands the value there is a mutate executed
* inside the Host process.
*/
function registerSaveRoute(scope) {
	const { ctx, settingsNs, refreshPicker, routeReleases } = scope;
	ctx.inject(["webServer"], (webCtx) => {
		const webServer = requireInjected(webCtx.webServer, "webServer");
		mountRouteGroup(webServer, [{
			path: QODER_SAVE_PATH,
			handler: (req, res) => saveHandler(req, res, {
				getSettings: () => webCtx.get?.("settings"),
				settingsNs,
				fallbackNs: QODER_SETTINGS_NS,
				refreshPicker
			})
		}], routeReleases, ctx.logger);
	});
}
/**
* The usage panel needs the same treatment: the quota lives upstream behind a
* bearer token the browser must never hold, so the host reads it and hands the
* card a credential-free summary. Each region is read independently and a
* failing region is reported as unavailable rather than failing the panel, so
* one dead sign-in cannot hide the other region's numbers.
*/
function registerUsageRoute(scope) {
	const { ctx, started, routeReleases } = scope;
	ctx.inject(["webServer"], (webCtx) => {
		const webServer = requireInjected(webCtx.webServer, "webServer");
		mountRouteGroup(webServer, [{
			path: QODER_USAGE_PATH,
			handler: (req, res) => usageHandler(req, res, {
				started,
				logger: ctx.logger,
				umidState: __dshQoderUmidState,
				requestCounter: scope.requestCounter,
				tokenCounter: scope.tokenCounter,
				tokenHistoryCache: scope.tokenHistoryCache
			})
		}], routeReleases, ctx.logger);
	});
}
/**
* The daily check-in, from a route owned by this plugin.
*
* Nothing about it is automatic and nothing about it is guessed: the card
* names the region, this host re-reads Qoder's own campaign list, and only a
* round that is open and unclaimed is ever posted at. The card therefore
* cannot claim a stale round even if it were to render one.
*/
function registerCheckinRoute(scope) {
	const { ctx, started, routeReleases } = scope;
	ctx.inject(["webServer"], (webCtx) => {
		const webServer = requireInjected(webCtx.webServer, "webServer");
		mountRouteGroup(webServer, [{
			path: QODER_CHECKIN_PATH,
			handler: (req, res) => checkinHandler(req, res, {
				started,
				logger: ctx.logger
			})
		}], routeReleases, ctx.logger);
	});
}
/**
* The account panel, and the plugin's own sign-in.
*
* The account panel answers "which sign-in drives each region, and in which
* state" — all from local evidence, so reading it costs no network. It is
* where a "this region shows no models" stops being a mystery: the panel says
* whether the app is not installed, the sign-in expired, or the store cannot
* be read and why.
*/
function registerAccountRoutes(scope) {
	const { ctx, started, startStoppedRegions, deviceDeps, regionSources, accountPayload, routeReleases } = scope;
	ctx.inject(["webServer"], (webCtx) => {
		const webServer = requireInjected(webCtx.webServer, "webServer");
		mountRouteGroup(webServer, [
			{
				path: QODER_ACCOUNT_PATH,
				handler: (req, res) => accountHandler(req, res, {
					payload: accountPayload,
					logger: ctx.logger
				})
			},
			{
				path: QODER_ACCOUNT_RELOAD_PATH,
				handler: (req, res) => reloadHandler(req, res, {
					regions: REGIONS,
					started,
					startStoppedRegions,
					payload: accountPayload,
					logger: ctx.logger
				})
			},
			{
				path: QODER_ACCOUNT_CONFIRM_PATH,
				handler: (req, res) => confirmHandler(req, res, {
					regions: REGIONS,
					started,
					readCredential: async (region) => regionSources.get(region.id)?.credentials.resolve()
				})
			}
		], routeReleases, ctx.logger);
		mountRouteGroup(webServer, [
			{
				path: QODER_DEVICE_LOGIN_START_PATH,
				handler: (req, res) => deviceLoginStartHandler(req, res, deviceDeps)
			},
			{
				path: QODER_DEVICE_LOGIN_POLL_PATH,
				handler: (req, res) => deviceLoginPollHandler(req, res, deviceDeps)
			},
			{
				path: QODER_DEVICE_LOGIN_CANCEL_PATH,
				handler: (req, res) => deviceLoginCancelHandler(req, res, deviceDeps)
			},
			{
				path: QODER_DEVICE_LOGIN_SIGNOUT_PATH,
				handler: (req, res) => deviceLoginSignOutHandler(req, res, deviceDeps)
			}
		], routeReleases, ctx.logger);
	});
}

//#endregion
export { Config, QODER_SETTINGS_NS, apply, inject, name, qoderCatalogPath };