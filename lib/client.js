/** Generated from src/client by scripts/build-client.mjs — edit the sources, not this file. */
window.__ModuleLoader__.load({
	id: "@eghrhegpe/dsh-connect-qoder",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
		//#region \0rolldown/runtime.js
		var __create = Object.create;
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __getProtoOf = Object.getPrototypeOf;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __copyProps = (to, from, except, desc) => {
			if (from && typeof from === "object" || typeof from === "function") {
				for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
					key = keys[i];
					if (!__hasOwnProp.call(to, key) && key !== except) {
						__defProp(to, key, {
							get: ((k) => from[k]).bind(null, key),
							enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
						});
					}
				}
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
		* and caret. The copy is verbatim to WorkBuddy's on purpose, so
		* both plugins render the same even when loaded together. WorkBuddy's
		* icon sizing rule is not copied: this card's header renders no icon
		* element, so that rule would be dead CSS nothing applies.
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
			".dsm-qoder-body{padding:12px 14px;display:flex;flex-direction:column;gap:12px}",
			".dsm-qoder-hint{margin:0;color:var(--dsw-alias-label-secondary,#61666b);font-size:12px;line-height:1.6}",
			".dsm-qoder-switch{display:flex;align-items:center;gap:8px;font-size:13px}",
			".dsm-qoder-switches{display:flex;align-items:center;gap:16px;flex-wrap:wrap}",
			".dsm-qoder-models{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px;max-height:320px;overflow:auto}",
			".dsm-qoder-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:6px 8px;border:1px solid var(--dsw-alias-border-l2,#36373b);border-radius:8px}",
			".dsm-qoder-row-main{display:flex;align-items:center;gap:8px;min-width:0}",
			".dsm-qoder-name{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".dsm-qoder-badge{font-size:10px;padding:1px 6px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,#36373b);color:var(--dsw-alias-label-secondary,#61666b);white-space:nowrap}",
			".dsm-qoder-badge-offer{border-color:var(--dsw-alias-state-success-primary,#12b76a);color:var(--dsw-alias-state-success-primary,#12b76a)}",
			".dsm-qoder-meta{font-size:11px;color:var(--dsw-alias-label-tertiary,#999);white-space:nowrap}",
			".dsm-qoder-select{font-size:12px;padding:3px 6px;border-radius:6px;background:var(--dsw-alias-bg-layer-3,#202126);color:inherit;border:1px solid var(--dsw-alias-border-l2,#36373b)}",
			".dsm-qoder-state{margin:0;font-size:12px;color:var(--dsw-alias-label-primary,#1a1a1a)}",
			".dsm-qoder-error{margin:0;font-size:12px;color:var(--dsw-alias-state-error-primary,#d92d20)}",
			".dsm-qoder-account-error{display:flex;align-items:center;gap:10px}",
			".dsm-qoder-actions{display:flex;gap:8px}",
			".dsm-qoder-actions-save{position:sticky;bottom:0;z-index:1;background:var(--dsw-alias-bg-layer-2,#25262b);border-top:1px solid var(--dsw-alias-border-l2,#36373b);padding:8px 0;margin-top:-4px}",
			".dsm-qoder-button{font-size:12px;padding:5px 12px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,#36373b);background:transparent;color:inherit;cursor:pointer}",
			".dsm-qoder-button:disabled{opacity:.5;cursor:default}",
			".dsm-qoder-usage{border:1px solid var(--dsw-alias-border-l2,#36373b);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:12px}",
			".dsm-qoder-usage-head{display:flex;align-items:center;justify-content:space-between;gap:8px}",
			".dsm-qoder-usage-title{margin:0;font-size:13px;font-weight:600}",
			".dsm-qoder-usage-block{display:flex;flex-direction:column;gap:6px}",
			".dsm-qoder-usage-row{display:flex;align-items:stretch;gap:12px;flex-wrap:wrap}",
			".dsm-qoder-usage-row>.dsm-qoder-usage{flex:1 1 260px;min-width:0}",
			".dsm-qoder-checkin{flex:0 1 auto;min-width:132px;max-width:200px;display:flex;flex-direction:column;justify-content:center;gap:6px;padding:12px;border:1px solid var(--dsw-alias-border-l2,#36373b);border-radius:10px;background:var(--dsw-alias-bg-layer-2,#24262c)}",
			".dsm-qoder-checkin-title{font-size:11px;color:var(--dsw-alias-label-tertiary,#999)}",
			".dsm-qoder-checkin-gain{font-size:18px;font-weight:600;line-height:1.2;color:var(--dsw-alias-state-success-primary,#22c55e);font-variant-numeric:tabular-nums}",
			".dsm-qoder-checkin-button{width:100%;padding:4px 10px}",
			".dsm-qoder-usage-label{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:12px}",
			".dsm-qoder-usage-when{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-secondary,#61666b);white-space:nowrap}",
			".dsm-qoder-bar{height:10px;border-radius:999px;background:var(--dsw-alias-bg-layer-3,#202126);overflow:hidden}",
			".dsm-qoder-bar-fill{height:100%;border-radius:999px;background:var(--dsw-alias-state-success-primary,#12b76a);transition:width .3s ease}",
			".dsm-qoder-bar-warn{background:var(--dsw-alias-state-warn-primary,#f59e0b)}",
			".dsm-qoder-bar-full{background:var(--dsw-alias-state-error-primary,#d92d20)}",
			".dsm-qoder-usage-figures{display:flex;align-items:baseline;justify-content:space-between;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary,#61666b)}",
			".dsm-qoder-usage-figures strong{color:inherit;font-weight:500;font-variant-numeric:tabular-nums}",
			".dsm-qoder-usage-remain{color:var(--dsw-alias-label-primary,#1a1a1a);white-space:nowrap}",
			".dsm-qoder-usage-remain strong{font-size:15px;font-weight:500;font-variant-numeric:tabular-nums}",
			".dsm-qoder-usage-badge{font-size:10px;padding:1px 6px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,#36373b);color:var(--dsw-alias-label-secondary,#61666b);white-space:nowrap}",
			".dsm-qoder-usage-badge-offer{border-color:var(--dsw-alias-state-success-primary,#12b76a);color:var(--dsw-alias-state-success-primary,#12b76a)}",
			".dsm-qoder-usage-promo{margin:0;font-size:11px;line-height:1.6;color:var(--dsw-alias-label-secondary,#61666b)}",
			".dsm-qoder-usage-promo a{color:inherit}",
			".dsm-qoder-usage-sep{height:1px;background:var(--dsw-alias-border-l2,#36373b);margin:0}",
			".dsm-qoder-usage-spacer{flex:1}",
			".dsm-qoder-pick{display:flex;align-items:center;gap:6px;flex:0 0 auto}",
			".dsm-qoder-rate{font-size:11px;padding:1px 6px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,#36373b);color:var(--dsw-alias-label-primary,#1a1a1a);white-space:nowrap;font-variant-numeric:tabular-nums}",
			".dsm-qoder-rate-free{border-color:var(--dsw-alias-state-success-primary,#12b76a);color:var(--dsw-alias-state-success-primary,#12b76a)}",
			".dsm-qoder-row-off .dsm-qoder-name{opacity:.55}",
			".dsm-qoder-tools{display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
			".dsm-qoder-search{font-size:12px;padding:5px 8px;border-radius:6px;background:var(--dsw-alias-bg-layer-3,#202126);color:inherit;border:1px solid var(--dsw-alias-border-l2,#36373b);min-width:150px;flex:1 1 150px}",
			".dsm-qoder-count{font-size:11px;color:var(--dsw-alias-label-secondary,#61666b);white-space:nowrap;font-variant-numeric:tabular-nums}",
			".dsm-qoder-count strong{color:var(--dsw-alias-label-primary,#1a1a1a);font-weight:500}",
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
			".dsm-qoder-offer-toggle{appearance:none;-webkit-appearance:none;width:30px;height:17px;margin:0;border-radius:999px;background:var(--dsw-alias-bg-layer-2,#2a2b31);border:1px solid var(--dsw-alias-border-l2,#36373b);position:relative;cursor:pointer;transition:background .15s,border-color .15s;flex:none}",
			".dsm-qoder-offer-toggle::before{content:\"\";position:absolute;top:1.5px;left:1.5px;width:12px;height:12px;border-radius:50%;background:var(--dsw-alias-label-tertiary,#999);transition:transform .15s,background .15s}",
			".dsm-qoder-offer-toggle:checked{background:var(--dsw-alias-state-success-primary,#12b76a);border-color:var(--dsw-alias-state-success-primary,#12b76a)}",
			".dsm-qoder-offer-toggle:checked::before{transform:translateX(13px);background:#fff}",
			".dsm-qoder-offer-toggle:disabled{cursor:default;opacity:.55}",
			".dsm-qoder-account-row-off .dsm-qoder-account-id,.dsm-qoder-account-row-off .dsm-qoder-button{opacity:.55}",
			".dsm-qoder-region-tabs{display:flex;gap:8px;flex-wrap:nowrap}",
			".dsm-qoder-region-tab-cell{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--dsw-alias-border-l2,#36373b);border-radius:999px;padding:3px 8px 3px 6px;min-width:0}",
			".dsm-qoder-region-tab-cell-active{border-color:var(--dsw-alias-brand-primary,#5686fe)}",
			".dsm-qoder-region-tab{display:inline-flex;align-items:center;gap:6px;background:none;border:none;padding:2px;cursor:pointer;color:var(--dsw-alias-label-primary,#1a1a1a);min-width:0}",
			".dsm-qoder-region-tab-off{color:var(--dsw-alias-label-tertiary,#999)}",
			".dsm-qoder-region-dot{width:8px;height:8px;border-radius:50%;flex:none;background:var(--dsw-alias-label-tertiary,#999)}",
			".dsm-qoder-region-dot-ok{background:var(--dsw-alias-state-success-primary,#12b76a)}",
			".dsm-qoder-region-dot-expired{background:var(--dsw-alias-state-error-primary,#d92d20)}",
			".dsm-qoder-region-dot-needs{background:var(--dsw-alias-state-warn-primary,#f59e0b)}",
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
			"row.refreshModels": "刷新模型目录",
			"row.refreshing": "正在刷新…",
			"row.refreshed": "已更新（{time}）",
			"row.refreshStale": "上次更新：{time}（刷新失败）",
			"row.refreshFailed": "刷新失败：{reason}",
			"row.refreshNotPersisted": "已刷新，但写盘失败——重启后会回到旧目录（下次刷新会自动重试）",
			"row.protocolChanged": "Qoder 的接口返回了本插件不认识的格式——请更新插件（重新登录没有用）",
			"row.offPeakOn": "错峰价",
			"row.offPeakOff": "标准价",
			"row.offPeakEnd": "至 {time}",
			"row.offPeakStart": "{time} 起",
			"row.offPeakUntil": "{time} 后切换",
			"row.offPeakHint": "错峰时段 {window}（{zone}）享受折扣；倍率按当前时段显示，到点会自动变化。",
			"row.search": "搜索模型",
			"row.searchPlaceholder": "输入模型名…",
			"row.searchEmpty": "没有匹配的模型。",
			"row.retry": "重试",
			"row.filterCount": "显示 {visible} / {total}",
			"row.filterTicked": "已勾选 {ticked}",
			"row.clearFilter": "清除筛选",
			"row.imageTuning": "按模型微调图像输入",
			"row.imageTuningTitle": "默认关闭：所有模型跟随 Qoder 目录声明的视觉能力。开启后可以为每个模型单独强制开启或关闭；已经改过的模型始终显示。"
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

		//#endregion
		//#region src/client/copy-usage.ts
		/** Simplified Chinese — usage panel copy. */
		const zhUsage = {
			"usage.title": "我的用量",
			"usage.refresh": "刷新用量",
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
			"usage.promoCount": "{count} 个活动",
			"usage.promoCollapse": "收起",
			"usage.viewDetails": "查看详情",
			"usage.credits": "Credits",
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
		const enUsage = {
			"usage.title": "My usage",
			"usage.refresh": "Refresh usage",
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
			"usage.promoCount": "{count} offers",
			"usage.promoCollapse": "Hide",
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

		//#endregion
		//#region src/client/copy-account.ts
		/** Simplified Chinese — account panel copy. */
		const zhAccount = {
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
			"account.readFail": "本地登录信息读不到：{detail}。请确认本机有已登录的 Qoder 客户端，或点「重新读取登录状态」",
			"account.download": "没装 Qoder 客户端？到「下载」区安装 {edition}，装好后登录",
			"account.downloadLink": "下载 {edition}",
			"account.error": "读取账号状态失败",
			"account.offer": "启用此版本",
			"account.offerTitle": "关闭后这个版本的模型不会出现在 DSH 的模型下拉框里；登录、用量与模型设置都会保留，重新开启即恢复。",
			"account.offerOff": "已关闭：该版本的模型不会出现在 DSH 的模型下拉框里",
			"account.offerError": "保存「启用此版本」开关失败：{detail}",
			"account.regionTabs": "版本：点哪个就看哪个版本的账号、用量与模型"
		};
		/** English — account panel copy. */
		const enAccount = {
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
			"account.readFail": "Could not read the local credential: {detail}. Make sure a signed-in Qoder client is on this machine, or press Re-read sign-in",
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
		* so `index.ts` and `card.tsx` import from one place.
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
		//#region src/client/card-model.ts
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
			const seconds = localSecondsOf(now, typeof promo.timezone === "string" ? promo.timezone : "Asia/Shanghai");
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
		* The window label for one model row.
		*
		* The host already computes this — `contextWindowLabel` on every row it serves
		* — and this used to recompute it from `contextOptions` /
		* `defaultContextWindow`. The two copies had drifted: the host shows a label
		* only when upstream published BOTH a non-empty `contextOptions` and a
		* positive `defaultContextWindow`, while this one showed a label for any
		* non-empty `contextOptions` and fell back to the widest offered window. For a
		* model whose `context_config` lists windows but marks none as default, the
		* card showed a size and the picker showed none (test/card-host-parity.test.js
		* pins that state).
		*
		* So this reads the host's answer. The remaining local work is one thing the
		* host cannot do: the per-row toggle, which flips between the default and the
		* widest at click time, before any refresh has happened. Both choices are
		* therefore derived from the shipped `contextOptions` — and the guard is
		* deliberately the HOST's rule (a default must exist), not the old
		* options-only one, so the two screens cannot diverge again.
		*/
		function windowLabelOf(model, preferMax) {
			const hostLabel = model.contextWindowLabel;
			const options = Array.isArray(model.contextOptions) ? model.contextOptions.filter((n) => Number(n) > 0) : [];
			if (options.length === 0 || !(Number(model.defaultContextWindow) > 0)) return "";
			if (preferMax) return formatContextWindowForUi(Math.max(...options.map(Number)));
			return typeof hostLabel === "string" ? hostLabel : formatContextWindowForUi(Number(model.defaultContextWindow));
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
		* The one refresh verdict this card should show, from the host's report.
		*
		* A pure function of `value` so the decision can be tested against the shipped
		* bundle (see test/protocol-shape-card.test.js) rather than only by reading JSX.
		*
		* The host sends `{ refreshedAt, refreshFailures }`. Four outcomes, kept apart
		* on purpose — collapsing them is the bug this replaces:
		*
		* - **no failure** → `null`: the rows shown are the last upstream answer, and
		*   the "已更新（time）" stamp is honest.
		* - **a transient failure** (`fetch` / `credential` / `no-credential`) → the
		*   stamp still shows, marked stale, because the rows on screen are real, just
		*   old. The user's next move is to retry.
		* - **`persist`** → the rows on screen are the newest answer, but the disk
		*   write was swallowed, so they will not survive a restart. Nothing is wrong
		*   with the data being shown — only with its durability — so this gets its
		*   own wording instead of a misleading "stale" or a confident "updated".
		* - **`protocol-shape-changed`** → the envelope moved and the plugin is out of
		*   date. This is the case that used to be indistinguishable from a queue: the
		*   user was told to re-sign, or waited out a retry ladder that could not
		*   possibly help. Neither appears here — the copy points at a plugin update.
		*
		* The protocol verdict wins over a transient one in the same payload, since it
		* is the one that cannot resolve on its own; `persist` outranks a transient
		* one because it names a different, actionable condition.
		*/
		function refreshNoticeKey(value) {
			const failures = Array.isArray(value?.refreshFailures) ? value.refreshFailures : [];
			if (failures.length === 0) return null;
			if (failures.some((f) => f?.reason === "protocol-shape-changed")) return "protocol-shape-changed";
			if (failures.some((f) => f?.reason === "persist")) return "persist";
			return "transient";
		}
		/**
		* A readable description of a thrown value, for the card's `catch` blocks
		* that show a failure reason to the user.
		*
		* A catch binding is `unknown` (`useUnknownInCatchVariables`), so `.message`
		* is not readable without narrowing. The spelling this replaces —
		* `error instanceof Error ? error.message : String(error)` — leaves a
		* non-`Error` throw (a bare object, a rejection carrying only a code)
		* rendering as `[object Object]`, and a thrown `undefined` rendering as the
		* literal text `"undefined"`: a failure message that says nothing at all.
		*
		* This is the ONE client-side copy: `card.tsx`, both panels and `controller.ts`
		* (whose private twin was merged into this one) all import it. It is still a
		* deliberate LOCAL copy of `host/errors.ts#describeThrown`. The card is a
		* separate bundle built by `scripts/build-client.mjs`, and no client file
		* imports from `src/host/`, so sharing one implementation would mean either
		* bundling host code into the browser card or hoisting this helper into the
		* generated `lib/client.js`. Two lines of narrowing against a stable language
		* rule is worth less than that coupling.
		*/
		function describeThrown(error) {
			const message = error?.message;
			if (typeof message === "string" && message !== "") return message;
			if (typeof error === "string") return error;
			return String(error);
		}

		//#endregion
		//#region src/client/http.ts
		/**
		* The card's only `fetch` surface.
		*
		* Every host-route read the card performs — the two containers'
		* (`QoderUsagePanel`, `QoderAccountPanel`) fetches and the model-roster read
		* the assembly layer keeps in `card.tsx` — goes through here, so the request
		* contract lives in exactly one place. The host routes serve the plugin's own
		* `lib/`, so they are same-origin and answer JSON; this wraps that contract
		* once.
		*
		* Every call sends `accept: application/json` and `credentials:
		* "same-origin"` — the routes are behind the loopback origin check in
		* `src/host/routes.ts`, so the credential must travel. POSTs that carry a
		* body stringify to JSON and advertise `content-type: application/json`.
		*
		* The shape of a failed response is decided here and nowhere else: a non-OK
		* status throws with the host's own `error` field when present, so the card's
		* catch blocks can show the real reason instead of a fabricated one (the
		* "undefined" failure message that issue 06 was about is what this prevents).
		* A `POST` body that will not parse degrades to an empty answer (`undefined`),
		* never a throw — a write that the host did not echo back is "no data". A
		* `GET` that will not parse THROWS instead: the reads that use it (roster,
		* accounts, quotas) have no "no data" state to fall back to, and a caller
		* that asked for a fact must be told the fact did not arrive.
		*/
		/** Read the host route at `path` and decode its JSON answer. */
		async function getJson(path, options) {
			const response = await fetch(path, {
				headers: { accept: "application/json" },
				credentials: "same-origin",
				signal: options?.signal
			});
			const value = await response.json().catch(() => void 0);
			if (!response.ok) {
				const message = value?.error;
				throw new Error(typeof message === "string" && message !== "" ? message : `HTTP ${response.status}`);
			}
			if (value === void 0) throw new Error(`unparseable JSON body (HTTP ${response.status})`);
			return value;
		}
		/** POST to the host route at `path` and decode its JSON answer. */
		async function postJson(path, body) {
			const response = await fetch(path, {
				method: "POST",
				headers: {
					accept: "application/json",
					"content-type": "application/json"
				},
				credentials: "same-origin",
				body: body === void 0 ? void 0 : JSON.stringify(body)
			});
			const value = await response.json().catch(() => void 0);
			if (!response.ok) {
				const message = value?.error;
				throw new Error(typeof message === "string" && message !== "" ? message : `HTTP ${response.status}`);
			}
			return value;
		}

		//#endregion
		//#region src/client/usage-panel.tsx
		/**
		* The usage section container.
		*
		* One of the two card containers that owns a `fetch` (the other is
		* `account-panel.tsx`). Both go through `./http.ts`, so the request contract
		* lives in exactly one place. This panel owns the quota read, the daily
		* check-in claim, and their two effects; the presentational pieces it renders
		* (`RegionUsage`, `CheckinCard`) stay in `card.tsx` as hook-free components.
		*
		* The split mirrors `dsh-connect-sensenova-token-plan`, where the assembly
		* module (`panel-page.ts`) imports a handful of focused containers rather than
		* holding every component itself. The card still renders identically — the
		* region strip, the usage block and the check-in card are the same nodes, in
		* the same order — only the module boundary moved.
		*/
		function QoderUsagePanel({ t, refreshToken = 0, activeRegion = "qoder-cn" }) {
			const [regions, setRegions] = react.useState([]);
			const [status, setStatus] = react.useState("loading");
			const [notice, setNotice] = react.useState(void 0);
			const [busy, setBusy] = react.useState(false);
			const [claimBusy, setClaimBusy] = react.useState(false);
			const [claimNotice, setClaimNotice] = react.useState(void 0);
			const [campaignsOpen, setCampaignsOpen] = react.useState(false);
			const mounted = react.useRef(true);
			const loadSeq = react.useRef(0);
			react.useEffect(() => {
				mounted.current = true;
				return () => {
					mounted.current = false;
				};
			}, []);
			const load = react.useCallback(async (refresh) => {
				const seq = ++loadSeq.current;
				setBusy(true);
				try {
					const value = await getJson(`${QODER_USAGE_PATH}${refresh ? "?refresh=1" : ""}`);
					if (seq !== loadSeq.current) return;
					if (!mounted.current) return;
					setRegions(Array.isArray(value.regions) ? value.regions : []);
					setStatus("ready");
					setNotice(void 0);
				} catch (error) {
					if (seq !== loadSeq.current) return;
					if (!mounted.current) return;
					setStatus("error");
					setNotice(describeThrown(error));
				} finally {
					if (seq === loadSeq.current && mounted.current) setBusy(false);
				}
			}, []);
			const claimCheckin = react.useCallback(async () => {
				setClaimBusy(true);
				setClaimNotice(void 0);
				try {
					const value = await postJson(`${QODER_CHECKIN_PATH}?region=${encodeURIComponent(activeRegion)}`);
					if (mounted.current) setClaimNotice({
						kind: value?.replayed === true ? "already" : "granted",
						amount: typeof value?.amount === "number" ? value.amount : void 0
					});
					await load(true);
				} catch (error) {
					if (mounted.current) setClaimNotice({
						kind: "error",
						message: describeThrown(error)
					});
				} finally {
					if (mounted.current) setClaimBusy(false);
				}
			}, [activeRegion, load]);
			react.useEffect(() => {
				load(false);
			}, [load]);
			react.useEffect(() => {
				if (refreshToken === 0) return;
				load(true);
			}, [refreshToken, load]);
			const active = regions.find((entry) => entry.region === activeRegion);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsm-qoder-usage-row",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsm-qoder-usage",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsm-qoder-usage-head",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", {
								className: "dsm-qoder-usage-title",
								children: t("usage.title")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsm-qoder-button",
								disabled: busy,
								onClick: () => {
									load(true);
								},
								children: t("usage.refresh")
							})]
						}),
						status === "loading" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dsm-qoder-hint",
							children: t("usage.loading")
						}) : null,
						status === "error" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dsm-qoder-error",
							children: `${t("usage.error")}: ${notice ?? ""}`
						}) : null,
						active !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RegionUsage, {
							t,
							entry: active,
							campaignsOpen,
							onCampaignsToggle: () => {
								setCampaignsOpen(!campaignsOpen);
							}
						}) : status === "ready" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dsm-qoder-state",
							children: t("usage.none")
						}) : null
					]
				}), active?.checkin !== void 0 && active.checkin.active === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CheckinCard, {
					t,
					checkin: active.checkin,
					busy: claimBusy,
					notice: claimNotice,
					onClaim: () => {
						claimCheckin();
					}
				}) : null]
			});
		}

		//#endregion
		//#region src/client/settings-write.ts
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
				return scope.getSnapshot().value?.[field] ?? null;
			} catch {
				return null;
			}
		}
		/**
		* Write one settings field, then confirm the value actually landed.
		*
		* The Host endpoint goes FIRST — it is the only writer that persists in
		* the host's silent-failure mode and, for the per-region field, the only
		* one that preserves the sibling region. `scope.set` then runs purely as
		* a mirror refresh (and as the degraded path, where the endpoint is
		* unreachable or the settings service is absent): on a host whose scope
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
			const nextValue = field === "enabledModelIds" ? {
				...fieldSnapshot(scope, field),
				...value
			} : value;
			try {
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
		//#region src/client/account-panel.tsx
		/**
		* The account section container.
		*
		* The second of the two card containers that owns a `fetch` (the other is
		* `usage-panel.tsx`); both go through `./http.ts`. This panel renders TWO
		* siblings — the body's region strip and, directly below it, the framed card
		* for the SELECTED region's sign-in — and owns every account-side network call:
		* the account read, the re-read, the per-region confirm, and the provider
		* switch write. The strip is the card's convergence point; it lives ABOVE the
		* account frame because it switches the WHOLE body, not just the sign-in card
		* (the WorkBuddy layout this card is modelled on).
		*
		* `activeRegion` / `onRegionChange` are the card-level pair that drives all
		* three surfaces (account, usage, model list). `onReconciled` lets the card
		* re-pull its models and usage once a re-read or switch has landed.
		*/
		function QoderAccountPanel({ t, onReconciled, settingsScope, activeRegion = "qoder-cn", onRegionChange }) {
			const [accounts, setAccounts] = react.useState([]);
			const [status, setStatus] = react.useState("loading");
			const [reloading, setReloading] = react.useState(false);
			const [confirmState, setConfirmState] = react.useState({});
			const [confirmBusy, setConfirmBusy] = react.useState({});
			const [enabledRegions, setEnabledRegions] = react.useState({});
			const [toggling, setToggling] = react.useState(false);
			const [offerError, setOfferError] = react.useState(void 0);
			const mounted = react.useRef(true);
			react.useEffect(() => {
				mounted.current = true;
				return () => {
					mounted.current = false;
				};
			}, []);
			const load = react.useCallback(async () => {
				try {
					const value = await getJson(QODER_ACCOUNT_PATH);
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
			react.useEffect(() => {
				load();
			}, [load]);
			const reload = react.useCallback(async () => {
				setReloading(true);
				try {
					await postJson(QODER_ACCOUNT_RELOAD_PATH, {});
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
			const autoReloaded = react.useRef(false);
			react.useEffect(() => {
				if (status !== "ready" || autoReloaded.current) return;
				if (!accounts.some((entry) => entry.state !== "ok")) return;
				autoReloaded.current = true;
				reload();
			}, [
				status,
				accounts,
				reload
			]);
			const confirm = react.useCallback(async (regionId) => {
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
					const value = await postJson(QODER_ACCOUNT_CONFIRM_PATH, { region: regionId });
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
							detail: describeThrown(error)
						}
					}));
				} finally {
					if (mounted.current) setConfirmBusy((current) => ({
						...current,
						[regionId]: false
					}));
				}
			}, []);
			const toggleRegion = react.useCallback(async (regionId, nextOn) => {
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
					if (mounted.current) setOfferError(describeThrown(error));
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
			const activeRegionId = activeEntry?.region;
			const activeEdition = activeEntry?.regionName ?? activeRegionId ?? "";
			const activeOffered = activeEntry !== void 0 && activeRegionId !== void 0 && enabledRegions[activeRegionId] !== false;
			const activeResult = activeEntry !== void 0 && activeRegionId !== void 0 ? confirmState[activeRegionId] : void 0;
			const activeIdentity = activeEntry?.identity ?? void 0;
			const activeHasIdentity = activeIdentity !== void 0 && activeIdentity !== null;
			const activeName = activeHasIdentity ? String(activeIdentity.name ?? "").trim() : "";
			const activeMeta = [];
			if (activeEntry !== void 0) {
				if (activeEntry.source === "env-pat") activeMeta.push(t("account.envPat"));
				else if (typeof activeEntry.appName === "string" && activeEntry.appName !== "") activeMeta.push(t("account.appFrom", { app: activeEntry.appName }));
				if (activeHasIdentity && Number(activeIdentity.expiresAt) > 0) activeMeta.push(withDate(t("account.expiresAt"), activeIdentity.expiresAt));
			}
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react.Fragment, { children: [status !== "error" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dsm-qoder-region-tabs",
				role: "tablist",
				"aria-label": t("account.regionTabs"),
				children: accounts.map((entry) => {
					const regionId = entry.region;
					if (regionId === void 0) return null;
					const offered = enabledRegions[regionId] !== false;
					const isActive = regionId === activeRegion;
					return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: `dsm-qoder-region-tab-cell${isActive ? " dsm-qoder-region-tab-cell-active" : ""}`,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							role: "tab",
							"aria-selected": isActive,
							className: `dsm-qoder-region-tab${offered ? "" : " dsm-qoder-region-tab-off"}`,
							title: `${entry.regionName ?? regionId} · ${stateLabelOf(entry)}`,
							onClick: () => {
								if (typeof onRegionChange === "function") onRegionChange(regionId);
								if (entry.state !== "ok") reload();
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								"aria-hidden": "true",
								className: `dsm-qoder-region-dot${dotClassOf(entry.state)}`
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-qoder-region-name",
								children: entry.regionName ?? regionId
							})]
						})
					}, `tab:${regionId}`);
				})
			}) : null, /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsm-qoder-account",
				children: [status === "error" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsm-qoder-account-error",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-qoder-error",
						children: t("account.error")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "dsm-qoder-button",
						disabled: reloading,
						onClick: () => {
							reload();
						},
						children: t("account.reload")
					})]
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(react.Fragment, { children: activeEntry !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react.Fragment, { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: `dsm-qoder-account-row${activeOffered ? "" : " dsm-qoder-account-row-off"}`,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "dsm-qoder-account-id",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsm-qoder-account-name",
									children: activeName !== "" ? activeName : "—"
								}), activeMeta.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsm-qoder-account-meta",
									children: activeMeta.join(" · ")
								}) : null]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "dsm-qoder-usage-spacer" }),
							activeRegionId !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: "dsm-qoder-switch",
								title: t("account.offerTitle"),
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "checkbox",
									className: "dsm-qoder-offer-toggle",
									checked: activeOffered,
									disabled: toggling,
									"aria-label": `${t("account.offer")}: ${activeEdition}`,
									onChange: (event) => {
										toggleRegion(activeRegionId, event.target.checked);
									}
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("account.offer") })]
							}) : null,
							activeEntry.source !== void 0 && activeRegionId !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsm-qoder-button",
								disabled: confirmBusy[activeRegionId] === true,
								onClick: () => {
									confirm(activeRegionId);
								},
								children: confirmBusy[activeRegionId] === true ? t("account.confirming") : t("account.confirm")
							}) : null
						]
					}),
					!activeOffered ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-qoder-account-note",
						children: t("account.offerOff")
					}) : null,
					activeEntry.state === "needs-app" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-qoder-account-note dsm-qoder-account-note-error",
						children: t("account.readFail", { detail: activeEntry.detail ?? "" })
					}) : null,
					activeEntry.state === "expired" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						className: "dsm-qoder-account-note",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("account.expiredHint", { app: activeEntry.appName ?? activeEntry.regionName ?? "Qoder" }) }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [t("account.download", { edition: activeEdition }), typeof activeEntry.downloadUrl === "string" && activeEntry.downloadUrl !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react.Fragment, { children: [" · ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
								href: activeEntry.downloadUrl,
								target: "_blank",
								rel: "noreferrer",
								title: activeEntry.downloadUrl,
								children: t("account.downloadLink", { edition: activeEdition })
							})] }) : null] })
						]
					}) : null,
					activeEntry.state === "signed-out" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						className: "dsm-qoder-account-note",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("account.unsigned") }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [t("account.download", { edition: activeEdition }), typeof activeEntry.downloadUrl === "string" && activeEntry.downloadUrl !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react.Fragment, { children: [" · ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
								href: activeEntry.downloadUrl,
								target: "_blank",
								rel: "noreferrer",
								title: activeEntry.downloadUrl,
								children: t("account.downloadLink", { edition: activeEdition })
							})] }) : null] })
						]
					}) : null,
					activeResult?.kind === "confirmed" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-qoder-account-note",
						children: t("account.confirmed")
					}) : null,
					activeResult?.kind === "sign-in-expired" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-qoder-account-note dsm-qoder-account-note-error",
						children: t("account.confirmExpired")
					}) : null,
					activeResult?.kind === "unavailable" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-qoder-account-note dsm-qoder-account-note-error",
						children: t("account.confirmFailed", { detail: activeResult.detail ?? "" })
					}) : null
				] }) : null }), offerError !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "dsm-qoder-account-note dsm-qoder-account-note-error",
					children: t("account.offerError", { detail: offerError })
				}) : null]
			})] });
		}

		//#endregion
		//#region src/client/controller.ts
		/**
		* The card's editable-state domain layer (no React, no DOM).
		*
		* WHY THIS FILE EXISTS
		*
		* The card's `dirty` / `save` / `discard` behaviour is a state machine, and it
		* used to live inside the React component — a component no Node test can import
		* without a browser. That made the very rules a user depends on (does this edit
		* count as unsaved? does a refused write show a failure?) testable only through
		* the shipped bundle's text or a DOM harness. Both are real, but neither is the
		* layer the bug is in.
		*
		* This is the same shape `dsh-sensenova-provider`'s `SenseNovaSettingsController`
		* uses: a class holding staged-vs-saved state, exposing one `state()` snapshot,
		* and doing the writes itself. The JSX then reads a plain object and calls
		* methods — no `useState` in the rules, only around the rendering concerns the
		* controller cannot own (the mount effect, the ticking clock, the row flash).
		*
		* WHAT IS PURE
		*
		* - No `react`, no `document`, no `fetch`. Every dependency is injected.
		* - `state()` answers a plain object, so a test can assert the whole surface.
		* - The persist function is injected, so a test can make it lie (the Windows
		*   silent-failure shape) without a network or a DOM.
		*
		* WHAT STAYS IN REACT
		*
		* The mount/refresh fetch, the status/refreshing/refreshedAt flags, the off-peak
		* clock, the row flash (`pulse`) and the open/collapsed flag are rendering
		* concerns driven by effects and timers. They are not the persisted document,
		* and dragging them in would defeat the point of extracting this layer.
		*/
		/** The three per-model image choices this card writes. */
		const IMAGE_MODES = [
			"auto",
			"on",
			"off"
		];
		/**
		* Sentinel stored in a region's allow-list to mean "hide every model".
		*
		* The host convention is `[] = no filter = show all`, so "hide all" has no
		* value of its own in that scheme. A non-empty list that matches no real model
		* id collapses to "show nothing" in `filterByEnabled`, so a marker that no model
		* id can equal expresses "hide all" without touching that convention.
		*/
		const HIDE_ALL_MODELS = "__hide-all__";
		/** Normalise whatever the saved map holds into one of {@link IMAGE_MODES}. */
		function imageModeOf(overrides, modelId) {
			const saved = overrides === null || typeof overrides !== "object" ? void 0 : overrides[modelId];
			return typeof saved === "string" && IMAGE_MODES.includes(saved) ? saved : "auto";
		}
		/**
		* The set of model ids currently ticked, given what the host reported.
		*
		* The host stores an empty list as "no filter" (every model shows), so the card
		* presents that same state as "everything ticked" — otherwise a fresh install
		* would render every box empty while every model was visible.
		*/
		function enabledIdsFor(models, saved) {
			const list = Array.isArray(saved) ? saved.filter((id) => typeof id === "string") : [];
			if (list.length === 0) return new Set(models.map((model) => model.id));
			return new Set(list);
		}
		/** The persist implementation the host provides: `writeSettingsField` bound to a scope. */
		function persistViaScope(scope) {
			return (field, value) => writeSettingsField(scope, field, value);
		}
		/** Stable initial state for a controller built from a route answer. */
		function initialEditableState(value) {
			const record = value === null || typeof value !== "object" ? {} : value;
			return {
				imageOverrides: record.imageOverrides !== null && typeof record.imageOverrides === "object" ? record.imageOverrides : {},
				maxWindow: record.useMaximumContextWindow === true,
				enabledIds: record.enabledModelIds !== null && typeof record.enabledModelIds === "object" ? record.enabledModelIds : {}
			};
		}
		/**
		* The card's editable-state machine.
		*
		* Construction is cheap and side-effect free: nothing is fetched, nothing is
		* subscribed. The caller feeds the roster with `setModels` after its own fetch
		* lands, and seeds the saved values with `seedSaved` on the first load — a
		* refresh must not clobber edits the user has staged but not yet saved, which is
		* why `seedSaved` is separate from `setModels`.
		*/
		var QoderCardController = class {
			staged;
			saved;
			models = [];
			saving = false;
			lastSave = void 0;
			query = "";
			activeRegion = "qoder-cn";
			snapshot;
			listeners = /* @__PURE__ */ new Set();
			constructor(initial) {
				this.staged = {
					imageOverrides: { ...initial.imageOverrides },
					maxWindow: initial.maxWindow,
					enabledIds: { ...initial.enabledIds }
				};
				this.saved = {
					imageOverrides: { ...initial.imageOverrides },
					maxWindow: initial.maxWindow,
					enabledIds: { ...initial.enabledIds }
				};
				this.snapshot = this.build();
			}
			/**
			* Subscribe to snapshot changes.
			*
			* An arrow property on purpose: `useSyncExternalStore` receives the bare
			* reference, so a prototype method would lose `this` and throw.
			*/
			subscribe = (listener) => {
				this.listeners.add(listener);
				return () => {
					this.listeners.delete(listener);
				};
			};
			/**
			* The current view, referentially stable until a mutation happens.
			*
			* `useSyncExternalStore` compares this by identity, so it must be the SAME
			* object across renders that changed nothing. Rebuilding it here on every
			* read would loop the card forever. An arrow property for the same reason
			* as {@link subscribe}.
			*/
			getSnapshot = () => {
				return this.snapshot;
			};
			/** Replace the roster. Never touches the saved or staged settings. */
			setModels(models) {
				this.models = Array.isArray(models) ? models : [];
				this.publish();
			}
			/** Seed the saved document, and mirror it as the staged state. */
			seedSaved(next) {
				this.saved = {
					imageOverrides: { ...next.imageOverrides },
					maxWindow: next.maxWindow,
					enabledIds: { ...next.enabledIds }
				};
				this.staged = {
					imageOverrides: { ...next.imageOverrides },
					maxWindow: next.maxWindow,
					enabledIds: { ...next.enabledIds }
				};
				this.lastSave = void 0;
				this.publish();
			}
			/** One model's image mode. "auto" deletes the override, so it writes no key. */
			setMode(modelId, mode) {
				const next = { ...this.staged.imageOverrides };
				if (mode === "auto") delete next[modelId];
				else next[modelId] = mode;
				this.staged.imageOverrides = next;
				this.lastSave = void 0;
				this.publish();
			}
			/**
			* Tick or untick one model for the picker.
			*
			* Ticking is recorded against the region's **full** roster, not against
			* whatever happens to be ticked now, so the saved list is a complete
			* allow-list rather than a diff. That is what lets a partially curated
			* region stay curated when the catalog later grows.
			*/
			toggleModel(regionId, modelId) {
				const roster = this.models.filter((m) => m.region === regionId).map((m) => m.id);
				const active = enabledIdsFor(this.models, this.staged.enabledIds[regionId]);
				const next = new Set(active);
				if (!next.delete(modelId)) next.add(modelId);
				const list = roster.filter((id) => next.has(id));
				this.staged.enabledIds = {
					...this.staged.enabledIds,
					[regionId]: list.length === roster.length ? [] : list
				};
				this.lastSave = void 0;
				this.publish();
			}
			/**
			* Bulk-set one region's roster to an extreme.
			*
			* `[]` is "show all" (the host's no-filter state); `[HIDE_ALL_MODELS]` matches
			* no real id, so the host returns `[]` — a true "hide all" without changing
			* the empty-means-all convention. Only the named region is touched.
			*/
			setRegionAll(regionId, allOn) {
				this.staged.enabledIds = {
					...this.staged.enabledIds,
					[regionId]: allOn ? [HIDE_ALL_MODELS] : []
				};
				this.lastSave = void 0;
				this.publish();
			}
			setMaxWindow(on) {
				this.staged.maxWindow = on;
				this.lastSave = void 0;
				this.publish();
			}
			setQuery(query) {
				this.query = query;
				this.publish();
			}
			setActiveRegion(regionId) {
				this.activeRegion = regionId;
				this.publish();
			}
			/**
			* Persist the three editable fields through the injected writer.
			*
			* Each write is verified upstream of this class (the host endpoint's
			* read-back in `writeSettingsField`), so a rejection raises here rather than
			* silently passing. On success the staged state becomes the saved state and
			* `lastSave` says so; on failure `lastSave` carries the reason and the
			* staged edits stay, so nothing the user typed is lost to a locked file.
			*/
			async save(persist) {
				if (this.saving) return;
				this.saving = true;
				this.lastSave = void 0;
				this.publish();
				try {
					await persist("enabledModelIds", this.staged.enabledIds);
					await persist("imageOverrides", this.staged.imageOverrides);
					await persist("useMaximumContextWindow", this.staged.maxWindow);
					this.saved = {
						imageOverrides: { ...this.staged.imageOverrides },
						maxWindow: this.staged.maxWindow,
						enabledIds: { ...this.staged.enabledIds }
					};
					this.lastSave = { ok: true };
				} catch (error) {
					this.lastSave = {
						ok: false,
						reason: describeThrown(error)
					};
				} finally {
					this.saving = false;
					this.publish();
				}
			}
			/** Drop every staged edit back to the last saved document. */
			discard() {
				this.staged = {
					imageOverrides: { ...this.saved.imageOverrides },
					maxWindow: this.saved.maxWindow,
					enabledIds: { ...this.saved.enabledIds }
				};
				this.lastSave = void 0;
				this.publish();
			}
			publish() {
				this.snapshot = this.build();
				for (const listener of [...this.listeners]) try {
					listener();
				} catch (error) {
					console.error("[dsh-connect-qoder] controller subscriber failed:", error);
				}
			}
			/** Compute the current snapshot from the live fields. */
			build() {
				const dirty = JSON.stringify(this.staged.imageOverrides) !== JSON.stringify(this.saved.imageOverrides) || JSON.stringify(this.staged.enabledIds) !== JSON.stringify(this.saved.enabledIds) || this.staged.maxWindow !== this.saved.maxWindow;
				const regionModels = this.models.filter((model) => model.region === this.activeRegion);
				const regionAllTicked = regionModels.length > 0 && regionModels.every((model) => enabledIdsFor(this.models, this.staged.enabledIds[this.activeRegion]).has(model.id));
				const needle = this.query.trim().toLowerCase();
				const visibleModels = regionModels.filter((model) => {
					if (needle === "") return true;
					return String(model.name ?? model.id).toLowerCase().includes(needle) || model.id.toLowerCase().includes(needle);
				});
				const visibleTicked = visibleModels.filter((model) => model.region !== void 0 && enabledIdsFor(this.models, this.staged.enabledIds[model.region]).has(model.id)).length;
				return {
					imageOverrides: this.staged.imageOverrides,
					maxWindow: this.staged.maxWindow,
					enabledIds: this.staged.enabledIds,
					dirty,
					saving: this.saving,
					lastSave: this.lastSave,
					query: this.query,
					activeRegion: this.activeRegion,
					regionModels,
					regionAllTicked,
					visibleModels,
					visibleTicked
				};
			}
		};

		//#endregion
		//#region src/client/card.tsx
		/**
		* One quota row: label, optional badges, an optional date, a bar, and the
		* used/total figures. Shared by the plan quota, the add-on package and the
		* per-model dedicated packages, which differ only in their wording.
		*/
		function QuotaBlock({ t, label, quota, when, badge }) {
			const percentage = Math.min(1, Math.max(0, Number(quota.percentage) || 0));
			const percent = Math.round(percentage * 1e3) / 10;
			const remaining = quota.remaining;
			const known = typeof remaining === "number" && Number.isFinite(remaining);
			const exhausted = known && remaining <= 0;
			const tone = exhausted ? " dsm-qoder-bar-full" : percentage >= .8 ? " dsm-qoder-bar-warn" : "";
			const unit = quota.unit === "credits" ? t("usage.credits") : quota.unit ?? "";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsm-qoder-usage-block",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-qoder-usage-label",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: label }),
							badge !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-qoder-usage-badge dsm-qoder-usage-badge-offer",
								children: badge
							}) : null,
							exhausted ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-qoder-usage-badge",
								children: t("usage.exceeded")
							}) : null,
							when ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-qoder-usage-when",
								children: when
							}) : null
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsm-qoder-bar",
						role: "progressbar",
						"aria-valuemin": 0,
						"aria-valuemax": 100,
						"aria-valuenow": Math.round(percentage * 100),
						"aria-label": label,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: `dsm-qoder-bar-fill${tone}`,
							style: { width: `${percent}%` }
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-qoder-usage-figures",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: `${quota.used} / ${quota.total}` }), ` (${Math.round(percent)}%)`] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "dsm-qoder-usage-remain",
							children: [
								`${t("usage.remaining")} `,
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: known ? remaining : "—" }),
								unit ? ` ${unit}` : ""
							]
						})]
					})
				]
			});
		}
		/**
		* Today's check-in, as a small card beside the usage panel.
		*
		* This used to be one more full-width row in the panel's stack, which spent a
		* whole line on two short strings ("每日签到" / "今日已签到") and made the panel
		* read as low-density. The facts are unchanged and still all come from the
		* host: whether a round is running, whether it was claimed, and what it is
		* worth. The card holds no arithmetic of its own — the amount is the host's
		* `checkin.amount`, the same value the panel already printed as "今日可领".
		*/
		function CheckinCard({ t, checkin, busy, notice, onClaim }) {
			const claimed = checkin.todayCheckedIn === true;
			const amount = typeof checkin.amount === "number" ? checkin.amount : void 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("aside", {
				className: "dsm-qoder-checkin",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsm-qoder-checkin-title",
						children: t("usage.checkin")
					}),
					amount !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
						className: "dsm-qoder-checkin-gain",
						children: t("usage.checkinGain", { amount })
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "dsm-qoder-button dsm-qoder-checkin-button",
						disabled: busy || claimed,
						onClick: onClaim,
						children: busy ? t("usage.checkinClaiming") : claimed ? t("usage.checkinClaimed") : t("usage.checkinClaim")
					}),
					notice != null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: notice.kind === "error" ? "dsm-qoder-error" : "dsm-qoder-state",
						children: notice.kind === "error" ? t("usage.checkinError", { message: notice.message ?? "" }) : notice.kind === "granted" && typeof notice.amount === "number" ? t("usage.checkinGranted", { amount: notice.amount }) : t("usage.checkinAlready")
					}) : null
				]
			});
		}
		/**
		* One region's usage block, as returned by the host usage route.
		*
		* Holds only the quota bars and the promotional lines. The daily check-in is
		* NOT part of this block: it is rendered by {@link QoderUsagePanel} as a card
		* beside the whole panel, because a check-in row inside this stack spent a
		* full-width line on two short strings.
		*/
		function RegionUsage({ t, entry, campaignsOpen, onCampaignsToggle }) {
			if (entry.available !== true) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dsm-qoder-usage-block",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "dsm-qoder-state",
					children: t("usage.unavailable")
				})
			});
			const packages = Array.isArray(entry.dedicatedPackages) ? entry.dedicatedPackages : [];
			const campaigns = Array.isArray(entry.campaigns) ? entry.campaigns : [];
			const hasAny = entry.userQuota !== void 0 || entry.addOnQuota !== void 0 || packages.length > 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsm-qoder-usage-block",
				children: [
					!hasAny ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-qoder-state",
						children: t("usage.empty")
					}) : null,
					entry.userQuota !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(QuotaBlock, {
						t,
						label: t("usage.planCredits"),
						quota: entry.userQuota,
						when: withDate(t("usage.renewsOn"), typeof entry.expiresAt === "number" ? entry.expiresAt : void 0)
					}) : null,
					entry.addOnQuota !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(QuotaBlock, {
						t,
						label: t("usage.resourcePackage"),
						quota: entry.addOnQuota
					}) : null,
					packages.map((pack, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { className: "dsm-qoder-usage-sep" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(QuotaBlock, {
						t,
						label: typeof pack.name === "string" && pack.name !== "" ? pack.name : t("usage.dedicatedPackage"),
						quota: pack,
						when: withDate(t("usage.expiresOn"), typeof pack.expiresAt === "number" ? pack.expiresAt : void 0)
					})] }, `pack:${pack.id}:${index}`)),
					campaigns.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { className: "dsm-qoder-usage-sep" }) : null,
					campaigns.length > 1 && campaignsOpen !== true ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "dsm-qoder-button",
						onClick: onCampaignsToggle,
						children: t("usage.promoCount", { count: campaigns.length })
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react.Fragment, { children: [campaigns.map((camp, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						className: "dsm-qoder-usage-promo",
						children: [
							index === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-qoder-usage-badge dsm-qoder-usage-badge-offer",
								children: t("usage.promotion")
							}) : null,
							index === 0 ? " " : null,
							camp.title,
							camp.endsAt !== void 0 ? ` · ${withDate(t("usage.expiresOn"), typeof camp.endsAt === "number" ? camp.endsAt : void 0)}` : "",
							camp.detailUrl ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react.Fragment, { children: [" ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
								href: camp.detailUrl,
								target: "_blank",
								rel: "noreferrer",
								children: t("usage.viewDetails")
							})] }) : null
						]
					}, `camp:${camp.key}`)), campaigns.length > 1 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "dsm-qoder-button",
						onClick: onCampaignsToggle,
						children: t("usage.promoCollapse")
					}) : null] })
				]
			});
		}
		/**
		* Whether the card starts expanded. Defaults to collapsed (the body is
		* `hidden`, not unmounted, so staged edits and a ticking countdown survive a
		* cycle); a host slot that passes `view="page"` opens it.
		*
		* @param view - the `view` prop the host slot passed, if any.
		* @returns true when the card should start expanded.
		*/
		function initialOpenForView(view) {
			return view === "page";
		}
		function QoderPluginCard({ t, settingsScope, view }) {
			if (t === void 0) throw new Error("Qoder settings card requires its translation function");
			const [open, setOpen] = react.useState(() => initialOpenForView(view));
			const [models, setModels] = react.useState([]);
			const [controller] = react.useState(() => new QoderCardController({
				imageOverrides: {},
				maxWindow: false,
				enabledIds: {}
			}));
			react.useEffect(() => {
				controller.setModels(models);
			}, [controller, models]);
			const snap = react.useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
			const [status, setStatus] = react.useState("loading");
			const [notice, setNotice] = react.useState(void 0);
			const [refreshing, setRefreshing] = react.useState(false);
			const [refreshedAt, setRefreshedAt] = react.useState(void 0);
			const [refreshFailure, setRefreshFailure] = react.useState(null);
			const [usageBump, setUsageBump] = react.useState(0);
			const [pulse, setPulse] = react.useState(void 0);
			const [imageTuning, setImageTuning] = react.useState(false);
			const [clock, setClock] = react.useState(() => /* @__PURE__ */ new Date());
			const mounted = react.useRef(true);
			react.useEffect(() => {
				mounted.current = true;
				return () => {
					mounted.current = false;
				};
			}, []);
			react.useEffect(() => {
				if (pulse === void 0) return void 0;
				const timer = window.setTimeout(() => setPulse(void 0), 1300);
				return () => window.clearTimeout(timer);
			}, [pulse]);
			react.useEffect(() => {
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
			const load = react.useCallback(async (refresh, signal) => {
				if (refresh) setRefreshing(true);
				try {
					const value = await getJson(`${QODER_MODELS_PATH}${refresh ? "?refresh=1" : ""}`, { signal });
					if (!mounted.current) return;
					setModels(Array.isArray(value.models) ? value.models : []);
					if (!refresh) controller.seedSaved(initialEditableState(value));
					setRefreshedAt(typeof value.refreshedAt === "number" ? value.refreshedAt : void 0);
					setRefreshFailure(refreshNoticeKey(value));
					setStatus("ready");
				} catch (error) {
					if (!mounted.current || signal?.aborted === true) return;
					setStatus("error");
					setNotice(describeThrown(error));
				} finally {
					if (mounted.current) setRefreshing(false);
				}
			}, []);
			react.useEffect(() => {
				const controller = new AbortController();
				load(false, controller.signal);
				return () => {
					controller.abort();
				};
			}, [load]);
			const reconcile = react.useCallback(() => {
				load(true);
				setUsageBump((n) => n + 1);
			}, [load]);
			const setMode = react.useCallback((modelId, mode) => {
				controller.setMode(modelId, mode);
				setPulse(modelId);
			}, [controller]);
			/**
			* Tick or untick one model for the picker.
			*
			* Ticking is recorded against the region's **full** roster, not against
			* whatever happens to be ticked now, so the saved list is a complete
			* allow-list rather than a diff. That is what lets a partially curated
			* region stay curated when the catalog later grows.
			*/
			const toggleModel = react.useCallback((regionId, modelId) => {
				controller.toggleModel(regionId, modelId);
				setPulse(modelId);
			}, [controller]);
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
			const setRegionAll = react.useCallback((regionId, allOn) => {
				controller.setRegionAll(regionId, allOn);
			}, [controller]);
			/**
			* Persist the card's three settings fields.
			*
			* The controller writes through `persistViaScope`, which verifies each write
			* (read-back against what was posted) and merges the per-region allow-list,
			* so a save either lands or raises — the "已保存" banner only appears for
			* values that actually persisted. The banner text is derived from the
			* controller's `lastSave` in the JSX, not set here.
			*/
			const save = react.useCallback(() => {
				if (settingsScope === void 0) return Promise.resolve();
				return controller.save(persistViaScope(settingsScope));
			}, [controller, settingsScope]);
			const discard = react.useCallback(() => {
				controller.discard();
			}, [controller]);
			const setQuery = react.useCallback((value) => {
				controller.setQuery(value);
			}, [controller]);
			const setActiveRegion = react.useCallback((regionId) => {
				controller.setActiveRegion(regionId);
			}, [controller]);
			const setMaxWindow = react.useCallback((on) => {
				controller.setMaxWindow(on);
			}, [controller]);
			const regionModels = snap.regionModels;
			const regionAllTicked = snap.regionAllTicked;
			const visibleModels = snap.visibleModels;
			const visibleTicked = snap.visibleTicked;
			const dirty = snap.dirty;
			const saving = snap.saving;
			const query = snap.query;
			const imageOverrides = snap.imageOverrides;
			const maxWindow = snap.maxWindow;
			const enabledIds = snap.enabledIds;
			const activeRegion = snap.activeRegion;
			const imageTuningActive = imageTuning || visibleModels.some((model) => imageModeOf(imageOverrides, model.id) !== "auto");
			const offPeakWindow = regionModels.find((model) => model.promotion !== void 0 && model.promotion !== null)?.promotion;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				className: `dsm-plugin-card${open ? " dsm-plugin-card-open" : ""}`,
				onKeyDown: (event) => {
					if (event.key !== "Escape" || !open) return;
					if (query !== "") {
						setQuery("");
						return;
					}
					setOpen(false);
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: "dsm-plugin-card-header",
					"aria-expanded": open,
					"aria-label": `${t(open ? "row.collapse" : "row.expand")}: ${t("row.title")}`,
					onClick: () => {
						setOpen(!open);
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "dsm-plugin-card-head",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsm-plugin-card-title",
							children: t("row.title")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsm-plugin-card-description",
							children: t("row.desc")
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						"aria-hidden": "true",
						className: `dsm-plugin-card-chevron${open ? " dsm-plugin-card-chevron-open" : ""}`
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dsm-plugin-card-body",
					hidden: !open,
					children: open ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-qoder-body",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(QoderAccountPanel, {
								t,
								onReconciled: reconcile,
								settingsScope,
								activeRegion,
								onRegionChange: setActiveRegion
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(QoderUsagePanel, {
								t,
								refreshToken: usageBump,
								activeRegion
							}),
							status === "loading" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsm-qoder-skeleton",
								"aria-busy": "true",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: "dsm-qoder-state",
										children: t("row.loading")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { className: "dsm-qoder-skeleton-row" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { className: "dsm-qoder-skeleton-row" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { className: "dsm-qoder-skeleton-row" })
								]
							}) : null,
							status === "error" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsm-qoder-tools",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "dsm-qoder-error",
									children: `${t("row.requestFailed")}: ${notice ?? ""}`
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dsm-qoder-button",
									disabled: refreshing,
									onClick: () => {
										load(true);
									},
									children: refreshing ? t("row.refreshing") : t("row.retry")
								})]
							}) : null,
							status === "ready" && models.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dsm-qoder-state",
								children: t("row.signedOut")
							}) : null,
							status === "ready" && models.length > 0 && regionModels.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dsm-qoder-state",
								children: t("row.regionEmpty")
							}) : null,
							models.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsm-qoder-tools",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "search",
									className: "dsm-qoder-search",
									value: query,
									placeholder: t("row.searchPlaceholder"),
									"aria-label": t("row.search"),
									onChange: (event) => setQuery(event.target.value)
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "dsm-qoder-count",
									"aria-live": "polite",
									children: [
										t("row.filterCount", {
											visible: visibleModels.length,
											total: regionModels.length
										}),
										" · ",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t("row.filterTicked", { ticked: visibleTicked }) })
									]
								})]
							}) : null,
							regionModels.length > 0 && visibleModels.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsm-qoder-tools",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "dsm-qoder-state",
									children: t("row.searchEmpty")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dsm-qoder-button",
									onClick: () => setQuery(""),
									children: t("row.clearFilter")
								})]
							}) : null,
							visibleModels.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
								className: "dsm-qoder-models",
								children: visibleModels.map((model) => {
									const active = model.region !== void 0 && enabledIdsFor(models, enabledIds[model.region]).has(model.id);
									const offPeak = offPeakState(model, clock);
									const rate = rateLabelOf(t, rateAt(model, clock));
									const offPeakTitle = model.promotion === void 0 ? t("row.rateLabel") : offPeak?.active === true ? `${t("row.offPeakOn")} · ${formatCountdown(offPeak.remainingSeconds)}` : t("row.offPeakOff");
									const boundary = model.promotion == null ? void 0 : offPeak?.active === true ? model.promotion.windowEnd : model.promotion.windowStart;
									const offPeakBadge = offPeak === void 0 ? "" : boundary === void 0 ? t(offPeak.active ? "row.offPeakOn" : "row.offPeakOff") : `${t(offPeak.active ? "row.offPeakOn" : "row.offPeakOff")} ${t(offPeak.active ? "row.offPeakEnd" : "row.offPeakStart", { time: boundary })}`;
									const windowLabel = windowLabelOf(model, maxWindow);
									const metaParts = [];
									if (windowLabel !== "") metaParts.push(windowLabel);
									metaParts.push(model.isVL === true ? t("row.vision") : t("row.textOnly"));
									const contextTitle = model.contextOptions?.length ? `${t("row.maxWindow")}: ${model.contextOptions.map(formatContextWindowForUi).join(" / ")}` : t("row.maxWindowNote");
									return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
										className: `dsm-qoder-row${active ? "" : " dsm-qoder-row-off"}${pulse === model.id ? " dsm-qoder-row-pulse" : ""}`,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: "dsm-qoder-row-main",
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
													className: "dsm-qoder-pick",
													title: t("row.showInPicker"),
													children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
														type: "checkbox",
														checked: active,
														disabled: saving || model.region === void 0,
														"aria-label": `${t("row.showInPicker")}: ${model.name ?? model.id}`,
														onChange: () => {
															if (model.region === void 0) return;
															toggleModel(model.region, model.id);
														}
													})
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "dsm-qoder-name",
													title: model.id,
													children: model.name ?? model.id
												}),
												rate !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: `dsm-qoder-rate${Number(rateAt(model, clock)) <= 0 ? " dsm-qoder-rate-free" : ""}`,
													title: offPeakTitle,
													children: rate
												}) : null,
												offPeak !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: `dsm-qoder-badge${offPeak.active ? " dsm-qoder-badge-offer" : ""}`,
													title: model.promotion?.description !== void 0 ? String(model.promotion.description) : offPeakTitle,
													children: offPeakBadge
												}) : null,
												metaParts.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "dsm-qoder-meta",
													title: contextTitle,
													children: metaParts.join(" · ")
												}) : null
											]
										}), imageTuning || imageModeOf(imageOverrides, model.id) !== "auto" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
											className: "dsm-qoder-switch",
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("row.imageTitle") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
												className: "dsm-qoder-select",
												value: imageModeOf(imageOverrides, model.id),
												disabled: saving,
												"aria-label": `${t("row.imageTitle")}: ${model.name ?? model.id}`,
												onChange: (event) => {
													setMode(model.id, event.target.value);
												},
												children: IMAGE_MODES.map((mode) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
													value: mode,
													children: t(mode === "auto" ? "row.imageAuto" : mode === "on" ? "row.imageOn" : "row.imageOff")
												}, mode))
											})]
										}) : null]
									}, `${model.region}:${model.id}`);
								})
							}) : null,
							offPeakWindow != null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dsm-qoder-hint",
								children: t("row.offPeakHint", {
									window: `${offPeakWindow.windowStart}–${offPeakWindow.windowEnd}`,
									zone: typeof offPeakWindow.timezone === "string" ? offPeakWindow.timezone : "Asia/Shanghai"
								})
							}) : null,
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsm-qoder-switches",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: "dsm-qoder-switch",
									title: t("row.maxWindowTitle"),
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										type: "checkbox",
										checked: maxWindow,
										disabled: saving,
										"aria-label": t("row.maxWindow"),
										onChange: (event) => {
											setMaxWindow(event.target.checked);
											if (status !== "error") setNotice(void 0);
										}
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("row.maxWindow") })]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: "dsm-qoder-switch",
									title: t("row.imageTuningTitle"),
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										type: "checkbox",
										checked: imageTuning,
										"aria-label": t("row.imageTuning"),
										onChange: (event) => {
											setImageTuning(event.target.checked);
										}
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("row.imageTuning") })]
								})]
							}),
							imageTuningActive ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dsm-qoder-hint",
								children: t("row.imageHint")
							}) : null,
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsm-qoder-actions",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dsm-qoder-button",
										disabled: refreshing,
										onClick: () => {
											load(true);
										},
										children: refreshing ? t("row.refreshing") : t("row.refreshModels")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dsm-qoder-button",
										disabled: saving,
										title: t("row.showHint"),
										onClick: () => {
											setRegionAll(activeRegion, regionAllTicked);
										},
										children: regionAllTicked ? t("row.disableAll") : t("row.enableAll")
									}),
									refreshedAt !== void 0 && !refreshing ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dsm-qoder-state",
										children: refreshFailure === "protocol-shape-changed" ? t("row.protocolChanged") : refreshFailure === "persist" ? t("row.refreshNotPersisted") : t(refreshFailure === "transient" ? "row.refreshStale" : "row.refreshed", { time: new Date(refreshedAt).toLocaleTimeString() })
									}) : refreshFailure !== null && !refreshing ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dsm-qoder-state",
										title: refreshFailure === "protocol-shape-changed" || refreshFailure === "persist" ? void 0 : t("row.refreshFailed", { reason: refreshFailure }),
										children: refreshFailure === "protocol-shape-changed" ? t("row.protocolChanged") : t("row.refreshFailed", { reason: refreshFailure })
									}) : null
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsm-qoder-actions dsm-qoder-actions-save",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dsm-qoder-button",
										disabled: saving || !dirty || settingsScope === void 0,
										onClick: save,
										children: saving ? t("row.saving") : t("row.save")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dsm-qoder-button",
										disabled: saving || !dirty,
										onClick: discard,
										children: t("row.discard")
									}),
									snap.lastSave !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dsm-qoder-state",
										children: snap.lastSave.ok === true ? t("row.saved") : `${t("row.failed")}: ${snap.lastSave.reason}`
									}) : dirty ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
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
		* The Loader entry id the host serves this plugin's settings under — the same
		* value the host half resolves in `settingsNamespaceOf` (`llm-qoder`). Named
		* once here so the namespace lookup and the row-slot key below cannot drift
		* into two spellings of the same id.
		*/
		const PROVIDER_NS = "llm-qoder";
		/**
		* Client services this card reads.
		*
		* The 0.2 harness serves settings through `configForms` only — the older
		* `settingsScope` wrapper service no longer exists, and Cordis' hard inject
		* gate would brick web boot on a listed-but-absent service ("1 entry did
		* not activate: … pending (waiting for service: …)"). Only guaranteed
		* services go in `inject`; the settings surface is probed softly inside
		* `apply` below.
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
				/**
				* Probe the settings surface without a hard dependency. The 0.2 harness
				* serves it through `configForms`; `ctx.get` returns undefined (never
				* throws) for an absent service, so a host without it degrades to a
				* read-only card instead of bricking boot. The older `settingsScope`
				* wrapper no longer exists, so it is no longer probed for. `forms.get(ns)`
				* answers the `.set` / `.getSnapshot` shape the card writes through.
				*/
				/**
				* Probe a service by name without a hard dependency.
				*
				* Answers `unknown`, matching the fact that `ctx.get` is a string-keyed
				* lookup: there is no mapping the compiler could check, so each caller
				* states the shape it expects at the point it reads a member. The shape
				* below (`configForms`) belongs to the harness, not
				* to this plugin, which is why they are declared inline where they are used
				* rather than invented as interfaces here — a hand-written guess at a peer
				* package's surface is worse than an honest `unknown`.
				*/
				const softGet = (name) => ctx.get(name);
				/**
				* The namespace the HOST actually serves this plugin's settings under.
				*
				* Read from the live `describe()` view rather than trusted from a constant,
				* because a plugin no longer picks its own namespace: on the 0.2 line the
				* service derives it from the Loader entry (`ns: entry.options.id`, which
				* is the provider name `llm-qoder`), and a host that mounts the plugin
				* without a Loader entry serves it under the plugin namespace. The host
				* half already resolves this the same way in `settingsNamespaceOf` — and
				* reads it live for the same reason.
				*
				* This value drives BOTH the locale table and the settings scope, and that
				* is the point: they must name one namespace, or the copy and the section
				* the user is looking at belong to different identities. An earlier version
				* hardcoded `"settings.qoder"` here — a namespace the host has never
				* served — so `locale.bind` found no table, every lookup fell back to
				* echoing its own key, and the card rendered as raw `account.reload`-style
				* identifiers in BOTH languages. The fault was misread as "no English
				* translation" for a while, because a key-echo looks the same as a missing
				* translation whichever locale is active.
				*/
				const resolveNamespace = () => {
					const fallback = "dsh-connect-qoder";
					const forms = softGet("configForms");
					if (forms === void 0) return fallback;
					try {
						const served = (forms.describe().getSnapshot().view?.namespaces ?? []).find((entry) => entry.ns === fallback || entry.ns === PROVIDER_NS);
						return served !== void 0 ? served.ns : fallback;
					} catch {
						return fallback;
					}
				};
				const namespace = resolveNamespace();
				ctx.effect(() => ctx.locale.register(namespace, {
					zh,
					en
				}), "dsh-connect-qoder: settings copy");
				const t = ctx.locale.bind(namespace);
				let settingsScope;
				const forms = softGet("configForms");
				if (forms !== void 0) settingsScope = forms.get(namespace);
				/**
				* FIX 0.1.7: the plugin-manager detail page renders a bundle's config
				* card from the `plugins.bundle.config` slot (and a row's from
				* `plugins.row.config`); the legacy `settings.plugin.item` slot is no
				* longer rendered there. The host gates the section on
				* `ledger.bundles.has(openPkg.name)`, and that set is read back from
				* these very slot registrations — a card registered under a key nobody
				* installs as a dependency is invisible even though `apply` ran.
				* The 0.3.2 scoped rename made that real: profiles may carry this
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
					registerCard("plugins.row.config", `${bundle}#${PROVIDER_NS}`);
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
