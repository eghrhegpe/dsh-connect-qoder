/** Simplified Chinese — account panel copy. */
export const zhAccount = {
	"account.reload": "重新读取登录状态",
	"account.confirm": "在线校验登录",
	"account.confirming": "校验中…",
	"account.confirmed": "在线校验通过：登录有效",
	"account.confirmExpired": "在线校验发现登录已过期——在 Qoder 客户端里重新登录后点「重新读取登录状态」",
	"account.confirmFailed": "在线校验失败：{detail}",
	"account.state.ok": "正常",
	"account.state.expired": "已过期",
	"account.state.needs-app": "读不到",
	"account.state.signed-out": "未登录",
	"account.envPat": "来自环境变量 PAT",
	"account.appFrom": "来自 {app}",
	"account.expiresAt": "有效期至 {date}",
	"account.unsigned": "本机没装这个版本的 Qoder 客户端",
	"account.expiredHint": "登录已失效——请打开 Qoder 客户端（{app}）重新登录，然后点「重新读取登录状态」",
	// The advice has to be true on every platform the plugin can run on. The
	// previous wording ("make sure a signed-in Qoder client is on this machine")
	// is exactly wrong for a macOS or Linux user: they HAVE one, the plugin just
	// cannot read that platform's keychain yet, and the host now says so in
	// `detail`. A PAT is the one fallback that works everywhere, so it is what
	// this points at; "re-read" only helps if the cause really was a stale read.
	"account.readFail": "本地登录信息读不到：{detail}。可改用环境变量 PAT（QODERCN_PAT / QODER_PAT），或点「重新读取登录状态」",
	"account.download": "没装 Qoder 客户端？到「下载」区安装 {edition}，装好后登录",
	"account.downloadLink": "下载 {edition}",
	"account.error": "读取账号状态失败",
	// Now a VISIBLE label on the switch, not a tooltip. It used to be "模型"
	// with the whole explanation living in a 57-character `title` that a touch
	// user or a keyboard focus never saw — and the switch sat inside the region
	// pill, eight pixels from a tab button that did something else entirely.
	"account.offer": "启用此版本",
	"account.offerTitle": "关闭后这个版本的模型不会出现在 DSH 的模型下拉框里；登录、用量与模型设置都会保留，重新开启即恢复。",
	"account.offerOff": "已关闭：该版本的模型不会出现在 DSH 的模型下拉框里",
	"account.offerError": "保存「启用此版本」开关失败：{detail}",
	"account.regionTabs": "版本：点哪个就看哪个版本的账号、用量与模型"
};
/** English — account panel copy. */
export const enAccount = {
	"account.reload": "Re-read sign-in",
	"account.confirm": "Confirm online",
	"account.confirming": "Confirming…",
	"account.confirmed": "Confirmed: sign-in is valid",
	"account.confirmFailed": "Could not confirm: {detail}",
	"account.state.ok": "OK",
	"account.state.expired": "Expired",
	"account.state.needs-app": "Unreadable",
	"account.state.signed-out": "Not signed in",
	"account.envPat": "from an environment PAT",
	"account.appFrom": "from {app}",
	"account.expiresAt": "Valid until {date}",
	"account.unsigned": "No Qoder client for this edition is installed on this machine",
	"account.expiredHint": "Sign-in has lapsed — sign in again in the Qoder client ({app}), then click Re-read sign-in",
	// See the zh note above: the remedy has to be valid everywhere, and a PAT is.
	"account.readFail": "Could not read the local credential: {detail}. Either set an environment PAT (QODERCN_PAT / QODER_PAT), or press Re-read sign-in",
	"account.download": "The Qoder client is missing — install {edition} from the Download section, then sign in",
	"account.downloadLink": "Download {edition}",
	"account.confirmExpired": "Confirmed: sign-in expired — sign in again in the Qoder client, then re-read",
	"account.error": "Could not read the account states",
	"account.offer": "Offer this edition",
	"account.offerTitle": "Turning this off hides the edition's models from DSH's model picker; the sign-in, usage and model settings are kept, and turning it back on restores them.",
	"account.offerOff": "Disabled: this edition's models are not offered to the model picker",
	"account.offerError": "Could not save the edition switch: {detail}",
	"account.regionTabs": "Editions: pick which one's account, usage and models to view"
};
