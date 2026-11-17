import { networkInterfaces } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The forma checkout: the stable core plus the seed of the malleable app. */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Where everything a running forma owns lives. `FORMA_HOME` overrides it. */
export const HOME = resolve(process.env.FORMA_HOME ?? join(ROOT, ".forma"));

/** The paths and ports one forma instance uses. */
export type Config = {
	/** The seed app copied into `liveApp` on first start. */
	readonly seedApp: string;
	/** The live, agent-editable copy of the app. Its own git repository. */
	readonly liveApp: string;
	/** The app's data: its database, the exercise library, cached media, backups. Outside the app's git. */
	readonly data: string;
	/** The agent's durable storage. */
	readonly agentDb: string;
	/** OptMem: the script, and the directory of memories (`FORMA_MEMORY_DIR` to share one, e.g. ~/.optmem/memory). */
	readonly memoTool: string;
	readonly memoryDir: string;
	/** Public port, on every interface, so phones on the LAN reach it. */
	readonly port: number;
	readonly host: string;
	/** Loopback port of the app process behind the proxy. */
	readonly appPort: number;
	/** The model the agent runs with, on the Claude Code provider. */
	readonly model: string;
	readonly thinkingLevel: "minimal" | "low" | "medium" | "high" | "xhigh";
};

/** Reads the configuration from the environment, with defaults. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
	const port = Number(env.PORT ?? 4300);
	return {
		seedApp: join(ROOT, "app"),
		liveApp: join(HOME, "app"),
		data: join(HOME, "data"),
		agentDb: join(HOME, "agent.sqlite"),
		memoTool: join(HOME, "optmem", "memo"),
		memoryDir: resolve(env.FORMA_MEMORY_DIR ?? join(HOME, "memory")),
		port,
		host: env.HOST ?? "0.0.0.0",
		appPort: Number(env.APP_PORT ?? port + 1),
		model: env.FORMA_MODEL ?? "claude-opus-5-5",
		thinkingLevel: (env.FORMA_THINKING as Config["thinkingLevel"] | undefined) ?? "medium",
	};
}

/** The addresses other devices on the LAN can open. */
export function lanUrls(port: number): string[] {
	const urls: string[] = [];
	for (const addresses of Object.values(networkInterfaces())) {
		for (const address of addresses ?? []) {
			if (address.family === "IPv4" && !address.internal) urls.push(`http://${address.address}:${port}`);
		}
	}
	return urls;
}
