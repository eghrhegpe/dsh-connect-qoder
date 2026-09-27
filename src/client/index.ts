import { installStyles } from "./styles"
import { zh, en } from "./copy"
import { QoderPluginCard } from "./card"
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
			const served = (forms.describe().getSnapshot().view?.namespaces ?? [])
				.find((entry) => entry.ns === "dsh-connect-qoder" || /qoder/i.test(entry.ns));
			if (served !== void 0) ns = served.ns;
		} catch {}
		settingsScope = forms.get(ns);
	} else if (legacy !== void 0) {
		settingsScope = legacy.bind({ namespace: "dsh-connect-qoder" });
	}
	/**
	 * FIX 0.1.7: the plugin-manager detail page renders a bundle's config
	 * card from the `plugins.bundle.config` slot (and a row's from
	 * `plugins.row.config`); the legacy `settings.plugin.item` slot is no
	 * longer rendered there. Register under all three so the card shows
	 * on the bundle page (0.1.7), the row page, and any legacy surface.
	 * Each registration degrades to a read-only card when no settings
	 * surface is served, instead of throwing into the loader.
	 */
	const registerCard = (slotName, key) => {
		try {
			ctx.slots.inject(slotName, () => ctx.slots.register({
				name: slotName,
				key,
				priority: 30,
				inject: () => settingsScope === void 0 ? {
					t
				} : {
					t,
					settingsScope
				}
			}, QoderPluginCard));
		} catch (error) {
			console.error(`[dsh-connect-qoder] card slot "${slotName}" failed to register (host provider unaffected):`, error);
		}
	};
	registerCard("plugins.bundle.config", "dsh-connect-qoder");
	registerCard("plugins.row.config", "dsh-connect-qoder#llm-qoder");
	registerCard("settings.plugin.item", "qoder");
	} catch (error) {
		console.error("[dsh-connect-qoder] client card failed to load (host provider unaffected):", error);
	}
}

export { apply, inject, name }