// Talking to the app server, and hooks that keep views in step with the data.
import { useEffect, useState } from "./preact.js";

async function request(method, path, body) {
	const response = await fetch(path, {
		method,
		headers: body === undefined ? {} : { "content-type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const data = await response.json().catch(() => ({}));
	if (!response.ok) throw new Error(data.error || `${method} ${path}: ${response.status}`);
	return data;
}

/** Generic collections: any name, any JSON documents. See server.ts for the filters `where` takes. */
export const db = {
	list: (collection, where = {}) => request("GET", `/api/c/${collection}?${new URLSearchParams(where)}`),
	get: (collection, id) => request("GET", `/api/c/${collection}/${encodeURIComponent(id)}`),
	create: (collection, doc) => request("POST", `/api/c/${collection}`, doc),
	put: (collection, doc) => request("PUT", `/api/c/${collection}/${encodeURIComponent(doc.id)}`, doc),
	patch: (collection, id, fields) => request("PATCH", `/api/c/${collection}/${encodeURIComponent(id)}`, fields),
	remove: (collection, id) => request("DELETE", `/api/c/${collection}/${encodeURIComponent(id)}`),
};

export const exercises = {
	search: (q, filters = {}, limit = 60) =>
		request("GET", `/api/exercises?${new URLSearchParams({ q, limit: String(limit), ...filters })}`),
	get: (id) => request("GET", `/api/exercises/${encodeURIComponent(id)}`),
	history: (id) => request("GET", `/api/exercises/${encodeURIComponent(id)}/history`),
	gifUrl: (id) => `/api/exercises/${encodeURIComponent(id)}/gif`,
};

export const meta = () => request("GET", "/api/meta");

/** Tells every view that data changed, so they refetch. The agent's dock fires this too after it edits data. */
export const changed = () => window.dispatchEvent(new CustomEvent("forma:data-changed"));

/**
 * Loads data and reloads it whenever `deps` change or data changes anywhere.
 *
 * Returns:
 *   [data, { loading, error, reload }]
 */
export function useData(loader, deps = []) {
	const [tick, setTick] = useState(0);
	const [state, setState] = useState({ data: undefined, loading: true, error: null });
	useEffect(() => {
		const on = () => setTick((t) => t + 1);
		window.addEventListener("forma:data-changed", on);
		return () => window.removeEventListener("forma:data-changed", on);
	}, []);
	useEffect(() => {
		let alive = true;
		setState((s) => ({ ...s, loading: true }));
		loader().then(
			(data) => alive && setState({ data, loading: false, error: null }),
			(error) => alive && setState({ data: undefined, loading: false, error }),
		);
		return () => {
			alive = false;
		};
	}, [...deps, tick]);
	return [state.data, { loading: state.loading, error: state.error, reload: () => setTick((t) => t + 1) }];
}

/** The owner's preferences, stored as the `prefs` document of the `settings` collection. */
export const DEFAULT_PREFS = { units: "kg" };
export async function loadPrefs() {
	try {
		return { ...DEFAULT_PREFS, ...(await db.get("settings", "prefs")) };
	} catch {
		return { ...DEFAULT_PREFS, id: "prefs" };
	}
}
