import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * The agent's permanent memory: OptMem (github.com/VictorTaelin/OptMem), an append-only log of one-line memories
 * with a tree of summaries, driven by one Python script. forma fetches the script at a pinned commit on first start
 * (the repository has no license, so it is not copied into forma) and keeps the memories in its own directory.
 */

const COMMIT = "1fb164cf39028047781f72ac3bb1e5a691c1dcb0";
const SHA256 = "3dc120d01be3115ef6267eab4103e7909fc830d6227b549f20991ba999ee9ffb";
const URL = `https://raw.githubusercontent.com/VictorTaelin/OptMem/${COMMIT}/memo`;

/** What one memo command printed. */
export type MemoResult = { readonly ok: boolean; readonly output: string };

export class Memory {
	readonly tool: string;
	readonly dir: string;

	constructor(tool: string, dir: string) {
		this.tool = tool;
		this.dir = dir;
	}

	/**
	 * Fetches the pinned OptMem script if it is missing, checks it, and creates the memory.
	 *
	 * Raises:
	 *   Error: When the download fails or does not match the pinned checksum.
	 */
	static async open(tool: string, dir: string): Promise<Memory> {
		if (!existsSync(tool)) {
			const response = await fetch(URL);
			if (!response.ok) throw new Error(`OptMem download failed: ${response.status}`);
			const bytes = Buffer.from(await response.arrayBuffer());
			const digest = createHash("sha256").update(bytes).digest("hex");
			if (digest !== SHA256) throw new Error(`OptMem script checksum mismatch: ${digest}`);
			mkdirSync(dirname(tool), { recursive: true });
			writeFileSync(tool, bytes);
			chmodSync(tool, 0o755);
		} else {
			const digest = createHash("sha256").update(readFileSync(tool)).digest("hex");
			if (digest !== SHA256) console.warn(`[memory] ${tool} differs from the pinned OptMem; using it anyway`);
		}
		const memory = new Memory(tool, dir);
		mkdirSync(dir, { recursive: true });
		await memory.run(["init"]);
		return memory;
	}

	/** Runs one memo command against this memory. */
	run(args: string[]): Promise<MemoResult> {
		return new Promise((resolve) => {
			execFile(
				"python3",
				[this.tool, ...args],
				{ env: { ...process.env, MEMORY_DIR: this.dir }, maxBuffer: 8 * 1024 * 1024, timeout: 30_000 },
				(error, stdout, stderr) => {
					resolve({ ok: !error, output: `${stdout}${stderr ? `\n${stderr}` : ""}`.trim() });
				},
			);
		});
	}

	/**
	 * The whole memory context, all parts joined, as `memo wake` prints it. When wake cannot finish because a
	 * compression is due, the output says so and carries the compression request instead.
	 */
	async wake(): Promise<string> {
		const first = await this.run(["wake"]);
		const parts = [first.output];
		let last = first.output;
		for (let guard = 0; guard < 20; guard++) {
			const next = last.match(/Not awake yet\. Run: \S+ wake (\d+) (\d+)/);
			if (!next) break;
			const result = await this.run(["wake", next[1]!, next[2]!]);
			parts.push(result.output);
			last = result.output;
		}
		return parts.join("\n");
	}
}

/** How the agent is told to use its memory, adapted from OptMem's own prompt for a tool instead of a shell. */
export const MEMORY_GUIDE = `Your memory is OptMem. It outlives every conversation, reset, compaction and model change; the chat itself does not. Without it you do not know who the owner is or what was decided and tried.

Your memory as of now is at the end of this block. You use it through the \`memory\` tool:
- \`memory note "<one line, at most 280 bytes>"\` whenever you learn something worth keeping: the owner's goals, injuries and pain, training history, schedule, equipment and gym, preferences (how they like plans, units, the look of the app), what they liked or disliked about a change, decisions and their reasons, events of lasting effect (a new PR, a new program, an injury). Do not record what the database already holds (individual workouts, sets, scan numbers): record what they mean ("cut started 2026-11-20 at 82 kg, target 76 kg by March"). Never record redundant memories.
- When a note (or the memory below) asks for a compression, do it before your next action: \`memory nap <a-b> "<one line>"\`, keeping what has lasting effect and inventing nothing.
- \`memory recall <regex>\` searches every memory word for word; \`memory zoom <a-b>\` opens a summary line (#a-b) into its two halves, down to the raw memories; \`memory forget <a-b>\` drops a bad summary so the next nap rebuilds it.
Shell commands the memory prints (".../memo nap 0-1 ...") map to the same \`memory\` tool calls; never run the script yourself and never touch its files.`;
