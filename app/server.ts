// forma app server. Started by the forma core as `node server.ts` with PORT, HOST and FORMA_DATA set.
// Serves the browser app from web/ and a JSON API under /api. No dependencies beyond Node itself.

import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { Store } from "./lib/db.ts";
import { Library } from "./lib/exercises.ts";

const PORT = Number(process.env.PORT ?? 4301);
const HOST = process.env.HOST ?? "127.0.0.1";
const DATA = resolve(process.env.FORMA_DATA ?? "./data");
const WEB = resolve(import.meta.dirname, "web");

mkdirSync(DATA, { recursive: true });
const store = new Store(join(DATA, "app.db"));
const library = new Library(DATA, store);
if (!store.get("settings", "prefs")) store.put("settings", { id: "prefs", units: "kg" });
void library.load();

const TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".ico": "image/x-icon",
	".webmanifest": "application/manifest+json",
};

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
	const isBuffer = Buffer.isBuffer(body);
	res.writeHead(status, {
		"content-type": isBuffer ? "application/octet-stream" : "application/json",
		"cache-control": "no-store",
		...headers,
	});
	res.end(isBuffer ? body : JSON.stringify(body));
}

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
	const chunks: Buffer[] = [];
	for await (const chunk of req) chunks.push(chunk as Buffer);
	const text = Buffer.concat(chunks).toString("utf8");
	if (!text) return {};
	const value = JSON.parse(text) as unknown;
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a JSON object");
	return value as Record<string, unknown>;
}

const COLLECTION = /^[a-z][a-z0-9_]{0,40}$/;

/** Every logged session of one exercise, newest first, from the workouts collection. */
function exerciseHistory(exerciseId: string) {
	const sessions: { date: string; workout: string; sets: unknown[] }[] = [];
	for (const workout of store.list("workouts")) {
		const items = (workout.exercises as { exerciseId?: string; sets?: { done?: boolean }[] }[] | undefined) ?? [];
		for (const item of items) {
			if (item.exerciseId !== exerciseId) continue;
			const done = (item.sets ?? []).filter((set) => set.done);
			if (done.length) sessions.push({ date: String(workout.date), workout: String(workout.title ?? ""), sets: done });
		}
	}
	return sessions.sort((a, b) => b.date.localeCompare(a.date));
}

async function api(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
	const parts = url.pathname.split("/").filter(Boolean).slice(1).map(decodeURIComponent);
	const method = req.method ?? "GET";
	const query = Object.fromEntries(url.searchParams);

	if (parts[0] === "health") return send(res, 200, { ok: true, library: library.ready });

	if (parts[0] === "meta") {
		await library.load();
		return send(res, 200, { gifs: library.gifsEnabled, facets: library.facets(), collections: store.collections() });
	}

	if (parts[0] === "exercises") {
		await library.load();
		const [, id, sub] = parts;
		if (!id) {
			const { q = "", limit = "60", ...filters } = query;
			return send(res, 200, library.search(q, filters, Math.min(Number(limit) || 60, 1000)));
		}
		const exercise = library.get(id);
		if (!exercise) return send(res, 404, { error: "No such exercise" });
		if (!sub) return send(res, 200, { ...exercise, gifCached: library.gifCached(id) });
		if (sub === "history") return send(res, 200, exerciseHistory(id));
		if (sub === "gif") {
			try {
				const gif = await library.gif(id);
				if (!gif) return send(res, 404, { error: "No GIF for this exercise" });
				return send(res, 200, gif, { "content-type": "image/gif", "cache-control": "public, max-age=31536000" });
			} catch (error) {
				return send(res, 502, { error: (error as Error).message });
			}
		}
	}

	if (parts[0] === "c") {
		const [, collection, id] = parts;
		if (!collection || !COLLECTION.test(collection)) return send(res, 400, { error: "Bad collection name" });
		if (!id) {
			if (method === "GET") return send(res, 200, store.list(collection, query));
			if (method === "POST") return send(res, 201, store.put(collection, await body(req)));
		} else {
			if (method === "GET") {
				const doc = store.get(collection, id);
				return doc ? send(res, 200, doc) : send(res, 404, { error: "Not found" });
			}
			if (method === "PUT") return send(res, 200, store.put(collection, { ...(await body(req)), id }));
			if (method === "PATCH") {
				const doc = store.patch(collection, id, await body(req));
				return doc ? send(res, 200, doc) : send(res, 404, { error: "Not found" });
			}
			if (method === "DELETE") return send(res, store.delete(collection, id) ? 200 : 404, { ok: true });
		}
	}

	if (parts[0] === "collections") return send(res, 200, store.collections());

	send(res, 404, { error: `No route ${method} ${url.pathname}` });
}

async function media(res: ServerResponse, url: URL): Promise<void> {
	const match = url.pathname.match(/^\/media\/ex\/([^/]+)\/(\d)\.jpg$/);
	if (!match) return send(res, 404, { error: "Not found" });
	const bytes = await library.photo(decodeURIComponent(match[1]!), Number(match[2]));
	if (!bytes) return send(res, 404, { error: "No photo" });
	send(res, 200, bytes, { "content-type": "image/jpeg", "cache-control": "public, max-age=31536000, immutable" });
}

function file(res: ServerResponse, pathname: string): void {
	const relative = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
	let path = join(WEB, relative);
	if (!path.startsWith(WEB)) return send(res, 403, { error: "Forbidden" });
	if (existsSync(path) && statSync(path).isDirectory()) path = join(path, "index.html");
	// Unknown paths without an extension get the app shell, so deep links work.
	if (!existsSync(path)) {
		if (extname(pathname)) return send(res, 404, { error: "Not found" });
		path = join(WEB, "index.html");
	}
	res.writeHead(200, {
		"content-type": TYPES[extname(path)] ?? "application/octet-stream",
		// Revalidate on every load, so a change the agent makes shows up at once.
		"cache-control": path.includes(`${join("web", "vendor")}`) ? "public, max-age=86400" : "no-cache",
	});
	res.end(readFileSync(path));
}

const server = createServer((req, res) => {
	const url = new URL(req.url ?? "/", "http://app");
	const work = url.pathname.startsWith("/api/")
		? api(req, res, url)
		: url.pathname.startsWith("/media/")
			? media(res, url)
			: Promise.resolve(file(res, url.pathname));
	work.catch((error: unknown) => {
		console.error(`[app] ${req.method} ${url.pathname}:`, error);
		if (!res.headersSent) send(res, 500, { error: (error as Error).message });
		else res.end();
	});
});

server.listen(PORT, HOST, () => console.log(`[app] listening on http://${HOST}:${PORT}, data in ${DATA}`));
for (const signal of ["SIGTERM", "SIGINT"] as const) {
	process.on(signal, () => {
		server.closeAllConnections();
		process.exit(0);
	});
}
