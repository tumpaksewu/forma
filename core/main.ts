#!/usr/bin/env node
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Agent, ClientErrors } from "./agent.ts";
import { HOME, lanUrls, loadConfig } from "./config.ts";
import { CoreServer } from "./http.ts";
import { Memory } from "./memory.ts";
import { Supervisor } from "./supervisor.ts";
import { Versions } from "./versions.ts";

const config = loadConfig();
mkdirSync(config.data, { recursive: true });

const versions = new Versions(config.liveApp);
if (versions.ensure(config.seedApp)) console.log(`[forma] created the live app at ${config.liveApp}`);
if (versions.dirty()) versions.commit("Changes made outside the agent");

const supervisor = new Supervisor(config.liveApp, config.appPort, {
	FORMA_DATA: config.data,
	EXERCISEDB_RAPIDAPI_KEY: process.env.EXERCISEDB_RAPIDAPI_KEY ?? "",
});
const clientErrors = new ClientErrors();
let agent: Agent | undefined;
let memory: Memory | undefined;

/** Copies the app's database aside before the agent runs, keeping the newest 20. */
function backupData(): void {
	const db = join(config.data, "app.db");
	const dir = join(config.data, "backups");
	try {
		mkdirSync(dir, { recursive: true });
		const target = join(dir, `app-${new Date().toISOString().replace(/[:.]/g, "-")}.db`);
		const handle = new DatabaseSync(db, { readOnly: true });
		handle.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
		handle.close();
		const old = readdirSync(dir)
			.filter((name) => name.endsWith(".db"))
			.sort()
			.slice(0, -20);
		for (const name of old) rmSync(join(dir, name));
	} catch (error) {
		console.warn(`[forma] data backup skipped: ${(error as Error).message}`);
	}
}

const server = new CoreServer({
	agent: () => agent,
	memory: () => memory,
	supervisor,
	versions,
	clientErrors,
	async restore(sha) {
		const created = versions.restore(sha);
		await supervisor.restart();
		server.broadcast("app", server.appState());
		server.broadcast("reload", { reason: "restore" });
		return created;
	},
});

supervisor.on("status", () => server.broadcast("app", server.appState()));

server.server.listen(config.port, config.host, () => {
	console.log(`[forma] listening on http://localhost:${config.port}`);
	for (const url of lanUrls(config.port)) console.log(`[forma] on your LAN: ${url}`);
	console.log(`[forma] home: ${HOME}`);
});

const health = await supervisor.start();
if (!health.ok) console.warn(`[forma] the app did not start:\n${health.logs}`);

try {
	memory = await Memory.open(config.memoTool, config.memoryDir);
	console.log(`[forma] memory: ${config.memoryDir}`);
} catch (error) {
	console.warn(`[forma] memory unavailable: ${(error as Error).message}`);
}

try {
	agent = await Agent.open({
		config,
		supervisor,
		clientErrors,
		memory,
		reloadClients: (reason) => server.broadcast("reload", { reason }),
		onRunStart: () => {
			backupData();
		},
		onRunEnd: async (request, answer) => {
			const subject = request.split("\n")[0]?.slice(0, 72) || "Agent change";
			const sha = versions.commit(subject, answer.slice(0, 2_000));
			if (sha) {
				await supervisor.restart();
				server.broadcast("reload", { reason: "change", sha: sha.slice(0, 7) });
			} else {
				server.broadcast("data", { reason: "run-end" });
			}
			server.broadcast("app", server.appState());
		},
	});
	agent.subscribe((view) => server.broadcast("chat", view));
	server.broadcast("chat", agent.view);
	console.log(`[forma] agent ready (claude-code/${config.model}, thinking ${config.thinkingLevel})`);
} catch (error) {
	console.error("[forma] the agent failed to start:", error);
	server.broadcast("agent-error", (error as Error).message);
}

async function shutdown(): Promise<void> {
	console.log("\n[forma] shutting down");
	await supervisor.stop();
	await agent?.close().catch(() => {});
	process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
