import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import {
	type Conversation,
	createRegistry,
	defineExtension,
	defineTool,
	Harness,
	section,
} from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import { arr, obj, str } from "@earendil-works/pi-schema";
import { createClaudeCodeProvider } from "../vendor/pi-claude-code/dist/provider.js";
import { buildMessage, type Upload } from "./attachments.ts";
import { buildChatView, type ChatView, stripContext } from "./chat-view.ts";
import type { Config } from "./config.ts";
import { MEMORY_GUIDE, type Memory } from "./memory.ts";
import type { Supervisor } from "./supervisor.ts";

const context = BACKGROUND_CONTEXT;

/** Browser errors the dock reported, newest last. The agent reads them when it checks the app. */
export class ClientErrors {
	readonly #items: { at: number; text: string }[] = [];

	add(text: string): void {
		this.#items.push({ at: Date.now(), text: text.slice(0, 2_000) });
		if (this.#items.length > 30) this.#items.shift();
	}

	since(at: number): string[] {
		return this.#items.filter((item) => item.at >= at).map((item) => item.text);
	}
}

/** What the agent needs from the rest of the core. */
export type AgentHost = {
	readonly config: Config;
	readonly supervisor: Supervisor;
	readonly clientErrors: ClientErrors;
	/** The agent's permanent memory; undefined when OptMem could not be set up. */
	readonly memory: Memory | undefined;
	/** Tells open browsers to reload, after a change. */
	reloadClients(reason: string): void;
	/** Called when a run starts, before the agent touches anything. */
	onRunStart(): void;
	/** Called once a run ends, with the user's request that started it and the final answer. */
	onRunEnd(request: string, answer: string): Promise<void>;
};

function preamble(config: Config): string {
	return `You are forma's built-in agent. forma is a workout planner and fitness tracker that its owner reshapes by talking to you from inside the app (often from a phone at the gym).

You can do two kinds of things, and should pick whichever the owner means:
1. Work with their training data: plan workouts, build programs, move or log sessions, add custom exercises. Use the app's HTTP API with curl against http://127.0.0.1:${config.appPort} (see the guide below). Never edit the database file by hand while the app runs.
2. Change the app itself: its look, its screens, its features, its data model, its server. Your working directory is the app's source; every file in it is yours to change, including server.ts. Read the guide below first, then the files you need.

How changes reach the owner:
- After changing code, call app_check. It restarts the server, checks every browser module parses, reports server logs and recent browser errors, and reloads the owner's open pages. Fix what it reports before you finish.
- When your run ends, forma saves a version of the app (git) and the owner can roll back any version from the History tab. You do not need to commit.
- When your run ends, the owner's open pages refresh by themselves (a reload if you changed code, a data refresh otherwise). Never tell them to refresh.
- The owner can attach files (Visbody or other scan reports as PDF, screenshots, CSV exports). PDFs and images arrive in their message for you to read directly; every file is also saved under $FORMA_DATA/uploads. When the owner hands you reports to import, read them yourself and write the values through the API; extract every value the report has, not just the headline ones.
- The owner's data lives outside the source in $FORMA_DATA (app.db). It is backed up before each of your runs. Keep data compatible: when you change the shape of stored documents, migrate existing ones instead of dropping them. Never delete training data unless asked.

Style: the owner reads your replies in a small chat panel. Be brief: say what you did in a sentence or two, not how. Ask one short question only when a request is genuinely ambiguous; otherwise make a sensible choice and mention it. Each message from the owner ends with an <app-context> block saying which screen they are looking at; use it to resolve "this", "today", "here".`;
}

function guide(dir: string): string | undefined {
	try {
		return readFileSync(join(dir, "AGENTS.md"), "utf8");
	} catch {
		return undefined;
	}
}

/**
 * The agent: one durable conversation over the live app's source, driven from the dock.
 */
export class Agent {
	readonly #host: AgentHost;
	readonly #harness: Harness;
	readonly #root: Conversation;
	#view: ChatView = { busy: false, items: [], partial: "", queued: 0 };
	#listeners = new Set<(view: ChatView) => void>();
	#busy = false;

	private constructor(host: AgentHost, harness: Harness, root: Conversation) {
		this.#host = host;
		this.#harness = harness;
		this.#root = root;
	}

	/** Opens the agent's storage, resumes any run a previous process left, and starts watching the conversation. */
	static async open(host: AgentHost): Promise<Agent> {
		const { config, supervisor, clientErrors } = host;
		const models = createModels();
		models.setProvider(createClaudeCodeProvider());

		const appCheck = defineTool({
			name: "app_check",
			description:
				"Restart the app server, parse every browser module, and report health, server logs, and browser errors since the last check. Also reloads the owner's open pages. Call it after changing code, and fix anything it reports.",
			parameters: obj({}),
			execute: async () => {
				const startedAt = Date.now();
				const health = await supervisor.restart();
				const syntax = await supervisor.syntaxCheck();
				host.reloadClients("app_check");
				// Give reloaded pages a moment to report errors from their first render.
				await new Promise((resolve) => setTimeout(resolve, 2_500));
				const browser = clientErrors.since(startedAt - 60_000);
				const ok = health.ok && syntax.length === 0;
				const parts = [
					ok ? "OK: server healthy, all modules parse." : "PROBLEMS FOUND.",
					`Server: ${health.detail}`,
					syntax.length ? `Syntax errors:\n${syntax.join("\n\n")}` : "",
					browser.length ? `Browser errors (from open pages, may be from before your fix):\n${browser.join("\n")}` : "",
					`Server log tail:\n${health.logs.split("\n").slice(-25).join("\n")}`,
				];
				return { output: [{ type: "text", text: parts.filter(Boolean).join("\n\n") }] };
			},
		});

		const { memory } = host;
		const memoryTool = defineTool({
			name: "memory",
			description:
				"Your permanent memory (OptMem). Commands: note <line>, nap <a-b> <line>, recall <regex>, zoom <a-b>, forget <a-b>. See the memory section.",
			parameters: obj({
				command: str({ description: "note | nap | recall | zoom | forget" }),
				args: arr(str(), { description: 'Arguments, e.g. ["Prefers 4-day splits"] or ["0-1", "summary line"]' }),
			}),
			execute: async (args) => {
				if (!memory) throw new Error("Memory is not available on this machine (needs python3 and a first download).");
				if (!["note", "nap", "recall", "zoom", "forget"].includes(args.command)) {
					throw new Error(`Unknown memory command "${args.command}"`);
				}
				const result = await memory.run([args.command, ...args.args]);
				if (!result.ok) throw new Error(result.output || "memo failed");
				return { output: [{ type: "text", text: result.output }] };
			},
		});

		const Forma = defineExtension({
			name: "forma",
			sections: [
				section("preamble", () => preamble(config), { tag: false }),
				section("memory", async () =>
					memory ? `${MEMORY_GUIDE}\n\n${await memory.wake()}` : "Permanent memory is not available on this machine.",
				),
				section("app-guide", () => guide(config.liveApp)),
			],
			tools: [appCheck, memoryTool],
		});

		const registry = createRegistry();
		registry.install(CodingTools);
		registry.install(Forma);

		const storage = await openNodeSqliteStorage(config.agentDb);
		const harness = await Harness.open(
			storage,
			{
				models,
				registry,
				identity: { attribution: null },
				env: () =>
					new NodeExecutionEnv({
						cwd: config.liveApp,
					}),
				settings: { retry: { maxRetries: 2 }, afterFailedRun: "continue" },
				onReport: (report) => {
					console.error(`[agent] ${report.kind}: ${(report as { error?: Error }).error?.message ?? ""}`);
				},
			},
			context,
		);
		const root = await harness.root(context);
		await root.configure(
			{
				model: { provider: "claude-code", modelId: config.model },
				thinkingLevel: config.thinkingLevel,
				cwd: config.liveApp,
				maxTurns: 80,
			},
			context,
		);
		const agent = new Agent(host, harness, root);
		await agent.#watch();
		harness.resume();
		return agent;
	}

	async #watch(): Promise<void> {
		const watch = await this.#root.watch(context, { min: 80, max: 200 });
		this.#apply(watch.value);
		watch.start(async (call) => {
			if (call.kind === "value") this.#apply(call.value);
		});
	}

	#apply(value: { entries: unknown; docs: unknown }): void {
		const entries = value.entries as Parameters<typeof buildChatView>[0];
		this.#view = buildChatView(entries, value.docs as Record<string, unknown>);
		const wasBusy = this.#busy;
		this.#busy = this.#view.busy;
		if (!wasBusy && this.#busy) this.#host.onRunStart();
		if (wasBusy && !this.#busy) {
			const items = this.#view.items;
			const request = [...items].reverse().find((item) => item.type === "user");
			const answer = [...items].reverse().find((item) => item.type === "assistant");
			void this.#host.onRunEnd(
				request?.type === "user" ? request.text : "Agent change",
				answer?.type === "assistant" ? answer.text : "",
			);
		}
		for (const listener of this.#listeners) listener(this.#view);
	}

	get view(): ChatView {
		return this.#view;
	}

	/** Calls `listener` with every new view until the returned function is called. */
	subscribe(listener: (view: ChatView) => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	/**
	 * Sends the owner's message. While a run works, it steers that run.
	 *
	 * Args:
	 *   text: What the owner typed.
	 *   screen: Where the owner is in the app (the page's hash route and title).
	 *   uploads: Attached files; saved to the uploads directory and handed to the model.
	 */
	async send(text: string, screen: string, uploads: readonly Upload[] = []): Promise<void> {
		const today = new Date();
		const date = today.toLocaleDateString("en-CA");
		const weekday = today.toLocaleDateString("en-US", { weekday: "long" });
		const appContext = `<app-context>\nToday: ${weekday} ${date}\nScreen: ${screen || "unknown"}\n</app-context>`;
		const typed = text.trim() || "(see the attached files)";
		const content = buildMessage(join(this.#host.config.data, "uploads"), typed, uploads, appContext, date);
		await this.#root.submit({ type: "input", content, whenBusy: "steer" }, context);
	}

	async stop(): Promise<void> {
		await this.#root.abort(context);
	}

	/** Starts a fresh context; the old messages stay stored but the model no longer sees them. */
	async reset(): Promise<void> {
		await this.#root.reset(undefined, context);
	}

	async close(): Promise<void> {
		await this.#harness.close(context);
	}
}

export { stripContext };
