import { installStyles } from "./styles.ts"
import { zh, en } from "./copy.ts"
import { QoderPluginCard } from "./card.tsx"
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
 * uses to the settings surface, which the 0.2 harness may or may not serve, and each is narrowed at
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
	get(name: string): unknown
}

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
function apply(ctx: ClientContext) {
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
	const softGet = (name: string): unknown => ctx.get(name);
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
	const resolveNamespace = (): string => {
		const fallback = "dsh-connect-qoder";
		// The two hops below are the harness's own `configForms` surface. Each is
		// declared as the minimum this line reads rather than guessed at whole:
		// `describe()` returns a live view whose `namespaces` array carries the
		// `ns` strings, and the optional links are optional because a future
		// harness that flattens any of them should answer `fallback` here, not
		// throw — the `try`/`catch` below already covers a throwing shape.
		const forms = softGet("configForms") as
			| { describe(): { getSnapshot(): { view?: { namespaces?: Array<{ ns: string }> } } } }
			| undefined;
		if (forms === void 0) return fallback;
		try {
			// Exact candidates only, never a substring: a loose match would find
			// a row belonging to another plugin, and the locale table and the
			// settings scope would then name a namespace that is not ours — the
			// card silently configured someone else's section. The two names are
			// the one the Loader serves (the entry id, `llm-qoder`) and the
			// fallback declared above; the host's own `settingsNamespaceOf`
			// resolves the same pair, and test/plugin-identity.test.js holds the
			// two spellings against the Loader row id in cordis.patch.yml.
			const namespaces = forms.describe().getSnapshot().view?.namespaces ?? [];
			const served = namespaces
				.find((entry) => entry.ns === fallback || entry.ns === PROVIDER_NS);
			if (served !== void 0) return served.ns;
			// A host that serves SOME namespaces but none of ours is not the
			// Loader-less case this fallback is written for — there the list is
			// empty. It means the id moved and every copy below was written
			// against the old one, so the card will register where nobody is
			// served and the settings row will simply be absent. That is
			// invisible by construction, so it is named here: the whole failure
			// is a one-value edit in cordis.patch.yml plus the two literals.
			if (namespaces.length > 0) {
				console.error(
					`[dsh-connect-qoder] the host serves ${namespaces.length} settings namespace(s) ` +
					`(${namespaces.map((entry) => entry.ns).join(", ")}) but none of them is this ` +
					`plugin's (${fallback} / ${PROVIDER_NS}); the card is registering under ` +
					`"${fallback}", which is not served — its settings row will be missing. ` +
					'This is the Loader row id in cordis.patch.yml drifting from src/client/index.ts.',
				);
			}
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
	let settingsScope: SettingsScope | undefined;
	// The settings surface, narrowed to the one call it is probed with.
	// `SettingsScope` is this card's own type (declared with the card), so
	// the cast below is where the harness's answer meets it — the same
	// division of labour as the `unknown` above, kept to one line.
	const forms = softGet("configForms") as { get(ns: string): unknown } | undefined;
	if (forms !== void 0) {
		settingsScope = forms.get(namespace) as SettingsScope;
	}
	// A host without the surface gets a read-only card: `settingsScope` stays
	// undefined and the slot registration degrades to `{ t }` — the existing
	// degraded path, not an error.
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

export { apply, inject, name }