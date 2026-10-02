/**
 * The card's only `fetch` surface.
 *
 * Both card containers (`QoderUsagePanel`, `QoderAccountPanel`) read the host
 * routes through here, so the requests are in exactly one place. The host
 * routes serve the plugin's own `lib/`, so they are same-origin and answer
 * JSON; this wraps that contract once.
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
 * A body that will not parse is treated as an empty answer, never as a throw,
 * so a malformed-but-200 payload degrades to "no data" rather than "broken".
 */

/** Read the host route at `path` and decode its JSON answer. */
export async function getJson<T = unknown>(path: string): Promise<T> {
	const response = await fetch(path, {
		headers: { accept: "application/json" },
		credentials: "same-origin",
	});
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	const value = (await response.json().catch((): undefined => undefined)) as T | undefined;
	if (value === undefined) throw new Error(`HTTP ${response.status}`);
	return value as T;
}

/** POST to the host route at `path` and decode its JSON answer. */
export async function postJson<T = unknown>(path: string, body?: unknown): Promise<T> {
	const response = await fetch(path, {
		method: "POST",
		headers: { accept: "application/json", "content-type": "application/json" },
		credentials: "same-origin",
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const value = (await response.json().catch((): undefined => undefined)) as T | undefined;
	if (!response.ok) {
		const message = (value as { error?: unknown } | undefined)?.error;
		throw new Error(typeof message === "string" && message !== "" ? message : `HTTP ${response.status}`);
	}
	return value as T;
}
