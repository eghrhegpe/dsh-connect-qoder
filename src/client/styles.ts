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
	// --- Card frame, copied from dsh-connect-workbuddy's card block ---
	".dsm-plugin-card{border:1px solid var(--dsw-alias-border-l2,#36373b);background:var(--dsw-alias-bg-layer-3,#202126);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}",
	".dsm-plugin-card:hover{border-color:var(--dsw-alias-label-dimmed,#777)}",
	".dsm-plugin-card-open{background:var(--dsw-alias-bg-layer-2,#25262b);border-color:var(--dsw-alias-label-dimmed,#777)}",
	".dsm-plugin-card-header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:transparent;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}",
	".dsm-plugin-card-header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:-2px}",
	".dsm-plugin-card-head{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}",
	".dsm-plugin-card-title{color:var(--dsw-alias-label-primary,#e6e6e6);font-size:15px;font-weight:600;line-height:1.4}",
	".dsm-plugin-card-description{color:var(--dsw-alias-label-tertiary,#999);font-size:13px;line-height:1.5}",
	// Pure-CSS caret (WorkBuddy's rationale, verbatim): the host
	// primitives' chevron icon names differ per DSH line (0.1.5
	// Outline14 vs 0.1.7 OutlineRegular), so no static import can serve
	// both. A border caret in the plugin's own CSS is version-proof.
	".dsm-plugin-card-chevron{color:var(--dsw-alias-label-tertiary,#999);flex:none;width:16px;height:16px;position:relative;transition:transform .16s}",
	".dsm-plugin-card-chevron::before{content:\"\";display:block;position:absolute;left:4px;top:5px;width:7px;height:7px;border-right:1.6px solid currentColor;border-bottom:1.6px solid currentColor;transform:rotate(45deg)}",
	".dsm-plugin-card-chevron-open{transform:rotate(180deg)}",
	".dsm-plugin-card-body{border-top:1px solid var(--dsw-alias-border-l2,#36373b);margin:0 16px;padding:0 0 8px}",
	".dsm-plugin-card-icon{width:32px;height:32px;flex:none;border-radius:7px}",
	// --- Card body, owned by this plugin ---
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
	// The account panel has no header row to hang a retry on, so the
	// error line carries its own: text and button on one row.
	".dsm-qoder-account-error{display:flex;align-items:center;gap:10px}",
	".dsm-qoder-actions{display:flex;gap:8px}",
	".dsm-qoder-button{font-size:12px;padding:5px 12px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,#36373b);background:transparent;color:inherit;cursor:pointer}",
	".dsm-qoder-button:disabled{opacity:.5;cursor:default}",
	// Usage panel. Mirrors the Qoder IDE's own "我的用量" card: a titled
	// block per quota, each with a filled bar and a used/total line.
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
	// Model row: a picker-visibility checkbox on the left, the name and its
	// rate in the middle, the image choice on the right.
	".dsm-qoder-pick{display:flex;align-items:center;gap:6px;flex:0 0 auto}",
	".dsm-qoder-rate{font-size:11px;padding:1px 6px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,#36373b);color:var(--dsw-alias-label-primary,#1a1a1a);white-space:nowrap;font-variant-numeric:tabular-nums}",
	".dsm-qoder-rate-free{border-color:var(--dsw-alias-state-success-primary,#12b76a);color:var(--dsw-alias-state-success-primary,#12b76a)}",
	".dsm-qoder-row-off .dsm-qoder-name{opacity:.55}",
	// Filter bar: a name search over the selected region's roster (the
	// region itself is chosen on the version strip at the top of the
	// card). View-only state — none of it is ever written back to the
	// settings document.
	".dsm-qoder-tools{display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
	".dsm-qoder-search{font-size:12px;padding:5px 8px;border-radius:6px;background:var(--dsw-alias-bg-layer-3,#202126);color:inherit;border:1px solid var(--dsw-alias-border-l2,#36373b);min-width:150px;flex:1 1 150px}",
	".dsm-qoder-count{font-size:11px;color:var(--dsw-alias-label-primary,#1a1a1a);white-space:nowrap;font-variant-numeric:tabular-nums}",
	// Loading skeleton: three shimmering placeholder rows in the shape of a
	// real model row, so the list does not jump when the data lands.
	".dsm-qoder-skeleton{display:flex;flex-direction:column;gap:6px}",
	".dsm-qoder-skeleton-row{height:34px;border-radius:8px;background:linear-gradient(90deg,var(--dsw-alias-bg-layer-3,#202126) 25%,var(--dsw-alias-bg-layer-2,#2a2b31) 37%,var(--dsw-alias-bg-layer-3,#202126) 63%);background-size:400% 100%;animation:dsm-qoder-shimmer 1.4s ease infinite}",
	"@keyframes dsm-qoder-shimmer{0%{background-position:100% 50%}100%{background-position:0 50%}}",
	// Row flash after an in-place edit (checkbox tick / image-mode pick), so
	// the change is visible where it happened instead of only in the
	// "有未保存的更改" banner at the bottom.
	".dsm-qoder-row-pulse{animation:dsm-qoder-flash 1.2s ease}",
	"@keyframes dsm-qoder-flash{0%{border-color:var(--dsw-alias-state-success-primary,#12b76a)}100%{border-color:var(--dsw-alias-border-l2,#36373b)}}",
	// Account panel: a version strip (one pill per region — status dot,
	// name, provider switch) over the SELECTED region's sign-in detail.
	// The frame mirrors the usage panel's so the two read as one family.
	".dsm-qoder-account{border:1px solid var(--dsw-alias-border-l2,#36373b);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:8px}",
	".dsm-qoder-account-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
	".dsm-qoder-account-id{display:flex;flex-direction:column;gap:2px;min-width:120px;flex:1 1 auto}",
	".dsm-qoder-account-name{font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
	".dsm-qoder-account-meta{font-size:11px;color:var(--dsw-alias-label-tertiary,#999)}",
	".dsm-qoder-account-note{margin:0;font-size:11px;line-height:1.5;color:var(--dsw-alias-label-tertiary,#999)}",
	".dsm-qoder-account-note-error{color:var(--dsw-alias-state-error-primary,#d92d20)}",
	".dsm-qoder-account-note a{color:inherit}",
	// The per-region provider switch, WorkBuddy's tab-switch shape: a
	// compact 30x17 track with a sliding thumb. Unchecked = the region's
	// models are not offered to DSH; the row dimming (below) is the
	// resting look of an off region. The ON track takes the same
	// success green as the region's "ok" status dot, so a tab reads
	// green when it is signed in AND offered.
	".dsm-qoder-region-toggle-cell{display:inline-flex;align-items:center;gap:6px;flex:none;cursor:pointer}",
	".dsm-qoder-region-toggle{appearance:none;-webkit-appearance:none;width:30px;height:17px;margin:0;border-radius:999px;background:var(--dsw-alias-bg-layer-2,#2a2b31);border:1px solid var(--dsw-alias-border-l2,#36373b);position:relative;cursor:pointer;transition:background .15s,border-color .15s;flex:none}",
	".dsm-qoder-region-toggle::before{content:\"\";position:absolute;top:1.5px;left:1.5px;width:12px;height:12px;border-radius:50%;background:var(--dsw-alias-label-tertiary,#999);transition:transform .15s,background .15s}",
	".dsm-qoder-region-toggle:checked{background:var(--dsw-alias-state-success-primary,#12b76a);border-color:var(--dsw-alias-state-success-primary,#12b76a)}",
	".dsm-qoder-region-toggle:checked::before{transform:translateX(13px);background:#fff}",
	".dsm-qoder-region-toggle:disabled{cursor:default;opacity:.55}",
	".dsm-qoder-account-row-off .dsm-qoder-account-id,.dsm-qoder-account-row-off .dsm-qoder-button{opacity:.55}",
	// The region tab strip, WorkBuddy's convergence: each region is one
	// pill — status dot + name + provider switch — and selecting the
	// pill shows that region's account detail, usage and model list
	// below it. The region name appears once, on this strip, so the
	// badges disappear from the model rows. The strip doubles as the
	// panel's header, so both pills must share one row: no wrapping,
	// the switch carries only its tooltip (no text label), and a long
	// region name ellipsizes instead of pushing the row past its box.
	".dsm-qoder-region-tabs{display:flex;gap:8px;flex-wrap:nowrap}",
	".dsm-qoder-region-tab-cell{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--dsw-alias-border-l2,#36373b);border-radius:999px;padding:3px 8px 3px 6px;min-width:0}",
	".dsm-qoder-region-tab-cell-active{border-color:var(--dsw-alias-brand-primary,#5686fe)}",
	".dsm-qoder-region-tab{display:inline-flex;align-items:center;gap:6px;background:none;border:none;padding:2px;cursor:pointer;color:var(--dsw-alias-label-primary,#1a1a1a);min-width:0}",
	".dsm-qoder-region-tab-off{color:var(--dsw-alias-label-tertiary,#999)}",
	".dsm-qoder-region-dot{width:8px;height:8px;border-radius:50%;flex:none;background:var(--dsw-alias-label-tertiary,#999)}",
	".dsm-qoder-region-dot-ok{background:var(--dsw-alias-state-success-primary,#12b76a)}",
	".dsm-qoder-region-dot-expired{background:var(--dsw-alias-state-error-primary,#d92d20)}",
	".dsm-qoder-region-dot-needs{background:var(--dsw-alias-state-warning-primary,#f79009)}",
	".dsm-qoder-region-name{font-size:13px;font-weight:500;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}",
].join("");
/** Inject the card stylesheet once per page. */
export function installStyles() {
	const cssId = "dsh-connect-qoder/client.css";
	if (document.querySelector(`style[data-plugin-css="${cssId}"]`) !== null) return;
	const styleTag = document.createElement("style");
	styleTag.dataset.plugin = "dsh-connect-qoder";
	styleTag.dataset.pluginCss = cssId;
	styleTag.textContent = QODER_CARD_CSS;
	document.head.appendChild(styleTag);
}