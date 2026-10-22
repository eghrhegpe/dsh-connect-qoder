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
import { isDeepStrictEqual } from 'node:util'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { sendJson } from './http-utils.ts'
import { methodAllowed, originAllowed, readJsonBody, readJsonBodyOr400 } from './routes.ts'
import { buildModelRowsPayload, projectModelRow } from './catalog-entry.ts'
import type { RateHelpers } from './catalog-entry.ts'
import { saveFieldOutcome } from './settings-save.ts'
import type { SettingsService } from './settings-save.ts'
import { classifyUpstreamError, describeThrown, isProtocolShapeChangedError, providerRegistrationState, thrownFlag } from './errors.ts'
import type { DeviceLoginFlow } from './device-login-flow.ts'
import type { DeviceCredentialStatus } from './device-credential.ts'
import type { CredentialKind } from './credential-kind.ts'
import {
  campaignIsClaimed,
  checkinStateFrom,
  claimableCampaignOf,
  normalizeClaimResult,
} from './claim.ts'
import { appDataRootFor, loadCredentialAsync, loadEnvCredential } from './credentials.ts'
import type { LoadedCredential } from './credentials.ts'
import { claimCampaign, fetchUserInfo, readCampaigns } from './upstream.ts'
import type { UsageSnapshot } from './upstream.ts'
import type { CatalogEntry, PluginLogger, RefreshFailureReason, Region } from './domain.ts'
import type { Preferences } from './preferences.ts'
import type { TokenDayRecord } from './token-counter.ts'

/**
 * The runtime surface the routes read — a structural minimum of the
 * `RegionRuntime` `index.ts` builds, declared here so this module stays free of
 * the Cordis peer dependencies. See the structural rule in `domain.ts`.
 */
export interface RouteRuntimeLike {
  region: Region
  resolveCredential(): Promise<LoadedCredential | undefined>
  invalidateCredential(): void
  refreshCatalog(): Promise<void>
  readUsage(force?: boolean): Promise<UsageSnapshot | undefined>
  invalidateUsage(): void
  catalog: { current(): CatalogEntry[]; fetchedAt?: number }
  refreshFailed?: { reason: RefreshFailureReason; error?: unknown } | undefined
  /**
   * The ids this region's roster history still calls "first seen recently".
   *
   * A read: the history is written on the refresh commit path, never here, so
   * this route keeps its documented "does not change state" contract. Optional
   * because a runtime stand-in (and a host older than the field) has no history
   * to read, which renders exactly like a first-ever run: no marker.
   */
  newModelIds?(): string[]
}

/** One started region, as the handlers see it. */
export interface RouteRuntimeEntry {
  region: Region
  runtime: RouteRuntimeLike
}

/** The settings the models route resolves rates and rows against. */
export interface ModelsDeps {
  started: RouteRuntimeEntry[]
  currentSettings: () => Preferences
  logger: PluginLogger
  /** The rate helpers `projectModelRow` calls, injected from the adapter. */
  rates: RateHelpers
  /**
   * The error `activate()` recorded when the host refused the provider
   * registration, or `undefined` when it landed.
   *
   * Carried on this route as well as on `/status` because this is the route the
   * card reads: a registration failure no longer unwinds `activate()`
   * (docs/issues/20), so without it here the card would render a full, tickable
   * roster for models the chat picker cannot offer, with nothing saying why.
   * Optional so a host that predates the field still serves its roster.
   */
  providerRegistrationError?: unknown
}

/**
 * Serve the card's model roster.
 *
 * `refresh=1` re-reads the catalog from upstream. It matters because both the
 * roster and the rates move on their own: Qoder adds and retires models, and an
 * off-peak discount flips the effective price at 22:00 and 08:00 Asia/Shanghai.
 * Without this the picker would keep showing whatever was true at process
 * start.
 */
export async function modelsHandler(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ModelsDeps,
): Promise<void> {
  if (!methodAllowed(req, res, 'GET')) return
  if (!originAllowed(req, res)) return
  const force = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('refresh') === '1'
  if (force) {
    for (const { runtime } of deps.started) {
      try {
        await runtime.refreshCatalog()
      } catch (error) {
        // A refresh failure must not blank the card: the last good catalog is
        // still served below.
        deps.logger.warn?.(
          `dsh-connect-qoder: ${runtime.region.displayName} catalog refresh failed`,
          error,
        )
      }
    }
  }
  const now = new Date()
  sendJson(
    res,
    200,
    buildModelRowsPayload({
      runtimes: deps.started,
      settings: deps.currentSettings(),
      now,
      projectRow: projectModelRow,
      rates: deps.rates,
      providerRegistrationError: deps.providerRegistrationError,
    }),
  )
}

/** The settings the save route writes through. */
export interface SaveDeps {
  /** The host settings service, or `undefined` when the host has none — the 503 path. */
  getSettings: () => SettingsService | undefined
  /** The namespace the HOST actually serves this plugin's settings under. */
  settingsNs: string
  /** The plugin's own namespace constant, the fallback candidate. */
  fallbackNs: string
  /** Re-publish the picker after a landed save. */
  refreshPicker: () => void
}

/**
 * Write one settings field through the authoritative Host endpoint.
 *
 * `webServer` alone is the point: the route mounts whether or not the settings
 * service exists, so the service-absent 503 is a real answer the client can
 * distinguish from a 404 (a host that does not serve this route at all) — the
 * false-"已保存" this closed, docs/issues/06.
 */
export async function saveHandler(
  req: IncomingMessage,
  res: ServerResponse,
  deps: SaveDeps,
): Promise<void> {
  if (!methodAllowed(req, res, 'POST')) return
  if (!originAllowed(req, res)) return
  try {
    const body = await readJsonBody(req)
    // `readJsonBody` is a raw reader — it parses JSON and nothing else, so the
    // shape is whatever the client sent. `saveFieldOutcome` validates it (a
    // non-string `field` is a 400 there, not a crash here) and answers the whole
    // verdict.
    const outcome = await saveFieldOutcome(deps.getSettings(), body, {
      // The live namespace first: on the 0.2 line `settingsNs` is the Loader
      // entry id (`llm-qoder`), and the constant is the fallback for a host that
      // mounts this plugin without a Loader entry. The two are the same value in
      // the entry case, so the list is what it is — no third candidate.
      candidates: [deps.settingsNs, deps.fallbackNs],
      equals: isDeepStrictEqual,
    })
    if (outcome.body.ok !== true) return sendJson(res, outcome.status, outcome.body)
    // No `Object.assign(preferences, …)` here, and its absence used to be a bug
    // report: `current()` resolves `{ ...snapshot, ...liveSource }`, so folding
    // the merged value in was dead in both directions (see the full note in
    // `index.ts`). The picker refresh is what makes a save reach the running
    // adapter without a restart.
    deps.refreshPicker()
    return sendJson(res, outcome.status, outcome.body)
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      errorName: (error as { name?: unknown } | undefined)?.name ?? 'unknown',
      error: describeThrown(error),
    })
  }
}

/**
 * The regions the usage route reports on.
 */
export interface UsageDeps {
  started: RouteRuntimeEntry[]
  logger: PluginLogger
  /**
   * Whether this machine can supply the desktop app's umid machine identity.
   * Optional so the route keeps working against a host that predates the
   * field; when absent the response simply omits the hint.
   */
  umidState?: () => { available: boolean; reason?: string }
  /**
   * 本地请求计数器（可选）。挂上时把「今日经本客户端发出的对话轮数」随每个
   * region 下发（`requestsToday`），以及「今日额度疑似用尽」标记
   * （`requestsExhausted`，本地推断、仅供参考）。缺失则不下发这些字段——旧宿主
   * / 未启用时卡片照常渲染，只是没有本地计数行。
   */
  requestCounter?: {
    read(region: string): { count: number | null; day: string | null }
    readExhausted(region: string): boolean
    /**
     * 「今日额度疑似用尽」的写入面。此前只有 chat shim 那一条路会调它
     * （`src/host/shim.ts`），于是**按账号**的每日额度拒掉了 usage 轮询时，卡片
     * 既说不出原因、徽标也不会亮——docs/issues/24 §4 就是这条缝。
     */
    markExhausted?(region: string): void
    gc(now?: number): void
  }
  /**
   * 本地 token 消耗累加器（可选）。挂上时把「今日经本客户端累计消耗的 token 数」
   * 随每个 region 下发（`tokensToday`）；缺失则不下发该字段。token 数是上游每轮
   * 明确下发的真实数据，本地聚合即可，与 `requestCounter`（上游不给每日上限、纯
   * 本地自计）的定位不同——此处不画比例条是因为本地口径不跨终端，非因为数据缺失。
   */
  tokenCounter?: {
    read(region: string): { total: number | null; cached: number | null; day: string | null }
    readHistory(region: string, days?: number): { day: string; total: number; cached: number }[]
    gc(now?: number): void
  }
  /**
   * 多日历史的进程内缓存（可选）。usage 路由每次轮询都重读一遍 7 个日文件、
   * 再把整份数组重发一遍——其中 6 份自从昨天起就没变过。缓存把「读」压到 1 次
   * 文件读（今日那一份），历史数组在今日读数不变时直接复用。
   *
   * 注入而非模块级 Map：缓存跟着 host 实例走，测试可以各给一个、互不串味。
   */
  tokenHistoryCache?: TokenHistoryCache
}

/**
 * 多日 token 历史的进程内备忘录。
 *
 * 正确性论证（为什么按「今日读数」做 key 是安全的）：
 * - 历史数组里只有最后一项是今天；其余几项对应的日文件已经写满，不会再变
 *   （本地日一切换就会新建文件，而那时今日读数必然也变了）。
 * - 所以 `read()` 拿到的 (day, total) 是整份数组的完整摘要：它不变，数组就不变。
 *
 * 已知边界：**只对同进程成立**。web / desktop 两个 profile 共用 `$DSH_HOME`
 *   时另一进程写的量这里看不到——这与 `token-counter.ts` 头注释登记的跨进程
 *   缺口是同一个，不是本缓存新引入的。
 */
export interface TokenHistoryCache {
  /** 取某 region 的历史；未命中返回 undefined，由调用方决定是否重建。 */
  get(region: string): { day: string | null; total: number | null; records: TokenDayRecord[] } | undefined
  /** 记下某 region 本次重建所用的摘要与结果。 */
  set(region: string, value: { day: string | null; total: number | null; records: TokenDayRecord[] }): void
}

/** 建一个空的进程内历史缓存（host 启动时一个）。 */
export function createTokenHistoryCache(): TokenHistoryCache {
  const entries = new Map<string, { day: string | null; total: number | null; records: TokenDayRecord[] }>()
  return {
    get(region) {
      return entries.get(region)
    },
    set(region, value) {
      entries.set(region, value)
    },
  }
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
export async function usageHandler(
  req: IncomingMessage,
  res: ServerResponse,
  deps: UsageDeps,
): Promise<void> {
  if (!methodAllowed(req, res, 'GET')) return
  if (!originAllowed(req, res)) return
  const force = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('refresh') === '1'
  const regions = await Promise.all(
    deps.started.map(async ({ runtime }) => {
      const base = {
        region: runtime.region.id,
        regionName: runtime.region.displayName,
        manageUrl: runtime.region.manageUrl,
        downloadUrl: runtime.region.downloadUrl,
      }
      try {
        const usage = await runtime.readUsage(force)
        // 本地口径：今日经本客户端发出的对话轮数 + 是否本地判定额度疑似用尽。
        // 区分两种「查不到」，否则客户端只能蒙：
        //  - `requestCounter` 没挂上（旧宿主 / 未启用）→ 下发 `requestsUnavailable: true`，
        //    客户端说「本地计数未接入」（真的没接上）。
        //  - 挂着但今日还没发出过请求（count 为 null、文件尚不存在）→ 下发
        //    `requestsToday: 0`，客户端说「今日 0 次」（有数据、只是还没有）。
        // 既不冒充 0 也不得把「尚未请求」画成「未接入」。`requestsExhausted` 仅在为
        // true 时下发，避免无谓的字段噪声。
        const counter = deps.requestCounter
        const requestsField: Record<string, unknown> = {}
        if (counter === undefined) {
          requestsField.requestsUnavailable = true
        } else {
          const snapshot = counter.read(runtime.region.id)
          requestsField.requestsToday = snapshot.count ?? 0
          if (counter.readExhausted(runtime.region.id) === true) {
            requestsField.requestsExhausted = true
          }
        }
        // 本地口径：今日经本客户端累计消耗的 token 数——这是上游每轮明确下发的真实
        // 数据，本地只是聚合。计数器没挂上（旧宿主 / 未启用）才不发这个字段；挂上了
        // 今天还没消耗就发 `tokensToday: 0`（有数据、只是 0），不冒充「查不到」。
        const tokenCounter = deps.tokenCounter
        if (tokenCounter !== undefined) {
          const tokens = tokenCounter.read(runtime.region.id)
          requestsField.tokensToday = tokens.total ?? 0
          if (tokens.cached !== null && tokens.cached > 0) {
            requestsField.tokensCachedToday = tokens.cached
          }
          // 多日历史：过去 7 天每天一个记录，供客户端渲染柱状图。
          // 轮询一次就整份重发一遍，其中 6 份自从昨天起就没动过——用「今日读数」
          // 做 key 缓存：它不变，历史数组就不变（见 TokenHistoryCache 的论证）。
          const cache = deps.tokenHistoryCache
          const summary = { day: tokens.day, total: tokens.total }
          const cached = cache?.get(runtime.region.id)
          let history = cached?.records
          // cached 命中且 (day, total) 摘要未变 → 今天这一份读数没动，数组也不变
          // （只有最后一项是今天，其余日文件已写满）。否则重建。
          if (history === undefined ||
              cached === undefined ||
              cached.day !== summary.day ||
              cached.total !== summary.total) {
            history = tokenCounter.readHistory(runtime.region.id, 7)
            cache?.set(runtime.region.id, { ...summary, records: history })
          }
          if (history.length > 0) {
            requestsField.tokensHistory = history
          }
        }
        return usage === undefined
          ? { ...base, available: false, ...requestsField }
          : { ...base, available: true, ...usage, ...requestsField }
      } catch (error) {
        deps.logger.warn?.(
          `dsh-connect-qoder: ${runtime.region.displayName} usage read failed`,
          error,
        )
        // The card can only offer the right remedy if it knows which failure
        // this is: a transport blip heals on its own, a renamed upstream
        // envelope needs a plugin update, and a spent daily allowance needs
        // neither — it needs the day to roll over. Everything else stays the
        // generic "could not read" the card already renders.
        const dailyLimit = thrownFlag(error, 'upstreamKind') === 'daily-limit'
        if (dailyLimit) {
          // The one signal the local "疑似已用尽" badge listens for
          // (`markExhausted`), and the reason docs/issues/24 exists: before the
          // verdict was carried, a daily limit on THIS read — the surface the
          // card polls — was indistinguishable from a network blip and the
          // badge could never light. A counter-less host stays silent rather
          // than claiming knowledge it does not have.
          deps.requestCounter?.markExhausted?.(runtime.region.id)
        }
        return {
          ...base,
          available: false,
          unavailableReason: isProtocolShapeChangedError(error)
            ? 'protocol-shape-changed'
            : dailyLimit
              ? 'daily-limit'
              : 'read-failed',
        }
      }
    }),
  )
  // 清理过期旧文件（7 天窗口之外的计数文件 + .tmp 残留）。每请求一次就够——
  // gc 扫的是共享目录（文件名里的 region 只用于判定删谁的文件），早先放在
  // per-region 块内是每区扫一遍，两区 5 分钟轮询就是每轮两次白工。两个计数器
  // 内部各有「每本地日至多一次」节流（lastGcDay，同款算法），这里不必再算。
  // requestCounter 那条曾是「文档说有 GC、生产里从不调用」的死代码——挂在
  // 这里与 tokenCounter 对称，request-count 文件才真的按窗口回收。
  deps.tokenCounter?.gc()
  deps.requestCounter?.gc()
  sendJson(res, 200, { regions, ...checkinAvailability(deps) })
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
function checkinAvailability(deps: UsageDeps): { checkin?: { umidAvailable: boolean; reason: string } } {
  if (deps.umidState === undefined) return {}
  const state = deps.umidState()
  if (state.available === true) return {}
  // The reason is the whole point, so it is never dropped to `undefined`: a
  // bare `umidAvailable: false` would reach the card as a warning with nothing
  // to say, which is the same blank the card is being fixed to stop showing.
  return { checkin: { umidAvailable: false, reason: state.reason ?? 'the Qoder machine identity is unavailable on this machine' } }
}

/** The started regions the check-in route can claim for. */
export interface CheckinDeps {
  started: RouteRuntimeEntry[]
  logger: PluginLogger
  /**
   * Claim one region's check-in. Defaults to {@link claimTodayFor}; injectable
   * so the route's status posture (200 / 502 / 404) is assertable without the
   * upstream network calls.
   */
  claim?: (runtime: RouteRuntimeLike) => Promise<ClaimOutcome>
}

/** What one claim call actually did, for the card to render. */
export interface ClaimOutcome {
  region: string
  claimed: boolean
  replayed: boolean
  amount?: number
  expiresAt?: number
  alreadyClaimed: boolean
  checkin: unknown
}

/** The upstream calls a claim makes, injectable so the orchestration is testable. */
export interface ClaimIo {
  readCampaigns: (region: Region, credential: LoadedCredential) => Promise<unknown>
  claimCampaign: (region: Region, credential: LoadedCredential, campaignId: string) => Promise<unknown>
}

/** The real upstream calls, used when a test injects no `io`. */
const realClaimIo: ClaimIo = { readCampaigns, claimCampaign }

/**
 * Claim one region's daily check-in, reporting what actually happened.
 *
 * Extracted from the route so the interesting part — which round gets claimed
 * and what the answer means — is assertable without a Cordis context. Same
 * `(input) => result` shape `applySettingsSave` established for the settings
 * pipeline.
 */
export async function claimTodayFor(runtime: RouteRuntimeLike, io: ClaimIo = realClaimIo): Promise<ClaimOutcome> {
  const credential = await runtime.resolveCredential()
  if (credential === undefined) throw new Error('no usable sign-in on this machine')

  const campaigns = await io.readCampaigns(runtime.region, credential)
  const campaign = claimableCampaignOf(campaigns)
  if (campaign === undefined) throw new Error('Qoder is not running a check-in for this account today')
  if (campaignIsClaimed(campaign)) {
    // Already collected today: posting anyway would buy a round trip to be told
    // the same thing, and the upstream would grant nothing.
    return {
      region: runtime.region.id,
      claimed: false,
      replayed: true,
      alreadyClaimed: true,
      checkin: checkinStateFrom(campaigns),
    }
  }

  // `campaignId` is not read by `claim.ts` on purpose — the card-facing state
  // never publishes it — but the CLAIM POST needs it, so it is read here off the
  // record the picker returned. An absent id is the upstream changing the
  // protocol, and `claimCampaign` answers a 400 for it rather than posting an
  // empty id.
  const campaignId = campaign.campaignId
  if (typeof campaignId !== 'string') throw new Error('campaign record carries no campaign id')

  const raw = await io.claimCampaign(runtime.region, credential, campaignId)
  const result = normalizeClaimResult(raw, campaign)
  if (result.claimed !== true) throw new Error('Qoder did not confirm this check-in')

  // The Credits land in the add-on quota this same panel renders, so the cached
  // reading is now wrong about the balance.
  runtime.invalidateUsage()

  // Read the result back instead of assuming it: a claim that the upstream
  // answered without recording would otherwise read as claimed forever.
  let checkin = { ...checkinStateFrom(campaigns), todayCheckedIn: true }
  try {
    checkin = checkinStateFrom(await io.readCampaigns(runtime.region, credential))
  } catch {
    // An unreadable acknowledgement still leaves a claimed round; the derived
    // state above is the most honest answer available.
  }
  return { region: runtime.region.id, ...result, alreadyClaimed: false, checkin }
}

/**
 * Claim the daily check-in for one named region.
 *
 * Nothing about it is automatic and nothing about it is guessed: the card names
 * the region, this host re-reads Qoder's own campaign list, and only a round
 * that is open and unclaimed is ever posted at. The card therefore cannot claim
 * a stale round even if it were to render one.
 */
export async function checkinHandler(
  req: IncomingMessage,
  res: ServerResponse,
  deps: CheckinDeps,
): Promise<void> {
  if (!methodAllowed(req, res, 'POST')) return
  if (!originAllowed(req, res)) return
  const requested = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('region')
  const entry = deps.started.find((candidate) => candidate.region.id === requested)
  if (entry === undefined) return sendJson(res, 404, { error: 'unknown-region' })
  try {
    const claim = deps.claim ?? ((runtime: RouteRuntimeLike) => claimTodayFor(runtime))
    sendJson(res, 200, await claim(entry.runtime))
  } catch (error) {
    // The one route where failure must name itself: an unusable sign-in, a
    // round that ended minutes ago, and a rejected claim are three different
    // problems wearing the same "nothing happened".
    //
    // Posture split (deliberate, unlike what a passing glance suggests): the
    // status route publishes only an error NAME (see statusHandler's comment),
    // while this family — checkin and the account-confirm route — publishes
    // the message to the same browser-visible surface. The boundary is the
    // error's origin, not the surface: providerRegistrationError is an
    // arbitrary host-wiring failure that can carry any activation-time path,
    // and the status comment refuses to bet it holds no credential-bearing
    // URL. Here the throwers are plugin-owned call sites (claim, fetchUserInfo,
    // loadCredentialAsync) whose endpoints are plugin-built constants and
    // whose credentials travel ONLY in `Authorization` headers — never in a
    // URL string (`upstream/headers.ts` builds `Bearer ${token}`, and
    // `upstream/cosy-sign.ts` builds the COSY value the same way) — so an
    // error message here cannot echo a bearer out of a query string. The
    // detail is also a pinned recovery contract (test/handlers.test.js pins
    // "502 naming the reason"; the card renders it to tell re-sign-in from
    // update-the-plugin), and it is length-capped at 300 chars where exposed.
    // If any of those call sites ever moves a secret into a URL, this comment
    // is the tripwire — cut the detail back to the kind alone.
    deps.logger.warn?.(`dsh-connect-qoder: ${entry.region.displayName} check-in failed`, error)
    sendJson(res, 502, { error: error instanceof Error ? error.message : String(error) })
  }
}

/** The account panel's payload reader and logger. */
export interface AccountDeps {
  /** Read the per-region sign-in states; `force` re-reads the store for real. */
  payload: (options?: { force?: boolean; cachedOnly?: boolean }) => Promise<unknown> | unknown
  logger: PluginLogger
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
export async function accountHandler(
  req: IncomingMessage,
  res: ServerResponse,
  deps: AccountDeps,
): Promise<void> {
  if (!methodAllowed(req, res, 'GET')) return
  if (!originAllowed(req, res)) return
  try {
    sendJson(res, 200, await deps.payload())
  } catch (error) {
    deps.logger.error?.('dsh-connect-qoder: account state read failed', error)
    sendJson(res, 500, {
      error: 'account state read failed',
      errorName: (error as { name?: unknown } | undefined)?.name ?? 'Error',
      detail: describeThrown(error).slice(0, 300),
    })
  }
}

/** What activation got done, as the status route reports it. */
export interface StatusDeps {
  /** How many regions came up during activation. */
  startedCount: number
  /**
   * The provider-registration failure, when there was one.
   *
   * `undefined` means registration succeeded (or had nothing to register, which
   * is the zero-region case and is not a failure).
   */
  providerRegistrationError?: unknown
  /**
   * The regions and the credential path serving each of them.
   *
   * Reported because the status route is the surface a user is sent to when
   * something is not working, and "which of the two sign-ins is in use" is the
   * first question. `credentialKind` is absent for a region that has resolved
   * no credential yet — that is different from a region served by the desktop
   * application, and the difference is the point.
   */
  regions?: readonly { id: string; credentialKind?: CredentialKind | undefined }[]
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
export async function statusHandler(
  req: IncomingMessage,
  res: ServerResponse,
  deps: StatusDeps,
): Promise<void> {
  if (!methodAllowed(req, res, 'GET')) return
  if (!originAllowed(req, res)) return
  const providerRegistration = providerRegistrationState(deps.providerRegistrationError)
  sendJson(res, 200, {
    activated: providerRegistration.ok,
    startedRegions: deps.startedCount,
    providerRegistration,
    ...(deps.regions === undefined
      ? {}
      : {
        regions: deps.regions.map((region) => ({
          id: region.id,
          ...(region.credentialKind === undefined ? {} : { credentialKind: region.credentialKind }),
        })),
      }),
  })
}

/** The regions and runtimes the reload route widens. */
export interface ReloadDeps {
  regions: readonly Region[]
  started: RouteRuntimeEntry[]
  /** Start any region that is not running yet and re-publish the set. */
  startStoppedRegions: (onlyRegionId?: string) => Promise<void>
  /** The shared account payload; the reload answers with `force: true`. */
  payload: (options?: { force?: boolean; cachedOnly?: boolean }) => Promise<unknown> | unknown
  logger: PluginLogger
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
export async function reloadHandler(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ReloadDeps,
): Promise<void> {
  if (!methodAllowed(req, res, 'POST')) return
  if (!originAllowed(req, res)) return
  const read = await readJsonBodyOr400(req, res)
  if (read.ok !== true) return
  // As in the save route: the body's shape is the client's, so the read below
  // goes through an explicit narrowing rather than off `unknown`. A non-string
  // `region` is not an error here — it simply falls through to `undefined`,
  // which means "every region".
  const posted = (read.body ?? {}) as { region?: unknown }
  const wanted =
    typeof posted.region === 'string' && deps.regions.some((region) => region.id === posted.region)
      ? posted.region
      : undefined
  // "Re-read" for a running region means: drop the cached credential so the
  // next resolve re-reads the app store, and force a catalog refresh so the
  // picker sees what is readable now.
  for (const { runtime } of deps.started) {
    if (wanted !== undefined && runtime.region.id !== wanted) continue
    runtime.invalidateCredential()
    void runtime.refreshCatalog()
  }
  // A region with no runtime at all — no sign-in, or an expired one, at
  // activation — needs more: start it now, and publish the widened set. This is
  // the "re-sign in, and the region appears without a DSH restart" path.
  //
  // Guarded: a region that fails to start is left exactly as it was, and the
  // panel still gets its fresh states. Without the guard a throw here reached
  // the web server's catch-all, which answers a bare 400 with no body —
  // undiagnosable from the card, and it hid the whole panel.
  try {
    await deps.startStoppedRegions(wanted)
  } catch (error) {
    deps.logger.error?.('dsh-connect-qoder: account re-read failed to start a stopped region', error)
  }
  // `force: true` is deliberate and unlike the GET above: this is the user
  // pressing "重读登录", i.e. asking for the store to be read again right now.
  // The SHAPE is the shared `accountPayload` one, not a narrower `{ regions }` —
  // the card reads this response directly (issue 12, item 8).
  sendJson(res, 200, await deps.payload({ force: true }))
}

/** The regions and runtimes the confirm route reads. */
export interface ConfirmDeps {
  regions: readonly Region[]
  started: RouteRuntimeEntry[]
  /**
   * Online identity check. Defaults to the real `fetchUserInfo`; injectable so
   * the route's classification posture (confirmed / sign-in-expired /
   * unavailable) is assertable without the upstream call.
   */
  confirmUserInfo?: (region: Region, credential: LoadedCredential) => Promise<{ name: unknown; email: unknown }>
  /**
   * Read a credential for a region that has no running runtime.
   *
   * The host wires the shared per-region cache here, so this branch resolves
   * the credential the way a runtime does — the desktop store, then the
   * plugin's own sign-in, then the PAT — instead of reading the desktop store
   * and the PAT only. Without the plugin's own source in that chain, a user
   * who only ever signed in through the browser was told "there is no sign-in
   * to confirm" for an edition that had one.
   *
   * Defaults to the real `loadCredentialAsync` (the desktop store alone), and
   * is injectable so that branch is assertable without decrypting anything on
   * the machine running the suite.
   */
  readCredential?: (region: Region) => Promise<LoadedCredential | undefined>
}

/**
 * Confirm one region's sign-in is still valid, online.
 *
 * The card's confirm button. Calls `fetchUserInfo` with the region's credential
 * and reports whether the upstream still accepts it — the one network call in
 * the account flow, kept behind its own route so an account render stays
 * network-free.
 */
export async function confirmHandler(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ConfirmDeps,
): Promise<void> {
  if (!methodAllowed(req, res, 'POST')) return
  if (!originAllowed(req, res)) return
  const read = await readJsonBodyOr400(req, res)
  if (read.ok !== true) return
  // Same narrowing as the reload route: `find` comparing against `entry.id` is
  // the validity check, so a missing or non-string `region` simply matches
  // nothing and the 400 below answers it.
  const posted = (read.body ?? {}) as { region?: unknown }
  const region = deps.regions.find((entry) => entry.id === posted.region)
  if (region === undefined) return sendJson(res, 400, { error: 'unknown region' })
  const runtime = deps.started.find((entry) => entry.region.id === region.id)?.runtime
  // Resolving a credential can now throw two ways the route has to answer for:
  // a failed PAT exchange, and the exchange throttle refusing to re-probe a
  // window the platform stated. Without this catch the confirmation press would
  // reach the web server's catch-all as a bare 400 for a whole window at a
  // time. The card maps `available: false` to "unavailable" and carries the
  // detail through.
  let credential
  try {
    // A region with no running runtime is a sign-in that never produced one
    // (expired, or the plugin started before the user signed in), and confirming
    // it is exactly how a card recovers. That read goes through the ASYNC
    // unwrapper: the synchronous one spawns PowerShell and blocks the event loop
    // for as long as it takes (up to 30 s per candidate), and a browser press
    // must never freeze the whole plugin for it. The runtime path already
    // resolves asynchronously for the same reason.
    const read = deps.readCredential ?? ((id: Region) => loadCredentialAsync(id, appDataRootFor()))
    credential = runtime !== undefined ? await runtime.resolveCredential() : (await read(region)) ?? loadEnvCredential(region)
  } catch (error) {
    // The detail-publishing posture here is the same one justified in
    // checkinHandler's catch (posture-split comment): plugin-owned throwers,
    // header-only credentials, 300-char cap, and the card needs the reason to
    // tell re-sign-in from update-the-plugin.
    return sendJson(res, 200, {
      region: region.id,
      available: false,
      detail: describeThrown(error).slice(0, 300),
    })
  }
  if (credential === undefined) return sendJson(res, 200, { region: region.id, available: false })
  try {
    const check = deps.confirmUserInfo ?? fetchUserInfo
    const info = await check(region, credential)
    // Identity only: the panel is a browser surface, and a userID is account
    // data the card never renders, so it is dropped here rather than carried to
    // the browser.
    return sendJson(res, 200, {
      region: region.id,
      available: true,
      confirmed: true,
      identity: { name: info.name, email: info.email },
    })
  } catch (error) {
    // A shape change is not the user's sign-in going bad: re-signing in cannot
    // fix a response the plugin no longer understands, and calling it a
    // sign-in-expired would send them through a login loop. It is reported as
    // its own verdict so the card says "update the plugin" instead.
    if (isProtocolShapeChangedError(error)) {
      return sendJson(res, 200, {
        region: region.id,
        available: true,
        confirmed: false,
        kind: 'protocol-shape-changed',
        detail: describeThrown(error).slice(0, 300),
      })
    }
    // Classify the way the shim does: a sign-in rejection is the one answer
    // that changes what the user should do (re-sign in, then re-read), so it is
    // named; everything else is a plain "could not confirm" with the transport
    // detail.
    const message = describeThrown(error)
    const kind = classifyUpstreamError({ message }, '', message).kind
    if (kind === 'sign-in-expired' && runtime !== undefined) {
      // The upstream said this credential is dead: treat it as the sign-in
      // rejection it is, so the re-read after a re-sign-in picks up the fresh
      // store.
      runtime.invalidateCredential()
    }
    return sendJson(res, 200, {
      region: region.id,
      available: true,
      confirmed: false,
      kind: kind === 'sign-in-expired' ? 'sign-in-expired' : 'unavailable',
      detail: message.slice(0, 300),
    })
  }
}

/**
 * The regions and the host-side attempt tracker the four device-login routes
 * share.
 *
 * `flow` is the real class rather than a bundle of callbacks because it is
 * peer-free: a handler test can build one over a stubbed `fetch` and exercise
 * the whole sign-in conversation through the routes, which is the layer that
 * would otherwise only be covered by reading source text.
 */
export interface DeviceLoginDeps {
  regions: readonly Region[]
  flow: DeviceLoginFlow
  /** Delete one region's stored credential. Answers whether it is gone. */
  forget: (regionId: string) => Promise<boolean>
  /** What the panel should be told about one region's credential file. */
  status: (regionId: string) => DeviceCredentialStatus
  logger: PluginLogger
}

/** The region a request names, but only if it is one this plugin knows. */
function namedRegion(
  value: unknown,
  regions: readonly Region[],
): string | undefined {
  const posted = (value ?? {}) as { region?: unknown }
  if (typeof posted.region !== 'string') return undefined
  return regions.some((region) => region.id === posted.region) ? posted.region : undefined
}

/** The region a query string names, on the routes a GET cannot put one in a body. */
function queriedRegion(req: IncomingMessage, regions: readonly Region[]): string | undefined {
  const requested = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('region')
  if (requested === null) return undefined
  return regions.some((region) => region.id === requested) ? requested : undefined
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
export async function deviceLoginStartHandler(
  req: IncomingMessage,
  res: ServerResponse,
  deps: DeviceLoginDeps,
): Promise<void> {
  if (!methodAllowed(req, res, 'POST')) return
  if (!originAllowed(req, res)) return
  const read = await readJsonBodyOr400(req, res)
  if (read.ok !== true) return
  const regionId = namedRegion(read.body, deps.regions)
  if (regionId === undefined) return sendJson(res, 404, { error: 'unknown-region' })
  const started = deps.flow.start(regionId)
  if (started.kind !== 'started') {
    // A region this plugin knows but the protocol layer does not: a build whose
    // product table and region table disagree. Named, not silently 404'd, so
    // the disagreement is visible the first time someone tries.
    deps.logger.warn?.(`dsh-connect-qoder: no device-login product for region ${regionId}`)
    return sendJson(res, 404, { error: 'unknown-region' })
  }
  return sendJson(res, 200, {
    region: started.region,
    authUrl: started.authUrl,
    expiresAt: started.expiresAt,
  })
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
export async function deviceLoginPollHandler(
  req: IncomingMessage,
  res: ServerResponse,
  deps: DeviceLoginDeps,
): Promise<void> {
  if (!methodAllowed(req, res, 'GET')) return
  if (!originAllowed(req, res)) return
  const regionId = queriedRegion(req, deps.regions)
  if (regionId === undefined) return sendJson(res, 404, { error: 'unknown-region' })
  const result = await deps.flow.poll(regionId)
  if (result.kind === 'failed') {
    // Logged as well as answered: the reason may be a status the user cannot
    // act on ("Http500"), and the log is where that becomes diagnosable.
    deps.logger.warn?.(`dsh-connect-qoder: device sign-in for ${regionId} failed: ${result.reason}`)
    return sendJson(res, 200, { state: 'failed', reason: result.reason })
  }
  if (result.kind === 'unsupported-region') return sendJson(res, 404, { error: 'unknown-region' })
  return sendJson(res, 200, { state: result.kind })
}

/**
 * Abandon an attempt.
 *
 * Deliberately not an error when there was nothing to cancel: a card that
 * unloads twice, or a user who closed the panel after the attempt expired, both
 * land here, and neither is a problem worth a sentence.
 */
export async function deviceLoginCancelHandler(
  req: IncomingMessage,
  res: ServerResponse,
  deps: DeviceLoginDeps,
): Promise<void> {
  if (!methodAllowed(req, res, 'POST')) return
  if (!originAllowed(req, res)) return
  const read = await readJsonBodyOr400(req, res)
  if (read.ok !== true) return
  const regionId = namedRegion(read.body, deps.regions)
  if (regionId === undefined) return sendJson(res, 404, { error: 'unknown-region' })
  return sendJson(res, 200, { region: regionId, cancelled: deps.flow.cancel(regionId) })
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
export async function deviceLoginSignOutHandler(
  req: IncomingMessage,
  res: ServerResponse,
  deps: DeviceLoginDeps,
): Promise<void> {
  if (!methodAllowed(req, res, 'POST')) return
  if (!originAllowed(req, res)) return
  const read = await readJsonBodyOr400(req, res)
  if (read.ok !== true) return
  const regionId = namedRegion(read.body, deps.regions)
  if (regionId === undefined) return sendJson(res, 404, { error: 'unknown-region' })
  deps.flow.cancel(regionId)
  let forgotten: boolean
  try {
    forgotten = await deps.forget(regionId)
  } catch (error) {
    deps.logger.error?.(`dsh-connect-qoder: could not sign out of the device credential for ${regionId}`, error)
    return sendJson(res, 500, { error: 'sign-out-failed', detail: describeThrown(error).slice(0, 300) })
  }
  if (!forgotten) {
    return sendJson(res, 500, {
      error: 'sign-out-failed',
      detail: 'the credential file could not be removed, so it is still in use',
    })
  }
  return sendJson(res, 200, { region: regionId, signedOut: true, device: deps.status(regionId) })
}
