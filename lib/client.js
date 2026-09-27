/** Generated from src/client by scripts/build-client.mjs — edit the sources, not this file. */
window.__ModuleLoader__.load({
	id: "@eghrhegpe/dsh-connect-qoder",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region \0rolldown/runtime.js
		var __create = Object.create;
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __getProtoOf = Object.getPrototypeOf;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __copyProps = (to, from, except, desc) => {
			if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
				key = keys[i];
				if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
					get: ((k) => from[k]).bind(null, key),
					enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
				});
			}
			return to;
		};
		var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
			value: mod,
			enumerable: true
		}) : target, mod));
		//#endregion
		let react = require("react");
		react = __toESM(react, 1);
		let react_jsx_runtime = require("react/jsx-runtime");
		react_jsx_runtime = __toESM(react_jsx_runtime, 1);
		//#region src/client/styles.ts
		/**
		* Card styles, injected once into the page head.
		*
		* The card frame (`dsm-plugin-card` and its header/body parts) follows
		* the dsh-connect-* sibling convention — WorkBuddy's card — so every
		* connect plugin in the settings list reads as one family. Those rules
		* are COPIED here rather than borrowed: the host defines no `dsm-*`
		* class at all (its own chrome is hashed CSS modules), so without this
		* block the frame silently depends on whichever sibling plugin happens
		* to be installed, and uninstalling it would strip the border, header
		* and caret. The copy is byte-identical to WorkBuddy's on purpose, so
		* both plugins render the same even when loaded together.
		*
		* Every colour is a theme token with a literal fallback, so the card
		* follows the active theme instead of pinning one.
		*/
		const QODER_CARD_CSS = [
			".dsm-plugin-card{border:1px solid var(--dsw-alias-border-l2,#36373b);background:var(--dsw-alias-bg-layer-3,#202126);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}",
			".dsm-plugin-card:hover{border-color:var(--dsw-alias-label-dimmed,#777)}",
			".dsm-plugin-card-open{background:var(--dsw-alias-bg-layer-2,#25262b);border-color:var(--dsw-alias-label-dimmed,#777)}",
			".dsm-plugin-card-header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:transparent;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}",
			".dsm-plugin-card-header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:-2px}",
			".dsm-plugin-card-head{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}",
			".dsm-plugin-card-title{color:var(--dsw-alias-label-primary,#e6e6e6);font-size:15px;font-weight:600;line-height:1.4}",
			".dsm-plugin-card-description{color:var(--dsw-alias-label-tertiary,#999);font-size:13px;line-height:1.5}",
			".dsm-plugin-card-chevron{color:var(--dsw-alias-label-tertiary,#999);flex:none;width:16px;height:16px;position:relative;transition:transform .16s}",
			".dsm-plugin-card-chevron::before{content:\"\";display:block;position:absolute;left:4px;top:5px;width:7px;height:7px;border-right:1.6px solid currentColor;border-bottom:1.6px solid currentColor;transform:rotate(45deg)}",
			".dsm-plugin-card-chevron-open{transform:rotate(180deg)}",
			".dsm-plugin-card-body{border-top:1px solid var(--dsw-alias-border-l2,#36373b);margin:0 16px;padding:0 0 8px}",
			".dsm-plugin-card-icon{width:32px;height:32px;flex:none;border-radius:7px}",
			".dsm-qoder-body{padding:12px 14px;display:flex;flex-direction:column;gap:12px}",
			".dsm-qoder-hint{margin:0;color:var(--dsw-alias-label-primary,#1a1a1a);font-size:12px;line-height:1.6}",
			".dsm-qoder-switch{display:flex;align-items:center;gap:8px;font-size:13px}",
			".dsm-qoder-models{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px;max-height:320px;overflow:auto}",
			".dsm-qoder-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:6px 8px;border:1px solid var(--dsw-alias-border-l2,#36373b);border-radius:8px}",
			".dsm-qoder-row-main{display:flex;align-items:center;gap:8px;min-width:0}",
			".dsm-qoder-name{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".dsm-qoder-badge{font-size:10px;padding:1px 6px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,#36373b);color:var(--dsw-alias-label-primary,#1a1a1a);white-space:nowrap}",
			".dsm-qoder-select{font-size:12px;padding:3px 6px;border-radius:6px;background:var(--dsw-alias-bg-layer-3,#202126);color:inherit;border:1px solid var(--dsw-alias-border-l2,#36373b)}",
			".dsm-qoder-state{margin:0;font-size:12px;color:var(--dsw-alias-label-primary,#1a1a1a)}",
			".dsm-qoder-error{margin:0;font-size:12px;color:var(--dsw-alias-state-error-primary,#d92d20)}",
			".dsm-qoder-account-error{display:flex;align-items:center;gap:10px}",
			".dsm-qoder-actions{display:flex;gap:8px}",
			".dsm-qoder-button{font-size:12px;padding:5px 12px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,#36373b);background:transparent;color:inherit;cursor:pointer}",
			".dsm-qoder-button:disabled{opacity:.5;cursor:default}",
			".dsm-qoder-usage{border:1px solid var(--dsw-alias-border-l2,#36373b);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:12px}",
			".dsm-qoder-usage-head{display:flex;align-items:center;justify-content:space-between;gap:8px}",
			".dsm-qoder-usage-title{margin:0;font-size:13px;font-weight:600}",
			".dsm-qoder-usage-block{display:flex;flex-direction:column;gap:6px}",
			".dsm-qoder-usage-label{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:12px}",
			".dsm-qoder-usage-when{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-primary,#1a1a1a);white-space:nowrap}",
			".dsm-qoder-bar{height:6px;border-radius:999px;background:var(--dsw-alias-bg-layer-3,#202126);overflow:hidden}",
			".dsm-qoder-bar-fill{height:100%;border-radius:999px;background:var(--dsw-alias-state-success-primary,#12b76a);transition:width .3s ease}",
			".dsm-qoder-bar-warn{background:var(--dsw-alias-state-warning-primary,#f79009)}",
			".dsm-qoder-bar-full{background:var(--dsw-alias-state-error-primary,#d92d20)}",
			".dsm-qoder-usage-figures{display:flex;align-items:baseline;justify-content:space-between;gap:8px;font-size:12px;color:var(--dsw-alias-label-primary,#1a1a1a)}",
			".dsm-qoder-usage-figures strong{color:inherit;font-weight:500}",
			".dsm-qoder-usage-badge{font-size:10px;padding:1px 6px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,#36373b);color:var(--dsw-alias-label-primary,#1a1a1a);white-space:nowrap}",
			".dsm-qoder-usage-badge-offer{border-color:var(--dsw-alias-state-success-primary,#12b76a);color:var(--dsw-alias-state-success-primary,#12b76a)}",
			".dsm-qoder-usage-promo{margin:0;font-size:11px;line-height:1.6;color:var(--dsw-alias-label-primary,#1a1a1a)}",
			".dsm-qoder-usage-promo a{color:inherit}",
			".dsm-qoder-usage-sep{height:1px;background:var(--dsw-alias-border-l2,#36373b);margin:0}",
			".dsm-qoder-usage-spacer{flex:1}",
			".dsm-qoder-pick{display:flex;align-items:center;gap:6px;flex:0 0 auto}",
			".dsm-qoder-rate{font-size:11px;padding:1px 6px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,#36373b);color:var(--dsw-alias-label-primary,#1a1a1a);white-space:nowrap;font-variant-numeric:tabular-nums}",
			".dsm-qoder-rate-free{border-color:var(--dsw-alias-state-success-primary,#12b76a);color:var(--dsw-alias-state-success-primary,#12b76a)}",
			".dsm-qoder-row-off .dsm-qoder-name{opacity:.55}",
			".dsm-qoder-tools{display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
			".dsm-qoder-search{font-size:12px;padding:5px 8px;border-radius:6px;background:var(--dsw-alias-bg-layer-3,#202126);color:inherit;border:1px solid var(--dsw-alias-border-l2,#36373b);min-width:150px;flex:1 1 150px}",
			".dsm-qoder-count{font-size:11px;color:var(--dsw-alias-label-primary,#1a1a1a);white-space:nowrap;font-variant-numeric:tabular-nums}",
			".dsm-qoder-skeleton{display:flex;flex-direction:column;gap:6px}",
			".dsm-qoder-skeleton-row{height:34px;border-radius:8px;background:linear-gradient(90deg,var(--dsw-alias-bg-layer-3,#202126) 25%,var(--dsw-alias-bg-layer-2,#2a2b31) 37%,var(--dsw-alias-bg-layer-3,#202126) 63%);background-size:400% 100%;animation:dsm-qoder-shimmer 1.4s ease infinite}",
			"@keyframes dsm-qoder-shimmer{0%{background-position:100% 50%}100%{background-position:0 50%}}",
			".dsm-qoder-row-pulse{animation:dsm-qoder-flash 1.2s ease}",
			"@keyframes dsm-qoder-flash{0%{border-color:var(--dsw-alias-state-success-primary,#12b76a)}100%{border-color:var(--dsw-alias-border-l2,#36373b)}}",
			".dsm-qoder-account{border:1px solid var(--dsw-alias-border-l2,#36373b);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:8px}",
			".dsm-qoder-account-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
			".dsm-qoder-account-id{display:flex;flex-direction:column;gap:2px;min-width:120px;flex:1 1 auto}",
			".dsm-qoder-account-name{font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".dsm-qoder-account-meta{font-size:11px;color:var(--dsw-alias-label-tertiary,#999)}",
			".dsm-qoder-account-note{margin:0;font-size:11px;line-height:1.5;color:var(--dsw-alias-label-tertiary,#999)}",
			".dsm-qoder-account-note-error{color:var(--dsw-alias-state-error-primary,#d92d20)}",
			".dsm-qoder-account-note a{color:inherit}",
			".dsm-qoder-region-toggle-cell{display:inline-flex;align-items:center;gap:6px;flex:none;cursor:pointer}",
			".dsm-qoder-region-toggle{appearance:none;-webkit-appearance:none;width:30px;height:17px;margin:0;border-radius:999px;background:var(--dsw-alias-bg-layer-2,#2a2b31);border:1px solid var(--dsw-alias-border-l2,#36373b);position:relative;cursor:pointer;transition:background .15s,border-color .15s;flex:none}",
			".dsm-qoder-region-toggle::before{content:\"\";position:absolute;top:1.5px;left:1.5px;width:12px;height:12px;border-radius:50%;background:var(--dsw-alias-label-tertiary,#999);transition:transform .15s,background .15s}",
			".dsm-qoder-region-toggle:checked{background:var(--dsw-alias-state-success-primary,#12b76a);border-color:var(--dsw-alias-state-success-primary,#12b76a)}",
			".dsm-qoder-region-toggle:checked::before{transform:translateX(13px);background:#fff}",
			".dsm-qoder-region-toggle:disabled{cursor:default;opacity:.55}",
			".dsm-qoder-account-row-off .dsm-qoder-account-id,.dsm-qoder-account-row-off .dsm-qoder-button{opacity:.55}",
			".dsm-qoder-region-tabs{display:flex;gap:8px;flex-wrap:nowrap}",
			".dsm-qoder-region-tab-cell{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--dsw-alias-border-l2,#36373b);border-radius:999px;padding:3px 8px 3px 6px;min-width:0}",
			".dsm-qoder-region-tab-cell-active{border-color:var(--dsw-alias-brand-primary,#5686fe)}",
			".dsm-qoder-region-tab{display:inline-flex;align-items:center;gap:6px;background:none;border:none;padding:2px;cursor:pointer;color:var(--dsw-alias-label-primary,#1a1a1a);min-width:0}",
			".dsm-qoder-region-tab-off{color:var(--dsw-alias-label-tertiary,#999)}",
			".dsm-qoder-region-dot{width:8px;height:8px;border-radius:50%;flex:none;background:var(--dsw-alias-label-tertiary,#999)}",
			".dsm-qoder-region-dot-ok{background:var(--dsw-alias-state-success-primary,#12b76a)}",
			".dsm-qoder-region-dot-expired{background:var(--dsw-alias-state-error-primary,#d92d20)}",
			".dsm-qoder-region-dot-needs{background:var(--dsw-alias-state-warning-primary,#f79009)}",
			".dsm-qoder-region-name{font-size:13px;font-weight:500;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}"
		].join("");
		/** Inject the card stylesheet once per page. */
		function installStyles() {
			const cssId = "dsh-connect-qoder/client.css";
			if (document.querySelector(`style[data-plugin-css="${cssId}"]`) !== null) return;
			const styleTag = document.createElement("style");
			styleTag.dataset.plugin = "dsh-connect-qoder";
			styleTag.dataset.pluginCss = cssId;
			styleTag.textContent = QODER_CARD_CSS;
			document.head.appendChild(styleTag);
		}
		//#endregion
		//#region src/client/copy-row.ts
		/** Simplified Chinese — model row copy. */
		const zhRow = {
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
			"row.refreshModels": "刷新计费",
			"row.refreshing": "正在刷新…",
			"row.refreshed": "已更新（{time}）",
			"row.offPeakOn": "错峰价",
			"row.offPeakOff": "标准价",
			"row.offPeakUntil": "{time} 后切换",
			"row.offPeakHint": "错峰时段 {window}（{zone}）享受折扣；倍率按当前时段显示，到点会自动变化。",
			"row.search": "搜索模型",
			"row.searchPlaceholder": "输入模型名…",
			"row.searchEmpty": "没有匹配的模型。",
			"row.retry": "重试",
			"row.filterCount": "显示 {visible} / {total} · 已勾选 {ticked}",
			"row.clearFilter": "清除筛选"
		};
		/** English — model row copy. */
		const enRow = {
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
			"row.refreshModels": "Refresh rates",
			"row.refreshing": "Refreshing…",
			"row.refreshed": "Updated ({time})",
			"row.offPeakOn": "off-peak",
			"row.offPeakOff": "standard",
			"row.offPeakUntil": "switches in {time}",
			"row.offPeakHint": "The off-peak discount applies {window} ({zone}); the rate shown follows the current window and changes on its own at the boundary.",
			"row.search": "Search models",
			"row.searchPlaceholder": "Type a model name…",
			"row.searchEmpty": "No matching models.",
			"row.retry": "Retry",
			"row.filterCount": "{visible} of {total} shown · {ticked} ticked",
			"row.clearFilter": "Clear filter"
		};
		//#endregion
		//#region src/client/copy-usage.ts
		/** Simplified Chinese — usage panel copy. */
		const zhUsage = {
			"usage.title": "我的用量",
			"usage.refresh": "刷新",
			"usage.loading": "正在读取用量…",
			"usage.empty": "当前账户暂无可展示的用量。",
			"usage.unavailable": "这个区域暂时读不到用量。",
			"usage.none": "这个版本暂时没有用量数据（未登录或尚未上线）。",
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
			"usage.viewDetails": "查看详情",
			"usage.credits": "Credits",
			"usage.checkin": "每日签到",
			"usage.checkinAvailable": "今日可领 {amount} Credits",
			"usage.checkinClaim": "立即签到",
			"usage.checkinClaiming": "签到中…",
			"usage.checkinClaimed": "今日已签到",
			"usage.checkinGranted": "已领取 {amount} Credits",
			"usage.checkinAlready": "今天这份已经领过了",
			"usage.checkinError": "签到失败：{message}"
		};
		/** English — usage panel copy. */
		const enUsage = {
			"usage.title": "My usage",
			"usage.refresh": "Refresh",
			"usage.loading": "Reading usage…",
			"usage.empty": "This account has no usage to show right now.",
			"usage.unavailable": "Usage is unavailable for this region right now.",
			"usage.none": "No usage data for this edition (not signed in, or offline yet).",
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
			"usage.viewDetails": "View details",
			"usage.credits": "Credits",
			"usage.checkin": "Daily check-in",
			"usage.checkinAvailable": "{amount} Credits to claim today",
			"usage.checkinClaim": "Check in",
			"usage.checkinClaiming": "Claiming…",
			"usage.checkinClaimed": "Checked in today",
			"usage.checkinGranted": "Claimed {amount} Credits",
			"usage.checkinAlready": "Already claimed today",
			"usage.checkinError": "Check-in failed: {message}"
		};
		//#endregion
		//#region src/client/copy-account.ts
		/** Simplified Chinese — account panel copy. */
		const zhAccount = {
			"account.reload": "重新读取登录状态",
			"account.confirm": "在线校验登录",
			"account.confirming": "校验中…",
			"account.confirmed": "在线校验通过：登录有效",
			"account.confirmExpired": "在线校验发现登录已过期——在应用内重新登录后点「重新读取登录状态」",
			"account.confirmFailed": "在线校验失败：{detail}",
			"account.state.ok": "正常",
			"account.state.expired": "已过期",
			"account.state.needs-app": "读不到",
			"account.state.signed-out": "未登录",
			"account.envPat": "来自环境变量 PAT",
			"account.appFrom": "来自 {app}",
			"account.expiresAt": "有效期至 {date}",
			"account.unsigned": "本机没装这个版本的 Qoder 应用",
			"account.expiredHint": "请在应用里重新登录，然后点「重新读取登录状态」",
			"account.readFail": "本地登录信息读不到：{detail}",
			"account.openManage": "到 Qoder 管理页",
			"account.error": "读取账号状态失败",
			"account.offer": "模型",
			"account.offerTitle": "取消勾选就关闭这个版本：它的模型不会出现在 DSH 的模型下拉框里；登录、用量与模型设置都会保留，重新勾选即恢复。",
			"account.offerOff": "已关闭：该版本的模型不会出现在 DSH 的模型下拉框里",
			"account.offerError": "保存「模型」开关失败：{detail}",
			"account.regionTabs": "版本：点哪个就看哪个版本的账号、用量与模型"
		};
		/** English — account panel copy. */
		const enAccount = {
			"account.reload": "Re-read sign-in",
			"account.confirm": "Confirm online",
			"account.confirming": "Confirming…",
			"account.confirmed": "Confirmed: sign-in is valid",
			"account.confirmExpired": "Confirmed: sign-in expired — sign in again in the app, then re-read",
			"account.confirmFailed": "Could not confirm: {detail}",
			"account.state.ok": "OK",
			"account.state.expired": "Expired",
			"account.state.needs-app": "Unreadable",
			"account.state.signed-out": "Not signed in",
			"account.envPat": "from an environment PAT",
			"account.appFrom": "from {app}",
			"account.expiresAt": "Valid until {date}",
			"account.unsigned": "No Qoder app for this region is installed on this machine",
			"account.expiredHint": "Sign in again in the app, then click Re-read sign-in",
			"account.readFail": "Could not read the local credential: {detail}",
			"account.openManage": "Open the Qoder account page",
			"account.error": "Could not read the account states",
			"account.offer": "Models",
			"account.offerTitle": "Unchecking disables this edition: its models no longer appear in DSH's model picker; the sign-in, usage and model settings are kept, and re-checking restores them.",
			"account.offerOff": "Disabled: this edition's models are not offered to the model picker",
			"account.offerError": "Could not save the models switch: {detail}",
			"account.regionTabs": "Editions: pick which one's account, usage and models to view"
		};
		//#endregion
		//#region src/client/copy.ts
		/**
		* Card copy — the public entry point.
		*
		* The actual translations live in three section files:
		* - `copy-row.ts` — model row labels, search, filter, off-peak
		* - `copy-usage.ts` — usage panel and daily check-in
		* - `copy-account.ts` — account panel and region tabs
		*
		* This file merges them into the single `{ zh, en }` shape the card expects,
		* so `index.ts` and `card.ts` import from one place.
		*/
		/** Simplified Chinese copy. */
		const zh = {
			...zhRow,
			...zhUsage,
			...zhAccount
		};
		/** English copy. */
		const en = {
			...enRow,
			...enUsage,
			...enAccount
		};
		//#endregion
		//#region src/client/paths.ts
		/** Plugin-owned read-only model route the card renders its rows from. */
		const QODER_MODELS_PATH = "/plugins/dsh-connect-qoder/models";
		/** Plugin-owned read-only usage route the panel renders its quotas from. */
		const QODER_USAGE_PATH = "/plugins/dsh-connect-qoder/usage";
		/** Plugin-owned read-only account route the panel renders its states from. */
		const QODER_ACCOUNT_PATH = "/plugins/dsh-connect-qoder/account";
		/** Plugin-owned write route: re-read the sign-ins and start any region that came back. */
		const QODER_ACCOUNT_RELOAD_PATH = "/plugins/dsh-connect-qoder/account/reload";
		/** Plugin-owned write route: the one online confirmation of a region's sign-in. */
		const QODER_ACCOUNT_CONFIRM_PATH = "/plugins/dsh-connect-qoder/account/confirm";
		/**
		* Plugin-owned write route: claim the daily check-in.
		*
		* Region-scoped like `dsh-connect-workbuddy`'s equivalent route: the host owns
		* which round is live and never lets the card name a campaign of its own, so a
		* day-old round can never be claimed from a stale render.
		*/
		const QODER_CHECKIN_PATH = "/plugins/dsh-connect-qoder/checkin";
		//#endregion
		//#region src/client/settings-write.ts
		/**
		* Verified settings writes, adapted from the WorkBuddy bundle's
		* `writeField` contract (src/client/account-selection) to this card's
		* three top-level fields.
		*
		* `settingsScope.set()` resolving is NOT proof that anything was stored.
		* The Host's settings document is replaced by writing a temp file and
		* renaming it over the target; on Windows an antivirus scanner or a sync
		* client can hold the file briefly, and once the atomic-write retries
		* exhaust the settings scope reloads Host state and merely RETURNS — the
		* card's `await` succeeds while the document is unchanged. Reading the
		* field back is the only reliable check, and the plugin's own Host
		* endpoint is the only writer that actually persists in that failure
		* mode (it runs the mutate inside the Host process).
		*
		* Field shapes, matching the Host `__save` whitelist:
		* - `enabledModelIds` is per-region, so the write posts only the
		*   regions the card edits and the Host merges them into the
		*   authoritative value — saving one region can never delete the
		*   other's allow-list.
		* - `imageOverrides` / `useMaximumContextWindow` are posted whole; the
		*   card always knows their complete value.
		*/
		/**
		* A settings write that did not take effect.
		*
		* Distinct from a rejected `set()`: thrown when the write reported
		* success (or the read-back disagreed) — which is the whole point of
		* this module. The card shows it, so the user knows the value is not
		* saved instead of trusting a "已保存" banner over stale settings.
		*/
		var QoderSettingsWriteError = class extends Error {
			field;
			constructor(field, reason) {
				super(`qoder: settings field "${field}" was not persisted${reason === void 0 ? "" : `: ${reason}`}`);
				this.name = "QoderSettingsWriteError";
				this.field = field;
			}
		};
		/**
		* POST one field to the plugin's own Host save endpoint.
		*
		* The handler runs `settings.mutate` inside the Host process and
		* answers with the merged value plus a read-back, so a failure here
		* names its cause instead of arriving as a swallowed success.
		*
		* The 200 response may carry `ok: false` with an `errorName` when the
		* host read-back mismatched (the value did not land). That case is
		* indistinguishable from "not persisted" from the card's side, so it is
		* thrown as a write failure rather than returning the stale value.
		*/
		async function saveFieldViaHost(field, value) {
			let response;
			try {
				response = await fetch("/plugins/dsh-connect-qoder/__save", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					credentials: "same-origin",
					body: JSON.stringify({
						field,
						value
					})
				});
			} catch (error) {
				throw new QoderSettingsWriteError(field, `Host save endpoint unreachable: ${String(error)}`);
			}
			if (!response.ok) {
				const detail = await response.json().catch(() => ({ error: `HTTP ${String(response.status)}` }));
				const reason = `${String(detail.errorName ?? "")} ${String(detail.error ?? "")}`.trim();
				throw new QoderSettingsWriteError(field, `Host save refused: ${reason === "" ? String(detail.error) : reason}`);
			}
			const detail = await response.json().catch(() => void 0);
			if (detail !== void 0 && detail.ok === false) throw new QoderSettingsWriteError(field, `Host read-back mismatch: ${`${String(detail.errorName ?? "")} ${String(detail.error ?? "")}`.trim()}`);
			return detail?.value;
		}
		/** Read one field back from the scope snapshot, tolerating an absent namespace. */
		function fieldSnapshot(scope, field) {
			try {
				const value = scope.getSnapshot().value?.[field];
				return value === void 0 ? null : value;
			} catch {
				return null;
			}
		}
		/**
		* Write one settings field, then confirm the value actually landed.
		*
		* The Host endpoint goes FIRST — it is the only writer that persists in
		* the 0.1.7 silent-failure mode and, for the per-region field, the only
		* one that preserves the sibling region. `scope.set` then runs purely as
		* a mirror refresh (and as the legacy-host path, where the endpoint is
		* absent or the settings service is unreachable): on a host whose scope
		* write is authoritative, delivering and reading back suffices; on a
		* host where it settled without persisting, the read-back mismatch
		* falls through to the endpoint error, which is thrown — never
		* swallowed into a false "已保存".
		*
		* @returns the authoritative value the write settled on (from the
		*   endpoint) or `null` when only the scope delivered it.
		*/
		async function writeSettingsField(scope, field, value) {
			let hostError;
			let authoritative = null;
			try {
				authoritative = await saveFieldViaHost(field, value);
				try {
					await scope.set(field, authoritative);
				} catch {}
				return authoritative;
			} catch (error) {
				hostError = error;
			}
			let scopeDelivered = false;
			try {
				const nextValue = field === "enabledModelIds" ? {
					...fieldSnapshot(scope, field),
					...value
				} : value;
				scopeDelivered = await scope.set(field, nextValue) !== false;
			} catch {
				scopeDelivered = false;
			}
			if (authoritative !== null) return authoritative;
			if (scopeDelivered) {
				const readBack = fieldSnapshot(scope, field);
				if (field === "enabledModelIds" ? Object.keys(nextValue).every((regionId) => JSON.stringify(readBack?.[regionId]) === JSON.stringify(nextValue[regionId])) : JSON.stringify(readBack) === JSON.stringify(nextValue)) return authoritative;
			}
			throw hostError instanceof Error ? hostError : new QoderSettingsWriteError(field, "neither the Host save endpoint nor the settings scope persisted the value");
		}
		//#endregion
		//#region src/client/card.ts
		/** The three per-model image choices this card writes. */
		const IMAGE_MODES = [
			"auto",
			"on",
			"off"
		];
		/**
		* Sentinel stored in a region's allow-list to mean "hide every model".
		*
		* The host convention is `[] = no filter = show all` (a fresh install
		* must still see every model), so "hide all" has no value of its own in
		* that scheme. A non-empty list that matches no real model id collapses
		* to "show nothing" in `filterByEnabled` (the allow-list branch keeps
		* the ids, matches none, returns `[]`), so a marker that no model id can
		* ever equal expresses "hide all" without touching that convention.
		* Unticking any one model drops the marker (it is not in the region's
		* roster) and the list becomes a plain allow-list again.
		*/
		const HIDE_ALL_MODELS = "__hide-all__";
		/** Normalise whatever the saved map holds into one of {@link IMAGE_MODES}. */
		function imageModeOf(overrides, modelId) {
			const saved = overrides === null || typeof overrides !== "object" ? void 0 : overrides[modelId];
			return IMAGE_MODES.includes(saved) ? saved : "auto";
		}
		/** Fill a `{date}` placeholder in a translated string. */
		function withDate(template, at) {
			if (typeof at !== "number" || !Number.isFinite(at) || at <= 0) return "";
			const date = new Date(at).toLocaleDateString(void 0, {
				year: "numeric",
				month: "numeric",
				day: "numeric"
			});
			return template.replace("{date}", date);
		}
		/**
		* The credit multiplier as a short label.
		*
		* A zero multiplier is a free model, which is worth naming rather than
		* rendering as "x0.00"; a model whose catalog entry carries no multiplier
		* shows nothing at all. This mirrors how the host decorates the picker
		* name, so the card and the picker never disagree.
		*/
		function rateLabelOf(t, factor) {
			const value = Number(factor);
			if (!Number.isFinite(value)) return void 0;
			return value <= 0 ? t("row.rateFree") : `x${value.toFixed(2)}`;
		}
		/** Seconds past local midnight in `timezone`, or undefined when unusable. */
		function localSecondsOf(date, timezone) {
			try {
				const parts = new Intl.DateTimeFormat("en-US", {
					timeZone: timezone,
					hour12: false,
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
		/** Parse `HH:MM` into seconds past midnight, or undefined. */
		function parseClock(text) {
			const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(text ?? "").trim());
			if (match === null) return void 0;
			const hour = Number(match[1]);
			const minute = Number(match[2]);
			const second = Number(match[3] ?? 0);
			if (hour > 23 || minute > 59 || second > 59) return void 0;
			return hour * 3600 + minute * 60 + second;
		}
		/**
		* The off-peak window state for one model at a given instant.
		*
		* The window is evaluated in the browser rather than taken from the
		* server's answer so the card can flip the rate and tick the countdown on
		* its own — a rate that silently changed at 22:00 only after a manual
		* refresh would look broken. `end` not after `start` means the window
		* crosses midnight (`22:00`-`08:00` is the case Qoder uses), so the test
		* is a disjunction.
		*
		* The `active` gate is load-bearing and must match the host's own rule
		* (`isOffPeakActive` in lib/offpeak.js, reached here through
		* `projectModelRow`). Qoder keeps the window fields populated on a
		* promotion it has switched off, and `upstream.normalizePromotion` carries
		* `active` and `windowStart`/`windowEnd` independently, so a window alone
		* is NOT evidence that the discount is live. Without this check a model
		* whose promotion is off was rendered at the discounted rate during its
		* own hours — showing the user a price they are not charged — and the two
		* surfaces (card and picker) disagreed, because the host was correctly
		* showing the `before` rate for that same model.
		*
		* The bug needs a mixed catalog to appear: the ticking clock is installed
		* when ANY model has `active === true` (see the `hasActiveWindow` gate),
		* and from then on every row re-resolves through this function.
		*
		* SYNC CONSTRAINT: this mirrors lib/offpeak.js. The card runs in the browser
		* and cannot be imported into a Node test, so the rule is pinned twice:
		* test/model-row.test.js specifies it, test/client-bundle.test.js executes
		* the shipped bundle — see docs/KNOWN_GAPS.md item 3（客户端卡片的门控表达式）.
		*
		* @returns `{ active, remainingSeconds }`, or undefined when the model
		*   carries no usable window or its promotion is not active.
		*/
		function offPeakState(model, now) {
			const promo = model.promotion;
			if (promo === null || typeof promo !== "object") return void 0;
			if (promo.active !== true) return void 0;
			const start = parseClock(promo.windowStart);
			const end = parseClock(promo.windowEnd);
			if (start === void 0 || end === void 0 || start === end) return void 0;
			const seconds = localSecondsOf(now, promo.timezone ?? "Asia/Shanghai");
			if (seconds === void 0) return void 0;
			const active = start < end ? seconds >= start && seconds < end : seconds >= start || seconds < end;
			const target = active ? end : start;
			return {
				active,
				remainingSeconds: target >= seconds ? target - seconds : 86400 - seconds + target
			};
		}
		/** `HH:MM:SS` from a second count, matching the Qoder client's countdown. */
		function formatCountdown(seconds) {
			const total = Math.max(0, Math.floor(Number(seconds) || 0));
			const pad = (value) => String(value).padStart(2, "0");
			return [
				Math.floor(total / 3600),
				Math.floor(total % 3600 / 60),
				total % 60
			].map(pad).join(":");
		}
		/**
		* A short label for a raw context-window token count, matching the
		* catalog's own naming (`1M` / `200K` / `128K`).
		*/
		function formatContextWindowForUi(tokens) {
			const n = Number(tokens);
			if (!Number.isFinite(n) || n <= 0) return "";
			if (n >= 1e6) return `${Math.round(n / 1e6)}M`;
			if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
			return String(n);
		}
		/**
		* The window label for one model row: the raw ingredients the host
		* publishes (`contextOptions` / `defaultContextWindow`) resolved
		* against the card's live `maxWindow` toggle, not the server-computed
		* label (which only reflects the last load). A model with no
		* selectable windows shows nothing — its fallback number is a local
		* degradation, not a window Qoder offers.
		*/
		function windowLabelOf(model, preferMax) {
			const options = Array.isArray(model.contextOptions) ? model.contextOptions.filter((n) => Number(n) > 0) : [];
			if (options.length === 0) return "";
			const widest = Math.max(...options);
			return formatContextWindowForUi(preferMax ? widest : Number(model.defaultContextWindow) > 0 ? Number(model.defaultContextWindow) : widest);
		}
		/**
		* The multiplier that applies at `now`.
		*
		* Mirrors the host's resolution: `priceFactor` is Qoder's *discounted*
		* price, and `beforePromotionPriceFactor` is what applies outside the
		* window — the two are related by exactly `before x discount`. Reading
		* `priceFactor` alone understates the cost for most of the day.
		*/
		function rateAt(model, now) {
			const base = Number(model.priceFactor);
			const promo = model.promotion;
			if (promo === null || typeof promo !== "object") return Number.isFinite(base) ? base : void 0;
			const before = Number(promo.beforePromotionPriceFactor);
			const discount = Number(promo.discountFactor);
			if (offPeakState(model, now)?.active === true) {
				if (Number.isFinite(before) && Number.isFinite(discount)) return before * discount;
				return Number.isFinite(base) ? base : void 0;
			}
			if (Number.isFinite(before)) return before;
			return Number.isFinite(base) ? base : void 0;
		}
		/**
		* The set of model ids currently ticked, given what the host reported.
		*
		* The host stores an empty list as "no filter" (every model shows), so the
		* card presents that same state as "everything ticked" — otherwise a fresh
		* install would render every box empty while every model was visible.
		*/
		function enabledIdsFor(models, saved) {
			const list = Array.isArray(saved) ? saved.filter((id) => typeof id === "string") : [];
			if (list.length === 0) return new Set(models.map((model) => model.id));
			return new Set(list);
		}
		/**
		* One quota row: label, optional badges, an optional date, a bar, and the
		* used/total figures. Shared by the plan quota, the add-on package and the
		* per-model dedicated packages, which differ only in their wording.
		*/
		function QuotaBlock({ t, label, quota, when, badge }) {
			const percentage = Math.min(1, Math.max(0, Number(quota.percentage) || 0));
			const percent = Math.round(percentage * 1e3) / 10;
			const tone = quota.remaining <= 0 ? " dsm-qoder-bar-full" : percentage >= .8 ? " dsm-qoder-bar-warn" : "";
			const unit = quota.unit === "credits" ? t("usage.credits") : quota.unit ?? "";
			return (0, react_jsx_runtime.jsxs)("div", {
				className: "dsm-qoder-usage-block",
				children: [
					(0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-qoder-usage-label",
						children: [
							(0, react_jsx_runtime.jsx)("span", { children: label }),
							badge !== void 0 ? (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-qoder-usage-badge dsm-qoder-usage-badge-offer",
								children: badge
							}) : null,
							quota.remaining <= 0 ? (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-qoder-usage-badge",
								children: t("usage.exceeded")
							}) : null,
							when ? (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-qoder-usage-when",
								children: when
							}) : null
						]
					}),
					(0, react_jsx_runtime.jsx)("div", {
						className: "dsm-qoder-bar",
						role: "progressbar",
						"aria-valuemin": 0,
						"aria-valuemax": 100,
						"aria-valuenow": Math.round(percentage * 100),
						"aria-label": label,
						children: (0, react_jsx_runtime.jsx)("div", {
							className: `dsm-qoder-bar-fill${tone}`,
							style: { width: `${percent}%` }
						})
					}),
					(0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-qoder-usage-figures",
						children: [(0, react_jsx_runtime.jsxs)("span", { children: [(0, react_jsx_runtime.jsx)("strong", { children: `${quota.used} / ${quota.total}` }), ` (${Math.round(percent)}%)`] }), (0, react_jsx_runtime.jsx)("span", { children: `${t("usage.remaining")} ${quota.remaining}${unit ? ` ${unit}` : ""}` })]
					})
				]
			});
		}
		/**
		* Today's check-in row.
		*
		* Assembled from parts this card already had — the `.dsm-qoder-row` frame and
		* the pill button every other action uses — rather than new CSS, and shaped
		* after `dsh-connect-workbuddy`'s check-in row so the two sibling cards read
		* alike in the same settings list.
		*
		* Everything it decides comes from the state the host computed. An earlier bug
		* in this family of cards rendered an off-peak price the card had worked out
		* for itself while the picker charged another, so this row deliberately holds
		* no arithmetic of its own: whether today's round exists, and whether it has
		* been claimed, are answered upstream and merely rendered here.
		*/
		function CheckinRow({ t, checkin, busy, onClaim }) {
			const claimed = checkin.todayCheckedIn === true;
			const amount = typeof checkin.amount === "number" ? checkin.amount : void 0;
			return (0, react_jsx_runtime.jsxs)("div", {
				className: "dsm-qoder-row",
				children: [(0, react_jsx_runtime.jsxs)("div", {
					className: "dsm-qoder-row-main",
					children: [(0, react_jsx_runtime.jsx)("span", {
						className: "dsm-qoder-usage-badge dsm-qoder-usage-badge-offer",
						children: t("usage.checkin")
					}), amount !== void 0 && !claimed ? (0, react_jsx_runtime.jsx)("span", {
						className: "dsm-qoder-name",
						children: t("usage.checkinAvailable", { amount })
					}) : null]
				}), (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: "dsm-qoder-button",
					disabled: busy || claimed,
					onClick: onClaim,
					children: busy ? t("usage.checkinClaiming") : claimed ? t("usage.checkinClaimed") : t("usage.checkinClaim")
				})]
			});
		}
		/** One region's usage block, as returned by the host usage route. */
		function RegionUsage({ t, entry, checkinBusy = false, checkinNotice = void 0, onClaimCheckin = void 0 }) {
			if (entry.available !== true) return (0, react_jsx_runtime.jsxs)("div", {
				className: "dsm-qoder-usage-block",
				children: [(0, react_jsx_runtime.jsx)("p", {
					className: "dsm-qoder-state",
					children: t("usage.unavailable")
				})]
			});
			const packages = Array.isArray(entry.dedicatedPackages) ? entry.dedicatedPackages : [];
			const campaigns = Array.isArray(entry.campaigns) ? entry.campaigns : [];
			const hasAny = entry.userQuota !== void 0 || entry.addOnQuota !== void 0 || packages.length > 0;
			return (0, react_jsx_runtime.jsxs)("div", {
				className: "dsm-qoder-usage-block",
				children: [
					!hasAny ? (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-qoder-state",
						children: t("usage.empty")
					}) : null,
					entry.userQuota !== void 0 ? (0, react_jsx_runtime.jsx)(QuotaBlock, {
						t,
						label: t("usage.planCredits"),
						quota: entry.userQuota,
						when: withDate(t("usage.renewsOn"), entry.expiresAt)
					}) : null,
					entry.addOnQuota !== void 0 ? (0, react_jsx_runtime.jsx)(QuotaBlock, {
						t,
						label: t("usage.resourcePackage"),
						quota: entry.addOnQuota
					}) : null,
					packages.map((pack, index) => (0, react_jsx_runtime.jsxs)(react.Fragment, { children: [(0, react_jsx_runtime.jsx)("div", { className: "dsm-qoder-usage-sep" }), (0, react_jsx_runtime.jsx)(QuotaBlock, {
						t,
						label: pack.name || t("usage.dedicatedPackage"),
						quota: pack,
						when: withDate(t("usage.expiresOn"), pack.expiresAt)
					})] }, `pack:${pack.id}:${index}`)),
					entry.checkin !== void 0 && entry.checkin.active === true ? (0, react_jsx_runtime.jsxs)(react.Fragment, { children: [
						(0, react_jsx_runtime.jsx)("div", { className: "dsm-qoder-usage-sep" }),
						(0, react_jsx_runtime.jsx)(CheckinRow, {
							t,
							checkin: entry.checkin,
							busy: checkinBusy,
							onClaim: onClaimCheckin
						}),
						checkinNotice !== void 0 ? (0, react_jsx_runtime.jsx)("p", {
							className: checkinNotice.kind === "error" ? "dsm-qoder-error" : "dsm-qoder-state",
							children: checkinNotice.kind === "error" ? t("usage.checkinError", { message: checkinNotice.message ?? "" }) : checkinNotice.kind === "granted" && typeof checkinNotice.amount === "number" ? t("usage.checkinGranted", { amount: checkinNotice.amount }) : t("usage.checkinAlready")
						}) : null
					] }) : null,
					campaigns.length > 0 ? (0, react_jsx_runtime.jsx)("div", { className: "dsm-qoder-usage-sep" }) : null,
					campaigns.map((camp) => (0, react_jsx_runtime.jsxs)("p", {
						className: "dsm-qoder-usage-promo",
						children: [
							(0, react_jsx_runtime.jsx)("span", {
								className: "dsm-qoder-usage-badge dsm-qoder-usage-badge-offer",
								children: t("usage.promotion")
							}),
							" ",
							camp.title,
							camp.endsAt !== void 0 ? ` · ${withDate(t("usage.expiresOn"), camp.endsAt)}` : "",
							camp.detailUrl ? (0, react_jsx_runtime.jsxs)(react.Fragment, { children: [" ", (0, react_jsx_runtime.jsx)("a", {
								href: camp.detailUrl,
								target: "_blank",
								rel: "noreferrer",
								children: t("usage.viewDetails")
							})] }) : null
						]
					}, `camp:${camp.key}`))
				]
			});
		}
		/**
		* The usage section: a refresh control plus one block per region.
		*
		* The panel owns its own fetch rather than riding the model read, because
		* quota changes with every turn and must be refreshable on demand.
		*
		* `refreshToken` is the card's "the world changed, re-read" signal: when
		* the account panel's re-read lands, the card bumps it, and this panel
		* forces a fresh quota pull for what the host can now serve.
		*/
		function QoderUsagePanel({ t, refreshToken = 0, activeRegion = "qoder-cn" }) {
			const [regions, setRegions] = (0, react.useState)([]);
			const [status, setStatus] = (0, react.useState)("loading");
			const [notice, setNotice] = (0, react.useState)(void 0);
			const [busy, setBusy] = (0, react.useState)(false);
			const [claimBusy, setClaimBusy] = (0, react.useState)(false);
			const [claimNotice, setClaimNotice] = (0, react.useState)(void 0);
			const mounted = (0, react.useRef)(true);
			(0, react.useEffect)(() => {
				mounted.current = true;
				return () => {
					mounted.current = false;
				};
			}, []);
			const load = (0, react.useCallback)(async (refresh) => {
				setBusy(true);
				try {
					const response = await fetch(`${QODER_USAGE_PATH}${refresh ? "?refresh=1" : ""}`, {
						headers: { accept: "application/json" },
						credentials: "same-origin"
					});
					const value = await response.json().catch(() => void 0);
					if (!response.ok || value === void 0) throw new Error(`HTTP ${response.status}`);
					if (!mounted.current) return;
					setRegions(Array.isArray(value.regions) ? value.regions : []);
					setStatus("ready");
					setNotice(void 0);
				} catch (error) {
					if (!mounted.current) return;
					setStatus("error");
					setNotice(error instanceof Error ? error.message : String(error));
				} finally {
					if (mounted.current) setBusy(false);
				}
			}, []);
			const claimCheckin = (0, react.useCallback)(async () => {
				setClaimBusy(true);
				setClaimNotice(void 0);
				try {
					const response = await fetch(`${QODER_CHECKIN_PATH}?region=${encodeURIComponent(activeRegion)}`, {
						method: "POST",
						headers: { accept: "application/json" },
						credentials: "same-origin"
					});
					const value = await response.json().catch(() => void 0);
					if (!response.ok) throw new Error(value?.error ?? `HTTP ${response.status}`);
					if (mounted.current) setClaimNotice({
						kind: value?.replayed === true ? "already" : "granted",
						amount: typeof value?.amount === "number" ? value.amount : void 0
					});
					await load(true);
				} catch (error) {
					if (mounted.current) setClaimNotice({
						kind: "error",
						message: error instanceof Error ? error.message : String(error)
					});
				} finally {
					if (mounted.current) setClaimBusy(false);
				}
			}, [activeRegion, load]);
			(0, react.useEffect)(() => {
				load(false);
			}, [load]);
			(0, react.useEffect)(() => {
				if (refreshToken === 0) return;
				load(true);
			}, [refreshToken, load]);
			return (0, react_jsx_runtime.jsxs)("div", {
				className: "dsm-qoder-usage",
				children: [
					(0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-qoder-usage-head",
						children: [(0, react_jsx_runtime.jsx)("h4", {
							className: "dsm-qoder-usage-title",
							children: t("usage.title")
						}), (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dsm-qoder-button",
							disabled: busy,
							onClick: () => {
								load(true);
							},
							children: t("usage.refresh")
						})]
					}),
					status === "loading" ? (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-qoder-hint",
						children: t("usage.loading")
					}) : null,
					status === "error" ? (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-qoder-error",
						children: `${t("usage.error")}: ${notice ?? ""}`
					}) : null,
					(() => {
						const active = regions.find((entry) => entry.region === activeRegion);
						if (active !== void 0) return (0, react_jsx_runtime.jsx)(RegionUsage, {
							t,
							entry: active,
							checkinBusy: claimBusy,
							checkinNotice: claimNotice,
							onClaimCheckin: () => {
								claimCheckin();
							}
						});
						return status === "ready" ? (0, react_jsx_runtime.jsx)("p", {
							className: "dsm-qoder-state",
							children: t("usage.none")
						}) : null;
					})()
				]
			});
		}
		/**
		* The account section: a version strip over the SELECTED region's
		* sign-in — who drives it, in which state it is, and what to do when
		* it is not `ok`. The strip is the card's convergence point: each
		* region is one pill (status dot + name + provider switch), and
		* selecting a pill scopes this detail, the usage panel and the model
		* list to that region, so the region name appears exactly once on the
		* card. `activeRegion` / `onRegionChange` are the card-level pair that
		* drives all three surfaces.
		*
		* The states come from the host's account route and are computed from
		* LOCAL evidence only, so reading the panel costs no network. The
		* deliberate actions are:
		*
		* - **Re-read sign-in** POSTs to the host's reload route, which
		*   invalidates the credential caches, re-reads the app stores, and
		*   starts any region that has come back online — a re-sign-in is
		*   picked up without restarting DSH. `onReconciled` lets the card
		*   re-pull its models and usage once the read has landed.
		* - **Confirm online** is the single optional network call
		*   (`fetchUserInfo`): it answers "is this sign-in still valid at the
		*   upstream?", a question a disk read cannot answer on its own.
		* - The pill's **provider switch** writes `enabledRegions` (opt-out:
		*   absent = offered) through the settings pipeline; a switched-off
		*   region contributes zero models, and the picker + card list hide
		*   it via the same host predicate.
		*/
		function QoderAccountPanel({ t, onReconciled, settingsScope, activeRegion = "qoder-cn", onRegionChange }) {
			const [accounts, setAccounts] = (0, react.useState)([]);
			const [status, setStatus] = (0, react.useState)("loading");
			const [reloading, setReloading] = (0, react.useState)(false);
			const [confirmState, setConfirmState] = (0, react.useState)({});
			const [confirmBusy, setConfirmBusy] = (0, react.useState)({});
			const [enabledRegions, setEnabledRegions] = (0, react.useState)({});
			const [toggling, setToggling] = (0, react.useState)(false);
			const [offerError, setOfferError] = (0, react.useState)(void 0);
			const mounted = (0, react.useRef)(true);
			(0, react.useEffect)(() => {
				mounted.current = true;
				return () => {
					mounted.current = false;
				};
			}, []);
			const load = (0, react.useCallback)(async () => {
				try {
					const response = await fetch(QODER_ACCOUNT_PATH, {
						headers: { accept: "application/json" },
						credentials: "same-origin"
					});
					const value = await response.json().catch(() => void 0);
					if (!response.ok || value === void 0) throw new Error(`HTTP ${response.status}`);
					if (!mounted.current) return;
					const regions = Array.isArray(value.regions) ? value.regions : [];
					setAccounts(regions);
					const map = value.enabledRegions !== null && typeof value.enabledRegions === "object" ? value.enabledRegions : Object.fromEntries(regions.filter((entry) => entry.region !== void 0).map((entry) => [entry.region, entry.enabled !== false]));
					setEnabledRegions(map);
					setStatus("ready");
				} catch {
					if (mounted.current) setStatus("error");
				}
			}, []);
			(0, react.useEffect)(() => {
				load();
			}, [load]);
			const reload = (0, react.useCallback)(async () => {
				setReloading(true);
				try {
					const response = await fetch(QODER_ACCOUNT_RELOAD_PATH, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						credentials: "same-origin",
						body: JSON.stringify({})
					});
					if (!response.ok) throw new Error(`HTTP ${response.status}`);
					if (!mounted.current) return;
					setConfirmState({});
					if (onReconciled !== void 0) onReconciled();
					await load();
				} catch {
					if (mounted.current) setStatus("error");
				} finally {
					if (mounted.current) setReloading(false);
				}
			}, [load, onReconciled]);
			const autoReloaded = (0, react.useRef)(false);
			(0, react.useEffect)(() => {
				if (status !== "ready" || autoReloaded.current) return;
				if (!accounts.some((entry) => entry.state !== "ok")) return;
				autoReloaded.current = true;
				reload();
			}, [
				status,
				accounts,
				reload
			]);
			const confirm = (0, react.useCallback)(async (regionId) => {
				setConfirmBusy((current) => ({
					...current,
					[regionId]: true
				}));
				setConfirmState((current) => {
					const next = { ...current };
					delete next[regionId];
					return next;
				});
				try {
					const response = await fetch(QODER_ACCOUNT_CONFIRM_PATH, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						credentials: "same-origin",
						body: JSON.stringify({ region: regionId })
					});
					const value = await response.json().catch(() => void 0);
					if (!response.ok || value === void 0) throw new Error(`HTTP ${response.status}`);
					if (!mounted.current) return;
					if (value.available !== true) {
						setConfirmState((current) => ({
							...current,
							[regionId]: { kind: "unavailable" }
						}));
						return;
					}
					setConfirmState((current) => ({
						...current,
						[regionId]: value.confirmed === true ? { kind: "confirmed" } : {
							kind: value.kind,
							detail: value.detail
						}
					}));
				} catch (error) {
					if (!mounted.current) return;
					setConfirmState((current) => ({
						...current,
						[regionId]: {
							kind: "unavailable",
							detail: String(error?.message ?? error)
						}
					}));
				} finally {
					if (mounted.current) setConfirmBusy((current) => ({
						...current,
						[regionId]: false
					}));
				}
			}, []);
			const toggleRegion = (0, react.useCallback)(async (regionId, nextOn) => {
				setToggling(true);
				setOfferError(void 0);
				const next = {
					...enabledRegions,
					[regionId]: nextOn
				};
				setEnabledRegions(next);
				try {
					if (settingsScope === void 0) throw new Error("settings service unavailable");
					await writeSettingsField(settingsScope, "enabledRegions", next);
					if (onReconciled !== void 0) onReconciled();
					await load();
				} catch (error) {
					setEnabledRegions((current) => ({
						...current,
						[regionId]: !nextOn
					}));
					if (mounted.current) setOfferError(String(error?.message ?? error));
				} finally {
					if (mounted.current) setToggling(false);
				}
			}, [
				enabledRegions,
				settingsScope,
				onReconciled,
				load
			]);
			const dotClassOf = (state) => state === "ok" ? " dsm-qoder-region-dot-ok" : state === "expired" ? " dsm-qoder-region-dot-expired" : state === "needs-app" ? " dsm-qoder-region-dot-needs" : "";
			const stateLabelOf = (entry) => t(`account.state.${entry.state}`);
			const activeEntry = accounts.find((entry) => entry.region === activeRegion) ?? accounts[0];
			const activeOffered = activeEntry !== void 0 && enabledRegions[activeEntry.region] !== false;
			const activeResult = activeEntry !== void 0 ? confirmState[activeEntry.region] : void 0;
			const activeHasIdentity = activeEntry !== void 0 && activeEntry.identity !== void 0 && activeEntry.identity !== null;
			const activeName = activeHasIdentity ? String(activeEntry.identity.name ?? "").trim() : "";
			const activeMeta = [];
			if (activeEntry !== void 0) {
				if (activeEntry.source === "env-pat") activeMeta.push(t("account.envPat"));
				else if (typeof activeEntry.appName === "string" && activeEntry.appName !== "") activeMeta.push(t("account.appFrom", { app: activeEntry.appName }));
				if (activeHasIdentity && Number(activeEntry.identity.expiresAt) > 0) activeMeta.push(withDate(t("account.expiresAt"), activeEntry.identity.expiresAt));
			}
			const activeManageLink = activeEntry !== void 0 && typeof activeEntry.manageUrl === "string" && activeEntry.manageUrl !== "" ? (0, react_jsx_runtime.jsx)("a", {
				href: activeEntry.manageUrl,
				target: "_blank",
				rel: "noreferrer",
				children: ` · ${t("account.openManage")}`
			}) : null;
			return (0, react_jsx_runtime.jsxs)("div", {
				className: "dsm-qoder-account",
				children: [status === "error" ? (0, react_jsx_runtime.jsxs)("div", {
					className: "dsm-qoder-account-error",
					children: [(0, react_jsx_runtime.jsx)("p", {
						className: "dsm-qoder-error",
						children: t("account.error")
					}), (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "dsm-qoder-button",
						disabled: reloading,
						onClick: () => {
							reload();
						},
						children: t("account.reload")
					})]
				}) : (0, react_jsx_runtime.jsxs)(react.Fragment, { children: [(0, react_jsx_runtime.jsx)("div", {
					className: "dsm-qoder-region-tabs",
					role: "tablist",
					"aria-label": t("account.regionTabs"),
					children: accounts.map((entry) => {
						const offered = enabledRegions[entry.region] !== false;
						const isActive = entry.region === activeRegion;
						return (0, react_jsx_runtime.jsxs)("div", {
							className: `dsm-qoder-region-tab-cell${isActive ? " dsm-qoder-region-tab-cell-active" : ""}`,
							children: [(0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								role: "tab",
								"aria-selected": isActive,
								className: `dsm-qoder-region-tab${offered ? "" : " dsm-qoder-region-tab-off"}`,
								title: `${entry.regionName ?? entry.region} · ${stateLabelOf(entry)}`,
								onClick: () => {
									if (typeof onRegionChange === "function") onRegionChange(entry.region);
									if (entry.state !== "ok") reload();
								},
								children: [(0, react_jsx_runtime.jsx)("span", {
									"aria-hidden": "true",
									className: `dsm-qoder-region-dot${dotClassOf(entry.state)}`
								}), (0, react_jsx_runtime.jsx)("span", {
									className: "dsm-qoder-region-name",
									children: entry.regionName ?? entry.region
								})]
							}), (0, react_jsx_runtime.jsxs)("label", {
								className: "dsm-qoder-region-toggle-cell",
								title: t("account.offerTitle"),
								children: [(0, react_jsx_runtime.jsx)("input", {
									type: "checkbox",
									className: "dsm-qoder-region-toggle",
									checked: offered,
									disabled: toggling,
									onChange: (event) => {
										toggleRegion(entry.region, event.target.checked);
									},
									"aria-label": `${t("account.offer")}: ${entry.regionName ?? entry.region}`
								})]
							})]
						}, `tab:${entry.region}`);
					})
				}), activeEntry !== void 0 ? (0, react_jsx_runtime.jsxs)(react.Fragment, { children: [
					(0, react_jsx_runtime.jsxs)("div", {
						className: `dsm-qoder-account-row${activeOffered ? "" : " dsm-qoder-account-row-off"}`,
						children: [
							(0, react_jsx_runtime.jsxs)("span", {
								className: "dsm-qoder-account-id",
								children: [(0, react_jsx_runtime.jsx)("span", {
									className: "dsm-qoder-account-name",
									children: activeName !== "" ? activeName : "—"
								}), activeMeta.length > 0 ? (0, react_jsx_runtime.jsx)("span", {
									className: "dsm-qoder-account-meta",
									children: activeMeta.join(" · ")
								}) : null]
							}),
							(0, react_jsx_runtime.jsx)("span", { className: "dsm-qoder-usage-spacer" }),
							activeEntry.source !== void 0 ? (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsm-qoder-button",
								disabled: confirmBusy[activeEntry.region] === true,
								onClick: () => {
									confirm(activeEntry.region);
								},
								children: confirmBusy[activeEntry.region] === true ? t("account.confirming") : t("account.confirm")
							}) : null
						]
					}),
					!activeOffered ? (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-qoder-account-note",
						children: t("account.offerOff")
					}) : null,
					activeEntry.state === "needs-app" ? (0, react_jsx_runtime.jsxs)("p", {
						className: "dsm-qoder-account-note dsm-qoder-account-note-error",
						children: [t("account.readFail", { detail: activeEntry.detail ?? "" }), activeManageLink]
					}) : null,
					activeEntry.state === "expired" ? (0, react_jsx_runtime.jsxs)("p", {
						className: "dsm-qoder-account-note",
						children: [t("account.expiredHint"), activeManageLink]
					}) : null,
					activeEntry.state === "signed-out" ? (0, react_jsx_runtime.jsxs)("p", {
						className: "dsm-qoder-account-note",
						children: [t("account.unsigned"), activeManageLink]
					}) : null,
					activeResult?.kind === "confirmed" ? (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-qoder-account-note",
						children: t("account.confirmed")
					}) : null,
					activeResult?.kind === "sign-in-expired" ? (0, react_jsx_runtime.jsxs)("p", {
						className: "dsm-qoder-account-note dsm-qoder-account-note-error",
						children: [t("account.confirmExpired"), activeManageLink]
					}) : null,
					activeResult?.kind === "unavailable" ? (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-qoder-account-note dsm-qoder-account-note-error",
						children: t("account.confirmFailed", { detail: activeResult.detail ?? "" })
					}) : null
				] }) : null] }), offerError !== void 0 ? (0, react_jsx_runtime.jsx)("p", {
					className: "dsm-qoder-account-note dsm-qoder-account-note-error",
					children: t("account.offerError", { detail: offerError })
				}) : null]
			});
		}
		/**
		* Whether the card starts expanded, resolved from the host's `view`.
		*
		* The host renders a slot card with one of three shapes:
		*
		* - `view: "page"` — the card is the page itself (the bundle / row
		*   detail pages, and the WorkBuddy-style detail surface). Collapsing a
		*   page would leave the user staring at an empty screen, so the card
		*   opens by default. This is the "auto-expand" behaviour borrowed from
		*   the WorkBuddy bundle.
		* - `view: "summary"` — the card sits in a list of cards, where an
		*   expanded card would push every sibling off-screen; start collapsed
		*   and let the header click do the work.
		* - no `view` (legacy slots that predate the prop) — the previous
		*   default was collapsed, and keeping it means an old host surface
		*   does not suddenly change shape on upgrade.
		*
		* Collapsing is never destructive: the card's body is `hidden`, not
		* unmounted, so staged edits and a ticking off-peak countdown survive a
		* collapse/expand cycle.
		*
		* @param view - the `view` prop the host slot passed, if any.
		* @returns true when the card should start expanded.
		*/
		function initialOpenForView(view) {
			return view === "page";
		}
		/** Render the Qoder model and image-input card. */
		function QoderPluginCard({ t, settingsScope, view }) {
			if (t === void 0) throw new Error("Qoder settings card requires its translation function");
			const [open, setOpen] = (0, react.useState)(() => initialOpenForView(view));
			const [models, setModels] = (0, react.useState)([]);
			const [imageOverrides, setImageOverrides] = (0, react.useState)({});
			const [savedOverrides, setSavedOverrides] = (0, react.useState)({});
			const [maxWindow, setMaxWindow] = (0, react.useState)(false);
			const [savedMaxWindow, setSavedMaxWindow] = (0, react.useState)(false);
			const [enabledIds, setEnabledIds] = (0, react.useState)({});
			const [savedEnabledIds, setSavedEnabledIds] = (0, react.useState)({});
			const [status, setStatus] = (0, react.useState)("loading");
			const [saving, setSaving] = (0, react.useState)(false);
			const [notice, setNotice] = (0, react.useState)(void 0);
			const [refreshing, setRefreshing] = (0, react.useState)(false);
			const [refreshedAt, setRefreshedAt] = (0, react.useState)(void 0);
			const [usageBump, setUsageBump] = (0, react.useState)(0);
			const [query, setQuery] = (0, react.useState)("");
			const [activeRegion, setActiveRegion] = (0, react.useState)("qoder-cn");
			const [pulse, setPulse] = (0, react.useState)(void 0);
			const [clock, setClock] = (0, react.useState)(() => /* @__PURE__ */ new Date());
			const mounted = (0, react.useRef)(true);
			(0, react.useEffect)(() => {
				mounted.current = true;
				return () => {
					mounted.current = false;
				};
			}, []);
			(0, react.useEffect)(() => {
				if (pulse === void 0) return void 0;
				const timer = window.setTimeout(() => setPulse(void 0), 1300);
				return () => window.clearTimeout(timer);
			}, [pulse]);
			(0, react.useEffect)(() => {
				if (!models.some((m) => m.promotion?.active === true)) return void 0;
				const timer = window.setInterval(() => {
					if (mounted.current) setClock(/* @__PURE__ */ new Date());
				}, 1e3);
				return () => {
					window.clearInterval(timer);
				};
			}, [models]);
			/**
			* Read the model roster from the host route.
			*
			* The card reads its rows from the host rather than the settings
			* document: the roster and the rates are live catalog state, not
			* configuration, so they are never persisted.
			*
			* `refresh` asks the host to re-read the catalog from upstream, which is
			* how a newly published model or a changed multiplier reaches the
			* picker without restarting DSH. The settings fields are only seeded on
			* the first load: a refresh must not clobber edits the user has staged
			* but not yet saved.
			*/
			const load = (0, react.useCallback)(async (refresh, signal) => {
				if (refresh) setRefreshing(true);
				try {
					const response = await fetch(`${QODER_MODELS_PATH}${refresh ? "?refresh=1" : ""}`, {
						headers: { accept: "application/json" },
						credentials: "same-origin",
						signal
					});
					const value = await response.json().catch(() => void 0);
					if (!response.ok || value === void 0) throw new Error(`HTTP ${response.status}`);
					if (!mounted.current) return;
					setModels(Array.isArray(value.models) ? value.models : []);
					if (!refresh) {
						const overrides = value.imageOverrides !== null && typeof value.imageOverrides === "object" ? value.imageOverrides : {};
						const savedEnabled = value.enabledModelIds !== null && typeof value.enabledModelIds === "object" ? value.enabledModelIds : {};
						setImageOverrides(overrides);
						setSavedOverrides(overrides);
						setMaxWindow(value.useMaximumContextWindow === true);
						setSavedMaxWindow(value.useMaximumContextWindow === true);
						setEnabledIds(savedEnabled);
						setSavedEnabledIds(savedEnabled);
					}
					setRefreshedAt(typeof value.refreshedAt === "number" ? value.refreshedAt : Date.now());
					setStatus("ready");
				} catch (error) {
					if (!mounted.current || signal?.aborted === true) return;
					setStatus("error");
					setNotice(error instanceof Error ? error.message : String(error));
				} finally {
					if (mounted.current) setRefreshing(false);
				}
			}, []);
			(0, react.useEffect)(() => {
				const controller = new AbortController();
				load(false, controller.signal);
				return () => {
					controller.abort();
				};
			}, [load]);
			const reconcile = (0, react.useCallback)(() => {
				load(true);
				setUsageBump((n) => n + 1);
			}, [load]);
			const dirty = (0, react.useMemo)(() => JSON.stringify(imageOverrides) !== JSON.stringify(savedOverrides) || JSON.stringify(enabledIds) !== JSON.stringify(savedEnabledIds) || maxWindow !== savedMaxWindow, [
				imageOverrides,
				savedOverrides,
				enabledIds,
				savedEnabledIds,
				maxWindow,
				savedMaxWindow
			]);
			const setMode = (0, react.useCallback)((modelId, mode) => {
				setImageOverrides((current) => {
					const next = { ...current };
					if (mode === "auto") delete next[modelId];
					else next[modelId] = mode;
					return next;
				});
				setPulse(modelId);
				setNotice(void 0);
			}, []);
			/**
			* Tick or untick one model for the picker.
			*
			* Ticking is recorded against the region's **full** roster, not against
			* whatever happens to be ticked now, so the saved list is a complete
			* allow-list rather than a diff. That is what lets a partially curated
			* region stay curated when the catalog later grows.
			*/
			const toggleModel = (0, react.useCallback)((regionId, modelId) => {
				setEnabledIds((current) => {
					const roster = models.filter((m) => m.region === regionId).map((m) => m.id);
					const active = enabledIdsFor(models, current[regionId]);
					const next = new Set(active);
					if (!next.delete(modelId)) next.add(modelId);
					const list = roster.filter((id) => next.has(id));
					return {
						...current,
						[regionId]: list.length === roster.length ? [] : list
					};
				});
				setPulse(modelId);
				setNotice(void 0);
			}, [models]);
			/**
			* Bulk-set the ACTIVE region's roster to one of two extremes.
			*
			* `[]` is the host's "no filter" state — every model in the region
			* shows, so this is the card's "show all". `[HIDE_ALL_MODELS]`
			* matches no real model id, so `filterByEnabled` returns `[]`
			* (nothing shown) — a true "hide all" / "deselect all" without
			* changing that convention. Only the active region's entry is
			* touched; the sibling region's allow-list is preserved, exactly
			* like a per-model tick.
			*/
			const setRegionAll = (0, react.useCallback)((regionId, allOn) => {
				setEnabledIds((current) => ({
					...current,
					[regionId]: allOn ? [HIDE_ALL_MODELS] : []
				}));
				setNotice(void 0);
			}, []);
			/**
			* Persist the card's three settings fields.
			*
			* Each write is verified (read-back against what was posted) and the
			* per-region allow-list goes through the Host merge, so a save
			* either lands or raises — the "已保存" banner only appears for
			* values that actually persisted.
			*/
			const save = (0, react.useCallback)(async () => {
				if (settingsScope === void 0) return;
				setSaving(true);
				try {
					await writeSettingsField(settingsScope, "enabledModelIds", enabledIds);
					await writeSettingsField(settingsScope, "imageOverrides", imageOverrides);
					await writeSettingsField(settingsScope, "useMaximumContextWindow", maxWindow);
					setSavedOverrides(imageOverrides);
					setSavedMaxWindow(maxWindow);
					setSavedEnabledIds(enabledIds);
					setNotice(t("row.saved"));
				} catch (error) {
					setNotice(`${t("row.failed")}: ${error instanceof Error ? error.message : String(error)}`);
				} finally {
					if (mounted.current) setSaving(false);
				}
			}, [
				settingsScope,
				imageOverrides,
				maxWindow,
				enabledIds,
				t
			]);
			const discard = (0, react.useCallback)(() => {
				setImageOverrides(savedOverrides);
				setMaxWindow(savedMaxWindow);
				setEnabledIds(savedEnabledIds);
				setNotice(void 0);
			}, [
				savedOverrides,
				savedMaxWindow,
				savedEnabledIds
			]);
			const regionModels = models.filter((model) => model.region === activeRegion);
			const regionAllTicked = regionModels.length > 0 && regionModels.every((model) => enabledIdsFor(models, enabledIds[activeRegion]).has(model.id));
			const needle = query.trim().toLowerCase();
			const visibleModels = regionModels.filter((model) => {
				if (needle === "") return true;
				return String(model.name ?? model.id).toLowerCase().includes(needle) || model.id.toLowerCase().includes(needle);
			});
			const visibleTicked = visibleModels.filter((model) => enabledIdsFor(models, enabledIds[model.region]).has(model.id)).length;
			return (0, react_jsx_runtime.jsxs)("li", {
				className: `dsm-plugin-card${open ? " dsm-plugin-card-open" : ""}`,
				onKeyDown: (event) => {
					if (event.key !== "Escape" || !open) return;
					if (query !== "") {
						setQuery("");
						return;
					}
					setOpen(false);
				},
				children: [(0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: "dsm-plugin-card-header",
					"aria-expanded": open,
					"aria-label": `${t(open ? "row.collapse" : "row.expand")}: ${t("row.title")}`,
					onClick: () => {
						setOpen(!open);
					},
					children: [(0, react_jsx_runtime.jsxs)("span", {
						className: "dsm-plugin-card-head",
						children: [(0, react_jsx_runtime.jsx)("span", {
							className: "dsm-plugin-card-title",
							children: t("row.title")
						}), (0, react_jsx_runtime.jsx)("span", {
							className: "dsm-plugin-card-description",
							children: t("row.desc")
						})]
					}), (0, react_jsx_runtime.jsx)("span", {
						"aria-hidden": "true",
						className: `dsm-plugin-card-chevron${open ? " dsm-plugin-card-chevron-open" : ""}`
					})]
				}), (0, react_jsx_runtime.jsx)("div", {
					className: "dsm-plugin-card-body",
					hidden: !open,
					children: open ? (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-qoder-body",
						children: [
							(0, react_jsx_runtime.jsx)(QoderAccountPanel, {
								t,
								onReconciled: reconcile,
								settingsScope,
								activeRegion,
								onRegionChange: setActiveRegion
							}),
							(0, react_jsx_runtime.jsx)(QoderUsagePanel, {
								t,
								refreshToken: usageBump,
								activeRegion
							}),
							status === "loading" ? (0, react_jsx_runtime.jsxs)("div", {
								className: "dsm-qoder-skeleton",
								"aria-busy": "true",
								children: [
									(0, react_jsx_runtime.jsx)("p", {
										className: "dsm-qoder-state",
										children: t("row.loading")
									}),
									(0, react_jsx_runtime.jsx)("div", { className: "dsm-qoder-skeleton-row" }),
									(0, react_jsx_runtime.jsx)("div", { className: "dsm-qoder-skeleton-row" }),
									(0, react_jsx_runtime.jsx)("div", { className: "dsm-qoder-skeleton-row" })
								]
							}) : null,
							status === "error" ? (0, react_jsx_runtime.jsxs)("div", {
								className: "dsm-qoder-tools",
								children: [(0, react_jsx_runtime.jsx)("p", {
									className: "dsm-qoder-error",
									children: `${t("row.requestFailed")}: ${notice ?? ""}`
								}), (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dsm-qoder-button",
									disabled: refreshing,
									onClick: () => {
										load(true);
									},
									children: refreshing ? t("row.refreshing") : t("row.retry")
								})]
							}) : null,
							status === "ready" && models.length === 0 ? (0, react_jsx_runtime.jsx)("p", {
								className: "dsm-qoder-state",
								children: t("row.signedOut")
							}) : null,
							status === "ready" && models.length > 0 && regionModels.length === 0 ? (0, react_jsx_runtime.jsx)("p", {
								className: "dsm-qoder-state",
								children: t("row.regionEmpty")
							}) : null,
							models.length > 0 ? (0, react_jsx_runtime.jsxs)("div", {
								className: "dsm-qoder-tools",
								children: [(0, react_jsx_runtime.jsx)("input", {
									type: "search",
									className: "dsm-qoder-search",
									value: query,
									placeholder: t("row.searchPlaceholder"),
									"aria-label": t("row.search"),
									onChange: (event) => setQuery(event.target.value)
								}), (0, react_jsx_runtime.jsx)("span", {
									className: "dsm-qoder-count",
									"aria-live": "polite",
									children: t("row.filterCount", {
										visible: visibleModels.length,
										total: regionModels.length,
										ticked: visibleTicked
									})
								})]
							}) : null,
							regionModels.length > 0 && visibleModels.length === 0 ? (0, react_jsx_runtime.jsxs)("div", {
								className: "dsm-qoder-tools",
								children: [(0, react_jsx_runtime.jsx)("p", {
									className: "dsm-qoder-state",
									children: t("row.searchEmpty")
								}), (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dsm-qoder-button",
									onClick: () => setQuery(""),
									children: t("row.clearFilter")
								})]
							}) : null,
							visibleModels.length > 0 ? (0, react_jsx_runtime.jsx)("ul", {
								className: "dsm-qoder-models",
								children: visibleModels.map((model) => {
									const active = enabledIdsFor(models, enabledIds[model.region]).has(model.id);
									const offPeak = offPeakState(model, clock);
									const rate = rateLabelOf(t, rateAt(model, clock));
									const offPeakTitle = model.promotion === void 0 ? t("row.rateLabel") : offPeak?.active === true ? `${t("row.offPeakOn")} · ${formatCountdown(offPeak.remainingSeconds)}` : t("row.offPeakOff");
									return (0, react_jsx_runtime.jsxs)("li", {
										className: `dsm-qoder-row${active ? "" : " dsm-qoder-row-off"}${pulse === model.id ? " dsm-qoder-row-pulse" : ""}`,
										children: [(0, react_jsx_runtime.jsxs)("span", {
											className: "dsm-qoder-row-main",
											children: [
												(0, react_jsx_runtime.jsx)("label", {
													className: "dsm-qoder-pick",
													title: t("row.showInPicker"),
													children: (0, react_jsx_runtime.jsx)("input", {
														type: "checkbox",
														checked: active,
														disabled: saving,
														"aria-label": `${t("row.showInPicker")}: ${model.name ?? model.id}`,
														onChange: () => {
															toggleModel(model.region, model.id);
														}
													})
												}),
												(0, react_jsx_runtime.jsx)("span", {
													className: "dsm-qoder-name",
													title: model.id,
													children: model.name ?? model.id
												}),
												rate !== void 0 ? (0, react_jsx_runtime.jsx)("span", {
													className: `dsm-qoder-rate${Number(rateAt(model, clock)) <= 0 ? " dsm-qoder-rate-free" : ""}`,
													title: offPeakTitle,
													children: rate
												}) : null,
												windowLabelOf(model, maxWindow) ? (0, react_jsx_runtime.jsx)("span", {
													className: "dsm-qoder-badge",
													title: model.contextOptions?.length ? `${t("row.maxWindow")}: ${model.contextOptions.map(formatContextWindowForUi).join(" / ")}` : t("row.maxWindowNote"),
													children: windowLabelOf(model, maxWindow)
												}) : null,
												offPeak !== void 0 ? (0, react_jsx_runtime.jsx)("span", {
													className: `dsm-qoder-badge${offPeak.active ? " dsm-qoder-badge-offer" : ""}`,
													title: model.promotion?.description ?? "",
													children: `${offPeak.active ? t("row.offPeakOn") : t("row.offPeakOff")} ${formatCountdown(offPeak.remainingSeconds)}`
												}) : null,
												(0, react_jsx_runtime.jsx)("span", {
													className: "dsm-qoder-badge",
													children: model.isVL === true ? t("row.vision") : t("row.textOnly")
												})
											]
										}), (0, react_jsx_runtime.jsxs)("label", {
											className: "dsm-qoder-switch",
											children: [(0, react_jsx_runtime.jsx)("span", { children: t("row.imageTitle") }), (0, react_jsx_runtime.jsx)("select", {
												className: "dsm-qoder-select",
												value: imageModeOf(imageOverrides, model.id),
												disabled: saving,
												"aria-label": `${t("row.imageTitle")}: ${model.name ?? model.id}`,
												onChange: (event) => {
													setMode(model.id, event.target.value);
												},
												children: IMAGE_MODES.map((mode) => (0, react_jsx_runtime.jsx)("option", {
													value: mode,
													children: t(mode === "auto" ? "row.imageAuto" : mode === "on" ? "row.imageOn" : "row.imageOff")
												}, mode))
											})]
										})]
									}, `${model.region}:${model.id}`);
								})
							}) : null,
							regionModels.some((model) => model.promotion !== void 0) ? (0, react_jsx_runtime.jsx)("p", {
								className: "dsm-qoder-hint",
								children: t("row.offPeakHint", {
									window: `${regionModels.find((model) => model.promotion !== void 0)?.promotion?.windowStart}–${regionModels.find((model) => model.promotion !== void 0)?.promotion?.windowEnd}`,
									zone: regionModels.find((model) => model.promotion !== void 0)?.promotion?.timezone ?? "Asia/Shanghai"
								})
							}) : null,
							(0, react_jsx_runtime.jsxs)("label", {
								className: "dsm-qoder-switch",
								title: t("row.maxWindowTitle"),
								children: [(0, react_jsx_runtime.jsx)("input", {
									type: "checkbox",
									checked: maxWindow,
									disabled: saving,
									"aria-label": t("row.maxWindow"),
									onChange: (event) => {
										setMaxWindow(event.target.checked);
										setNotice(void 0);
									}
								}), (0, react_jsx_runtime.jsx)("span", { children: t("row.maxWindow") })]
							}),
							(0, react_jsx_runtime.jsx)("p", {
								className: "dsm-qoder-hint",
								children: t("row.imageHint")
							}),
							(0, react_jsx_runtime.jsxs)("div", {
								className: "dsm-qoder-actions",
								children: [
									(0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dsm-qoder-button",
										disabled: refreshing,
										onClick: () => {
											load(true);
										},
										children: refreshing ? t("row.refreshing") : t("row.refreshModels")
									}),
									(0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dsm-qoder-button",
										disabled: saving,
										title: t("row.showHint"),
										onClick: () => {
											setRegionAll(activeRegion, regionAllTicked);
										},
										children: t(regionAllTicked ? "row.disableAll" : "row.enableAll")
									}),
									refreshedAt !== void 0 && !refreshing ? (0, react_jsx_runtime.jsx)("span", {
										className: "dsm-qoder-state",
										children: t("row.refreshed", { time: new Date(refreshedAt).toLocaleTimeString() })
									}) : null
								]
							}),
							(0, react_jsx_runtime.jsxs)("div", {
								className: "dsm-qoder-actions",
								children: [
									(0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dsm-qoder-button",
										disabled: saving || !dirty || settingsScope === void 0,
										onClick: save,
										children: saving ? t("row.saving") : t("row.save")
									}),
									(0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dsm-qoder-button",
										disabled: saving || !dirty,
										onClick: discard,
										children: t("row.discard")
									}),
									notice !== void 0 ? (0, react_jsx_runtime.jsx)("span", {
										className: "dsm-qoder-state",
										children: notice
									}) : dirty ? (0, react_jsx_runtime.jsx)("span", {
										className: "dsm-qoder-state",
										children: t("row.unsaved")
									}) : null
								]
							})
						]
					}) : null
				})]
			});
		}
		//#endregion
		//#region src/client/index.ts
		/** Stable browser-plugin name. */
		const name = "dsh-connect-qoder-client";
		/**
		* Client services this card reads.
		*
		* FIX 0.1.7: the harness removed the `settingsScope` wrapper service in the
		* 0.1.7 settings rewrite and replaced it with `configForms`. Cordis' hard
		* inject gate never calls `apply` while a listed service is absent, so
		* listing `settingsScope` here bricked web boot on 0.1.7
		* ("1 entry did not activate: dsh-connect-qoder: pending (waiting for
		* service: settingsScope)"). Only guaranteed services go in `inject`; the
		* settings service is probed softly inside `apply` below.
		*/
		const inject = ["slots", "locale"];
		/**
		* Register the Qoder card under Plugin configuration.
		*
		* The whole body is wrapped so that a future DSH slot-API change degrades
		* to a `console.error` instead of throwing into the loader and raising the
		* red "Failed to load plugins" banner — the host provider keeps working
		* either way, and the model channel is unaffected.
		*
		* `key` names the settings namespace the HOST serves. A card whose key
		* names no served namespace is registered into the slot but never
		* rendered, because the card list is built from the Host's installed
		* sections.
		*/
		function apply(ctx) {
			try {
				installStyles();
				const namespace = "settings.qoder";
				ctx.effect(() => ctx.locale.register(namespace, {
					zh,
					en
				}), "dsh-connect-qoder: settings copy");
				const t = ctx.locale.bind(namespace);
				/**
				* FIX 0.1.7: probe the settings surface without a hard dependency.
				* 0.1.7 serves the section through `configForms`; 0.1.6 and earlier
				* through `settingsScope`. `ctx.get` returns undefined (never throws)
				* for an absent service, so one build spans both lines. `forms.get(ns)`
				* mirrors the legacy `settingsScope.bind` shape (`.set` / `.getSnapshot`),
				* so the card body below is unchanged.
				*/
				const softGet = (name) => ctx.get(name);
				let settingsScope;
				const forms = softGet("configForms");
				const legacy = softGet("settingsScope");
				if (forms !== void 0) {
					let ns = "dsh-connect-qoder";
					try {
						const served = (forms.describe().getSnapshot().view?.namespaces ?? []).find((entry) => entry.ns === "dsh-connect-qoder" || /qoder/i.test(entry.ns));
						if (served !== void 0) ns = served.ns;
					} catch {}
					settingsScope = forms.get(ns);
				} else if (legacy !== void 0) settingsScope = legacy.bind({ namespace: "dsh-connect-qoder" });
				/**
				* FIX 0.1.7: the plugin-manager detail page renders a bundle's config
				* card from the `plugins.bundle.config` slot (and a row's from
				* `plugins.row.config`); the legacy `settings.plugin.item` slot is no
				* longer rendered there. The host gates the section on
				* `ledger.bundles.has(openPkg.name)`, and that set is read back from
				* these very slot registrations — a card registered under a key nobody
				* installs as a dependency is invisible even though `apply` ran.
				* The 0.3.1 scoped rename made that real: profiles may carry this
				* bundle as either bare `dsh-connect-qoder` (the historical name) or
				* scoped `@eghrhegpe/dsh-connect-qoder` (the npm name), so each key is
				* registered in both identities. Registration itself degrades to a
				* read-only card when no settings surface is served, instead of
				* throwing into the loader.
				*/
				const registerCard = (slotName, key) => {
					try {
						ctx.slots.inject(slotName, () => ctx.slots.register({
							name: slotName,
							key,
							priority: 30,
							inject: () => settingsScope === void 0 ? { t } : {
								t,
								settingsScope
							}
						}, QoderPluginCard));
					} catch (error) {
						console.error(`[dsh-connect-qoder] card slot "${slotName}" failed to register (host provider unaffected):`, error);
					}
				};
				for (const bundle of ["@eghrhegpe/dsh-connect-qoder", "dsh-connect-qoder"]) {
					registerCard("plugins.bundle.config", bundle);
					registerCard("plugins.row.config", `${bundle}#llm-qoder`);
				}
				registerCard("settings.plugin.item", "qoder");
			} catch (error) {
				console.error("[dsh-connect-qoder] client card failed to load (host provider unaffected):", error);
			}
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;

		return module.exports;
	}
});
