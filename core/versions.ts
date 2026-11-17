import { execFileSync } from "node:child_process";
import { cpSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** One saved version of the live app. */
export type Version = {
	readonly sha: string;
	readonly short: string;
	readonly date: string;
	readonly subject: string;
	readonly body: string;
};

/**
 * The live app's history, kept as a git repository of its own so every agent change can be looked at and undone,
 * without touching the forma checkout.
 */
export class Versions {
	readonly dir: string;

	constructor(dir: string) {
		this.dir = dir;
	}

	#git(args: string[], input?: string): string {
		// The live app's history is local bookkeeping: never signed, whatever the owner's global git config says.
		return execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], {
			cwd: this.dir,
			encoding: "utf8",
			input,
			stdio: ["pipe", "pipe", "pipe"],
			env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
		});
	}

	/**
	 * Creates the live app from the seed on first start.
	 *
	 * Returns:
	 *   True when the live app was created now.
	 */
	ensure(seed: string): boolean {
		if (existsSync(join(this.dir, ".git"))) {
			// A first start that died before its first commit leaves a repository without one; finish it.
			try {
				this.head();
				return false;
			} catch {
				this.#git(["add", "-A"]);
				this.#git(["commit", "-q", "-m", "Seed: the original forma app"]);
				return true;
			}
		}
		cpSync(seed, this.dir, {
			recursive: true,
			filter: (path) => !path.includes("node_modules") && !path.endsWith(".DS_Store"),
		});
		writeFileSync(join(this.dir, ".gitignore"), "node_modules/\n.DS_Store\n");
		this.#git(["init", "-q", "-b", "main"]);
		this.#git(["config", "user.name", "forma agent"]);
		this.#git(["config", "user.email", "agent@forma.local"]);
		this.#git(["add", "-A"]);
		this.#git(["commit", "-q", "-m", "Seed: the original forma app"]);
		return true;
	}

	/** Whether files changed since the last saved version. */
	dirty(): boolean {
		return this.#git(["status", "--porcelain"]).trim() !== "";
	}

	/**
	 * Saves every change as a new version.
	 *
	 * Returns:
	 *   The new version's sha, or undefined when nothing changed.
	 */
	commit(subject: string, body = ""): string | undefined {
		if (!this.dirty()) return undefined;
		this.#git(["add", "-A"]);
		const message = body ? `${subject}\n\n${body}` : subject;
		this.#git(["commit", "-q", "-F", "-"], message);
		return this.head();
	}

	head(): string {
		return this.#git(["rev-parse", "HEAD"]).trim();
	}

	/** The newest versions first. */
	log(limit = 60): Version[] {
		const sep = "\x1f";
		const end = "\x1e";
		const out = this.#git(["log", `-n${limit}`, `--format=%H${sep}%h${sep}%cI${sep}%s${sep}%b${end}`]);
		return out
			.split(end)
			.map((chunk) => chunk.trim())
			.filter(Boolean)
			.map((chunk) => {
				const [sha = "", short = "", date = "", subject = "", body = ""] = chunk.split(sep);
				return { sha, short, date, subject, body: body.trim() };
			});
	}

	/** Files a version changed, with line counts. */
	stat(sha: string): string {
		return this.#git(["show", "--stat", "--format=", sha]).trim();
	}

	/**
	 * Makes the app exactly what it was at `sha`, as a new version on top, so the restore itself can be undone.
	 *
	 * Returns:
	 *   The new version's sha, or undefined when the app already matched.
	 */
	restore(sha: string): string | undefined {
		const full = this.#git(["rev-parse", "--verify", `${sha}^{commit}`]).trim();
		const subject = this.#git(["log", "-1", "--format=%s", full]).trim();
		if (this.dirty()) this.commit("Unsaved changes before a restore");
		this.#git(["rm", "-r", "-q", "--ignore-unmatch", "."]);
		this.#git(["checkout", full, "--", "."]);
		return this.commit(`Restore: ${subject}`, `Restored the app to ${full.slice(0, 7)}.`);
	}
}
