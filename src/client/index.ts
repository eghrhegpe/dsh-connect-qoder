import { installStyles } from "./styles.ts"
import { zh, en } from "./copy.ts"
import { QoderPluginCard } from "./card.ts"
import type { SettingsScope } from "./settings-write.ts"

/**
 * The browser plugin's Cordis context, from the members this file touches.
 *
 * Declared structurally for the same reason `HostContext` is (`domain.ts`):
 * Cordis is a peer the checkout has no types for, and a hand-written imitation
 * of its real `Context` would be worse than `unknown` because it could not
 * admit what it does not know. Everything below is either present in the
 * `inject` list above or probed with `ctx.get`, so nothing here is speculative.
 *
 * `get` answers `unknown` on purpose: it is the soft service locator this file
 * uses to span the 0.1.6/0.1.7 settings split, and each result is narrowed at
 * the point of use rather than trusted by name.
 */
interface ClientContext {
	effect(callback: () => unknown, name?: string): unknown
	locale: {
		register(namespace: string, copy: { zh: unknown; en: unknown }): unknown
		bind(namespace: string): (key: string) => string
	}
	slots: {
		inject(slotName: string, callback: () => unknown): unknown
		register(slot: Record<string, unknown>, card: unknown): unknown
	}
	get(name: string): any
}

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
function apply(ctx: ClientContext) {
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
	const softGet = (name: string): any => ctx.get(name);
	let settingsScope: SettingsScope | undefined;
	const forms = softGet("configForms");
	const legacy = softGet("settingsScope");
	if (forms !== void 0) {
		let ns = "dsh-connect-qoder";
		try {
			const served = (forms.describe().getSnapshot().view?.namespaces ?? [])
				.find((entry: { ns: string }) => entry.ns === "dsh-connect-qoder" || /qoder/i.test(entry.ns));
			if (served !== void 0) ns = served.ns;
		} catch {}
		settingsScope = forms.get(ns) as SettingsScope;
	} else if (legacy !== void 0) {
		settingsScope = legacy.bind({ namespace: "dsh-connect-qoder" }) as SettingsScope;
	}
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
	const registerCard = (slotName: string, key: string) => {
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
		} catch (error: any) {
			console.error(`[dsh-connect-qoder] card slot "${slotName}" failed to register (host provider unaffected):`, error);
		}
	};
	for (const bundle of ["@eghrhegpe/dsh-connect-qoder", "dsh-connect-qoder"]) {
		registerCard("plugins.bundle.config", bundle);
		registerCard("plugins.row.config", `${bundle}#llm-qoder`);
	}
	registerCard("settings.plugin.item", "qoder");
	} catch (error: any) {
		console.error("[dsh-connect-qoder] client card failed to load (host provider unaffected):", error);
	}
}

export { apply, inject, name }