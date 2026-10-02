/**
 * The domain vocabulary the host modules annotate against.
 *
 * WHY THIS FILE EXISTS
 *
 * The modules under `src/host/` talk about the same handful of things — a
 * region, a catalog entry, a rate — and until now every one of them spelled
 * those things as an implicit `any`. That is not merely untidy: the annotation
 * for one module has to be written by hand, and two hand-written versions of
 * the same shape is exactly the drift this repository keeps finding. The drift
 * guard for that is a test, and a test per spelling is how it starts.
 *
 * So the shape is declared once, here, and imported. Three rules keep this from
 * becoming the thing it replaces:
 *
 * 1. NO peer-module shapes. `@deepseek-ai/dsh-llm`, `pi-ai`, `cordis` and the
 *    rest resolve from the Host runtime and are declared as `declare module`
 *    with no shape at all (see `types/dsh-peer-modules.d.ts`). Inventing a
 *    plausible-looking `Adapter` interface here would be a type that can be
 *    confidently wrong — worse than `any`, because `any` at least admits it.
 *    Where a module genuinely holds peer values, it says `unknown` or declares
 *    the minimum it reads, and that is visible in review.
 * 2. NO `any`. `unknown` where the value comes from outside, a real type where
 *    this plugin decides the shape.
 * 3. Structural, not nominal. The runtime objects are built by one module and
 *    consumed by another through plain property reads; the types describe what
 *    is read, not who built it.
 *
 * Types only — no runtime values, so importing this module costs nothing at
 * runtime and cannot change a bundle.
 *
 * @module dsh-connect-qoder/domain
 */

/**
 * One Qoder region: the CN edition, or the global edition.
 *
 * The plugin's own descriptor, built in `host/index.ts` — not a peer type.
 */
export interface Region {
  id: string
  displayName: string
}

/**
 * The time-of-day discount block, as this plugin NORMALIZES it.
 *
 * Note the spelling: these are NOT upstream's field names. `normalizePromotion`
 * (`upstream.ts`) renames the snake_case wire form on the way in —
 * `window_start` → `windowStart`, `before_promotion_price_factor` →
 * `beforePromotionPriceFactor`, `discount_factor` → `discountFactor` — and
 * every consumer downstream (offpeak, pi-model, the card) reads the normalized
 * names. The optional index signature below carries the bilingual `badge` /
 * `description` copy through untouched, which is why the block has to stay open.
 *
 * The four rate/window fields are all optional by construction: `normalizePromotion`
 * spreads them in only when they parsed, so a promotion with no usable factor
 * genuinely lacks the key rather than carrying a placeholder.
 */
export interface Promotion {
  /** Whether Qoder has switched this promotion on, re-read against the clock. */
  active?: boolean
  /** `HH:MM`, or `''` when upstream published no parseable window. */
  windowStart?: string
  /** `HH:MM`, or `''` — see {@link Promotion.windowStart}. */
  windowEnd?: string
  /** IANA zone the window is published in; defaults to `Asia/Shanghai`. */
  timezone?: string
  /** Multiplier inside the window, present only when it parsed as a number. */
  discountFactor?: number
  /** Multiplier before the window — the rate that applies during working hours. */
  beforePromotionPriceFactor?: number
  /** The bilingual copy, forwarded verbatim; see {@link Promotion}. */
  [field: string]: unknown
}

/**
 * One model as this plugin stores it, after `normalizeEntry`.
 *
 * This is the shape the catalog cache holds, the adapter projects into pi-ai
 * descriptors, and the card route re-projects for display — so a field added
 * here is a field three consumers can see.
 */
export interface CatalogEntry {
  /** Stable, display-name-derived id — the selector's key. */
  id: string
  /** The upstream key this model is requested by. */
  key: string
  /** The human name, as published. */
  name: string
  /** Qoder publishes image input support. */
  isVL?: boolean
  isReasoning?: boolean
  /** Whether the model offers selectable reasoning efforts. */
  supportsEffort?: boolean
  /** Whether the model reasons regardless of an effort selection. */
  alwaysThinking?: boolean
  effortLevels?: string[]
  maxInputTokens?: number
  defaultContextWindow?: number
  contextOptions?: unknown[]
  priceFactor?: number
  isFree?: boolean
  isDefault?: boolean
  promotion?: Promotion
}

/**
 * The credential a region resolved to, or nothing.
 *
 * `expired` is read with `=== true` everywhere it is consulted, because a
 * truthy-but-not-true value is not something this plugin produces and treating
 * it as expired would refuse to publish a working region.
 */
export interface ResolvedCredential {
  expired?: boolean
  [field: string]: unknown
}

/**
 * The `catalog` handle a runtime exposes: the store's public surface.
 *
 * Declared as the minimum every consumer reads, so a test stand-in with only
 * `current()` and `replace()` still satisfies it — the offline suite passes
 * exactly that shape.
 */
export interface CatalogLike {
  current(): unknown[]
  replace(entries: unknown[], now?: number): void
  fetchedAt?: number
}

/**
 * The failure a refresh left behind, per-reason.
 *
 * `credential` and `no-credential` and `fetch` are transient; a protocol shape
 * change is not, which is why the reason travels with the record instead of
 * being collapsed into a boolean.
 */
export interface RefreshFailure {
  reason: string
  error?: unknown
}

/**
 * The runtime shape the pure refresh/catalog helpers operate on.
 *
 * Every field is optional on purpose: these helpers exist to be called with
 * stand-ins by tests that cannot construct a Cordis runtime, and a type that
 * demanded the full runtime would push the tests back to hand-written shapes.
 */
export interface RefreshableRuntime {
  catalog?: CatalogLike
  refreshFailed?: RefreshFailure | undefined
  invalidate?: () => void
  disposed?: boolean
}

/**
 * What one catalog refresh produced: an answer or a failure.
 *
 * Discriminated on `ok`, and the success branch carries `entries` while the
 * failure branch carries `reason`/`error` — so reading `entries` after
 * narrowing on `ok === true` is checked, not merely permitted.
 */
export type CatalogOutcome =
  | { ok: true; entries: unknown[] }
  | { ok: false; reason: string; error?: unknown }

/** A logger the plugin writes warnings to, when the host supplies one. */
export interface PluginLogger {
  warn?(message: string, error?: unknown): void
}

/**
 * One raw campaign record, as `GET /sash/api/v1/me/campaigns` returns it.
 *
 * This is an UPSTREAM shape, not one this plugin mints — `claim.ts` reads it in
 * place and normalizes the answer, deliberately never handing the record itself
 * to the card (a stale campaign id could be clicked from a published state, so
 * the host re-reads before every claim).
 *
 * Every field is optional and the timestamps are `unknown`, not `number`: the
 * upstream is inconsistent here in a way `toEpochMs` exists to absorb — the
 * campaign list publishes second-precision integers while the claim endpoint for
 * the same round answers with RFC 3339 strings.
 */
export interface Campaign {
  /** `CLAIM_BENEFIT` for the round that pays; anything else never does. */
  actionType?: string
  /** `CLAIMED` once this account collected the round. */
  claimStatus?: string
  /** Seconds, milliseconds or an RFC 3339 string — see `toEpochMs`. */
  startAt?: unknown
  /** The alternative spelling the campaign list sometimes uses. */
  beginAt?: unknown
  /** Seconds, milliseconds or an RFC 3339 string — see `toEpochMs`. */
  endAt?: unknown
  /** The payout attached to a `CLAIM_BENEFIT` action, when there is one. */
  benefit?: {
    amount?: unknown
    kind?: unknown
    validity?: { days?: unknown }
  }
}

/**
 * The card-facing check-in state, shaped after `status.checkin`.
 *
 * The card renders a button and never derives `active` or `todayCheckedIn`
 * itself — that "one fact, one place" rule is what off-peak pricing cost this
 * plugin once, so the two fields are stated here and nowhere else.
 */
export interface CheckinState {
  /** Whether the upstream has a round running. */
  active: boolean
  /** Whether this account already collected it. */
  todayCheckedIn: boolean
  /** Only present when the round actually pays out. */
  amount?: number
  unit?: string
  validDays?: number
  endsAt?: number
}