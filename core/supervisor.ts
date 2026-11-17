import { type ChildProcess, execFile, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";

export type AppStatus = "starting" | "running" | "crashed" | "stopped";

/** What a restart found. */
export type Health = {
	readonly ok: boolean;
	readonly status: AppStatus;
	readonly detail: string;
	readonly logs: string;
};

/** Keeps the last lines a process printed. */
class LogRing {
	readonly #lines: string[] = [];
	readonly #max: number;
	#partial = "";

	constructor(max: number) {
		this.#max = max;
	}

	push(chunk: string): void {
		const text = this.#partial + chunk;
		const lines = text.split("\n");
		this.#partial = lines.pop() ?? "";
		for (const line of lines) {
			this.#lines.push(line);
			if (this.#lines.length > this.#max) this.#lines.shift();
		}
	}

	note(line: string): void {
		this.push(`[forma] ${line}\n`);
	}

	tail(count = 60): string {
		const lines = [...this.#lines, ...(this.#partial ? [this.#partial] : [])];
		return lines.slice(-count).join("\n");
	}
}

/**
 * Runs the malleable app as a child process on a loopback port, restarts it on request, and notices when it dies.
 * It never restarts a crashing app in a loop: after three crashes in a minute it stays down until asked.
 */
export class Supervisor extends EventEmitter<{ status: [AppStatus] }> {
	readonly logs = new LogRing(400);
	readonly #dir: string;
	readonly #port: number;
	readonly #env: NodeJS.ProcessEnv;
	#child: ChildProcess | undefined;
	#status: AppStatus = "stopped";
	#crashes: number[] = [];

	constructor(dir: string, port: number, env: NodeJS.ProcessEnv) {
		super();
		this.#dir = dir;
		this.#port = port;
		this.#env = env;
	}

	get status(): AppStatus {
		return this.#status;
	}

	get port(): number {
		return this.#port;
	}

	#set(status: AppStatus): void {
		if (status === this.#status) return;
		this.#status = status;
		this.emit("status", status);
	}

	#spawn(): void {
		const child = spawn(process.execPath, ["server.ts"], {
			cwd: this.#dir,
			env: { ...process.env, ...this.#env, PORT: String(this.#port), HOST: "127.0.0.1" },
			stdio: ["ignore", "pipe", "pipe"],
		});
		this.#child = child;
		this.#set("starting");
		child.stdout?.setEncoding("utf8").on("data", (chunk: string) => this.logs.push(chunk));
		child.stderr?.setEncoding("utf8").on("data", (chunk: string) => this.logs.push(chunk));
		child.on("exit", (code, signal) => {
			if (this.#child !== child) return;
			this.#child = undefined;
			this.logs.note(`app exited (${signal ?? `code ${code}`})`);
			this.#set("crashed");
			const now = Date.now();
			this.#crashes = [...this.#crashes.filter((at) => now - at < 60_000), now];
			if (this.#crashes.length < 3) {
				setTimeout(() => {
					if (!this.#child && this.#status === "crashed") void this.start();
				}, 1_000);
			} else {
				this.logs.note("crashed 3 times in a minute; staying down until restarted");
			}
		});
	}

	async #waitUp(timeoutMs: number): Promise<boolean> {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			if (!this.#child) return false;
			try {
				const response = await fetch(`http://127.0.0.1:${this.#port}/api/health`, {
					signal: AbortSignal.timeout(1_000),
				});
				await response.body?.cancel();
				if (response.status < 500) return true;
			} catch {
				// not listening yet
			}
			await new Promise((resolve) => setTimeout(resolve, 150));
		}
		return false;
	}

	/** Starts the app if it is not running and waits until it answers. */
	async start(): Promise<Health> {
		if (!this.#child) this.#spawn();
		const up = await this.#waitUp(10_000);
		if (up) this.#set("running");
		return {
			ok: up,
			status: this.#status,
			detail: up ? "The app answers on /api/health." : "The app did not answer within 10 s.",
			logs: this.logs.tail(),
		};
	}

	/** Stops the app process, waiting for it to exit. */
	async stop(): Promise<void> {
		const child = this.#child;
		if (!child) return;
		this.#child = undefined;
		const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
		child.kill("SIGTERM");
		const timer = setTimeout(() => child.kill("SIGKILL"), 3_000);
		await exited;
		clearTimeout(timer);
		this.#set("stopped");
	}

	/** Stops and starts the app again, so changed server code takes effect. */
	async restart(): Promise<Health> {
		await this.stop();
		this.#crashes = [];
		this.logs.note("restarting app");
		return this.start();
	}

	/**
	 * Parses every JavaScript module of the app the way Node would, to catch syntax errors before a browser loads them.
	 *
	 * Returns:
	 *   One line per broken file, empty when all parse.
	 */
	async syntaxCheck(): Promise<string[]> {
		const files = walk(join(this.#dir, "web")).filter(
			(path) => path.endsWith(".js") && !path.includes(`${join("web", "vendor")}`),
		);
		const problems: string[] = [];
		await Promise.all(
			files.map(
				(file) =>
					new Promise<void>((resolve) => {
						execFile(process.execPath, ["--check", file], { cwd: this.#dir }, (error, _out, stderr) => {
							if (error)
								problems.push(`${relative(this.#dir, file)}:\n${stderr.trim().split("\n").slice(0, 6).join("\n")}`);
							resolve();
						});
					}),
			),
		);
		return problems;
	}
}

function walk(dir: string): string[] {
	let entries: import("node:fs").Dirent[];
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}
	return entries.flatMap((entry) => {
		if (entry.name === "node_modules" || entry.name.startsWith(".")) return [];
		const path = join(dir, entry.name);
		return entry.isDirectory() ? walk(path) : [path];
	});
}
