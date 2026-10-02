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
 * The plugin's own descriptor, declared in `credentials.ts#REGIONS` — not a
 * peer type. The three URL families are deliberately separate fields rather
 * than one `baseUrl`: the gateway serves the chat protocol, the openapi host
 * serves model metadata, and the center host serves usage, and they are NOT
 * the same origin on either edition. Collapsing them was never done and must
 * not be.
 *
 * `appNames` / `newAppNames` are the two Electron user-data directory layouts,
 * newest first; `patEnvNames` are the environment variables that may carry a
 * personal access token for this region.
 */
export interface Region {
  id: string
  /** `'cn'` or `'global'` — selects protocol and locale differences. */
  mode: string
  displayName: string
  /** `%APPDATA%`-style roots, tried in order. */
  appNames: string[]
  /** The 0.3.x `com.<vendor>.app.<channel>` layout, tried first. */
  newAppNames?: string[]
  /** The COSY gateway root; chat and signing live here. */
  baseUrl: string
  /** Model metadata host — a different origin from {@link Region.baseUrl}. */
  openApiUrl: string
  /** Usage/quota host — a third origin again. */
  centerUrl: string
  manageUrl: string
  downloadUrl: string
  patEnvNames: string[]
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
 * The credential one region resolved to, or nothing.
 *
 * `expired` is read with `=== true` everywhere it is consulted, because a
 * truthy-but-not-true value is not something this plugin produces and treating
 * it as expired would refuse to publish a working region.
 *
 * The identity fields are what `authHeaders` signs: the gateway verifies an
 * `info` blob encrypted under a per-request AES key containing exactly these,
 * so a missing `userID` or `token` is not a degraded call — it produces a
 * signature the gateway will reject.
 */
export interface ResolvedCredential {
  expired?: boolean
  [field: string]: unknown
}

/**
 * The credential as the signing and chat paths consume it.
 *
 * A closed shape, not an open record, because every one of these is READ by
 * `authHeaders` and by `streamChat` — a field that is merely optional here
 * still has to be handled there, and typing them as `string` makes that
 * visible. `machineID` is the one that may legitimately be empty: it is a
 * machine fingerprint, and an absent one is sent as the empty string rather
 * than failing the request.
 */
export interface QoderCredential {
  userID: string
  token: string
  name?: string
  email?: string
  machineID?: string
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

/**
 * One streamed tool call, before the shim has merged it with its siblings.
 *
 * `arguments` arrives FRAGMENTED — a function's arguments are streamed across
 * several frames and concatenated by string, which is why the accumulator
 * appends rather than assigns. `index` is the call's position in the array and
 * is what identifies "the same call" across frames.
 *
 * Every field is optional and the `function` is itself open: a frame may carry
 * only the id, only the name, or only an argument fragment, and the shim's
 * guards on each read individually are load-bearing rather than defensive.
 */
export interface ToolCallDelta {
  index?: number
  id?: string
  function?: {
    name?: string
    arguments?: string
    [field: string]: unknown
  }
  [field: string]: unknown
}

/**
 * One SSE frame from the upstream chat stream, as this shim reads it.
 *
 * This is Qoder's own envelope, and the shim translates it to OpenAI's shape
 * because that is what pi-ai's parser expects. Both spellings of the content
 * carrier appear — `delta` on a streaming frame, `message` on a non-streaming
 * one — and the shim reads `delta ?? message` in both code paths, so the type
 * admits both rather than pretending one is canonical.
 *
 * `usage` is deliberately top-level and optional: the token-accounting frame
 * arrives with an EMPTY `choices` array, so every consumer that indexes
 * `choices[0]` before checking `usage` silently drops the frame. That ordering
 * bug is what made Qoder report no tokens; see the streaming path in `shim.ts`.
 */
export interface UpstreamChunk {
  choices?: Array<{
    delta?: {
      content?: unknown
      reasoning_content?: unknown
      reasoning?: unknown
      tool_calls?: ToolCallDelta[]
      [field: string]: unknown
    }
    message?: {
      content?: unknown
      tool_calls?: ToolCallDelta[]
      [field: string]: unknown
    }
    finish_reason?: unknown
  }>
  /** Top-level token accounting, present only on its own frame. */
  usage?: unknown
  [field: string]: unknown
}

/**
 * The decoded request body pi-ai posts to the shim's chat route.
 *
 * Every field is optional and `unknown`-valued because this is the OpenAI
 * request shape arriving from a peer, and the shim's job is precisely to
 * decide what it may trust: `resolveThinking` reads `reasoning_effort` and
 * `thinking` as "whatever the client sent" and falls back to the catalog, and
 * `max_tokens` is forwarded only when it is actually a number.
 */
export interface ChatRequestBody {
  model?: unknown
  messages?: unknown
  tools?: unknown
  max_tokens?: unknown
  reasoning_effort?: unknown
  thinking?: unknown
  stream?: unknown
  user?: unknown
  [field: string]: unknown
}

/** The failure object the upstream layer raises, as the shim reads it. */
export interface UpstreamFailure {
  message?: unknown
  /** Set by `QueueRejection`; the shim turns it into a `Retry-After`. */
  retryAfterSeconds?: unknown
  /** Queue and other transient failures the host should retry. */
  retryable?: unknown
  /** A spent daily allowance — its own kind, never a queue. */
  dailyLimit?: unknown
  signInExpired?: unknown
  name?: unknown
  code?: unknown
}

/**
 * One chat turn as the shim asks the upstream layer for it.
 *
 * `alwaysThinking` is not the same as `enableThinking`: the first marks a model
 * that REJECTS `enable_thinking: false` (so the flag is omitted rather than
 * sent as `false`), the second is this turn's decision. Conflating them is how
 * a forced-off selection turns into a 403.
 */
export interface ChatTurnRequest {
  /** Qoder's own model key — the shim maps the user-facing id onto it. */
  model: unknown
  messages: unknown
  tools: unknown
  maxTokens: number | undefined
  enableThinking: boolean
  alwaysThinking: boolean
  reasoningEffort: string | undefined
  sessionId: string | undefined
}

/** The async stream the shim pulls one chat turn from. */
export type ChatStream = AsyncIterator<UpstreamChunk>

/**
 * The upstream call the shim makes per request.
 *
 * Takes the abort signal so a client disconnect cancels the upstream fetch —
 * without it a dropped request keeps billing the account until Qoder answers.
 *
 * Returns a PULL iterator rather than an `AsyncIterable` because the shim drives
 * it by hand: it pulls the first chunk before committing to a status code, and
 * a `for await` loop cannot express "look at this one frame first, then decide
 * whether the response has started". An async generator satisfies this shape.
 */
export type RunChat = (
  region: Region,
  credential: Record<string, unknown>,
  request: ChatTurnRequest,
  signal: AbortSignal,
) => AsyncIterator<UpstreamChunk>