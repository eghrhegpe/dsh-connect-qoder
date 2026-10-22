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
			".dsm-qoder-roster{display:flex;flex-direction:column;max-height:368px;overflow:auto}",
			".dsm-qoder-models{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px;flex:none}",
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
			".dsm-qoder-actions-save{position:sticky;bottom:0;z-index:1;flex:none;background:var(--dsw-alias-bg-layer-2,#25262b);border-top:1px solid var(--dsw-alias-border-l2,#36373b);padding:8px 0}",
			".dsm-qoder-button{font-size:12px;padding:5px 12px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,#36373b);background:transparent;color:inherit;cursor:pointer}",
			".dsm-qoder-button:disabled{opacity:.5;cursor:default}",
			".dsm-qoder-disclosure{align-self:flex-start;font-size:11px;padding:3px 10px;border-color:var(--dsw-alias-state-success-primary,#12b76a);color:var(--dsw-alias-state-success-primary,#12b76a)}",
			".dsm-qoder-disclosure::after{content:\"\";display:inline-block;width:5px;height:5px;margin-left:6px;border-right:1.4px solid currentColor;border-bottom:1.4px solid currentColor;transform:rotate(45deg) translateY(-2px)}",
			".dsm-qoder-disclosure[aria-expanded=\"true\"]::after{transform:rotate(225deg) translateY(-2px)}",
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
			".dsm-qoder-usage-local{margin:2px 0 0;display:flex;flex-wrap:wrap;align-items:baseline;gap:6px;font-size:11px;line-height:1.6;color:var(--dsw-alias-label-tertiary,#999)}",
			".dsm-qoder-usage-local-note{color:var(--dsw-alias-state-warn-primary,#f79009)}",
			".dsm-qoder-usage-local-unavailable{font-style:italic}",
			".dsm-qoder-usage-spacer{flex:1}",
			".dsm-qoder-visually-hidden{position:absolute!important;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}",
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
			".dsm-qoder-device{border-top:1px solid var(--dsw-alias-border-l1,#2a2b31);padding-top:8px;display:flex;flex-direction:column;gap:6px}",
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
			".dsm-qoder-region-name{font-size:13px;font-weight:500;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}",
			".dsm-qoder-composer-pill{position:relative;display:inline-flex;align-items:center;gap:6px;font:inherit}"
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
			"row.refreshModels": "刷新模型目录",
			"row.refreshing": "正在刷新…",
			"row.refreshed": "已更新（{time}）",
			"row.refreshStale": "上次更新：{time}（刷新失败）",
			"row.refreshFailed": "刷新失败：{reason}",
			"row.refreshNotPersisted": "已刷新，但写盘失败——重启后会回到旧目录（下次刷新会自动重试）",
			"row.protocolChanged": "Qoder 的接口返回了本插件不认识的格式——请更新插件（重新登录没有用）",
			"row.refreshDailyLimit": "上游说今日额度已用尽——要等零点重置（不是登录问题，也不用更新插件）",
			"row.refreshDailyLimitStale": "上次更新：{time}（今日额度已用尽）",
			"row.providerRegistrationFailed": "插件启动时模型 provider 注册失败（{reason}）：下面的模型在对话里选不到。完整错误已写入宿主日志。",
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
			"row.refreshDailyLimit": "Upstream says today's allowance is spent — it resets at midnight (this is not a sign-in problem, and updating will not help)",
			"row.refreshDailyLimitStale": "Last updated: {time} (today's allowance is spent)",
			"row.providerRegistrationFailed": "The model provider failed to register when the plugin started ({reason}): the models below cannot be picked in chat. The full error is in the host log.",
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
			"usage.promoCount": "限时特惠 · {count} 个活动",
			"usage.promoCollapse": "收起活动",
			"usage.promotionsUnavailable": "活动信息暂不可用：{reason}",
			"usage.protocolChanged": "Qoder 返回了本插件不认识的格式——请更新插件（重新登录没有用）",
			"usage.dailyLimit": "今日额度已用尽（上游口径）——零点重置后自动恢复",
			"usage.promotionsProtocolChanged": "活动接口返回了本插件不认识的格式——请更新插件（重新登录没有用）",
			"usage.viewDetails": "查看详情",
			"usage.credits": "Credits",
			"usage.checkin": "每日签到",
			"usage.checkinGain": "+{amount} Credits",
			"usage.checkinClaim": "立即签到",
			"usage.checkinClaiming": "签到中…",
			"usage.checkinClaimed": "今日已签到",
			"usage.checkinGranted": "已领取 {amount} Credits",
			"usage.checkinAlready": "今天这份已经领过了",
			"usage.checkinError": "签到失败：{message}",
			"pill.details": "用量详情",
			"pill.balance": "余额",
			"pill.loading": "正在读取用量…",
			"pill.unavailable": "读不到用量",
			"pill.stale": "数据可能已过期",
			"pill.checkinDone": "今日已签到",
			"pill.checkinNow": "签到领 {amount} Credits",
			"pill.checkinBusy": "签到中…",
			"pill.checkinFailed": "签到失败：{message}",
			"pill.modelLabel": "当前模型",
			"pill.offpeakActive": "错峰折扣生效 · 费率 {rate}",
			"pill.offpeakIdle": "错峰窗口 {window} · 未生效",
			"pill.offpeakRemaining": "剩余 {time}",
			"pill.newModels": "新模型",
			"pill.newModelsRow": "本机新见",
			"pill.newModelsTitle": "本机首次见到的模型：",
			"pill.newModelsSep": "、",
			"usage.requestsToday": "今日经本客户端请求 {count} 次",
			"usage.requestsUnavailable": "本地请求计数未接入",
			"usage.requestsExhausted": "今日额度疑似已用尽（本地统计，仅供参考）",
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
		const enUsage = {
			"usage.title": "My usage",
			"usage.refresh": "Refresh usage",
			"usage.loading": "Reading usage…",
			"usage.empty": "This account has no usage to show right now.",
			"usage.unavailable": "Usage is unavailable for this region right now.",
			"usage.none": "No usage data for this edition (not signed in, or offline yet).",
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
			"usage.promotionsUnavailable": "Offers unavailable: {reason}",
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
			"pill.newModels": "new",
			"pill.newModelsRow": "New here",
			"pill.newModelsTitle": "First seen on this device: ",
			"pill.newModelsSep": ", ",
			"usage.requestsToday": "Requested {count} times via this client today",
			"usage.requestsUnavailable": "Local request count not wired in",
			"usage.requestsExhausted": "Daily allowance may be used up (local estimate, for reference)",
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
			"account.confirmNoSignIn": "这个版本没有可校验的登录——请先登录，或设置环境变量 PAT（QODERCN_PAT / QODER_PAT）",
			"account.confirmProtocolChanged": "在线校验收到本插件不认识的接口格式——请更新插件（重新登录没有用）",
			"account.state.ok": "正常",
			"account.state.expired": "已过期",
			"account.state.needs-app": "读不到",
			"account.state.signed-out": "未登录",
			"account.state.device": "已登录",
			"account.deviceActive": "当前用的是插件自有登录（浏览器登录）——不需要桌面端客户端。",
			"account.deviceFrom": "来自插件自有登录",
			"account.envPat": "来自环境变量 PAT",
			"account.appFrom": "来自 {app}",
			"account.expiresAt": "有效期至 {date}",
			"account.unsigned": "本机没装这个版本的 Qoder 客户端",
			"account.expiredHint": "登录已失效——请打开 Qoder 客户端（{app}）重新登录，然后点「重新读取登录状态」",
			"account.readFail": "本地登录信息读不到：{detail}。可改用环境变量 PAT（QODERCN_PAT / QODER_PAT），或点「重新读取登录状态」",
			"account.readFailDevice": "本地登录信息读不到：{detail}。可点「浏览器登录」用插件自有登录（不装桌面端也能用），或改用环境变量 PAT（QODERCN_PAT / QODER_PAT），或点「重新读取登录状态」",
			"account.download": "没装 Qoder 客户端？到「下载」区安装 {edition}，装好后登录",
			"account.downloadLink": "下载 {edition}",
			"account.error": "读取账号状态失败",
			"account.offer": "启用此版本",
			"account.offerTitle": "关闭后这个版本的模型不会出现在 DSH 的模型下拉框里；登录、用量与模型设置都会保留，重新开启即恢复。",
			"account.offerOff": "已关闭：该版本的模型不会出现在 DSH 的模型下拉框里",
			"account.offerError": "保存「启用此版本」开关失败：{detail}",
			"account.regionTabs": "版本：点哪个就看哪个版本的账号、用量与模型",
			"device.title": "插件自有登录",
			"device.available": "不装桌面端也能用：在浏览器里批准一个码，插件把换来的可刷新令牌存在本机，只放在这个版本自己的文件里。",
			"device.signIn": "浏览器登录",
			"device.starting": "正在获取授权链接…",
			"device.waiting": "已打开授权页，等待批准（最多 5 分钟）",
			"device.reopen": "重新打开授权页",
			"device.signOut": "退出插件登录",
			"device.signingOut": "正在退出…",
			"device.state.ok": "插件已登录",
			"device.state.none": "本机没有插件自己的登录",
			"device.state.expired": "插件登录已过期——点「浏览器登录」重新授权",
			"device.state.unknown": "插件登录状态未知（宿主比本卡片新）",
			"device.renewFailed": "插件登录续期被拒：{reason}——点「浏览器登录」重新授权",
			"device.saveFailed": "插件登录续期成功，但没能写入本机文件：{reason}。当前会话照常用，重启后会失效——请检查磁盘与插件目录的写入权限",
			"device.unreadable": "插件保存的登录文件读不出来：{reason}",
			"device.startFailed": "打开授权页失败：{detail}",
			"device.loginFailed": "登录失败：{reason}",
			"device.loginExpired": "授权超时了，请重新点「浏览器登录」",
			"device.loginLost": "这次登录已经不在等待中了，请重新发起",
			"device.signOutFailed": "退出插件登录失败：{detail}",
			"device.signOutNote": "只删除插件自己的令牌；桌面端的登录、环境变量 PAT、另一个版本的文件都不受影响。"
		};
		/** English — account panel copy. */
		const enAccount = {
			"account.reload": "Re-read sign-in",
			"account.confirm": "Confirm online",
			"account.confirming": "Confirming…",
			"account.confirmed": "Confirmed: sign-in is valid",
			"account.confirmFailed": "Could not confirm: {detail}",
			"account.confirmNoSignIn": "There is no sign-in to confirm for this edition — sign in first, or set an environment PAT (QODERCN_PAT / QODER_PAT)",
			"account.state.ok": "OK",
			"account.state.expired": "Expired",
			"account.state.needs-app": "Unreadable",
			"account.state.signed-out": "Not signed in",
			"account.state.device": "Signed in",
			"account.deviceActive": "You are signed in with the plugin's own sign-in (browser sign-in) — the desktop client is not needed.",
			"account.deviceFrom": "from the plugin's own sign-in",
			"account.envPat": "from an environment PAT",
			"account.appFrom": "from {app}",
			"account.expiresAt": "Valid until {date}",
			"account.unsigned": "No Qoder client for this edition is installed on this machine",
			"account.expiredHint": "Sign-in has lapsed — sign in again in the Qoder client ({app}), then click Re-read sign-in",
			"account.readFail": "Could not read the local credential: {detail}. Either set an environment PAT (QODERCN_PAT / QODER_PAT), or press Re-read sign-in",
			"account.readFailDevice": "Could not read the local credential: {detail}. Either press Sign in with a browser (the plugin's own sign-in, which works without the desktop client), or set an environment PAT (QODERCN_PAT / QODER_PAT), or press Re-read sign-in",
			"account.download": "The Qoder client is missing — install {edition} from the Download section, then sign in",
			"account.downloadLink": "Download {edition}",
			"account.confirmExpired": "Confirmed: sign-in expired — sign in again in the Qoder client, then re-read",
			"account.confirmProtocolChanged": "Confirmation hit an unrecognised API shape — update the plugin (signing in again will not help)",
			"account.error": "Could not read the account states",
			"account.offer": "Offer this edition",
			"account.offerTitle": "Turning this off hides the edition's models from DSH's model picker; the sign-in, usage and model settings are kept, and turning it back on restores them.",
			"account.offerOff": "Disabled: this edition's models are not offered to the model picker",
			"account.offerError": "Could not save the edition switch: {detail}",
			"account.regionTabs": "Editions: pick which one's account, usage and models to view",
			"device.title": "Plugin sign-in",
			"device.available": "Works without the desktop client: approve a code in your browser and the plugin stores the refreshable token it gets back, in this edition's own file only.",
			"device.signIn": "Sign in with a browser",
			"device.starting": "Getting the sign-in URL…",
			"device.waiting": "Authorization page opened — waiting for approval (up to 5 minutes)",
			"device.reopen": "Open the authorization page again",
			"device.signOut": "Sign out of the plugin",
			"device.signingOut": "Signing out…",
			"device.state.ok": "Signed in to the plugin",
			"device.state.none": "This machine has no plugin sign-in",
			"device.state.expired": "The plugin sign-in has expired — press Sign in with a browser to authorize again",
			"device.state.unknown": "The plugin sign-in is in a state this card does not know (the host is newer)",
			"device.renewFailed": "The plugin sign-in could not be renewed: {reason} — press Sign in with a browser to authorize again",
			"device.saveFailed": "The plugin sign-in renewed successfully but could not be written to disk: {reason} — this session keeps working, a restart will not; check that the plugin directory is writable",
			"device.unreadable": "The plugin's saved sign-in file cannot be read: {reason}",
			"device.startFailed": "Could not open the authorization page: {detail}",
			"device.loginFailed": "Sign-in failed: {reason}",
			"device.loginExpired": "The authorization timed out — press Sign in with a browser to start again",
			"device.loginLost": "That sign-in attempt is no longer pending — start it again",
			"device.signOutFailed": "Could not sign out of the plugin: {detail}",
			"device.signOutNote": "Only the plugin's own token is deleted; the desktop client's sign-in, an environment PAT, and the other edition's file are all untouched."
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
		/**
		* Plugin-owned write route: begin this plugin's own device sign-in.
		*
		* Answers with the URL the user approves in a browser. The four routes are one
		* feature — the host mounts them as a group, all or none — so the card must
		* treat a failure to reach any of them the same way: say so, do not pretend the
		* button worked.
		*/
		const QODER_DEVICE_LOGIN_START_PATH = "/plugins/dsh-connect-qoder/device-login/start";
		/** Plugin-owned read route: one poll of a pending device sign-in. */
		const QODER_DEVICE_LOGIN_POLL_PATH = "/plugins/dsh-connect-qoder/device-login/poll";
		/** Plugin-owned write route: abandon a pending device sign-in. */
		const QODER_DEVICE_LOGIN_CANCEL_PATH = "/plugins/dsh-connect-qoder/device-login/cancel";
		/** Plugin-owned write route: delete the plugin's own stored token for a region. */
		const QODER_DEVICE_LOGIN_SIGNOUT_PATH = "/plugins/dsh-connect-qoder/device-login/signout";

		//#endregion
		//#region src/client/card-model.ts
		/**
		* 两个 YYYY-MM-DD 是否恰好相差一个日历日（跨月/跨年/闰年边界都算对）。
		*
		* **纯 UTC 日序差，绝不读本地时区**：host 侧（`token-counter.ts` 的 readHistory/gc、
		* `request-counter.ts`）已整体改用 `setDate` 日历步进、认定固定 24h 在 DST 切换日
		* 是错的（相邻日会差 23h/25h）；客户端这条渲染链曾把 `Date.parse('...T00:00:00')`
		* （本地午夜）+ `=== 24h` 方程用回来过——那会让趋势箭头在 DST 日每年静默消失一天。
		* 回归钉在 `test/token-adjacent-days.test.js`（含强制 DST 时区的边界对）。
		*/
		function areAdjacentDays(a, b) {
			const da = dayOrdinal(a);
			const db = dayOrdinal(b);
			if (da === null || db === null) return false;
			return Math.abs(db - da) === 1;
		}
		/** YYYY-MM-DD → UTC 日序数；非法返回 null。Date.UTC 会把越界分量归一化
		*  （2026-02-30 变成 03-02），所以必须读回校验各日历字段原位，否则坏日期
		*  会被算成合法相邻日。年份 0099 之类同样被这层挡住（Date.UTC 把 0-99 映射到 1900+）。 */
		function dayOrdinal(day) {
			const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
			if (match === null) return null;
			const year = Number(match[1]);
			const month = Number(match[2]);
			const date = Number(match[3]);
			const ms = Date.UTC(year, month - 1, date);
			if (Number.isNaN(ms)) return null;
			const back = new Date(ms);
			if (back.getUTCFullYear() !== year || back.getUTCMonth() !== month - 1 || back.getUTCDate() !== date) return null;
			return ms / 864e5;
		}
		/**
		* Which credential path is serving this region, as the host reported it.
		*
		* `undefined` when the host named none — an older build, or a host that has
		* resolved no credential yet. The callers then fall back to what the panel can
		* infer, which is a guess; the host's answer is not.
		*/
		function credentialKindOf(entry) {
			const kind = entry.credentialKind;
			return kind === "desktop" || kind === "device" || kind === "env" ? kind : void 0;
		}
		/**
		* Whether the DESKTOP application's credential is the one serving this region.
		*
		* The host resolves credentials in one order — the desktop store, then the
		* plugin's own, then the PAT (see `src/host/credential-cache.ts`) — and the card
		* has to answer about the credential that order actually picks. When the host
		* names the kind, that is the answer; otherwise the panel's own inference is
		* used: a region that reads the desktop store says `ok` and keeps saying so.
		*/
		function desktopCredentialInUse(entry) {
			const kind = credentialKindOf(entry);
			if (kind !== void 0) return kind === "desktop";
			return entry.state === "ok" && (entry.source === "app" || entry.source === void 0);
		}
		/**
		* The EFFECTIVE sign-in state of one region.
		*
		* The card has to answer ONE question — "am I signed in for this edition?" —
		* and on a machine that cannot read the desktop app's keychain the answer is
		* yes whenever the plugin's own credential is the one in use. Without this, a
		* macOS user who signed in through the browser read "Unreadable" in the state
		* label and "Signed in to the plugin" two lines below.
		*/
		function effectiveAccountStateOf(entry) {
			const kind = credentialKindOf(entry);
			if (kind === "device") return "device";
			if (kind !== void 0) return String(entry.state);
			return entry.device?.state === "ok" && !desktopCredentialInUse(entry) ? "device" : String(entry.state);
		}
		/**
		* Which source chip this region's credential deserves.
		*
		* ONE chip, because two of them at once ("from Qoder · from the plugin's own
		* sign-in") reads as a contradiction. The host's kind decides it when it is
		* there; otherwise the panel falls back to the source it was told about.
		*/
		function credentialChipOf(entry) {
			const kind = credentialKindOf(entry);
			if (kind === "device") return "device";
			if (kind === "env") return "env";
			if (kind === "desktop") return "app";
			if (effectiveAccountStateOf(entry) === "device") return "device";
			if (entry.source === "env-pat") return "env";
			return entry.source === "app" || entry.source === void 0 && (entry.state === "ok" || entry.state === "expired") ? "app" : void 0;
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
		* A short label for a raw daily token count: 15441 → "15.4k", 1500000 → "1.5m".
		* Uses the same K/M style as `formatContextWindowForUi` but keeps one decimal
		* for precision (a daily total, not a model spec). Below 10 000 the comma
		* separator stays — 1 500 is more legible than 1.5k.
		*/
		function formatTokenCount(n) {
			const v = Math.max(0, Math.floor(Number(n) || 0));
			if (v >= 1e6) return `${abbr(v / 1e6)}m`;
			if (v >= 1e4) return `${abbr(v / 1e3)}k`;
			return v.toLocaleString("en-US");
		}
		/** Truncate one decimal without round-up: 999.999 → "999.9", 15.0 → "15". */
		function abbr(x) {
			const int = Math.floor(x);
			const dec = Math.floor((x - int) * 10);
			return dec === 0 ? String(int) : `${int}.${dec}`;
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
		* The host sends `{ refreshedAt, refreshFailures }`; five outcomes, kept apart
		* on purpose:
		*
		* - **no failure** → `null`: the rows are the last upstream answer, and the
		*   "已更新（time）" stamp is honest.
		* - **a transient failure** (`fetch` / `credential` / `no-credential`) → the
		*   stamp still shows, marked stale: the rows on screen are real, just old.
		* - **`daily-limit`** → the rows are just as real, but retrying cannot help, so
		*   it names the allowance and its reset instead of reusing the stale wording
		*   (docs/issues/24).
		* - **`persist`** → the rows are the newest answer but the disk write was
		*   swallowed, so only their durability is wrong; it gets its own wording.
		* - **`protocol-shape-changed`** → the envelope moved and the plugin is out of
		*   date; the copy points at a plugin update, never at a re-sign.
		*
		* The protocol verdict wins over a transient one (it cannot resolve on its own);
		* `persist` and `daily-limit` each outrank a transient one.
		*/
		function refreshNoticeKey(value) {
			const failures = Array.isArray(value?.refreshFailures) ? value.refreshFailures : [];
			if (failures.length === 0) return null;
			if (failures.some((f) => f?.reason === "protocol-shape-changed")) return "protocol-shape-changed";
			if (failures.some((f) => f?.reason === "persist")) return "persist";
			if (failures.some((f) => f?.reason === "daily-limit")) return "daily-limit";
			return "transient";
		}
		/**
		* The copy key for a region whose usage the host could not read.
		*
		* A protocol-shape change is NOT "try again later": only an update fixes it,
		* and a spent daily allowance cannot be retried either (docs/issues/24).
		* Reusing the generic "unavailable" wording would leave the user retrying a
		* read that cannot succeed — the same split `refreshNoticeKey` already makes
		* for the model list. A host older than the `unavailableReason` field degrades
		* to the old copy.
		*/
		function usageUnavailableKey(entry) {
			if (entry?.unavailableReason === "protocol-shape-changed") return "usage.protocolChanged";
			if (entry?.unavailableReason === "daily-limit") return "usage.dailyLimit";
			return "usage.unavailable";
		}
		/**
		* The copy key for the offers line, when the campaigns read failed.
		*
		* Same split as {@link usageUnavailableKey}: a shape change needs the update
		* wording, a transport failure keeps the host's own reason. `null` means there
		* is nothing to say (no failure, or a rendered campaign wins over the note).
		*/
		function campaignsNoticeKey(entry) {
			if (entry?.campaignsShapeChanged === true) return "usage.promotionsProtocolChanged";
			return typeof entry?.campaignsError === "string" && entry.campaignsError !== "" ? "usage.promotionsUnavailable" : null;
		}
		/**
		* The provider-registration failure the models envelope carried, or `null`.
		*
		* The card's half of the fact the host publishes on `QODER_STATUS_PATH`: since
		* docs/issues/20 a failed registration no longer unwinds activation, so every
		* card route mounts and the roster arrives normally.
		*
		* `null` covers BOTH "registration succeeded" and "this payload does not report
		* it" — a host from before this field sends no `providerRegistration` at all,
		* and inventing a warning out of a missing field would be the false-alarm twin
		* of the silent failure this closes. Only an explicit `{ ok: false }` warns.
		*
		* The name is never empty: a missing or non-string name narrows to `'Error'`.
		*
		* @param value - the parsed models payload.
		* @returns the host's non-empty error name, or `null` when there is nothing
		*   trustworthy to warn about.
		*/
		function providerRegistrationFailure(value) {
			const registration = value?.providerRegistration;
			if (registration === null || typeof registration !== "object") return null;
			const record = registration;
			if (record.ok !== false) return null;
			return typeof record.errorName === "string" && record.errorName !== "" ? record.errorName : "Error";
		}
		/**
		* What to say about a region's plugin-owned credential, or nothing at all.
		*
		* React-free on purpose: this is the whole decision table (which state means
		* which sentence, and which of them the user must act on) and it touches no DOM
		* and no React state, so it belongs here rather than inside the panel, where a
		* DOM test would be the only thing able to reach it.
		*
		* `undefined` means "say nothing", and it covers exactly one case: a host that
		* did not report a device entry at all. That is NOT the same as `none` — `none`
		* is the host stating that this machine has no plugin token, which is what the
		* sign-in button exists for. Collapsing them would put a "not signed in" claim
		* on a panel whose host never looked.
		*
		* An unrecognised state reads as unknown rather than falling through to a
		* reassuring sentence: a newer host that grew a state this build does not know
		* must not be rendered as `ok`.
		*/
		function deviceLoginNotice(device) {
			if (device === void 0 || device === null) return void 0;
			const reason = typeof device.reason === "string" ? device.reason : "";
			switch (device.state) {
				case "none": return {
					key: "device.state.none",
					kind: "note"
				};
				case "ok": return {
					key: "device.state.ok",
					kind: "note"
				};
				case "expired": return {
					key: "device.state.expired",
					kind: "error"
				};
				case "refresh-failed": return {
					key: "device.renewFailed",
					kind: "error",
					detail: reason
				};
				case "save-failed": return {
					key: "device.saveFailed",
					kind: "error",
					detail: reason
				};
				case "unreadable": return {
					key: "device.unreadable",
					kind: "error",
					detail: reason
				};
				default: return {
					key: "device.state.unknown",
					kind: "note"
				};
			}
		}
		/**
		* Whether the panel should offer to sign out of the plugin's own credential.
		*
		* True whenever a token exists in any form — including one that has expired or
		* whose renewal was refused. Those are exactly the states a user wants to be
		* able to clear: leaving them with only a "sign in again" button would strand a
		* token on disk that they can see and cannot remove.
		*/
		function deviceLoginHasToken(device) {
			return device?.state === "ok" || device?.state === "expired" || device?.state === "refresh-failed" || device?.state === "save-failed";
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
		* Every host-route read the card performs goes through here, so the request
		* contract lives in one place. The routes serve the plugin's own `lib/`, so they
		* are same-origin and answer JSON.
		*
		* Every call sends `accept: application/json` and `credentials: "same-origin"`
		* — the routes sit behind the loopback origin check in `src/host/routes.ts`.
		*
		* The shape of a failed response is decided here and nowhere else: a non-OK
		* status throws with the host's own `error` field when present, so the card's
		* catch blocks show the real reason (docs/issues/06). A `POST` body that will
		* not parse degrades to `undefined`, never a throw; a `GET` that will not parse
		* THROWS — the reads that use it have no "no data" state to fall back to.
		*/
		/**
		* The reason to report for a refused response.
		*
		* The host answers refusals in three shapes and all must reach the reader:
		* route gates write `{ error: "origin-not-trusted" }` (a bare string), the
		* device-login handlers write `{ error: "sign-out-failed", detail: "…" }`, and
		* `writeError` writes `{ error: { message, type, code } }`. Reading only the
		* first would turn every `writeError` refusal into a bare `HTTP 500`, and
		* dropping the second's `detail` names the failure without saying what happened
		* (docs/issues/06). A shape neither branch recognises still yields the status
		* code: naming the failure is the floor, never a fabricated reason.
		*/
		function failureMessage(value, status) {
			const error = value?.error;
			const detail = value?.detail;
			if (typeof error === "string" && error !== "" && typeof detail === "string" && detail !== "") return `${error}: ${detail}`;
			if (typeof error === "string" && error !== "") return error;
			const message = error?.message;
			if (typeof message === "string" && message !== "") return message;
			return `HTTP ${status}`;
		}
		/** Read the host route at `path` and decode its JSON answer. */
		async function getJson(path, options) {
			const response = await fetch(path, {
				headers: { accept: "application/json" },
				credentials: "same-origin",
				...options?.signal === void 0 ? {} : { signal: options.signal }
			});
			const value = await response.json().catch(() => void 0);
			if (!response.ok) throw new Error(failureMessage(value, response.status));
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
				...body === void 0 ? {} : { body: JSON.stringify(body) }
			});
			const value = await response.json().catch(() => void 0);
			if (!response.ok) throw new Error(failureMessage(value, response.status));
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
			const [checkinHint, setCheckinHint] = react.useState(void 0);
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
					const hint = value.checkin;
					setCheckinHint(hint !== void 0 && hint.umidAvailable === false && typeof hint.reason === "string" && hint.reason.length > 0 ? hint.reason : void 0);
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
				}) : checkinHint !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "dsm-qoder-account-note dsm-qoder-account-note-error",
					children: t("usage.checkinUnavailable", { reason: checkinHint })
				}) : null]
			});
		}

		//#endregion
		//#region src/client/settings-write.ts
		var QoderSettingsWriteError = class extends Error {
			field;
			kind;
			constructor(field, reason, kind = "refused") {
				super(`qoder: settings field "${field}" was not persisted${reason === void 0 ? "" : `: ${reason}`}`);
				this.name = "QoderSettingsWriteError";
				this.field = field;
				this.kind = kind;
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
				throw new QoderSettingsWriteError(field, `Host save endpoint unreachable: ${String(error)}`, "refused");
			}
			if (!response.ok) {
				const detail = await response.json().catch(() => ({ error: `HTTP ${String(response.status)}` }));
				const reason = `${String(detail.errorName ?? "")} ${String(detail.error ?? "")}`.trim();
				const kind = response.status === 404 ? "absent" : "refused";
				throw new QoderSettingsWriteError(field, `Host save ${kind === "absent" ? "endpoint absent (404)" : "refused"}: ${reason === "" ? `HTTP ${String(response.status)}` : reason}`, kind);
			}
			const detail = await response.json().catch(() => void 0);
			if (detail !== void 0 && detail.ok === false) throw new QoderSettingsWriteError(field, `Host read-back mismatch: ${`${String(detail.errorName ?? "")} ${String(detail.error ?? "")}`.trim()}`, "refused");
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
		* Read one field back as a MERGE BASE, telling "absent" apart from "unreadable".
		*
		* `fieldSnapshot` collapses both into `null`, which is fine for a read-back
		* COMPARISON (an unreadable field simply does not match). It is NOT fine for a
		* merge base: an unreadable snapshot means the sibling regions are UNKNOWN, and
		* merging the posted map on top of an empty base drops them — exactly the
		* damage the per-region rule exists to prevent. A field the Host has not
		* materialized yet is NOT unreadable: the snapshot comes back without it, and
		* that is a base of `{}` (there are no siblings to preserve).
		*/
		function fieldSnapshotBase(scope, field) {
			try {
				return {
					readable: true,
					value: scope.getSnapshot().value?.[field] ?? null
				};
			} catch {
				return {
					readable: false,
					value: null
				};
			}
		}
		/**
		* Write one settings field, then confirm the value actually landed.
		*
		* The Host endpoint goes FIRST — it is the only writer that persists in
		* the host's silent-failure mode and, for the per-region field, the only
		* one that preserves the sibling region. A `scope.set` runs either as a
		* mirror refresh after a confirmed endpoint write, or — only when the
		* endpoint answered **404** (a host that does not serve the route at all) —
		* as the degraded writer. The degraded value is then read back against the
		* scope's own snapshot, which can only prove "the scope holds it", not "the
		* document holds it": that is exactly the lie that used to surface as a
		* false "已保存", so it is returned as an {@link UnconfirmedSave} rather than
		* passed off as a clean save. A **definitive** refusal (503 settings service
		* unavailable, 500, 400, or a read-back mismatch) is NOT papered over: it
		* throws, and the card shows a failed save.
		*
		* @returns the authoritative value the endpoint read back (a confirmed
		*   save), or an {@link UnconfirmedSave} when only the scope delivered it on
		*   a 404. Throws when the endpoint definitively refused, or when it was
		*   absent and the scope could not deliver a matching value either.
		*/
		async function writeSettingsField(scope, field, value) {
			let hostError;
			try {
				const authoritative = await saveFieldViaHost(field, value);
				try {
					await scope.set(field, authoritative);
				} catch {}
				return authoritative;
			} catch (error) {
				hostError = error;
			}
			if (hostError instanceof QoderSettingsWriteError && hostError.kind === "absent") {
				let nextValue = value;
				if (field === "enabledModelIds") {
					const base = fieldSnapshotBase(scope, field);
					if (!base.readable) throw new QoderSettingsWriteError(field, "the current per-region value could not be read, so the sibling regions could not be preserved — nothing was written", "refused");
					nextValue = {
						...base.value,
						...value
					};
				}
				let scopeDelivered = false;
				try {
					scopeDelivered = await scope.set(field, nextValue) !== false;
				} catch {
					scopeDelivered = false;
				}
				if (scopeDelivered) {
					const readBack = fieldSnapshot(scope, field);
					if (field === "enabledModelIds" ? Object.keys(nextValue).every((regionId) => JSON.stringify(readBack?.[regionId]) === JSON.stringify(nextValue[regionId])) : JSON.stringify(readBack) === JSON.stringify(nextValue)) return {
						unconfirmed: true,
						value: nextValue
					};
				}
			}
			throw hostError instanceof Error ? hostError : new QoderSettingsWriteError(field, "neither the Host save endpoint nor the settings scope persisted the value");
		}

		//#endregion
		//#region src/client/device-login-panel.tsx
		/**
		* The plugin's own sign-in, for the selected edition.
		*
		* This is the card half of the third credential source: the plugin's own
		* refreshable token, obtained by approving a code in a browser, for the machines
		* where there is no Qoder desktop client to read a login out of. It is reported
		* BESIDE the account row's state, never merged into it — the application's
		* sign-in and the plugin's token are two credentials with two lifetimes, and a
		* region can be signed out of the application while this token works fine.
		*
		* Two components, deliberately:
		*
		* - the outer gate calls NO hooks, so it can return `null` before any state
		*   exists (the `composer-usage-pill.tsx` pattern, and for the same reason: an
		*   early return above a hook changes the hook count between renders).
		* - the inner component holds every hook and is only mounted once there is a
		*   region and a `device` entry to talk about.
		*
		* Absent `device` means the host did not report one — a build older than the
		* routes below. It renders NOTHING rather than "not signed in", because that
		* sentence would be a claim this card cannot make.
		*
		* Every failure names itself. The start POST, each poll, and the sign-out each
		* carry the host's own reason into a paragraph, and the waiting state keeps a
		* plain link to the authorization page for the case where the popup was blocked.
		* A sign-in button that quietly does nothing is the exact shape this repo's
		* first red line forbids.
		*/
		/** How often a pending approval is checked. The host's own attempt lives 5 minutes. */
		const POLL_MS$1 = 2e3;
		/**
		* The gate. No hooks here, so returning `null` is safe.
		*
		* `region` is required as well as `device`: the three routes below are all
		* addressed by region, and a block with a button that cannot name its target
		* would be worse than no block.
		*/
		function QoderDeviceLoginPanel({ t, region, device, onChanged }) {
			if (region === void 0 || device === void 0) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActiveDeviceLogin, {
				t,
				region,
				device,
				onChanged
			});
		}
		function ActiveDeviceLogin({ t, region, device, onChanged }) {
			const [busy, setBusy] = react.useState("idle");
			const [authUrl, setAuthUrl] = react.useState(void 0);
			const [problem, setProblem] = react.useState(void 0);
			const translate = react.useRef(t);
			translate.current = t;
			const changed = react.useRef(onChanged);
			changed.current = onChanged;
			const live = react.useRef({
				busy,
				region
			});
			live.current = {
				busy,
				region
			};
			react.useEffect(() => {
				return () => {
					const current = live.current;
					if (current.busy !== "waiting") return;
					postJson(QODER_DEVICE_LOGIN_CANCEL_PATH, { region: current.region }).catch(() => void 0);
				};
			}, []);
			react.useEffect(() => {
				if (busy !== "waiting") return;
				let alive = true;
				let timer;
				const tick = async () => {
					try {
						const value = await getJson(`${QODER_DEVICE_LOGIN_POLL_PATH}?region=${encodeURIComponent(region)}`);
						if (!alive) return;
						const state = typeof value?.state === "string" ? value.state : "";
						if (state === "pending") {} else if (state === "authorized") {
							setBusy("idle");
							setAuthUrl(void 0);
							setProblem(void 0);
							changed.current?.();
							return;
						} else if (state === "expired") {
							setBusy("idle");
							setAuthUrl(void 0);
							setProblem(translate.current("device.loginExpired"));
							return;
						} else if (state === "idle") {
							setBusy("idle");
							setAuthUrl(void 0);
							setProblem(translate.current("device.loginLost"));
							return;
						} else {
							const reason = typeof value?.reason === "string" ? value.reason : "";
							setBusy("idle");
							setAuthUrl(void 0);
							setProblem(translate.current("device.loginFailed", { reason }));
							return;
						}
					} catch (error) {
						if (!alive) return;
						setBusy("idle");
						setAuthUrl(void 0);
						setProblem(translate.current("device.loginFailed", { reason: describeThrown(error) }));
						return;
					}
					timer = window.setTimeout(() => {
						tick();
					}, POLL_MS$1);
				};
				tick();
				return () => {
					alive = false;
					if (timer !== void 0) window.clearTimeout(timer);
				};
			}, [busy, region]);
			const start = react.useCallback(async () => {
				setBusy("starting");
				setProblem(void 0);
				try {
					const value = await postJson(QODER_DEVICE_LOGIN_START_PATH, { region });
					const url = typeof value?.authUrl === "string" ? value.authUrl : "";
					if (url === "") throw new Error(translate.current("device.startFailed", { detail: "" }));
					setAuthUrl(url);
					setBusy("waiting");
					window.open(url, "_blank", "noopener,noreferrer");
				} catch (error) {
					setBusy("idle");
					setProblem(translate.current("device.startFailed", { detail: describeThrown(error) }));
				}
			}, [region]);
			const signOut = react.useCallback(async () => {
				setBusy("signing-out");
				setProblem(void 0);
				try {
					await postJson(QODER_DEVICE_LOGIN_SIGNOUT_PATH, { region });
					setBusy("idle");
					changed.current?.();
				} catch (error) {
					setBusy("idle");
					setProblem(translate.current("device.signOutFailed", { detail: describeThrown(error) }));
				}
			}, [region]);
			const notice = deviceLoginNotice(device);
			if (notice === void 0) return null;
			const hasToken = deviceLoginHasToken(device);
			const note = t(notice.key, { reason: notice.detail ?? "" });
			const busyLabel = busy === "starting" ? t("device.starting") : t("device.signIn");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsm-qoder-device",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-qoder-account-row",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-qoder-account-id",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsm-qoder-account-name",
									children: t("device.title")
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "dsm-qoder-usage-spacer" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsm-qoder-button",
								disabled: busy === "starting" || busy === "signing-out",
								onClick: () => {
									start();
								},
								children: busyLabel
							}),
							hasToken ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsm-qoder-button",
								disabled: busy !== "idle",
								onClick: () => {
									signOut();
								},
								children: busy === "signing-out" ? t("device.signingOut") : t("device.signOut")
							}) : null
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: `dsm-qoder-account-note${notice.kind === "error" ? " dsm-qoder-account-note-error" : ""}`,
						children: note
					}),
					problem !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-qoder-account-note dsm-qoder-account-note-error",
						children: problem
					}) : null,
					busy === "waiting" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						className: "dsm-qoder-account-note",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("device.waiting") }), authUrl !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react.Fragment, { children: [" · ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
							href: authUrl,
							target: "_blank",
							rel: "noreferrer",
							title: authUrl,
							children: t("device.reopen")
						})] }) : null]
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-qoder-account-note",
						children: hasToken ? t("device.signOutNote") : t("device.available")
					})
				]
			});
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
			const loadSeq = react.useRef(0);
			const [loadError, setLoadError] = react.useState(void 0);
			const load = react.useCallback(async () => {
				const seq = ++loadSeq.current;
				try {
					const value = await getJson(QODER_ACCOUNT_PATH);
					if (!mounted.current || seq !== loadSeq.current) return;
					const regions = Array.isArray(value.regions) ? value.regions : [];
					setAccounts(regions);
					const map = value.enabledRegions !== null && typeof value.enabledRegions === "object" ? value.enabledRegions : Object.fromEntries(regions.filter((entry) => entry.region !== void 0).map((entry) => [entry.region, entry.enabled !== false]));
					setEnabledRegions(map);
					setStatus("ready");
					setLoadError(void 0);
				} catch (error) {
					if (!mounted.current || seq !== loadSeq.current) return;
					setLoadError(describeThrown(error));
					setStatus("error");
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
						const detail = typeof value.detail === "string" && value.detail !== "" ? value.detail : void 0;
						setConfirmState((current) => ({
							...current,
							[regionId]: {
								kind: detail === void 0 ? "no-sign-in" : "unavailable",
								detail
							}
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
			const dotClassOf = (state) => state === "ok" || state === "device" ? " dsm-qoder-region-dot-ok" : state === "expired" ? " dsm-qoder-region-dot-expired" : state === "needs-app" ? " dsm-qoder-region-dot-needs" : "";
			const stateLabelOf = (entry) => t(`account.state.${effectiveAccountStateOf(entry)}`);
			const activeEntry = accounts.find((entry) => entry.region === activeRegion) ?? accounts[0];
			const activeRegionId = activeEntry?.region;
			const activeEdition = activeEntry?.regionName ?? activeRegionId ?? "";
			const deviceSignInOffered = activeRegionId !== void 0 && deviceLoginNotice(activeEntry?.device) !== void 0;
			const activeEffectiveState = activeEntry !== void 0 ? effectiveAccountStateOf(activeEntry) : "";
			const deviceActive = activeEntry?.device?.state === "ok";
			const activeOffered = activeEntry !== void 0 && activeRegionId !== void 0 && enabledRegions[activeRegionId] !== false;
			const activeResult = activeEntry !== void 0 && activeRegionId !== void 0 ? confirmState[activeRegionId] : void 0;
			const activeIdentity = activeEntry?.identity ?? void 0;
			const activeHasIdentity = activeIdentity !== void 0 && activeIdentity !== null;
			const activeName = activeHasIdentity ? String(activeIdentity.name ?? "").trim() : "";
			const activeMeta = [];
			if (activeEntry !== void 0) {
				const chip = credentialChipOf(activeEntry);
				if (chip === "device") activeMeta.push(t("account.deviceFrom"));
				else if (chip === "env") activeMeta.push(t("account.envPat"));
				else if (chip === "app" && typeof activeEntry.appName === "string" && activeEntry.appName !== "") activeMeta.push(t("account.appFrom", { app: activeEntry.appName }));
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
								className: `dsm-qoder-region-dot${dotClassOf(effectiveAccountStateOf(entry))}`
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
						children: loadError === void 0 ? t("account.error") : `${t("account.error")} (${loadError})`
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
							(activeEntry.source !== void 0 || deviceActive) && activeRegionId !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
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
					activeEffectiveState === "device" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-qoder-account-note",
						children: t("account.deviceActive")
					}) : null,
					activeEffectiveState === "needs-app" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-qoder-account-note dsm-qoder-account-note-error",
						children: t(deviceSignInOffered ? "account.readFailDevice" : "account.readFail", { detail: activeEntry.detail ?? "" })
					}) : null,
					activeEffectiveState === "expired" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
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
					activeEffectiveState === "signed-out" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
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
					activeResult?.kind === "protocol-shape-changed" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-qoder-account-note dsm-qoder-account-note-error",
						children: t("account.confirmProtocolChanged")
					}) : null,
					activeResult?.kind === "unavailable" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-qoder-account-note dsm-qoder-account-note-error",
						children: t("account.confirmFailed", { detail: activeResult.detail ?? "" })
					}) : null,
					activeResult?.kind === "no-sign-in" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-qoder-account-note dsm-qoder-account-note-error",
						children: t("account.confirmNoSignIn")
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(QoderDeviceLoginPanel, {
						t,
						region: activeRegionId,
						device: activeEntry.device,
						onChanged: () => {
							reload();
							onReconciled?.();
						}
					})
				] }) : null }), offerError !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "dsm-qoder-account-note dsm-qoder-account-note-error",
					children: t("account.offerError", { detail: offerError })
				}) : null]
			})] });
		}

		//#endregion
		//#region src/client/token-history-chart.tsx
		/**
		* 迷你柱状图 — 7 天 token 消耗趋势。
		*
		* SVG 手绘（DSH 的 UI 组件库没有图表组件）。柱高按当天 token 数占窗口内最大值的比例，
		* 颜色按消耗量分三档：低（绿）、中（蓝）、高（橙）。底部标注窗口总量与日均。
		*
		* 数据源：`tokensHistory`（host 下发的每日记录，按 day 升序，只含真实有数据的日子）。
		*
		* ## 约束
		*
		* - **只信传入的 `history`**：缺失的日子 host 不会补 0（见
		*   `src/host/token-counter.ts` 的 `readHistory`），所以这里的「总量 / 日均 / 趋势」
		*   全部按 `history.length` 这一**实际有数据的天数**计算。早期实现 host 侧补 0，
		*   新用户前 6 天都被摊薄成当日值的 1/7；现在没有补 0，口径自然对齐。
		* - **保持宽高比**：`preserveAspectRatio="none"` 会把柱子按容器宽度横向拉伸，
		*   圆角（rx）在非等比缩放下变成椭圆。这里改用 `xMidYMid` + 固定 viewBox 宽度，
		*   容器宽于图表时两端留白、窄于图表时整体缩放，形状不走样。
		*
		* 无障碍：SVG role="img" + aria-label；每根柱子带 <title>（日期 + 数值），
		* 供鼠标 hover 与读屏软件逐柱朗读；另外附一份可见的数据表格（仅读屏可见），
		* 因为 <title> 在不同读屏/浏览器组合下并不可靠。
		*/
		/** 柱子颜色阈值：按窗口内最大值的比例分三档。 */
		function barColorForRatio(ratio) {
			if (ratio >= .75) return "var(--dsw-alias-state-warn-primary, #e8850c)";
			if (ratio >= .4) return "var(--dsw-alias-state-business-primary, #3b82f6)";
			return "var(--dsw-alias-state-success-primary, #22c55e)";
		}
		/** 窗口内总量求和。 */
		function weeklyTotal(history) {
			return history.reduce((sum, r) => sum + r.total, 0);
		}
		/** 日均（按实际有数据的天数，不是固定 7 天）。 */
		function dailyAverage(history) {
			if (history.length === 0) return 0;
			return Math.round(weeklyTotal(history) / history.length);
		}
		/** 趋势箭头：最后一天 vs 前一天（仅当两者日历连续时才成立）。 */
		function trendArrow(history) {
			if (history.length < 2) return null;
			const yesterday = history[history.length - 2];
			const today = history[history.length - 1];
			if (!yesterday || !today) return null;
			if (!areAdjacentDays(yesterday.day, today.day)) return null;
			if (today.total === 0 && yesterday.total === 0) return "flat";
			const diff = today.total - yesterday.total;
			if (diff === 0) return "flat";
			return diff > 0 ? "up" : "down";
		}
		/** 趋势百分比。前一天为 0 或不相邻时不编造百分比，返回 null。 */
		function trendPercent(history) {
			if (history.length < 2) return null;
			const yesterday = history[history.length - 2];
			const today = history[history.length - 1];
			if (!yesterday || !today) return null;
			if (!areAdjacentDays(yesterday.day, today.day)) return null;
			if (yesterday.total === 0) return null;
			const diff = today.total - yesterday.total;
			return Math.round(diff / yesterday.total * 100);
		}
		function TokenHistoryChart({ history, t }) {
			if (history.length === 0) return null;
			const max = Math.max(...history.map((r) => r.total), 1);
			const total = weeklyTotal(history);
			const avg = dailyAverage(history);
			const trend = trendArrow(history);
			const trendPct = trendPercent(history);
			const chartHeight = 24;
			const barWidth = 14;
			const chartWidth = history.length * 18 - 4;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					display: "flex",
					flexDirection: "column",
					gap: 4,
					marginTop: 6
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							alignItems: "baseline",
							justifyContent: "space-between"
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: {
								fontSize: 11,
								opacity: .7
							},
							children: t("usage.tokensHistoryTitle")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: {
								fontSize: 11,
								display: "flex",
								alignItems: "center",
								gap: 6
							},
							children: trend === "up" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: { color: "var(--dsw-alias-state-warn-primary, #e8850c)" },
								children: trendPct !== null ? t("usage.tokensTrendUp", { pct: trendPct }) : "↑"
							}) : trend === "down" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: { color: "var(--dsw-alias-state-success-primary, #22c55e)" },
								children: trendPct !== null ? t("usage.tokensTrendDown", { pct: Math.abs(trendPct) }) : "↓"
							}) : trend === "flat" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: { opacity: .5 },
								children: t("usage.tokensTrendFlat")
							}) : null
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
						width: "100%",
						viewBox: `0 0 ${chartWidth} ${chartHeight}`,
						height: chartHeight,
						preserveAspectRatio: "xMidYMid meet",
						role: "img",
						"aria-label": t("usage.tokensHistoryTitle"),
						style: { display: "block" },
						children: history.map((r, i) => {
							const ratio = r.total / max;
							const barHeight = Math.max(2, ratio * chartHeight);
							const x = i * 18;
							const y = chartHeight - barHeight;
							return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
								x,
								y,
								width: barWidth,
								height: barHeight,
								rx: 2,
								fill: barColorForRatio(ratio),
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("title", { children: t("usage.tokensDayTooltip", {
									day: r.day,
									total: formatTokenCount(r.total)
								}) })
							}, r.day);
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("table", {
						className: "dsm-qoder-visually-hidden",
						style: { borderCollapse: "collapse" },
						"aria-label": t("usage.tokensHistoryTitle"),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tr", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
							scope: "col",
							children: t("usage.tokensHistoryTitle")
						}) }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tbody", { children: history.map((r) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
							scope: "row",
							children: r.day
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: formatTokenCount(r.total) })] }, r.day)) })]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							justifyContent: "space-between",
							fontSize: 10,
							opacity: .6
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("usage.tokensWeeklyTotal", { total: formatTokenCount(total) }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("usage.tokensDailyAvg", { avg: formatTokenCount(avg) }) })]
					})
				]
			});
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
				const results = [];
				try {
					results.push(await persist("enabledModelIds", this.staged.enabledIds));
					results.push(await persist("imageOverrides", this.staged.imageOverrides));
					results.push(await persist("useMaximumContextWindow", this.staged.maxWindow));
					this.saved = {
						imageOverrides: { ...this.staged.imageOverrides },
						maxWindow: this.staged.maxWindow,
						enabledIds: { ...this.staged.enabledIds }
					};
					const unconfirmed = results.some((result) => result !== null && typeof result === "object" && result.unconfirmed === true);
					this.lastSave = unconfirmed ? {
						ok: true,
						confirmed: false
					} : { ok: true };
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
					children: t(usageUnavailableKey(entry))
				})
			});
			const packages = Array.isArray(entry.dedicatedPackages) ? entry.dedicatedPackages : [];
			const campaigns = Array.isArray(entry.campaigns) ? entry.campaigns : [];
			const hasAny = entry.userQuota !== void 0 || entry.addOnQuota !== void 0 || packages.length > 0;
			const campaignsNotice = campaigns.length === 0 ? campaignsNoticeKey(entry) : null;
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
						className: "dsm-qoder-button dsm-qoder-disclosure",
						"aria-expanded": false,
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
						className: "dsm-qoder-button dsm-qoder-disclosure",
						"aria-expanded": true,
						onClick: onCampaignsToggle,
						children: t("usage.promoCollapse")
					}) : null] }),
					campaignsNotice !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-qoder-account-note dsm-qoder-account-note-error",
						children: t(campaignsNotice, campaignsNotice === "usage.promotionsUnavailable" ? { reason: entry.campaignsError ?? "" } : void 0)
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { className: "dsm-qoder-usage-sep" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						className: "dsm-qoder-usage-local",
						children: [
							entry.requestsUnavailable === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-qoder-usage-local-unavailable",
								children: t("usage.requestsUnavailable")
							}) : t("usage.requestsToday", { count: entry.requestsToday ?? 0 }),
							entry.tokensToday !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [" · ", t("usage.tokensToday", { tokens: formatTokenCount(entry.tokensToday) })] }) : null,
							entry.requestsExhausted === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-qoder-usage-local-note",
								children: t("usage.requestsExhausted")
							}) : null,
							entry.tokensCachedToday !== void 0 && entry.tokensCachedToday > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-qoder-usage-local-note",
								children: t("usage.tokensCachedToday", { cached: formatTokenCount(entry.tokensCachedToday) })
							}) : null
						]
					}),
					entry.tokensHistory && entry.tokensHistory.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TokenHistoryChart, {
						history: entry.tokensHistory,
						t
					}) : null
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
			const [providerFailure, setProviderFailure] = react.useState(null);
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
					setProviderFailure(providerRegistrationFailure(value));
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
							providerFailure !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dsm-qoder-error",
								children: t("row.providerRegistrationFailed", { reason: providerFailure })
							}) : null,
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
								className: "dsm-qoder-roster",
								children: [visibleModels.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
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
								}) : null, /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
											children: snap.lastSave.ok === true ? snap.lastSave.confirmed === false ? t("row.savedUnconfirmed") : t("row.saved") : `${t("row.failed")}: ${snap.lastSave.reason}`
										}) : dirty ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "dsm-qoder-state",
											children: t("row.unsaved")
										}) : null
									]
								})]
							}),
							offPeakWindow != null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dsm-qoder-hint",
								children: t("row.offPeakHint", {
									window: `${offPeakWindow.windowStart}–${offPeakWindow.windowEnd}`,
									zone: typeof offPeakWindow.timezone === "string" ? offPeakWindow.timezone : "Asia/Shanghai"
								})
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
										children: refreshFailure === "protocol-shape-changed" ? t("row.protocolChanged") : refreshFailure === "persist" ? t("row.refreshNotPersisted") : t(refreshFailure === "transient" ? "row.refreshStale" : refreshFailure === "daily-limit" ? "row.refreshDailyLimitStale" : "row.refreshed", { time: new Date(refreshedAt).toLocaleTimeString() })
									}) : refreshFailure !== null && !refreshing ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dsm-qoder-state",
										title: refreshFailure === "protocol-shape-changed" || refreshFailure === "persist" || refreshFailure === "daily-limit" ? void 0 : t("row.refreshFailed", { reason: refreshFailure }),
										children: refreshFailure === "protocol-shape-changed" ? t("row.protocolChanged") : refreshFailure === "daily-limit" ? t("row.refreshDailyLimit") : t("row.refreshFailed", { reason: refreshFailure })
									}) : null
								]
							})
						]
					}) : null
				})]
			});
		}

		//#endregion
		//#region src/client/pill-model.ts
		/**
		* 对话框用量胶囊的纯模型层（无 JSX，可被 Node 测试直接 import）。
		*
		* 从 `composer-usage-pill.tsx` 拆出：那个文件是 `.tsx`，Node 的原生 type-stripping
		* 不解析 JSX，所以纯函数若留在那里，`node --test` 无法 import。凡是「给定输入算出
		* 输出」的逻辑都住这里；`.tsx` 只做渲染与 hook。
		*/
		/** 与 Plugins 页卡片 `QuotaBlock` 的 warn 阈值同源（已用比例 0.8 = 剩余 20%）。 */
		const WARN_SHARE = .8;
		/** 座席接受的 provider id（区域）。`qoder` 是国际版。 */
		const QODER_REGIONS = ["qoder-cn", "qoder"];
		const isQoderRegion = (value) => typeof value === "string" && QODER_REGIONS.includes(value);
		/** 胶囊正文的区域前缀。未知回落 "Qoder" 而非报错。 */
		const REGION_PREFIX = {
			"qoder-cn": "Qoder CN",
			qoder: "Qoder"
		};
		const regionPrefixOf = (region) => {
			if (typeof region === "string") {
				const hit = REGION_PREFIX[region];
				if (typeof hit === "string") return hit;
			}
			return "Qoder";
		};
		/** 数字窄化：是有限数字才认，其余按缺失处理。 */
		const num = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;
		/**
		* 剩余 Credits，`0` 是有效读数（耗尽），只有缺失/非有限才是 null。
		* `remaining` 缺失时可用 used/total 反推，仍是上游给的原始数字的差。
		*/
		const remainingOf = (quota) => {
			const remaining = num(quota?.remaining);
			if (remaining !== null) return remaining;
			const total = num(quota?.total);
			const used = num(quota?.used);
			if (total !== null && used !== null) return total - used;
			return null;
		};
		/** 千分位格式，最多 1 位小数；未知显示 —。 */
		const formatCredits = (value) => {
			if (value === null) return "—";
			return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
		};
		/** 一条额度是否有可用总额（决定它算不算「查不到」）。 */
		const usableTotal = (quota) => (num(quota?.total) ?? 0) > 0;
		/**
		* 一条额度的分级色档。阈值与卡片 `QuotaBlock` 一致：
		* `total > 0` 且 `remaining <= 0` → 耗尽；已用比例 `>= 0.8` → 黄；否则绿；
		* 缺字段（total 非正、used/remaining/percentage 皆未知）→ 灰。
		*/
		function tierOfQuota(quota) {
			if (quota == null) return "unknown";
			const total = num(quota.total);
			const remaining = num(quota.remaining);
			const percentage = num(quota.percentage);
			if (total === null || total <= 0) return "unknown";
			if (remaining !== null && remaining <= 0) return "exhausted";
			if (percentage !== null) return percentage >= .8 ? "warn" : "ok";
			const used = num(quota.used);
			if (used !== null) return used / total >= .8 ? "warn" : "ok";
			if (remaining !== null) return (total - remaining) / total >= .8 ? "warn" : "ok";
			return "unknown";
		}
		/**
		* 候选选择：`next` 优先于 `lastUsed`，但一个空的 `next`（切换的瞬态）不得遮蔽
		* 仍可用的 `lastUsed`——否则切模型的那几帧胶囊会消失（sensenova 踩过）。
		*/
		function candidateOf(projection) {
			const p = projection ?? {};
			const usable = (c) => c !== null && c !== void 0 && (typeof c.provider === "string" || typeof c.model === "string");
			if (usable(p.next)) return p.next ?? void 0;
			if (usable(p.lastUsed)) return p.lastUsed ?? void 0;
		}
		/** 会话当前指向的 provider（区域），`next` 优先。 */
		function selectedRegionOf(projection) {
			const provider = candidateOf(projection)?.provider;
			return typeof provider === "string" && provider !== "" ? provider : void 0;
		}
		/**
		* 主额度：套餐内 Credits 可用就优先，否则（CN 免费层 plan=0）回落个人资源包。
		* 返回的 `known` 区分「查不到」（false）与「真的是 0」（true，走 `0` 而非 `—`）。
		*/
		function primaryQuotaOf(region) {
			if (region == null) return {
				quota: void 0,
				known: false
			};
			const plan = region.userQuota;
			if (plan != null && usableTotal(plan)) return {
				quota: plan,
				known: true
			};
			if (region.addOnQuota != null) return {
				quota: region.addOnQuota,
				known: true
			};
			return {
				quota: void 0,
				known: false
			};
		}
		/** `modelSelection` 里当前选中的模型标识（id 或显示名），无则 undefined。 */
		function selectedModelOf(projection) {
			const model = candidateOf(projection)?.model;
			return typeof model === "string" && model !== "" ? model : void 0;
		}
		/**
		* 在（已按 region 过滤的）名册里找当前选中的模型。
		*
		* `projection.model` 可能是模型 id 也可能是显示名，两份都试；都不命中返回
		* undefined——调用方此时**不显示错峰信息**，因为声称折扣必须精确，猜不得。
		*/
		function matchingModel(rows, modelKey) {
			if (typeof modelKey !== "string" || modelKey === "") return void 0;
			if (!Array.isArray(rows)) return void 0;
			return rows.find((m) => m != null && (m.id === modelKey || m.name === modelKey));
		}
		/** 胶囊里最多列出几个新模型名（第三个之后折叠成省略号）。 */
		const NEW_MODEL_LIMIT = 3;
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
		function newModelsOf(rows, newIds) {
			if (!Array.isArray(rows) || !Array.isArray(newIds)) return [];
			const ids = new Set(newIds.filter((id) => typeof id === "string" && id !== ""));
			if (ids.size === 0) return [];
			return rows.filter((row) => row != null && ids.has(row.id));
		}
		/**
		* 新模型在胶囊/面板里的显示名：优先显示名，缺失回落 id；超过
		* {@link NEW_MODEL_LIMIT} 个只留前几个（面板宽度有限，名字是举例不是清单）。
		*/
		function newModelNamesOf(rows, limit = 3) {
			return rows.slice(0, Math.max(0, limit)).map((row) => typeof row.name === "string" && row.name !== "" ? row.name : row.id);
		}
		/**
		* 当前模型的错峰状态。`promotion` 缺失/非对象（含 `null`，与卡片同裁）→ undefined，
		* 面板不画错峰块；有 promotion 但不在窗口内 → `{active:false}`，画「未生效」而非假装
		* 在打折。`rate` 用卡片同一 `rateAt`/`rateLabelOf`，保证两屏费率一致。
		*/
		function offPeakSummary(model, now, t) {
			if (model === void 0) return void 0;
			const promo = model.promotion;
			if (promo === null || typeof promo !== "object") return void 0;
			const state = offPeakState(model, now);
			if (state === void 0) return void 0;
			const rate = rateLabelOf(t, rateAt(model, now)) ?? "";
			const window = [promo.windowStart, promo.windowEnd].filter((value) => typeof value === "string" && value !== "").join("–");
			return {
				active: state.active,
				remainingSeconds: state.remainingSeconds,
				rate,
				window
			};
		}

		//#endregion
		//#region src/client/composer-usage-pill.tsx
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
		/** 轮询间隔：5 分钟。余额是存量，秒级轮询只会闪数字。 */
		const POLL_MS = 3e5;
		/** 面板元素 id，供 a11y（`aria-controls` / 测试查询）。 */
		const POPOVER_ID = "dsh-connect-qoder-composer-pill-popover";
		const TIER_DOT = {
			ok: "var(--dsw-alias-state-success-primary, #12b76a)",
			warn: "var(--dsw-alias-state-warn-primary, #f59e0b)",
			exhausted: "var(--dsw-alias-state-error-primary, #d92d20)",
			unknown: "var(--dsw-alias-label-tertiary, #999)"
		};
		const TIER_INK = {
			ok: "var(--dsw-alias-label-primary, #e6e6e6)",
			warn: "var(--dsw-alias-label-primary, #e6e6e6)",
			exhausted: "var(--dsw-alias-state-error-primary, #d92d20)",
			unknown: "var(--dsw-alias-label-tertiary, #999)"
		};
		function ActiveUsagePill({ t, region, modelKey }) {
			const [open, setOpen] = react.useState(false);
			const [usage, setUsage] = react.useState(null);
			const [loadedOnce, setLoadedOnce] = react.useState(false);
			const [stale, setStale] = react.useState(false);
			const [models, setModels] = react.useState([]);
			const [newModelIds, setNewModelIds] = react.useState([]);
			const [clock, setClock] = react.useState(() => /* @__PURE__ */ new Date());
			const mounted = react.useRef(true);
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
					const value = await getJson(QODER_USAGE_PATH);
					if (!isCurrent() || !mounted.current) return;
					const regions = Array.isArray(value.regions) ? value.regions : [];
					setUsage(regions.find((entry) => entry.region === region) ?? null);
					setLoadedOnce(true);
					setStale(false);
				} catch {
					if (!isCurrent() || !mounted.current) return;
					setLoadedOnce(true);
					setStale(true);
				}
			}, [region]);
			const loadModels = react.useCallback(async () => {
				modelGeneration.current += 1;
				const mine = modelGeneration.current;
				try {
					const value = await getJson(QODER_MODELS_PATH);
					if (modelGeneration.current !== mine || !mounted.current) return;
					setModels(Array.isArray(value.models) ? value.models : []);
					setNewModelIds(Array.isArray(value.newModelIds) ? value.newModelIds.filter((id) => typeof id === "string" && id !== "") : []);
				} catch (error) {
					console.warn("dsh-connect-qoder: composer pill could not read the model list", error);
				}
			}, []);
			react.useEffect(() => {
				load();
				loadModels();
				const timer = window.setInterval(() => {
					load();
				}, POLL_MS);
				const modelsTimer = window.setInterval(() => {
					loadModels();
				}, POLL_MS);
				return () => {
					window.clearInterval(timer);
					window.clearInterval(modelsTimer);
				};
			}, [load, loadModels]);
			const hasActiveWindow = models.some((model) => model.promotion?.active === true);
			react.useEffect(() => {
				if (!hasActiveWindow) return;
				setClock(/* @__PURE__ */ new Date());
				const timer = window.setInterval(() => {
					setClock(/* @__PURE__ */ new Date());
				}, 1e3);
				return () => {
					window.clearInterval(timer);
				};
			}, [hasActiveWindow]);
			react.useEffect(() => {
				if (!open) return;
				const onPointerDown = (event) => {
					const target = event.target;
					if (!(target instanceof Node)) return;
					const root = document.querySelector("[data-dsh-qoder-pill-root]");
					if (root !== null && root.contains(target)) return;
					setOpen(false);
				};
				const onKeyDown = (event) => {
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
			const display = remaining === null ? "—" : formatCredits(remaining);
			const prefix = regionPrefixOf(region);
			const exhausted = tier === "exhausted";
			const totalNum = num(quota?.total);
			const usedNum = num(quota?.used);
			const pctRaw = num(quota?.percentage);
			const pct = pctRaw !== null ? pctRaw : totalNum !== null && totalNum > 0 && usedNum !== null ? Math.min(1, Math.max(0, usedNum / totalNum)) : null;
			const pctText = pct === null ? "—" : `${Math.round(pct * 100)}%`;
			const pctColor = TIER_DOT[tier];
			const checkin = usage?.checkin;
			const regionModels = models.filter((model) => model.region === region);
			const currentModel = matchingModel(regionModels, modelKey);
			const offPeak = offPeakSummary(currentModel, clock, t);
			const newRows = newModelsOf(regionModels, newModelIds);
			const newNames = newModelNamesOf(newRows);
			const newTooltip = newNames.length === 0 ? void 0 : `${t("pill.newModelsTitle")}${newNames.join(t("pill.newModelsSep"))}`;
			const [claimBusy, setClaimBusy] = react.useState(false);
			const [claimFailedMessage, setClaimFailedMessage] = react.useState(void 0);
			const claim = react.useCallback(async () => {
				setClaimBusy(true);
				setClaimFailedMessage(void 0);
				try {
					await postJson(`${QODER_CHECKIN_PATH}?region=${encodeURIComponent(region)}`);
					await load();
				} catch (error) {
					if (!mounted.current) return;
					setClaimFailedMessage(error instanceof Error ? error.message : String(error));
				} finally {
					if (mounted.current) setClaimBusy(false);
				}
			}, [load, region]);
			const compactQuotaRow = (label, q) => {
				if (!usableTotal(q)) return null;
				const qTier = tierOfQuota(q);
				const pRaw = num(q.percentage);
				const totalN = num(q.total);
				const usedN = num(q.used);
				const p = pRaw !== null ? pRaw : totalN !== null && totalN > 0 && usedN !== null ? Math.min(1, Math.max(0, usedN / totalN)) : null;
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						display: "flex",
						alignItems: "center",
						gap: "8px",
						fontSize: "11px"
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: {
								flex: "0 0 auto",
								color: "var(--dsw-alias-label-secondary, #61666b)"
							},
							children: label
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								flex: "1 1 auto",
								height: "4px",
								borderRadius: "999px",
								background: "var(--dsw-alias-bg-layer-2, #2a2b31)",
								overflow: "hidden"
							},
							children: p !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { style: {
								height: "100%",
								width: `${Math.round(p * 100)}%`,
								borderRadius: "999px",
								background: TIER_DOT[qTier],
								transition: "width .3s ease"
							} }) : null
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							style: {
								flex: "0 0 auto",
								fontWeight: "600",
								color: TIER_INK[qTier],
								fontVariantNumeric: "tabular-nums"
							},
							children: [
								formatCredits(remainingOf(q)),
								" ",
								t("usage.credits")
							]
						})
					]
				});
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: "dsm-qoder-composer-pill",
				"data-dsh-qoder-pill-root": "true",
				style: {
					display: "inline-flex",
					alignItems: "center",
					height: "28px",
					position: "relative"
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						"aria-expanded": open,
						"aria-controls": open ? POPOVER_ID : void 0,
						title: t("pill.details"),
						onClick: () => {
							setOpen(!open);
						},
						style: {
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
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								"aria-hidden": "true",
								style: {
									width: "7px",
									height: "7px",
									borderRadius: "50%",
									background: TIER_DOT[tier],
									flex: "none"
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									fontSize: "12px",
									lineHeight: "1",
									whiteSpace: "nowrap"
								},
								children: `${prefix} · ${display}`
							}),
							newNames.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								title: newTooltip,
								style: {
									fontSize: "11px",
									lineHeight: "1",
									whiteSpace: "nowrap",
									color: "var(--dsw-alias-state-success-primary, #12b76a)"
								},
								children: ` · ${newNames.length} ${t("pill.newModels")}`
							}) : null
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						"aria-hidden": "true",
						style: {
							position: "absolute",
							left: "0",
							right: "0",
							bottom: "0",
							height: "2px",
							borderRadius: "999px",
							background: "var(--dsw-alias-bg-layer-2, #2a2b31)",
							overflow: "hidden"
						},
						children: pct !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { style: {
							height: "100%",
							width: `${Math.round(pct * 100)}%`,
							borderRadius: "999px",
							background: pctColor,
							transition: "width .3s ease"
						} }) : null
					}),
					open ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						id: POPOVER_ID,
						role: "dialog",
						"aria-label": t("pill.details"),
						style: {
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
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "flex",
									alignItems: "center",
									justifyContent: "space-between",
									gap: "8px"
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										fontSize: "13px",
										fontWeight: "600"
									},
									children: prefix
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										fontSize: "11px",
										color: exhausted ? "var(--dsw-alias-state-error-primary, #d92d20)" : "var(--dsw-alias-label-tertiary, #999)"
									},
									children: exhausted ? t("usage.exceeded") : t("pill.balance")
								})]
							}),
							stale && usage !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: {
									fontSize: "11px",
									color: "var(--dsw-alias-state-warn-primary, #d97706)"
								},
								children: t("pill.stale")
							}) : null,
							offPeak !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "flex",
									flexDirection: "column",
									gap: "4px",
									paddingBottom: "8px",
									borderBottom: "1px solid var(--dsw-alias-border-l2, #36373b)"
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										style: {
											fontSize: "11px",
											color: "var(--dsw-alias-label-secondary, #61666b)"
										},
										children: t("pill.modelLabel")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										style: {
											fontSize: "12px",
											color: "var(--dsw-alias-label-primary, #e6e6e6)",
											overflow: "hidden",
											textOverflow: "ellipsis",
											whiteSpace: "nowrap"
										},
										children: currentModel?.name ?? currentModel?.id ?? modelKey ?? ""
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										style: {
											fontSize: "12px",
											color: offPeak.active ? "var(--dsw-alias-state-success-primary, #12b76a)" : "var(--dsw-alias-label-tertiary, #999)",
											fontVariantNumeric: "tabular-nums"
										},
										children: offPeak.active ? `${t("pill.offpeakActive", { rate: offPeak.rate })} · ${t("pill.offpeakRemaining", { time: formatCountdown(offPeak.remainingSeconds) })}` : t("pill.offpeakIdle", { window: offPeak.window })
									})
								]
							}) : null,
							newNames.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "flex",
									flexDirection: "column",
									gap: "2px"
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										fontSize: "11px",
										color: "var(--dsw-alias-label-secondary, #61666b)"
									},
									children: t("pill.newModelsRow")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										fontSize: "12px",
										color: "var(--dsw-alias-state-success-primary, #12b76a)"
									},
									children: newRows.length > newNames.length ? `${newNames.join(t("pill.newModelsSep"))}…` : newNames.join(t("pill.newModelsSep"))
								})]
							}) : null,
							known && quota !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "flex",
									flexDirection: "column",
									gap: "6px"
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: {
											display: "flex",
											alignItems: "baseline",
											justifyContent: "space-between",
											gap: "8px"
										},
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: {
												fontSize: "11px",
												color: "var(--dsw-alias-label-secondary, #61666b)"
											},
											children: t("usage.planCredits")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: {
												fontSize: "16px",
												fontWeight: "600",
												color: pctColor,
												fontVariantNumeric: "tabular-nums"
											},
											children: pctText
										})]
									}),
									pct !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										role: "progressbar",
										"aria-label": `${t("usage.planCredits")} ${pctText}`,
										"aria-valuenow": Math.round(pct * 100),
										"aria-valuemin": 0,
										"aria-valuemax": 100,
										style: {
											height: "6px",
											borderRadius: "999px",
											background: "var(--dsw-alias-bg-layer-2, #2a2b31)",
											overflow: "hidden"
										},
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { style: {
											height: "100%",
											width: `${Math.round(pct * 100)}%`,
											borderRadius: "999px",
											background: pctColor,
											transition: "width .3s ease"
										} })
									}) : null,
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: {
											display: "flex",
											alignItems: "baseline",
											justifyContent: "space-between",
											gap: "8px",
											fontSize: "12px",
											color: "var(--dsw-alias-label-secondary, #61666b)"
										},
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: `${t("usage.used")} ${formatCredits(num(quota.used))}` }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [`${t("usage.remaining")} `, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
											style: {
												fontSize: "16px",
												fontWeight: "600",
												color: TIER_INK[tier],
												fontVariantNumeric: "tabular-nums"
											},
											children: display
										})] })]
									})
								]
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: {
									fontSize: "11px",
									color: "var(--dsw-alias-label-tertiary, #999)"
								},
								children: loadedOnce ? t(usageUnavailableKey(usage)) : t("pill.loading")
							}),
							usableTotal(usage?.userQuota) && usableTotal(usage?.addOnQuota) ? compactQuotaRow(t("usage.resourcePackage"), usage.addOnQuota) : null,
							Array.isArray(usage?.dedicatedPackages) && usage.dedicatedPackages.some((item) => usableTotal(item)) ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: {
									display: "flex",
									flexDirection: "column",
									gap: "4px"
								},
								children: usage.dedicatedPackages.map((item) => compactQuotaRow(t("usage.dedicatedPackage"), item))
							}) : null,
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "flex",
									flexDirection: "column",
									gap: "2px",
									fontSize: "11px",
									color: "var(--dsw-alias-label-tertiary, #999)"
								},
								children: [usage?.requestsUnavailable === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									style: { color: "var(--dsw-alias-label-tertiary, #999)" },
									children: [t("usage.requestsUnavailable"), usage?.tokensToday !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: " · " }), t("usage.tokensToday", { tokens: formatTokenCount(usage.tokensToday) })] }) : null]
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
									t("usage.requestsToday", { count: usage?.requestsToday ?? 0 }),
									usage?.tokensToday !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: " · " }), t("usage.tokensToday", { tokens: formatTokenCount(usage.tokensToday) })] }) : null,
									usage?.requestsExhausted === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: " · " }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: { color: "var(--dsw-alias-state-warn-primary, #f79009)" },
										children: t("usage.requestsExhausted")
									})] }) : null
								] }), usage?.tokensCachedToday !== void 0 && usage.tokensCachedToday > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: { color: "var(--dsw-alias-state-success-primary, #12b76a)" },
									children: t("usage.tokensCachedToday", { cached: formatTokenCount(usage.tokensCachedToday) })
								}) : null]
							}),
							usage?.tokensHistory && usage.tokensHistory.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TokenHistoryChart, {
								history: usage.tokensHistory,
								t
							}) : null,
							checkin !== void 0 && checkin.active === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "flex",
									flexDirection: "column",
									gap: "6px"
								},
								children: [checkin.todayCheckedIn === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										fontSize: "12px",
										color: "var(--dsw-alias-state-success-primary, #12b76a)"
									},
									children: t("pill.checkinDone")
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									disabled: claimBusy,
									"aria-busy": claimBusy,
									onClick: () => {
										claim();
									},
									style: {
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
									},
									children: claimBusy ? t("pill.checkinBusy") : t("pill.checkinNow", { amount: formatCredits(num(checkin.amount)) })
								}), claimFailedMessage === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										fontSize: "11px",
										color: "var(--dsw-alias-state-error-primary, #d92d20)"
									},
									children: t("pill.checkinFailed", { message: claimFailedMessage })
								})]
							}) : null
						]
					}) : null
				]
			});
		}
		/**
		* 输入框工具栏用量胶囊。仅当会话当前指向 Qoder 区域时挂载内层；否则不渲染、
		* 也不跑 fetch 循环。
		*/
		function ComposerUsagePill({ t, useProjection }) {
			const projection = (useProjection ?? (() => void 0))("modelSelection");
			const region = selectedRegionOf(projection);
			if (!isQoderRegion(region)) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActiveUsagePill, {
				t,
				region,
				modelKey: selectedModelOf(projection)
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
						const namespaces = forms.describe().getSnapshot().view?.namespaces ?? [];
						const served = namespaces.find((entry) => entry.ns === fallback || entry.ns === PROVIDER_NS);
						if (served !== void 0) return served.ns;
						if (namespaces.length > 0) console.error(`[dsh-connect-qoder] the host serves ${namespaces.length} settings namespace(s) (${namespaces.map((entry) => entry.ns).join(", ")}) but none of them is this plugin's (${fallback} / ${PROVIDER_NS}); the card is registering under "${fallback}", which is not served — its settings row will be missing. This is the Loader row id in cordis.patch.yml drifting from src/client/index.ts.`);
						return fallback;
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
				try {
					ctx.slots.inject("conversation.input.right", () => ctx.slots.register({
						name: "conversation.input.right",
						id: `${PROVIDER_NS}-composer-pill`,
						locale: namespace,
						order: 4,
						inject: () => ({ t })
					}, ComposerUsagePill));
				} catch (error) {
					console.error(`[dsh-connect-qoder] composer pill slot failed to register (host provider unaffected):`, error);
				}
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
