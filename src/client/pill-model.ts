/**
 * 对话框用量胶囊的纯模型层（无 JSX，可被 Node 测试直接 import）。
 *
 * 从 `composer-usage-pill.tsx` 拆出：那个文件是 `.tsx`，Node 的原生 type-stripping
 * 不解析 JSX，所以纯函数若留在那里，`node --test` 无法 import。凡是「给定输入算出
 * 输出」的逻辑都住这里；`.tsx` 只做渲染与 hook。
 */
import { offPeakState, rateAt, rateLabelOf } from "./card-model.ts"
import type { CardModelRow, CardQuota, CardUsageRegion, TranslateFn } from "./card-model.ts"

/** 与 Plugins 页卡片 `QuotaBlock` 的 warn 阈值同源（已用比例 0.8 = 剩余 20%）。 */
export const WARN_SHARE = 0.8

/** 座席接受的 provider id（区域）。`qoder` 是国际版。 */
const QODER_REGIONS = ["qoder-cn", "qoder"] as const
export const isQoderRegion = (value: string | undefined): boolean =>
	typeof value === "string" && (QODER_REGIONS as readonly string[]).includes(value)

/** 胶囊正文的区域前缀。未知回落 "Qoder" 而非报错。 */
const REGION_PREFIX: Record<string, string> = { "qoder-cn": "Qoder CN", qoder: "Qoder" }
export const regionPrefixOf = (region: string | undefined): string => {
	if (typeof region === "string") {
		const hit = REGION_PREFIX[region];
		if (typeof hit === "string") return hit;
	}
	return "Qoder"
}

/** 数字窄化：是有限数字才认，其余按缺失处理。 */
export const num = (value: unknown): number | null =>
	typeof value === "number" && Number.isFinite(value) ? value : null

/**
 * 剩余 Credits，`0` 是有效读数（耗尽），只有缺失/非有限才是 null。
 * `remaining` 缺失时可用 used/total 反推，仍是上游给的原始数字的差。
 */
export const remainingOf = (quota: CardQuota | null | undefined): number | null => {
	const remaining = num(quota?.remaining);
	if (remaining !== null) return remaining;
	const total = num(quota?.total);
	const used = num(quota?.used);
	if (total !== null && used !== null) return total - used;
	return null
}

/** 千分位格式，最多 1 位小数；未知显示 —。 */
export const formatCredits = (value: number | null): string => {
	if (value === null) return "—";
	return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value)
}

/** 一条额度是否有可用总额（决定它算不算「查不到」）。 */
export const usableTotal = (quota: CardQuota | null | undefined): boolean => (num(quota?.total) ?? 0) > 0

/** 四档分级，worst-first 便于比较。 */
export type Tier = "ok" | "warn" | "exhausted" | "unknown"

/**
 * 一条额度的分级色档。阈值与卡片 `QuotaBlock` 一致：
 * `total > 0` 且 `remaining <= 0` → 耗尽；已用比例 `>= 0.8` → 黄；否则绿；
 * 缺字段（total 非正、used/remaining/percentage 皆未知）→ 灰。
 */
export function tierOfQuota(quota: CardQuota | null | undefined): Tier {
	if (quota == null) return "unknown";
	const total = num(quota.total);
	const remaining = num(quota.remaining);
	const percentage = num(quota.percentage); // 上游给的已用比例，0..1
	if (total === null || total <= 0) return "unknown";
	if (remaining !== null && remaining <= 0) return "exhausted";
	if (percentage !== null) return percentage >= WARN_SHARE ? "warn" : "ok";
	const used = num(quota.used);
	if (used !== null) return used / total >= WARN_SHARE ? "warn" : "ok";
	if (remaining !== null) return (total - remaining) / total >= WARN_SHARE ? "warn" : "ok";
	return "unknown"
}

/** `modelSelection` projection 里这份组件需要的切片。 */
export interface ModelSelectionLike {
	next?: { provider?: string; model?: string } | null
	lastUsed?: { provider?: string; model?: string } | null
}

/**
 * 候选选择：`next` 优先于 `lastUsed`，但一个空的 `next`（切换的瞬态）不得遮蔽
 * 仍可用的 `lastUsed`——否则切模型的那几帧胶囊会消失（sensenova 踩过）。
 */
export function candidateOf(projection: ModelSelectionLike | undefined): { provider?: string; model?: string } | undefined {
	const p = projection ?? {};
	const usable = (c: { provider?: string; model?: string } | null | undefined) =>
		c !== null && c !== undefined && (typeof c.provider === "string" || typeof c.model === "string");
	if (usable(p.next)) return p.next ?? undefined;
	if (usable(p.lastUsed)) return p.lastUsed ?? undefined;
	return undefined
}

/** 会话当前指向的 provider（区域），`next` 优先。 */
export function selectedRegionOf(projection: ModelSelectionLike | undefined): string | undefined {
	const candidate = candidateOf(projection);
	const provider = candidate?.provider;
	return typeof provider === "string" && provider !== "" ? provider : undefined
}

/**
 * 主额度：套餐内 Credits 可用就优先，否则（CN 免费层 plan=0）回落个人资源包。
 * 返回的 `known` 区分「查不到」（false）与「真的是 0」（true，走 `0` 而非 `—`）。
 */
export function primaryQuotaOf(region: CardUsageRegion | null | undefined): { quota: CardQuota | undefined; known: boolean } {
	if (region == null) return { quota: undefined, known: false };
	const plan = region.userQuota;
	if (plan != null && usableTotal(plan)) return { quota: plan, known: true };
	if (region.addOnQuota != null) return { quota: region.addOnQuota, known: true };
	return { quota: undefined, known: false }
}

/** `modelSelection` 里当前选中的模型标识（id 或显示名），无则 undefined。 */
export function selectedModelOf(projection: ModelSelectionLike | undefined): string | undefined {
	const candidate = candidateOf(projection);
	const model = candidate?.model;
	return typeof model === "string" && model !== "" ? model : undefined
}

/**
 * 在（已按 region 过滤的）名册里找当前选中的模型。
 *
 * `projection.model` 可能是模型 id 也可能是显示名，两份都试；都不命中返回
 * undefined——调用方此时**不显示错峰信息**，因为声称折扣必须精确，猜不得。
 */
export function matchingModel(rows: unknown, modelKey: string | undefined): CardModelRow | undefined {
	if (typeof modelKey !== "string" || modelKey === "") return undefined;
	if (!Array.isArray(rows)) return undefined;
	return (rows as CardModelRow[]).find((m) => m != null && (m.id === modelKey || m.name === modelKey))
}

/** 胶囊里最多列出几个新模型名（第三个之后折叠成省略号）。 */
export const NEW_MODEL_LIMIT = 3

/**
 * 「本机首次见到」的那几行，按名册顺序。
 *
 * 输入是宿主给的 id 列表（`newModelIds`）与**已经按 region 过滤过的**名册行——
 * 区域过滤放在调用方，因为「哪些行属于当前区域」是名册的既有事实，这里只做
 * 集合求交。两边的空值都当「没有新模型」：字段缺失（旧宿主）与空数组在屏幕上
 * 是同一件事（不挂标记），与首次运行的画面一致。
 *
 * 只认 id 精确相等，不做名字匹配：id 是本插件从 `display_name` 机械生成的稳定
 * 标识，名字会随上游改文案而变——用名字对齐会把「改了个名」误报成「新模型」。
 */
export function newModelsOf(rows: unknown, newIds: unknown): CardModelRow[] {
	if (!Array.isArray(rows) || !Array.isArray(newIds)) return [];
	const ids = new Set(newIds.filter((id): id is string => typeof id === "string" && id !== ""));
	if (ids.size === 0) return [];
	return (rows as CardModelRow[]).filter((row) => row != null && ids.has(row.id))
}

/**
 * 新模型在胶囊/面板里的显示名：优先显示名，缺失回落 id；超过
 * {@link NEW_MODEL_LIMIT} 个只留前几个（面板宽度有限，名字是举例不是清单）。
 */
export function newModelNamesOf(rows: CardModelRow[], limit: number = NEW_MODEL_LIMIT): string[] {
	return rows
		.slice(0, Math.max(0, limit))
		.map((row) => (typeof row.name === "string" && row.name !== "" ? row.name : row.id))
}

/** 错峰摘要：只有模型确实带 promotion 且 `offPeakState` 能算才给值。 */
export interface OffPeakSummary {
	active: boolean
	remainingSeconds: number
	rate: string
	window: string
}

/**
 * 当前模型的错峰状态。`promotion` 缺失/非对象（含 `null`，与卡片同裁）→ undefined，
 * 面板不画错峰块；有 promotion 但不在窗口内 → `{active:false}`，画「未生效」而非假装
 * 在打折。`rate` 用卡片同一 `rateAt`/`rateLabelOf`，保证两屏费率一致。
 */
export function offPeakSummary(
	model: CardModelRow | undefined,
	now: Date,
	t: TranslateFn
): OffPeakSummary | undefined {
	if (model === undefined) return undefined;
	const promo = model.promotion;
	if (promo === null || typeof promo !== "object") return undefined;
	const state = offPeakState(model, now);
	if (state === undefined) return undefined;
	const rate = rateLabelOf(t, rateAt(model, now)) ?? "";
	const window = [promo.windowStart, promo.windowEnd]
		.filter((value): value is string => typeof value === "string" && value !== "")
		.join("–");
	return { active: state.active, remainingSeconds: state.remainingSeconds, rate, window }
}