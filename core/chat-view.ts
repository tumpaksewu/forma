import { attachmentNames } from "./attachments.ts";

/**
 * Turns the agent conversation's committed state into the small, flat shape the dock renders. Pure: no I/O.
 */

/** One row of the chat as the dock shows it. */
export type ChatItem =
	| { readonly type: "user"; readonly id: string; readonly text: string; readonly files?: string[] }
	| { readonly type: "assistant"; readonly id: string; readonly text: string }
	| {
			readonly type: "tool";
			readonly id: string;
			readonly name: string;
			readonly summary: string;
			readonly state: "running" | "done" | "error";
			readonly output?: string;
	  }
	| { readonly type: "notice"; readonly id: string; readonly text: string; readonly tone: "info" | "error" };

export type ChatView = {
	readonly busy: boolean;
	readonly items: ChatItem[];
	/** Text of the answer being written right now. */
	readonly partial: string;
	readonly failure?: string;
	readonly queued: number;
};

type Block = { type?: string; text?: string; id?: string; name?: string; arguments?: Record<string, unknown> };
type ModelMessage = {
	role?: string;
	content?: string | Block[];
	toolCallId?: string;
	isError?: boolean;
	stopReason?: string;
	errorMessage?: string;
};
type Entry = { id: number; kind: string; model?: ModelMessage[]; data?: unknown };
type ToolSlot = { callId: string; name: string; status: string; output?: string };
type Live = {
	run?: unknown;
	generation?: { message?: ModelMessage; retry?: { error?: string } };
	tools?: ToolSlot[];
	runFailure?: { reason: string; detail?: string };
};

/** A short line saying what a tool call does, for the step list. */
export function summarizeCall(name: string, args: Record<string, unknown> | undefined): string {
	const a = args ?? {};
	const str = (value: unknown) => (typeof value === "string" ? value : "");
	switch (name) {
		case "bash":
			return str(a.command).split("\n")[0]?.slice(0, 140) ?? "";
		case "read":
			return `Read ${str(a.path)}`;
		case "write":
			return `Write ${str(a.path)}`;
		case "edit":
			return `Edit ${str(a.path)}`;
		case "app_check":
			return "Restart and check the app";
		case "memory": {
			const rest = Array.isArray(a.args) ? a.args.join(" ") : "";
			return `Memory ${str(a.command)} ${rest}`.slice(0, 140);
		}
		default:
			return name;
	}
}

function textOf(content: ModelMessage["content"]): string {
	if (typeof content === "string") return content;
	return (content ?? [])
		.filter((block) => block.type === "text")
		.map((block) => block.text ?? "")
		.join("");
}

function clip(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** The text a user typed, without the context and attachments forma adds to it. */
export function stripContext(text: string): string {
	return text
		.replace(/<app-context>[\s\S]*?<\/app-context>/g, "")
		.replace(/<attachments>[\s\S]*?<\/attachments>/g, "")
		.replace(/<file name="[^"]*">[\s\S]*?<\/file>/g, "")
		.trim();
}

/**
 * Builds the dock's view from one value of the conversation watch.
 *
 * Args:
 *   entries: The watch window's entries, oldest first.
 *   docs: The watch's documents; only `pi.live` and `pi.inbox` are read.
 */
export function buildChatView(entries: readonly Entry[], docs: Record<string, unknown>): ChatView {
	const items: ChatItem[] = [];
	const tools = new Map<string, number>();
	for (const entry of entries) {
		if (entry.kind === "pi.reset") {
			items.length = 0;
			tools.clear();
			continue;
		}
		const message = entry.model?.[0];
		if (!message) continue;
		if (message.role === "user") {
			const raw = textOf(message.content);
			const text = stripContext(raw);
			const files = attachmentNames(raw);
			if (text || files.length)
				items.push({ type: "user", id: `${entry.id}`, text, ...(files.length ? { files } : {}) });
		} else if (message.role === "assistant") {
			const blocks =
				typeof message.content === "string" ? [{ type: "text", text: message.content }] : (message.content ?? []);
			let index = 0;
			for (const block of blocks) {
				index++;
				if (block.type === "text" && block.text?.trim()) {
					items.push({ type: "assistant", id: `${entry.id}.${index}`, text: block.text });
				} else if (block.type === "toolCall" && block.id && block.name) {
					tools.set(block.id, items.length);
					items.push({
						type: "tool",
						id: block.id,
						name: block.name,
						summary: summarizeCall(block.name, block.arguments),
						state: "running",
					});
				}
			}
			if (message.stopReason === "error" && message.errorMessage) {
				items.push({ type: "notice", id: `${entry.id}.err`, text: clip(message.errorMessage, 400), tone: "error" });
			}
		} else if (message.role === "toolResult" && message.toolCallId) {
			const at = tools.get(message.toolCallId);
			const item = at === undefined ? undefined : items[at];
			if (at !== undefined && item?.type === "tool") {
				items[at] = {
					...item,
					state: message.isError ? "error" : "done",
					output: clip(textOf(message.content).trim(), 1_500),
				};
			}
		}
	}

	const live = (docs["pi.live"] ?? {}) as Live;
	for (const slot of live.tools ?? []) {
		const at = tools.get(slot.callId);
		const item = at === undefined ? undefined : items[at];
		if (at !== undefined && item?.type === "tool" && item.state === "running" && slot.output) {
			items[at] = { ...item, output: clip(slot.output.slice(-1_500), 1_500) };
		}
	}
	const busy = live.run !== undefined;
	const partial = busy ? textOf(live.generation?.message?.content) : "";
	const failure = live.runFailure
		? `${live.runFailure.reason.replaceAll("_", " ")}${live.runFailure.detail ? `: ${clip(live.runFailure.detail, 300)}` : ""}`
		: undefined;
	const inbox = (docs["pi.inbox"] ?? {}) as { items?: unknown[] };
	const view: ChatView = { busy, items: items.slice(-200), partial, queued: inbox.items?.length ?? 0 };
	return failure && !busy ? { ...view, failure } : view;
}
