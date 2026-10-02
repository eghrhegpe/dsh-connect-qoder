/** Simplified Chinese — model row copy. */
export const zhRow = {
	"row.title": "接入 Qoder 积分与模型 (dsh-connect-qoder)",
	"row.desc": "使用本机已登录的 Qoder（国内版 / 国际版）模型；图像输入可以按模型逐个设置。",
	"row.expand": "展开",
	"row.collapse": "收起",
	"row.loading": "正在读取模型目录…",
	"row.signedOut": "没找到已登录的 Qoder 应用，所以没有模型。",
	"row.regionEmpty": "这个版本当前没有可展示的模型（未登录，或它的「模型」开关已关闭）。",
	"row.imageTitle": "图像输入",
	"row.imageHint": "「跟随目录」使用 Qoder 自己声明的视觉能力；「开启」/「关闭」是手动强制。开启后该模型可以接收图片。",
	"row.maxWindow": "按最大上下文显示",
	"row.maxWindowTitle": "开启时显示该模型支持的最大窗口；关闭时显示默认窗口。未列出窗口的模型不支持切换。",
	"row.maxWindowNote": "该模型未提供可切换的上下文窗口",
	"row.save": "保存",
	"row.saving": "保存中…",
	"row.saved": "已保存",
	// The 404-legacy save: the value reached the settings scope's own snapshot
	// but the host endpoint did not confirm it, so "已保存" would be a lie.
	"row.savedUnconfirmed": "已保存（未确认）",
	"row.discard": "撤销更改",
	"row.unsaved": "有未保存的更改",
	"row.failed": "保存失败",
	"row.requestFailed": "读取模型目录失败",
	"row.imageAuto": "跟随目录",
	"row.imageOn": "开启",
	"row.imageOff": "关闭",
	"row.vision": "视觉",
	"row.textOnly": "纯文本",
	"row.region.qoder-cn": "国内版",
	"row.region.qoder": "国际版",
	"row.showInPicker": "出现在模型下拉框",
	"row.showHint": "未勾选的模型不会出现在 DSH 的模型下拉框里。",
	"row.enableAll": "全部勾选",
	"row.disableAll": "全部取消勾选",
	"row.enabledCount": "已勾选 {count} / {total}",
	"row.rateFree": "免费",
	"row.rateLabel": "倍率",
	// Two refreshes used to sit on one card under three different names —
	// "刷新" (usage), "刷新计费" (catalog) and "重新读取登录状态" (sign-in) —
	// so a user whose numbers looked wrong had to guess which one to press.
	// The sign-in one is a genuinely different action and keeps its own name;
	// these two now say WHAT they refresh. "刷新计费" was the worst of them:
	// the route re-reads the model catalog, and the rates ride along with it.
	"row.refreshModels": "刷新模型目录",
	"row.refreshing": "正在刷新…",
	"row.refreshed": "已更新（{time}）",
	// Issue 05: the host now ships the fetch time and names a stale region,
	// so the card can say what it knows instead of stamping "now" on a refresh
	// that never happened. A protocol change gets its own wording on purpose —
	// its fix is a plugin update, so pointing at a re-sign-in would send the
	// user through a ritual that cannot possibly work.
	"row.refreshStale": "上次更新：{time}（刷新失败）",
	"row.refreshFailed": "刷新失败：{reason}",
	"row.refreshNotPersisted": "已刷新，但写盘失败——重启后会回到旧目录（下次刷新会自动重试）",
	"row.protocolChanged": "Qoder 的接口返回了本插件不认识的格式——请更新插件（重新登录没有用）",
	"row.offPeakOn": "错峰价",
	"row.offPeakOff": "标准价",
	// The badge names the boundary the rate flips at, not a countdown to it:
	// "错峰价 至 08:00" / "标准价 22:00 起". The precise countdown stays in the
	// badge's tooltip, where it is read on demand instead of ticking on screen.
	"row.offPeakEnd": "至 {time}",
	"row.offPeakStart": "{time} 起",
	"row.offPeakUntil": "{time} 后切换",
	"row.offPeakHint": "错峰时段 {window}（{zone}）享受折扣；倍率按当前时段显示，到点会自动变化。",
	// Search, error retry, and the Escape-to-collapse affordance.
	"row.search": "搜索模型",
	"row.searchPlaceholder": "输入模型名…",
	"row.searchEmpty": "没有匹配的模型。",
	"row.retry": "重试",
	// Split in two so the two facts can carry different weight: how many rows
	// the filter left on screen is bookkeeping, how many of them will actually
	// reach DSH's model picker is the number the user is here to set.
	"row.filterCount": "显示 {visible} / {total}",
	"row.filterTicked": "已勾选 {ticked}",
	"row.clearFilter": "清除筛选",
	// The per-row image-input selects are the card's single largest source of
	// noise: fourteen rows each printing "跟随目录", a value that says "nothing
	// was set". They are now behind this switch. It is a VIEW switch, not a
	// setting — it never dirties the card — and a model already carrying an
	// override stays visible even with it off: hiding a value the user set
	// would be worse than the noise.
	"row.imageTuning": "按模型微调图像输入",
	"row.imageTuningTitle": "默认关闭：所有模型跟随 Qoder 目录声明的视觉能力。开启后可以为每个模型单独强制开启或关闭；已经改过的模型始终显示。"
};
/** English — model row copy. */
export const enRow = {
	"row.title": "Connect Qoder credits and models (dsh-connect-qoder)",
	"row.desc": "Use the Qoder models already signed in on this machine (Qoder CN / Qoder); image input is decided per model.",
	"row.expand": "Expand",
	"row.collapse": "Collapse",
	"row.loading": "Reading the model catalog…",
	"row.signedOut": "No signed-in Qoder app was found, so there are no models.",
	"row.regionEmpty": "No models to show for this edition right now (not signed in, or its switch is off).",
	"row.imageTitle": "Image input",
	"row.imageHint": "\"Follow catalog\" uses Qoder's own vision flag; On/Off forces it. An enabled model accepts images.",
	"row.maxWindow": "Show each model's maximum context window",
	"row.maxWindowTitle": "On: show the widest window the model offers. Off: show the default window. Models with no listed window cannot be switched.",
	"row.maxWindowNote": "No switchable context window offered for this model",
	"row.save": "Save",
	"row.saving": "Saving…",
	"row.saved": "Saved",
	// The 404-legacy save: only the scope's snapshot saw the value, so the
	// host did not confirm it and a clean "Saved" would be a lie.
	"row.savedUnconfirmed": "Saved (unconfirmed)",
	"row.discard": "Discard changes",
	"row.unsaved": "Unsaved changes",
	"row.failed": "Save failed",
	"row.requestFailed": "Could not read the model catalog",
	"row.imageAuto": "Follow catalog",
	"row.imageOn": "On",
	"row.imageOff": "Off",
	"row.vision": "Vision",
	"row.textOnly": "Text",
	"row.region.qoder-cn": "Qoder CN",
	"row.region.qoder": "Qoder",
	"row.showInPicker": "Show in the model picker",
	"row.showHint": "An unchecked model is hidden from DSH's model picker.",
	"row.enableAll": "Check all",
	"row.disableAll": "Uncheck all",
	"row.enabledCount": "{count} of {total} checked",
	"row.rateFree": "free",
	"row.rateLabel": "Rate",
	"row.refreshModels": "Refresh the model catalog",
	"row.refreshing": "Refreshing…",
	"row.refreshed": "Updated ({time})",
	"row.refreshStale": "Last updated: {time} (refresh failed)",
	"row.refreshFailed": "Refresh failed: {reason}",
	"row.refreshNotPersisted": "Refreshed, but the catalog could not be written — it will revert after a restart (the next refresh retries automatically)",
	"row.protocolChanged": "Qoder replied in a format this plugin does not recognise — update the plugin (signing in again will not help)",
	"row.offPeakOn": "off-peak",
	"row.offPeakOff": "standard",
	"row.offPeakEnd": "until {time}",
	"row.offPeakStart": "from {time}",
	"row.offPeakUntil": "switches in {time}",
	"row.offPeakHint": "The off-peak discount applies {window} ({zone}); the rate shown follows the current window and changes on its own at the boundary.",
	// Search, error retry, and the Escape-to-collapse affordance.
	"row.search": "Search models",
	"row.searchPlaceholder": "Type a model name…",
	"row.searchEmpty": "No matching models.",
	"row.retry": "Retry",
	"row.filterCount": "{visible} of {total} shown",
	"row.filterTicked": "{ticked} ticked",
	"row.clearFilter": "Clear filter",
	"row.imageTuning": "Tune image input per model",
	"row.imageTuningTitle": "Off by default: every model follows the vision flag Qoder's own catalog declares. Turn it on to force image input on or off per model; a model you have already changed stays visible either way."
};
