/**
 * 对话框用量胶囊 — 输入框工具栏 `conversation.input.right` 座席。
 *
 * 形态跟随 dsh-connect-workbuddy 的 ComposerCredits：**裸可点击余额读数**
 * `Qoder CN · 1,034`（区域前缀 · 剩余 Credits），无进度条、无百分比。
 * 不跟随 sensenova 的「已用百分比」形态，因为两家的上游不同：Token Plan 是
 * 5h/周 滚动额度池、没有单一余额可显示，只能用百分比；Qoder 的额度是**分条**
 * 的（套餐 / 个人资源包 / 专属资源包），但每条都带 `remaining`（剩余 Credits）——
 * 上游给的单池事实。选读主额度是**拿上游给的事实**，不是把几条加成一个总数：
 * 加总等于发明上游没公布的口径，是本插件不做的（sensenova 对「把余额换算成
 * 百分比」的禁令，换了个方向同样成立）。
 *
 * **主额度**：套餐内 Credits 有可用额度就优先读它；套餐不可用（CN 免费层
 * plan=0，`total` 不是正数）时回落到个人资源包——签到资源包是免费层唯一额度
 * （README:204-205）。两条都不可用出灰 `—`，绝不合并、绝不算出一个「总额」。
 * 选择逻辑在 `./pill-model.ts`（`primaryQuotaOf`）。
 *
 * **归属门控**：`useProjection("modelSelection")`，`next` 优先于 `lastUsed`——但
 * 一个空的 `next`（切换模型的瞬态）不得遮蔽仍可用的 `lastUsed`，否则切换的那几帧
 * 胶囊会消失。该 prop 是 session 作用域槽位**严格必需**的物化 prop（见
 * `test/composer-pill.test.js`：session 作用域 `optional=false`，缺源抛
 * `SlotAssemblyError`），这里的 noop 兜底只是让 Node 侧单测能脱离 Host 注入。
 * provider 不是 `qoder-cn` / `qoder` 时胶囊不挂载，也不跑任何 fetch 循环。
 *
 * **三层结构**（不「切模型即消失」的关键）：归属门控发生在**组件边界**——外层
 * `ComposerUsagePill` 只决定内层 `ActiveUsagePill` 挂/摘，轮询 hook 全在内层，外层
 * 不调用任何 React hook。若在同一组件里先调 hook 再按门控早退（`return null`），
 * 切模型会踩 Rules of Hooks 的红线（组件被 React 甩出树）。
 *
 * **分级色点**（7px，`--dsw-alias-state-*` token）：剩余 >20% 绿 / ≤20% 黄 / 耗尽
 * 红 / 未知灰。阈值与 Plugins 页卡片的 `QuotaBlock` 同源（`percentage >= 0.8` 黄，
 * `remaining <= 0 && total > 0` 耗尽，`tierOfQuota` 在 `./pill-model.ts`）——同一屏
 * 里两套阈值互相打脸比任何一套都糟。只有耗尽档给正文上色（error token），其余档
 * 只染圆点。
 *
 * **展开面板**：胶囊点一下展开额度卡，画的是胶囊装不下的东西——主额度的原始
 * used/total 与 remaining、各专属资源包分项、以及今日签到行（未签到给一个真按钮，
 * 点了走与 Plugins 页 `QoderUsagePanel` 同一条 claim 路由，领完立刻重读把 Credits
 * 推回余额；失败把宿主给的理由显示在按钮下，不静默）。**不放百分比**：胶囊
 * 已经显示了余额，再来一个百分比是同一个数字说两遍。面板是触发器的兄弟节点非子
 * 节点（inline style，不注入样式表）。读不到的字段显示 `—`，永不 `0`——`0` 是
 * 「确认是零」的读数，`—` 是「查不到」，二者不等价（`QuotaBlock` 同裁定）。
 *
 * **错峰折扣**：折扣挂在**模型**上（`CardModelRow.promotion`），不是区域属性，所以
 * 面板画错峰必须精确匹配当前选中模型——`projection.model` 对名册里的 `id` 或 `name`
 * 任一命中才画块（`matchingModel`），匹配不上就什么都不说。绝不因为「这个区域别的
 * 模型在打折」而声称当前模型在打折：那是把相邻行的事实安到这一行头上。窗口内画
 * 「生效 · 费率 · 剩余 HH:MM:SS」，窗口外画「窗口未生效」而非假装在打折。费率和
 * 倒计时与 Plugins 页卡片同一套 `rateAt`/`offPeakState`，两屏不会打脸。名册单独
 * 读 `QODER_MODELS_PATH`，读失败保留上次（无从判断时就不画块）。
 *
 * **轮询**：5 分钟（余额是存量不是秒表，秒级轮询只会闪数字）。失败保留上次数值、
 * 不抛、不显示错误条——面板照常用，读不到显示 `—`。例外是**秒级 tick 的「现在」**：
 * 只有该 region 确有 promotion 窗口 active 时按秒刷新（同卡片 `hasActiveWindow`
 * 门控），否则静态，避免常驻每秒重渲。
 *
 * **关闭方式**：再点一次胶囊、点面板外部（`pointerdown`，非 `click`——后者会先关
 * 面板又被触发器 toggle 重开）、按 Esc。监听只在外层开着时挂，收起即摘。
 *
 * 纯函数（门控、主额度、分级、模型匹配、错峰摘要）在 `./pill-model.ts`，本文件
 * 只做渲染与 hook。
 */
import * as react from "react"
import { formatCountdown, formatTokenCount, usageUnavailableKey } from "./card-model.ts"
import type { CardModelRow, CardQuota, CardUsageRegion, TranslateFn } from "./card-model.ts"
import { TokenHistoryChart } from "./token-history-chart.tsx"
import {
	isQoderRegion,
	selectedRegionOf,
	selectedModelOf,
	regionPrefixOf,
	primaryQuotaOf,
	remainingOf,
	formatCredits,
	num,
	tierOfQuota,
	usableTotal,
	matchingModel,
	offPeakSummary,
	newModelsOf,
	newModelNamesOf,
	type Tier,
	type ModelSelectionLike
} from "./pill-model.ts"
import { QODER_USAGE_PATH, QODER_CHECKIN_PATH, QODER_MODELS_PATH } from "./paths.ts"
import { getJson, postJson } from "./http.ts"

/** 轮询间隔：5 分钟。余额是存量，秒级轮询只会闪数字。 */
const POLL_MS = 5 * 60 * 1000
/** 面板元素 id，供 a11y（`aria-controls` / 测试查询）。 */
const POPOVER_ID = "dsh-connect-qoder-composer-pill-popover"

const TIER_DOT: Record<Tier, string> = {
	ok: "var(--dsw-alias-state-success-primary, #12b76a)",
	warn: "var(--dsw-alias-state-warn-primary, #f59e0b)",
	exhausted: "var(--dsw-alias-state-error-primary, #d92d20)",
	unknown: "var(--dsw-alias-label-tertiary, #999)"
}
const TIER_INK: Record<Tier, string> = {
	ok: "var(--dsw-alias-label-primary, #e6e6e6)",
	warn: "var(--dsw-alias-label-primary, #e6e6e6)",
	exhausted: "var(--dsw-alias-state-error-primary, #d92d20)",
	unknown: "var(--dsw-alias-label-tertiary, #999)"
}

/** 座席交给组件的 props：插件字典 `t` + renderer 物化的 `useProjection`。 */
export interface ComposerPillProps {
	t: TranslateFn
	useProjection?: (key: "modelSelection") => ModelSelectionLike | undefined
}

/* ------------------------------------------------------------------ */
/* 内层：真正持有 hook 与轮询的组件                                      */
/* ------------------------------------------------------------------ */

interface ActiveUsagePillProps {
	t: TranslateFn
	region: string
	/** 当前选中模型的标识（id 或显示名），错峰折扣是模型级事实，缺了就无从谈起。 */
	modelKey: string | undefined
}

function ActiveUsagePill({ t, region, modelKey }: ActiveUsagePillProps) {
	const [open, setOpen] = react.useState(false);
	// 读到的用量。跨失败保留：上一帧的余额仍是「直到被反驳前为真」的事实。
	const [usage, setUsage] = react.useState<CardUsageRegion | null>(null);
	// 首次读之前不算「查到 0」，是「还没查」——胶囊给 `—` 而非 `0`。
	const [loadedOnce, setLoadedOnce] = react.useState(false);
	// 最近一次读取失败了，屏幕上的数字是冻结的旧值。与卡片面板「上次更新（刷新
	// 失败）」同一道防线：保留旧值是对的，冒充它仍是当刻事实不是。
	const [stale, setStale] = react.useState(false);
	// 名册（错峰折扣挂在模型上）。读失败保留上次：读不到就无从判断错峰，但
	// 也不该把已读到的模型清掉。
	const [models, setModels] = react.useState<CardModelRow[]>([]);
	// 宿主认定的「本机首次见到」的模型 id。与名册分开存：名册读失败要保留旧值，
	// 但新模型标记是**同一份响应**里的字段，两者必须同批落 state，否则会出现
	// 「标记来自新名册、名字来自旧名册」的错配。
	const [newModelIds, setNewModelIds] = react.useState<string[]>([]);
	// 错峰倒计时用的「现在」。只在该 region 确有 promotion 窗口 active 时秒级
	// 刷新（同卡片 `hasActiveWindow` 门控），否则静态，避免常驻每秒重渲。
	const [clock, setClock] = react.useState(() => new Date());
	const mounted = react.useRef(true);
	// 只允许最新一次读取落 state：轮询可以前一次还没返回就发起第二次，慢响应
	// 后到会把屏幕上的数字搬回去。用量与名册各一份，互不打断。
	const generation = react.useRef(0);
	const modelGeneration = react.useRef(0);

	react.useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);

	const load = react.useCallback(async () => {
		generation.current += 1;
		const mine = generation.current;
		const isCurrent = () => generation.current === mine;
		try {
			const value = await getJson<{ regions?: unknown }>(QODER_USAGE_PATH);
			if (!isCurrent() || !mounted.current) return;
			const regions = Array.isArray(value.regions) ? (value.regions as CardUsageRegion[]) : [];
			setUsage(regions.find((entry) => entry.region === region) ?? null);
			setLoadedOnce(true);
			setStale(false);
		} catch {
			// 读不到不是「额度没了」：保留上次数值，面板照常用。不抛、不显示错误条
			// ——但要说得出这是旧数。
			if (!isCurrent() || !mounted.current) return;
			setLoadedOnce(true);
			setStale(true);
		}
	}, [region]);

	const loadModels = react.useCallback(async () => {
		modelGeneration.current += 1;
		const mine = modelGeneration.current;
		try {
			const value = await getJson<{ models?: unknown; newModelIds?: unknown }>(QODER_MODELS_PATH);
			if (modelGeneration.current !== mine || !mounted.current) return;
			setModels(Array.isArray(value.models) ? (value.models as CardModelRow[]) : []);
			// 字段缺失（旧宿主）与空数组同义：没有标记可挂。
			setNewModelIds(
				Array.isArray(value.newModelIds)
					? (value.newModelIds as unknown[]).filter((id): id is string => typeof id === "string" && id !== "")
					: []
			);
		} catch (error) {
			// 名册读不到 → 无从判断错峰，面板不画错峰块；不抛、不清掉已读到的名册。
			// 用户无需看见这份安静，维护者不能——留一条控制台线索。
			console.warn("dsh-connect-qoder: composer pill could not read the model list", error);
		}
	}, []);

	react.useEffect(() => {
		void load();
		void loadModels();
		const timer = window.setInterval(() => {
			void load();
		}, POLL_MS);
		const modelsTimer = window.setInterval(() => {
			void loadModels();
		}, POLL_MS);
		return () => {
			window.clearInterval(timer);
			window.clearInterval(modelsTimer);
		};
	}, [load, loadModels]);

	// 秒级倒计时：只有该 region 确有 promotion 窗口开着才 tick（窗口是 22:00–08:00
	// 那种长时段，其余时间不需要每秒刷一遍「现在」）。名册更新会重挂本 effect。
	const hasActiveWindow = models.some((model) => model.promotion?.active === true);
	react.useEffect(() => {
		if (!hasActiveWindow) return;
		setClock(new Date());
		const timer = window.setInterval(() => {
			setClock(new Date());
		}, 1000);
		return () => {
			window.clearInterval(timer);
		};
	}, [hasActiveWindow]);

	// 关闭面板：点外部用 `pointerdown`（见文件头），Esc 收尾。只在开着时挂。
	react.useEffect(() => {
		if (!open) return;
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target;
			if (!(target instanceof Node)) return;
			const root = document.querySelector('[data-dsh-qoder-pill-root]');
			if (root !== null && root.contains(target)) return;
			setOpen(false);
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") setOpen(false);
		};
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [open]);

	const { quota, known } = primaryQuotaOf(usage);
	const tier = known ? tierOfQuota(quota) : "unknown";
	const remaining = known ? remainingOf(quota) : null;
	// 首次读之前是「还没查」，一律 `—` 灰；查到后按实际读数。
	const display = remaining === null ? "—" : formatCredits(remaining);
	const prefix = regionPrefixOf(region);
	const exhausted = tier === "exhausted";
	// 主额度单桶的已用比例：优先取宿主算好的 `percentage`，缺失时用 used/total
	// 反推。这是「单个桶」自己的比例，不是把几条额度加总成总额——后者是本插件
	// 明确不做的（见本文件头），这里与 Plugins 页卡片的 `QuotaBlock` 同源。
	const totalNum = num(quota?.total);
	const usedNum = num(quota?.used);
	const pctRaw = num(quota?.percentage);
	const pct = pctRaw !== null ? pctRaw : (totalNum !== null && totalNum > 0 && usedNum !== null ? Math.min(1, Math.max(0, usedNum / totalNum)) : null);
	const pctText = pct === null ? "—" : `${Math.round(pct * 100)}%`;
	const pctColor = TIER_DOT[tier];
	const checkin = usage?.checkin;
	// 错峰折扣是模型级事实，必须精确匹配当前选中模型才画；匹配不上（名册没这
	// 条、`projection.model` 不是 id 也不是显示名）就什么都不说，不猜。
	const regionModels = models.filter((model) => model.region === region);
	const currentModel = matchingModel(regionModels, modelKey);
	const offPeak = offPeakSummary(currentModel, clock, t);
	// 新模型标记：与本区域名册求交（宿主已按 region 过滤过一次，这里再按行过滤
	// 一次是为了「名册与 id 来自同一次响应」这个不变量），只列前 3 个名字。
	const newRows = newModelsOf(regionModels, newModelIds);
	const newNames = newModelNamesOf(newRows);
	const newTooltip = newNames.length === 0 ? undefined : `${t("pill.newModelsTitle")}${newNames.join(t("pill.newModelsSep"))}`;

	// 签到动作（不只是显示）。与 Plugins 页 `QoderUsagePanel` 走同一条 claim
	// 路由和同一个「领完立刻重读」约定，所以面板上的按钮和设置卡里的按钮说的
	// 是同一件事——Credits 落回资源包，重读才把余额推上去。
	const [claimBusy, setClaimBusy] = react.useState(false);
	const [claimFailedMessage, setClaimFailedMessage] = react.useState<string | undefined>(undefined);

	const claim = react.useCallback(async () => {
		setClaimBusy(true);
		setClaimFailedMessage(undefined);
		try {
			await postJson(`${QODER_CHECKIN_PATH}?region=${encodeURIComponent(region)}`);
			await load();
		} catch (error) {
			// 红线 1：签到动作失败必须给用户可见的理由（http.ts 抛的 Error 里就是
			// 宿主给的 `error` 字段），不许静默吞掉——静默等于用户以为领了但没领。
			if (!mounted.current) return;
			setClaimFailedMessage(error instanceof Error ? error.message : String(error));
		} finally {
			if (mounted.current) setClaimBusy(false);
		}
	}, [load, region]);

	// 紧凑额度行：标签 + 内联进度条 + 剩余数（单行，用于个人资源包和专属资源包）。
	const compactQuotaRow = (label: string, q: CardQuota | null | undefined) => {
		if (!usableTotal(q)) return null;
		const qTier = tierOfQuota(q);
		// 与主额度同源的比例计算：优先上游 percentage，缺失用 used/total 反推。
		const pRaw = num(q!.percentage);
		const totalN = num(q!.total);
		const usedN = num(q!.used);
		const p = pRaw !== null ? pRaw : (totalN !== null && totalN > 0 && usedN !== null ? Math.min(1, Math.max(0, usedN / totalN)) : null);
		return (
			<div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "11px" }}>
				<span style={{ flex: "0 0 auto", color: "var(--dsw-alias-label-secondary, #61666b)" }}>{label}</span>
				<div style={{ flex: "1 1 auto", height: "4px", borderRadius: "999px", background: "var(--dsw-alias-bg-layer-2, #2a2b31)", overflow: "hidden" }}>
					{p !== null ? (
						<div style={{ height: "100%", width: `${Math.round(p * 100)}%`, borderRadius: "999px", background: TIER_DOT[qTier], transition: "width .3s ease" }} />
					) : null}
				</div>
				<span style={{ flex: "0 0 auto", fontWeight: "600", color: TIER_INK[qTier], fontVariantNumeric: "tabular-nums" }}>
					{formatCredits(remainingOf(q))} {t("usage.credits")}
				</span>
			</div>
		);
	};

	return (
		<span
			className="dsm-qoder-composer-pill"
			data-dsh-qoder-pill-root="true"
			style={{
				display: "inline-flex",
				alignItems: "center",
				height: "28px",
				position: "relative"
			}}
		>
			<button
				type="button"
				aria-expanded={open}
				aria-controls={open ? POPOVER_ID : undefined}
				title={t("pill.details")}
				onClick={() => {
					setOpen(!open);
				}}
				style={{
					display: "inline-flex",
					alignItems: "center",
					gap: "6px",
					height: "28px",
					padding: "0 8px",
					border: "0",
					borderRadius: "999px",
					background: "transparent",
					color: TIER_INK[tier],
					font: "inherit",
					fontVariantNumeric: "tabular-nums",
					cursor: "pointer"
				}}
			>
				<span
					aria-hidden="true"
					style={{
						width: "7px",
						height: "7px",
						borderRadius: "50%",
						background: TIER_DOT[tier],
						flex: "none"
					}}
				/>
				<span style={{ fontSize: "12px", lineHeight: "1", whiteSpace: "nowrap" }}>
					{`${prefix} · ${display}`}
				</span>
				{/* 第三段只在有标记时出现：没标记时胶囊的字符宽度与从前完全一致，
				    工具栏那 28px 单行预算不受影响。措辞是「本机首次见到」，见
				    copy-usage.ts 的注——不替上游宣布「网关新增」。 */}
				{newNames.length > 0 ? (
					<span
						title={newTooltip}
						style={{
							fontSize: "11px",
							lineHeight: "1",
							whiteSpace: "nowrap",
							color: "var(--dsw-alias-state-success-primary, #12b76a)"
						}}
					>
						{` · ${newNames.length} ${t("pill.newModels")}`}
					</span>
				) : null}
			</button>
			{/* 折叠态进度条：胶囊主额度是「单个桶」，已用比例取宿主算好的
			    `percentage`，缺失用 used/total 反推。2px 细条贴底贯穿胶囊，让
			    「还剩多少」一眼可见，贴近插件页卡片与 sensenova 套餐卡的形态。
			    比例查不到时不画填充，只留轨道——`—` 与「0」不等价，绝不冒充。 */}
			<div
				aria-hidden="true"
				style={{
					position: "absolute",
					left: "0",
					right: "0",
					bottom: "0",
					height: "2px",
					borderRadius: "999px",
					background: "var(--dsw-alias-bg-layer-2, #2a2b31)",
					overflow: "hidden"
				}}
			>
				{pct !== null ? (
					<div
						style={{
							height: "100%",
							width: `${Math.round(pct * 100)}%`,
							borderRadius: "999px",
							background: pctColor,
							transition: "width .3s ease"
						}}
					/>
				) : null}
			</div>
			{open ? (
				<div
					id={POPOVER_ID}
					role="dialog"
					aria-label={t("pill.details")}
					style={{
						position: "absolute",
						bottom: "calc(100% + 8px)",
						right: "0",
						width: "280px",
						maxWidth: "80vw",
						padding: "10px 12px",
						borderRadius: "10px",
						border: "1px solid var(--dsw-alias-border-l2, #36373b)",
						background: "var(--dsw-alias-bg-layer-3, #202126)",
						boxShadow: "0 8px 24px rgba(0,0,0,.4)",
						display: "flex",
						flexDirection: "column",
						gap: "10px",
						zIndex: 40,
						fontVariantNumeric: "tabular-nums"
					}}
				>
					<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
						<span style={{ fontSize: "13px", fontWeight: "600" }}>{prefix}</span>
						<span
							style={{
								fontSize: "11px",
								color: exhausted ? "var(--dsw-alias-state-error-primary, #d92d20)" : "var(--dsw-alias-label-tertiary, #999)"
							}}
						>
							{exhausted ? t("usage.exceeded") : t("pill.balance")}
						</span>
					</div>
					{stale && usage !== null ? (
						<div style={{ fontSize: "11px", color: "var(--dsw-alias-state-warn-primary, #d97706)" }}>
							{t("pill.stale")}
						</div>
					) : null}

					{/* 错峰折扣：只画当前选中模型的窗口状态（见上方 `offPeak` 注释）。
					    `promotion` 缺失不画块；有窗口但未生效画「未生效」，不假装在打折。 */}
					{offPeak !== undefined ? (
						<div
							style={{
								display: "flex",
								flexDirection: "column",
								gap: "4px",
								paddingBottom: "8px",
								borderBottom: "1px solid var(--dsw-alias-border-l2, #36373b)"
							}}
						>
							<div style={{ fontSize: "11px", color: "var(--dsw-alias-label-secondary, #61666b)" }}>
								{t("pill.modelLabel")}
							</div>
							<div style={{ fontSize: "12px", color: "var(--dsw-alias-label-primary, #e6e6e6)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
								{currentModel?.name ?? currentModel?.id ?? modelKey ?? ""}
							</div>
							<div
								style={{
									fontSize: "12px",
									color: offPeak.active
										? "var(--dsw-alias-state-success-primary, #12b76a)"
										: "var(--dsw-alias-label-tertiary, #999)",
									fontVariantNumeric: "tabular-nums"
								}}
							>
								{offPeak.active
									? `${t("pill.offpeakActive", { rate: offPeak.rate })} · ${t("pill.offpeakRemaining", {
											time: formatCountdown(offPeak.remainingSeconds)
										})}`
									: t("pill.offpeakIdle", { window: offPeak.window })}
							</div>
						</div>
					) : null}

					{/* 新模型行：放在余额之上，因为它解释「这个区域为什么值得看一眼」。
					    只列前几个名字，其余折叠成省略号——名字是举例不是清单。 */}
					{newNames.length > 0 ? (
						<div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
							<span style={{ fontSize: "11px", color: "var(--dsw-alias-label-secondary, #61666b)" }}>
								{t("pill.newModelsRow")}
							</span>
							<span style={{ fontSize: "12px", color: "var(--dsw-alias-state-success-primary, #12b76a)" }}>
								{newRows.length > newNames.length
									? `${newNames.join(t("pill.newModelsSep"))}…`
									: newNames.join(t("pill.newModelsSep"))}
							</span>
						</div>
					) : null}

					{known && quota !== undefined ? (
						<div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
							<div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "8px" }}>
								<span style={{ fontSize: "11px", color: "var(--dsw-alias-label-secondary, #61666b)" }}>
									{t("usage.planCredits")}
								</span>
								<span style={{ fontSize: "16px", fontWeight: "600", color: pctColor, fontVariantNumeric: "tabular-nums" }}>
									{pctText}
								</span>
							</div>
							{pct !== null ? (
								<div
									role="progressbar"
									aria-label={`${t("usage.planCredits")} ${pctText}`}
									aria-valuenow={Math.round(pct * 100)}
									aria-valuemin={0}
									aria-valuemax={100}
									style={{ height: "6px", borderRadius: "999px", background: "var(--dsw-alias-bg-layer-2, #2a2b31)", overflow: "hidden" }}
								>
									<div
										style={{
											height: "100%",
											width: `${Math.round(pct * 100)}%`,
											borderRadius: "999px",
											background: pctColor,
											transition: "width .3s ease"
										}}
									/>
								</div>
							) : null}
							<div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "8px", fontSize: "12px", color: "var(--dsw-alias-label-secondary, #61666b)" }}>
								<span>{`${t("usage.used")} ${formatCredits(num(quota.used))}`}</span>
								<span>
									{`${t("usage.remaining")} `}
									<strong style={{ fontSize: "16px", fontWeight: "600", color: TIER_INK[tier], fontVariantNumeric: "tabular-nums" }}>{display}</strong>
								</span>
							</div>
						</div>
					) : (
						// 未完成首次读 ≠ 读不到：前者只是还没答案（loading），后者是
						// 真查过却没有——两种状态说两句话，不把未加载画成失败。第三种
						// 是协议漂移：宿主说明了原因时用与卡片同一套判断，避免胶囊说
						// 「读不到」而实际是「该更新插件了」。
						<div style={{ fontSize: "11px", color: "var(--dsw-alias-label-tertiary, #999)" }}>
							{loadedOnce ? t(usageUnavailableKey(usage)) : t("pill.loading")}
						</div>
					)}

					{/* 个人资源包（当套餐 Credits 为主额度时作为次级额度显示）。 */}
					{usableTotal(usage?.userQuota) && usableTotal(usage?.addOnQuota) ? (
						compactQuotaRow(t("usage.resourcePackage"), usage!.addOnQuota)
					) : null}

					{/* 专属资源包：每条画进度条，与插件页卡片同源。 */}
					{Array.isArray(usage?.dedicatedPackages) && usage.dedicatedPackages.some((item) => usableTotal(item)) ? (
						<div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
							{usage.dedicatedPackages.map((item) => (
								compactQuotaRow(t("usage.dedicatedPackage"), item)
							))}
						</div>
					) : null}

					{/* 本地口径：请求计数 + token 消耗，同行显示（· 分隔）。 */}
					<div style={{ display: "flex", flexDirection: "column", gap: "2px", fontSize: "11px", color: "var(--dsw-alias-label-tertiary, #999)" }}>
						{usage?.requestsUnavailable === true ? (
							<span style={{ color: "var(--dsw-alias-label-tertiary, #999)" }}>
								{t("usage.requestsUnavailable")}
								{usage?.tokensToday !== undefined ? (
									<><span> · </span>{t("usage.tokensToday", { tokens: formatTokenCount(usage.tokensToday) })}</>
								) : null}
							</span>
						) : (
							<span>
								{t("usage.requestsToday", { count: usage?.requestsToday ?? 0 })}
								{usage?.tokensToday !== undefined ? (
									<><span> · </span>{t("usage.tokensToday", { tokens: formatTokenCount(usage.tokensToday) })}</>
								) : null}
								{usage?.requestsExhausted === true ? (
									<><span> · </span><span style={{ color: "var(--dsw-alias-state-warn-primary, #f79009)" }}>{t("usage.requestsExhausted")}</span></>
								) : null}
							</span>
						)}
						{usage?.tokensCachedToday !== undefined && usage.tokensCachedToday > 0 ? (
							<span style={{ color: "var(--dsw-alias-state-success-primary, #12b76a)" }}>
								{t("usage.tokensCachedToday", { cached: formatTokenCount(usage.tokensCachedToday) })}
							</span>
						) : null}
					</div>
					{usage?.tokensHistory && usage.tokensHistory.length > 0 ? (
						<TokenHistoryChart history={usage.tokensHistory} t={t} />
					) : null}

					{checkin !== undefined && checkin.active === true ? (
						<div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
							{checkin.todayCheckedIn === true ? (
								<span style={{ fontSize: "12px", color: "var(--dsw-alias-state-success-primary, #12b76a)" }}>
									{t("pill.checkinDone")}
								</span>
							) : (
								<button
									type="button"
									disabled={claimBusy}
									aria-busy={claimBusy}
									onClick={() => {
										void claim();
									}}
									style={{
										alignSelf: "flex-start",
										display: "inline-flex",
										alignItems: "center",
										height: "26px",
										padding: "0 10px",
										border: "1px solid var(--dsw-alias-brand-primary, #5686fe)",
										borderRadius: "999px",
										background: "transparent",
										color: "var(--dsw-alias-state-success-primary, #12b76a)",
										font: "inherit",
										fontSize: "12px",
										cursor: "pointer",
										opacity: claimBusy ? "0.6" : "1"
									}}
								>
									{claimBusy
										? t("pill.checkinBusy")
										: t("pill.checkinNow", { amount: formatCredits(num(checkin.amount)) })}
								</button>
							)}
							{claimFailedMessage === undefined ? null : (
								<span style={{ fontSize: "11px", color: "var(--dsw-alias-state-error-primary, #d92d20)" }}>
									{t("pill.checkinFailed", { message: claimFailedMessage })}
								</span>
							)}
						</div>
					) : null}
				</div>
			) : null}
		</span>
	)
}

/* ------------------------------------------------------------------ */
/* 外层：只做归属门控，不调用任何 hook                                   */
/* ------------------------------------------------------------------ */

/**
 * 输入框工具栏用量胶囊。仅当会话当前指向 Qoder 区域时挂载内层；否则不渲染、
 * 也不跑 fetch 循环。
 */
export function ComposerUsagePill({ t, useProjection }: ComposerPillProps) {
	// renderer 物化的 keyed 标准 prop；Node 单测不注入时回落 noop（见文件头）。
	const projection = (useProjection ?? (() => undefined))("modelSelection");
	const region = selectedRegionOf(projection);
	if (!isQoderRegion(region)) return null;
	return <ActiveUsagePill t={t} region={region as string} modelKey={selectedModelOf(projection)} />
}
