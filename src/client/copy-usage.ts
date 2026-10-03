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
	"usage.checkinError": "签到失败：{message}"
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
	"usage.viewDetails": "View details",
	"usage.credits": "Credits",
	"usage.checkin": "Daily check-in",
	"usage.checkinGain": "+{amount} Credits",
	"usage.checkinClaim": "Check in",
	"usage.checkinClaiming": "Claiming…",
	"usage.checkinClaimed": "Checked in today",
	"usage.checkinGranted": "Claimed {amount} Credits",
	"usage.checkinAlready": "Already claimed today",
	"usage.checkinError": "Check-in failed: {message}"
};
