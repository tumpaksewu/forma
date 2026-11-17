import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, request, type Server, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Agent, ClientErrors } from "./agent.ts";
import type { Upload } from "./attachments.ts";
import type { Memory } from "./memory.ts";
import type { Supervisor } from "./supervisor.ts";
import type { Versions } from "./versions.ts";

const DOCK_DIR = join(dirname(fileURLToPath(import.meta.url)), "dock");
const DOCK_TAG = `<script type="module" src="/__forma/dock.js"></script>`;

/** Adds the dock to an HTML page the app served. */
export function injectDock(html: string): string {
	if (html.includes("/__forma/dock.js")) return html;
	const at = html.lastIndexOf("</body>");
	return at === -1 ? `${html}${DOCK_TAG}` : `${html.slice(0, at)}${DOCK_TAG}${html.slice(at)}`;
}

/** The page shown when the app does not answer, so the owner can still talk to the agent or roll back. */
function fallbackPage(status: string, logs: string): string {
	const escaped = logs.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c);
	return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>forma — app down</title>
<style>body{font:15px/1.5 system-ui,sans-serif;margin:0;padding:24px 16px;background:#0f1115;color:#e7e9ee}h1{font-size:20px;margin:0 0 4px}p{color:#9aa3b2;margin:0 0 16px}pre{background:#171a21;border:1px solid #262b36;border-radius:10px;padding:12px;overflow:auto;font-size:12px;max-height:60vh;white-space:pre-wrap}</style>
</head><body><h1>The app is not running (${status})</h1><p>Its last change probably broke it. Ask the agent to fix it, or open History in the agent panel and restore a working version.</p><pre>${escaped}</pre>${DOCK_TAG}</body></html>`;
}

const MAX_BODY = 100 * 1024 * 1024;

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
	const chunks: Buffer[] = [];
	let total = 0;
	for await (const chunk of req) {
		total += (chunk as Buffer).length;
		if (total > MAX_BODY) throw new Error("Request too large (100 MB max)");
		chunks.push(chunk as Buffer);
	}
	const text = Buffer.concat(chunks).toString("utf8");
	if (!text) return {};
	const value: unknown = JSON.parse(text);
	return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function json(res: ServerResponse, status: number, body: unknown): void {
	res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
	res.end(JSON.stringify(body));
}

/** The files of a chat request, keeping only well-formed ones. */
function parseUploads(value: unknown): Upload[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((item) => {
		const file = item as Partial<Upload>;
		if (typeof file?.name !== "string" || typeof file.data !== "string") return [];
		return [{ name: file.name, mimeType: typeof file.mimeType === "string" ? file.mimeType : "", data: file.data }];
	});
}

/** Everything the core's HTTP surface reaches. */
export type CoreDeps = {
	readonly agent: () => Agent | undefined;
	readonly memory: () => Memory | undefined;
	readonly supervisor: Supervisor;
	readonly versions: Versions;
	readonly clientErrors: ClientErrors;
	/** Restores a version and restarts the app; rejects while the agent works. */
	restore(sha: string): Promise<string | undefined>;
};

/**
 * The public server: the agent's own routes under `/__forma/`, and a reverse proxy to the app for everything else,
 * with the dock added to every HTML page.
 */
export class CoreServer {
	readonly #deps: CoreDeps;
	readonly #clients = new Set<ServerResponse>();
	readonly server: Server;

	constructor(deps: CoreDeps) {
		this.#deps = deps;
		this.server = createServer((req, res) => {
			this.#handle(req, res).catch((error: unknown) => {
				console.error("[core]", error);
				if (!res.headersSent) json(res, 500, { error: (error as Error).message });
				else res.end();
			});
		});
		setInterval(() => this.#send("ping", Date.now()), 25_000).unref();
	}

	/** Sends one server-sent event to every open page. */
	broadcast(event: string, data: unknown): void {
		this.#send(event, data);
	}

	#send(event: string, data: unknown): void {
		const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
		for (const client of this.#clients) client.write(frame);
	}

	appState(): { status: string; head: string } {
		return { status: this.#deps.supervisor.status, head: this.#deps.versions.head().slice(0, 7) };
	}

	async #handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
		const url = new URL(req.url ?? "/", "http://forma");
		if (url.pathname.startsWith("/__forma/")) return this.#core(url, req, res);
		return this.#proxy(req, res);
	}

	async #core(url: URL, req: IncomingMessage, res: ServerResponse): Promise<void> {
		const route = `${req.method} ${url.pathname.slice("/__forma".length)}`;
		const agent = this.#deps.agent();
		switch (route) {
			case "GET /dock.js":
			case "GET /viewport.js":
			case "GET /dock.css": {
				const file = url.pathname.slice(url.pathname.lastIndexOf("/") + 1);
				res.writeHead(200, {
					"content-type": file.endsWith(".js") ? "text/javascript" : "text/css",
					"cache-control": "no-cache",
				});
				res.end(readFileSync(join(DOCK_DIR, file)));
				return;
			}
			case "GET /events": {
				res.writeHead(200, {
					"content-type": "text/event-stream",
					"cache-control": "no-store",
					connection: "keep-alive",
					"x-accel-buffering": "no",
				});
				res.write(`retry: 1500\n\n`);
				this.#clients.add(res);
				req.on("close", () => this.#clients.delete(res));
				res.write(`event: app\ndata: ${JSON.stringify(this.appState())}\n\n`);
				if (agent) res.write(`event: chat\ndata: ${JSON.stringify(agent.view)}\n\n`);
				else res.write(`event: agent-error\ndata: ${JSON.stringify("The agent is starting…")}\n\n`);
				return;
			}
			case "POST /chat": {
				if (!agent) return json(res, 503, { error: "The agent is not ready" });
				const body = await readJson(req);
				const text = typeof body.text === "string" ? body.text : "";
				const files = parseUploads(body.files);
				if (!text.trim() && !files.length) return json(res, 400, { error: "Empty message" });
				await agent.send(text, typeof body.screen === "string" ? body.screen : "", files);
				return json(res, 200, { ok: true });
			}
			case "POST /stop":
				await agent?.stop();
				return json(res, 200, { ok: true });
			case "POST /reset":
				await agent?.reset();
				return json(res, 200, { ok: true });
			case "GET /memory": {
				const memory = this.#deps.memory();
				if (!memory) return json(res, 200, { available: false, text: "" });
				return json(res, 200, { available: true, dir: memory.dir, text: await memory.wake() });
			}
			case "GET /history":
				return json(res, 200, { head: this.#deps.versions.head(), versions: this.#deps.versions.log() });
			case "GET /stat": {
				const sha = url.searchParams.get("sha") ?? "";
				if (!/^[0-9a-f]{7,40}$/.test(sha)) return json(res, 400, { error: "Bad sha" });
				return json(res, 200, { stat: this.#deps.versions.stat(sha) });
			}
			case "POST /restore": {
				const body = await readJson(req);
				const sha = typeof body.sha === "string" ? body.sha : "";
				if (!/^[0-9a-f]{7,40}$/.test(sha)) return json(res, 400, { error: "Bad sha" });
				if (agent?.view.busy) return json(res, 409, { error: "The agent is working; stop it first." });
				const created = await this.#deps.restore(sha);
				return json(res, 200, { ok: true, sha: created });
			}
			case "POST /restart": {
				const health = await this.#deps.supervisor.restart();
				this.broadcast("app", this.appState());
				return json(res, 200, health);
			}
			case "POST /client-error": {
				const body = await readJson(req);
				this.#deps.clientErrors.add(`${String(body.where ?? "")}: ${String(body.message ?? "")}`);
				return json(res, 200, { ok: true });
			}
			default:
				return json(res, 404, { error: "Not found" });
		}
	}

	#proxy(req: IncomingMessage, res: ServerResponse): Promise<void> {
		const { supervisor } = this.#deps;
		const headers = { ...req.headers };
		delete headers["accept-encoding"];
		return new Promise((resolve) => {
			const upstream = request(
				{ host: "127.0.0.1", port: supervisor.port, method: req.method, path: req.url, headers },
				(answer) => {
					const type = String(answer.headers["content-type"] ?? "");
					if (!type.includes("text/html")) {
						res.writeHead(answer.statusCode ?? 502, answer.headers);
						answer.pipe(res);
						answer.on("end", resolve);
						return;
					}
					const chunks: Buffer[] = [];
					answer.on("data", (chunk: Buffer) => chunks.push(chunk));
					answer.on("end", () => {
						const html = injectDock(Buffer.concat(chunks).toString("utf8"));
						const out = { ...answer.headers };
						delete out["content-length"];
						delete out["transfer-encoding"];
						res.writeHead(answer.statusCode ?? 200, { ...out, "content-length": Buffer.byteLength(html) });
						res.end(html);
						resolve();
					});
				},
			);
			upstream.on("error", () => {
				const wantsHtml = String(req.headers.accept ?? "").includes("text/html");
				if (wantsHtml) {
					const html = fallbackPage(supervisor.status, supervisor.logs.tail(80));
					res.writeHead(503, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
					res.end(html);
				} else {
					json(res, 502, { error: `The app is ${supervisor.status}` });
				}
				resolve();
			});
			req.pipe(upstream);
		});
	}
}
