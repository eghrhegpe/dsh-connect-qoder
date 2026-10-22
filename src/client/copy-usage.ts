/** Simplified Chinese — usage panel copy. */
export const zhUsage = {
	"usage.title": "我的用量",
	// "刷新" alone was ambiguous next to the card's other refresh: this one
	// re-reads the quota, the other re-reads the model catalog.
	"usage.refresh": "刷新用量",
	"usage.loading": "正在读取用量…",
	"usage.empty": "当前账户暂无可展示的用量。",
	"usage.unavailable": "这个区域暂时读不到用量。",
	"usage.none": "这个版本暂时没有用量数据（未登录或尚未上线）。",
	// `{reason}` carries the host's own words, not a guess. The international
	// edition's campaigns endpoint is gated on the desktop app's machine
	// identity, so the check-in card is absent for THAT reason — not because
	// there is nothing to claim. Rendering nothing was indistinguishable from
	// "no round today", which is the silent-failure shape (red line 1).
	"usage.checkinUnavailable": "每日签到暂不可用：{reason}",
	"usage.error": "读取用量失败",
	"usage.planCredits": "套餐内 Credits",
	"usage.resourcePackage": "个人资源包",
	"usage.dedicatedPackage": "专属资源包",
	"usage.renewsOn": "将于 {date} 续订",
	"usage.expiresOn": "将于 {date} 结束",
	"usage.remaining": "剩余",
	"usage.used": "已使用",
	"usage.exceeded": "额度用完",
	"usage.promotion": "限时特惠",
	// Upstream can ship several campaigns at once. Each used to take a full
	// line — same badge, same weight, no way to tell which one is relevant —
	// until the promo block was taller than the quota it sits under. More than
	// one now collapses behind a count. The folded label keeps the offer
	// wording the per-line badge carried: folding the campaigns away must not
	// also drop the signal that there ARE offers on this account.
	"usage.promoCount": "限时特惠 · {count} 个活动",
	"usage.promoCollapse": "收起活动",
	// 促销行读失败时的可见降级：配额数字照旧显示，但「今天没有活动」与
	// 「活动没读出来」不再长得一样（红线 1）。{reason} 是宿主原话。
	"usage.promotionsUnavailable": "活动信息暂不可用：{reason}",
	// 协议漂移（docs/issues/10 的残留缺口）：上游 200 的正文不再是本插件认识的信封。
	// 这不是「稍后再试」能好的——只有更新插件能修，所以不能借用「读不到用量」的
	// 措辞让用户反复重试。「重新登录也没有用」是刻意写明的：账号是好的，是形状变了。
	"usage.protocolChanged": "Qoder 返回了本插件不认识的格式——请更新插件（重新登录没有用）",
	// docs/issues/24：第二个「重试无用」的读失败。上游明确说今日额度已用尽，能等的只有
	// 零点重置；沿用「暂时读不到」会让用户反复点刷新去等一件不会因为刷新而改变的事。
	"usage.dailyLimit": "今日额度已用尽（上游口径）——零点重置后自动恢复",
	"usage.promotionsProtocolChanged": "活动接口返回了本插件不认识的格式——请更新插件（重新登录没有用）",
	"usage.viewDetails": "查看详情",
	"usage.credits": "Credits",
	// The daily check-in. Wording follows dsh-connect-workbuddy's own
	// check-in so two sibling cards read alike in the same list: a three-state
	// button plus a line telling you what today's round is worth. `checkinGain`
	// is the card's headline and reads the amount the HOST resolved from the
	// live campaign — a repeat claim grants nothing and must not be rendered as
	// though it did, which is why the granted/already notices stay separate.
	"usage.checkin": "每日签到",
	"usage.checkinGain": "+{amount} Credits",
	"usage.checkinClaim": "立即签到",
	"usage.checkinClaiming": "签到中…",
	"usage.checkinClaimed": "今日已签到",
	"usage.checkinGranted": "已领取 {amount} Credits",
	"usage.checkinAlready": "今天这份已经领过了",
	"usage.checkinError": "签到失败：{message}",
	// 对话框用量胶囊（composer-usage-pill.tsx）。胶囊正文只放 `Qoder CN · 1,034`，
	// 这些词都是展开面板里的：面板右上「余额」标签、读不到时的说明、以及今日签到行
	// 的两个状态。复用 `usage.planCredits` / `usage.dedicatedPackage` / `usage.remaining`
	// / `usage.used` / `usage.exceeded`，所以胶囊与 Plugins 页卡片说同一套词。
	"pill.details": "用量详情",
	"pill.balance": "余额",
	"pill.loading": "正在读取用量…",
	"pill.unavailable": "读不到用量",
	// 数字还在、读取已经断了：面板顶部一行小字，诚实标注这是旧数（红线 1 的
	// 「显式降级」——数值保留不等于宣称它仍是当刻事实）。
	"pill.stale": "数据可能已过期",
	"pill.checkinDone": "今日已签到",
	// 胶囊面板里的签到**动作**（不只是显示）：可领取时给一个真按钮，点了就走
	// 与 Plugins 页同一个 claim 路由。`busy` 是请求在途，`failed` 是宿主给的失败
	// 理由（红线 1：新失败路径必须给用户可见的错误，不许吞）。
	"pill.checkinNow": "签到领 {amount} Credits",
	"pill.checkinBusy": "签到中…",
	"pill.checkinFailed": "签到失败：{message}",
	// 错峰折扣（面板顶部的「当前模型」块）。折扣挂在模型上，所以块里先说当前是哪个
	// 模型，再说它的窗口状态；`offpeakIdle` 是「有窗口但不在窗口内」，不是假装在打折。
	"pill.modelLabel": "当前模型",
	"pill.offpeakActive": "错峰折扣生效 · 费率 {rate}",
	"pill.offpeakIdle": "错峰窗口 {window} · 未生效",
	"pill.offpeakRemaining": "剩余 {time}",
	// 「本机首次见到」的模型标记（胶囊第三段 `· N 新模型` + 面板一行）。措辞刻意
	// 不说「网关新增」：Qoder 的目录行没有「上架时间」字段，本插件能证明的只有
	// 「本机上次记下的名册里没有它」，说成网关新增就是替上游宣布一件它没公布的事。
	// 窗口 7 天，过期自动消失——这是提示不是档案。
	"pill.newModels": "新模型",
	"pill.newModelsRow": "本机新见",
	"pill.newModelsTitle": "本机首次见到的模型：",
	"pill.newModelsSep": "、",
	// 本地请求计数器（本客户端经本插件发往上游的每日对话轮数）。上游不给每日上限，
	// 只报「用完了」，所以这是本地自计——与魔搭社区兄弟插件同款本地口径。桌面端与
	// Web 端各记各的；官方总量以 Qoder 为准。`requestsToday` 为 `null`（文件尚不存在）
	// 时宿主下发 `0`，客户端说「今日 0 次」（有数据、只是还没有）；计数器没挂上（旧宿主 /
	// 未启用）时发 `requestsUnavailable: true`，客户端说「本地计数未接入」。
	// 撞到每日限流时附 `requestsExhausted` 注（仅本地推断，不保证）。
	"usage.requestsToday": "今日经本客户端请求 {count} 次",
	"usage.requestsUnavailable": "本地请求计数未接入",
	"usage.requestsExhausted": "今日额度疑似已用尽（本地统计，仅供参考）",
	// 本地 token 消耗累加器（上游每轮明确下发的 total_tokens / cached_tokens，本地
	// 聚合）。与请求计数同行显示（· 分隔），所以去掉重复的「今日经本客户端」前缀。
	"usage.tokensToday": "消耗 {tokens} tokens",
	"usage.tokensCachedToday": "（其中缓存命中 {cached}）",
	"usage.tokensHistoryTitle": "Token 用量（7 天）",
	"usage.tokensWeeklyTotal": "周总 {total}",
	"usage.tokensDailyAvg": "日均 {avg}",
	"usage.tokensTrendUp": "↑ 涨 {pct}%",
	"usage.tokensTrendDown": "↓ 跌 {pct}%",
	"usage.tokensTrendFlat": "— 持平",
	"usage.tokensDayTooltip": "{day}: {total} tokens"
};
/** English — usage panel copy. */
export const enUsage = {
	"usage.title": "My usage",
	"usage.refresh": "Refresh usage",
	"usage.loading": "Reading usage…",
	"usage.empty": "This account has no usage to show right now.",
	"usage.unavailable": "Usage is unavailable for this region right now.",
	"usage.none": "No usage data for this edition (not signed in, or offline yet).",
	// See the zh note: the reason is the host's, and it is the whole message.
	"usage.checkinUnavailable": "Daily check-in unavailable: {reason}",
	"usage.error": "Could not read usage",
	"usage.planCredits": "Plan Credits",
	"usage.resourcePackage": "Personal resource package",
	"usage.dedicatedPackage": "Dedicated package",
	"usage.renewsOn": "Renews on {date}",
	"usage.expiresOn": "Ends on {date}",
	"usage.remaining": "remaining",
	"usage.used": "used",
	"usage.exceeded": "Quota exhausted",
	"usage.promotion": "Limited offer",
	"usage.promoCount": "Limited offer · {count} offers",
	"usage.promoCollapse": "Hide offers",
	// See the zh note: the reason is the host's, and it is the whole message.
	"usage.promotionsUnavailable": "Offers unavailable: {reason}",
	// See the zh note: a shape change cannot be retried into working, so this
	// copy points at a plugin update instead of borrowing the retry wording.
	"usage.protocolChanged": "Qoder replied in a shape this plugin does not recognise — update the plugin (signing in again will not help)",
	"usage.dailyLimit": "Today's allowance is spent (upstream's own words) — it comes back after the midnight reset",
	"usage.promotionsProtocolChanged": "The offers endpoint replied in a shape this plugin does not recognise — update the plugin (signing in again will not help)",
	"usage.viewDetails": "View details",
	"usage.credits": "Credits",
	"usage.checkin": "Daily check-in",
	"usage.checkinGain": "+{amount} Credits",
	"usage.checkinClaim": "Check in",
	"usage.checkinClaiming": "Claiming…",
	"usage.checkinClaimed": "Checked in today",
	"usage.checkinGranted": "Claimed {amount} Credits",
	"usage.checkinAlready": "Already claimed today",
	"usage.checkinError": "Check-in failed: {message}",
	"pill.details": "Usage details",
	"pill.balance": "Balance",
	"pill.loading": "Reading usage…",
	"pill.unavailable": "No usage reading",
	"pill.stale": "Data may be stale",
	"pill.checkinDone": "Checked in today",
	"pill.checkinNow": "Check in · {amount} Credits",
	"pill.checkinBusy": "Checking in…",
	"pill.checkinFailed": "Check-in failed: {message}",
	"pill.modelLabel": "Current model",
	"pill.offpeakActive": "Off-peak active · rate {rate}",
	"pill.offpeakIdle": "Off-peak window {window} · inactive",
	"pill.offpeakRemaining": "{time} remaining",
	// See the zh note: this is "first seen on THIS machine", not "newly listed by
	// the gateway" — the catalog has no listed-since field, so the weaker claim
	// is the only true one. Window is 7 days; the marker is a hint, not an archive.
	"pill.newModels": "new",
	"pill.newModelsRow": "New here",
	"pill.newModelsTitle": "First seen on this device: ",
	"pill.newModelsSep": ", ",
	// See the zh note: local request counter, self-counted (upstream only says
	// "used up", never the limit), same local-only accounting as the ModelScope
	// sibling plugin. Desktop and Web count separately. When the counter is
	// wired but has no data yet, the host sends 0; when it is not wired at all,
	// the host sends requestsUnavailable: true.
	"usage.requestsToday": "Requested {count} times via this client today",
	"usage.requestsUnavailable": "Local request count not wired in",
	"usage.requestsExhausted": "Daily allowance may be used up (local estimate, for reference)",
	// Local token-consumption accumulator (upstream's per-turn total_tokens /
	// cached_tokens, aggregated locally). Displayed inline after the request
	// count with a " · " separator, so the "via this client today" prefix is
	// shared.
	"usage.tokensToday": "spent {tokens} tokens",
	"usage.tokensCachedToday": "(including {cached} cached)",
	"usage.tokensHistoryTitle": "Token usage (7 days)",
	"usage.tokensWeeklyTotal": "Weekly {total}",
	"usage.tokensDailyAvg": "Avg {avg}",
	"usage.tokensTrendUp": "↑ +{pct}%",
	"usage.tokensTrendDown": "↓ −{pct}%",
	"usage.tokensTrendFlat": "— flat",
	"usage.tokensDayTooltip": "{day}: {total} tokens"
};
