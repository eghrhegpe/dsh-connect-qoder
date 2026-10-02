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
	// --- Card body, owned by this plugin ---
	// Text hierarchy: the card used to spend `--dsw-alias-label-primary` on
	// eleven rules and `--dsw-alias-label-secondary` on none, so explanatory
	// prose, the filter counter and the quota figures all rendered at body
	// weight — the one thing a dense settings card cannot afford. Everything
	// that is a NOTE about the content above it now takes the middle stop.
	// The token is real: the shipped 0.1.7 frontend defines
	// `--dsw-alias-label-secondary` twice (`var(--dsw-static-neutral-bluish-700)`
	// light / `-300` dark, i.e. #61666b / #cfd3d6), confirmed against
	// %LOCALAPPDATA%\Programs\DeepSeek Harness\resources\app.asar — so the
	// fallback below is the token's own value, not a guess, and a misspelling
	// would not have been visible anyway (see the warn token note below).
	".dsm-qoder-body{padding:12px 14px;display:flex;flex-direction:column;gap:12px}",
	".dsm-qoder-hint{margin:0;color:var(--dsw-alias-label-secondary,#61666b);font-size:12px;line-height:1.6}",
	".dsm-qoder-switch{display:flex;align-items:center;gap:8px;font-size:13px}",
	// The two row-level choices that are not per-model: the context-window
	// display and the image-input tuning switch. They belong on one line —
	// as separate children of the body's flex column each spent a full 12px
	// gap row on a single 13px label.
	".dsm-qoder-switches{display:flex;align-items:center;gap:16px;flex-wrap:wrap}",
	".dsm-qoder-models{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px;max-height:320px;overflow:auto}",
	".dsm-qoder-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:6px 8px;border:1px solid var(--dsw-alias-border-l2,#36373b);border-radius:8px}",
	".dsm-qoder-row-main{display:flex;align-items:center;gap:8px;min-width:0}",
	".dsm-qoder-name{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
	".dsm-qoder-badge{font-size:10px;padding:1px 6px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,#36373b);color:var(--dsw-alias-label-secondary,#61666b);white-space:nowrap}",
	// The model-row "活动价" highlight. This class was drifting: `card.tsx`
	// applied `dsm-qoder-badge-offer` to the off-peak badge but styles.ts had
	// never defined it, so an active promotion rendered identically to a
	// normal badge. The rule is the success-colour modifier the usage block's
	// own offer badge (`.dsm-qoder-usage-badge-offer`) already carries.
	".dsm-qoder-badge-offer{border-color:var(--dsw-alias-state-success-primary,#12b76a);color:var(--dsw-alias-state-success-primary,#12b76a)}",
	// Static model facts — the context window and whether the model takes
	// images — as flat muted text. As pills they competed with the rate (the
	// one number that changes and therefore the one worth a pill): a row
	// carried four same-sized chips with only two colours between them, so
	// "1M" and "视觉" read as loudly as "x0.20". They are attributes, not
	// status, so they take the quietest label stop and no border.
	".dsm-qoder-meta{font-size:11px;color:var(--dsw-alias-label-tertiary,#999);white-space:nowrap}",
	".dsm-qoder-select{font-size:12px;padding:3px 6px;border-radius:6px;background:var(--dsw-alias-bg-layer-3,#202126);color:inherit;border:1px solid var(--dsw-alias-border-l2,#36373b)}",
	".dsm-qoder-state{margin:0;font-size:12px;color:var(--dsw-alias-label-primary,#1a1a1a)}",
	".dsm-qoder-error{margin:0;font-size:12px;color:var(--dsw-alias-state-error-primary,#d92d20)}",
	// The account panel has no header row to hang a retry on, so the
	// error line carries its own: text and button on one row.
	".dsm-qoder-account-error{display:flex;align-items:center;gap:10px}",
	".dsm-qoder-actions{display:flex;gap:8px}",
	// Save / discard, pinned to the bottom of the viewport while the card is
	// on screen. The edits happen in the roster, which scrolls inside its own
	// 320px box above two hint paragraphs and a maintenance row — the commit
	// controls used to be a full screen away from the change they commit, and
	// a user could tick a model and never see that a save was pending. The
	// background is the open card's own layer so rows scrolling under it stay
	// hidden rather than bleeding through.
	".dsm-qoder-actions-save{position:sticky;bottom:0;z-index:1;background:var(--dsw-alias-bg-layer-2,#25262b);border-top:1px solid var(--dsw-alias-border-l2,#36373b);padding:8px 0;margin-top:-4px}",
	".dsm-qoder-button{font-size:12px;padding:5px 12px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,#36373b);background:transparent;color:inherit;cursor:pointer}",
	".dsm-qoder-button:disabled{opacity:.5;cursor:default}",
	// Usage panel. Mirrors the Qoder IDE's own "我的用量" card: a titled
	// block per quota, each with a filled bar and a used/total line.
	".dsm-qoder-usage{border:1px solid var(--dsw-alias-border-l2,#36373b);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:12px}",
	".dsm-qoder-usage-head{display:flex;align-items:center;justify-content:space-between;gap:8px}",
	".dsm-qoder-usage-title{margin:0;font-size:13px;font-weight:600}",
	".dsm-qoder-usage-block{display:flex;flex-direction:column;gap:6px}",
	// The usage panel and the check-in card sit side by side, so "how many
	// Credits do I have" (the panel's bars) and "claim today's" are read in one
	// glance instead of two stacked rows. The panel keeps the space it needs;
	// the card is sized to its own content and wraps BELOW the panel on a
	// narrow card rather than squeezing it.
	".dsm-qoder-usage-row{display:flex;align-items:stretch;gap:12px;flex-wrap:wrap}",
	".dsm-qoder-usage-row>.dsm-qoder-usage{flex:1 1 260px;min-width:0}",
	".dsm-qoder-checkin{flex:0 1 auto;min-width:132px;max-width:200px;display:flex;flex-direction:column;justify-content:center;gap:6px;padding:12px;border:1px solid var(--dsw-alias-border-l2,#36373b);border-radius:10px;background:var(--dsw-alias-bg-layer-2,#24262c)}",
	".dsm-qoder-checkin-title{font-size:11px;color:var(--dsw-alias-label-tertiary,#999)}",
	".dsm-qoder-checkin-gain{font-size:18px;font-weight:600;line-height:1.2;color:var(--dsw-alias-state-success-primary,#22c55e);font-variant-numeric:tabular-nums}",
	".dsm-qoder-checkin-button{width:100%;padding:4px 10px}",
	".dsm-qoder-usage-label{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:12px}",
	".dsm-qoder-usage-when{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-secondary,#61666b);white-space:nowrap}",
	// The bar is the panel's only quantification — "how much is left" is what
	// the user came here for — and at 6px it read as a hairline next to 12px
	// text while the prose below it took the primary label colour. Doubling its
	// height is the cheapest way to put the weight back where it belongs.
	".dsm-qoder-bar{height:10px;border-radius:999px;background:var(--dsw-alias-bg-layer-3,#202126);overflow:hidden}",
	".dsm-qoder-bar-fill{height:100%;border-radius:999px;background:var(--dsw-alias-state-success-primary,#12b76a);transition:width .3s ease}",
	// The host's design token is the ABBREVIATED `--dsw-alias-state-warn-primary`
	// (confirmed against the shipped 0.1.7 frontend CSS: the long `warning` form
	// is never defined, only referenced with a fallback by two of the host's own
	// packages). A misspelled custom property never blanks the rule — `var()`
	// falls through to the fallback — so the wrong name is invisible: no error,
	// no warning, no visual anomaly, and the host token is never consulted.
	// The fallback must therefore be the token's real value, `--dsw-static-amber-500`
	// = rgb(245,158,11) = #f59e0b, which is what the host resolves it to.
	".dsm-qoder-bar-warn{background:var(--dsw-alias-state-warn-primary,#f59e0b)}",
	".dsm-qoder-bar-full{background:var(--dsw-alias-state-error-primary,#d92d20)}",
	// Two figures, two weights. "266 / 1300 (21%)" is bookkeeping and drops to
	// the middle stop; "剩余 1034 Credits" is the answer and keeps the primary
	// label at a larger size. Both numbers stay tabular so a refresh that moves
	// the digits does not shift the row.
	".dsm-qoder-usage-figures{display:flex;align-items:baseline;justify-content:space-between;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary,#61666b)}",
	".dsm-qoder-usage-figures strong{color:inherit;font-weight:500;font-variant-numeric:tabular-nums}",
	".dsm-qoder-usage-remain{color:var(--dsw-alias-label-primary,#1a1a1a);white-space:nowrap}",
	".dsm-qoder-usage-remain strong{font-size:15px;font-weight:500;font-variant-numeric:tabular-nums}",
	".dsm-qoder-usage-badge{font-size:10px;padding:1px 6px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,#36373b);color:var(--dsw-alias-label-secondary,#61666b);white-space:nowrap}",
	".dsm-qoder-usage-badge-offer{border-color:var(--dsw-alias-state-success-primary,#12b76a);color:var(--dsw-alias-state-success-primary,#12b76a)}",
	// Promotions are upstream marketing, not a fact about this machine: they must
// not outrank the quota they are printed under.
".dsm-qoder-usage-promo{margin:0;font-size:11px;line-height:1.6;color:var(--dsw-alias-label-secondary,#61666b)}",
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
	".dsm-qoder-count{font-size:11px;color:var(--dsw-alias-label-secondary,#61666b);white-space:nowrap;font-variant-numeric:tabular-nums}",
	// "已勾选 3" is the one number here that describes a consequence — it is
	// how many models will actually reach DSH's picker — so it keeps the
	// primary label while the "显示 14 / 14" beside it stays secondary.
	".dsm-qoder-count strong{color:var(--dsw-alias-label-primary,#1a1a1a);font-weight:500}",
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
	// Account panel: the framed card with the SELECTED region's sign-in
	// detail. The region strip is NOT inside it — since 2026-10 it renders
	// directly above the frame as the whole body's header (see card.tsx).
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
	// badges disappear from the model rows. The strip renders ABOVE the
	// account frame as the whole body's header, so both pills must share
	// one row: no wrapping, the switch carries only its tooltip (no text
	// label), and a long region name ellipsizes instead of pushing the
	// row past its box.
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