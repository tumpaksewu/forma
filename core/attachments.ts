import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";

/**
 * Files the owner attaches in the dock. Every file is kept in the uploads directory, so the agent and the owner can
 * come back to it. Images and PDFs also go to the model as they are (Claude reads both natively); text files go
 * inline. Nothing is parsed here: this is transport only.
 */

/** A file as the dock sends it. */
export type Upload = { readonly name: string; readonly mimeType: string; readonly data: string };

/** Content blocks of one user message, in pi-ai's shape. A PDF rides as an image block with its own MIME type. */
export type ContentBlock = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

/** The types the model reads natively. */
const NATIVE = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"]);
const TEXT_EXT = new Set([".csv", ".tsv", ".txt", ".json", ".md", ".xml", ".gpx", ".tcx"]);
const MAX_INLINE_TEXT = 200_000;

const isText = (upload: Upload) =>
	upload.mimeType.startsWith("text/") ||
	upload.mimeType === "application/json" ||
	TEXT_EXT.has(extname(upload.name).toLowerCase());

/** A file name safe to keep on disk, without its directory. */
export function safeName(name: string): string {
	const base = basename(name)
		.replace(/[^\w.\- ]+/g, "_")
		.replace(/\s+/g, "-")
		.slice(-120);
	return base || "file";
}

function size(bytes: number): string {
	return bytes > 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.ceil(bytes / 1_000)} KB`;
}

/**
 * Saves the uploads and builds the message the model sees.
 *
 * Args:
 *   dir: The uploads directory.
 *   text: What the owner typed.
 *   uploads: The attached files.
 *   context: The `<app-context>` block that ends every message.
 *   today: Date prefix for saved names ("YYYY-MM-DD").
 */
export function buildMessage(
	dir: string,
	text: string,
	uploads: readonly Upload[],
	context: string,
	today: string,
): ContentBlock[] | string {
	if (!uploads.length) return `${text}\n\n${context}`;
	mkdirSync(dir, { recursive: true });
	const lines: string[] = [];
	const inline: string[] = [];
	const blocks: ContentBlock[] = [];
	for (const upload of uploads) {
		const bytes = Buffer.from(upload.data, "base64");
		const name = safeName(upload.name);
		let path = join(dir, `${today}-${name}`);
		for (let n = 2; existsSync(path); n++) path = join(dir, `${today}-${n}-${name}`);
		writeFileSync(path, bytes);
		let how = "kept on disk only (not a type you can read directly)";
		if (NATIVE.has(upload.mimeType)) {
			blocks.push({ type: "image", data: upload.data, mimeType: upload.mimeType });
			how = "attached below";
		} else if (isText(upload)) {
			const body = bytes.toString("utf8");
			inline.push(
				`<file name="${name}">\n${body.slice(0, MAX_INLINE_TEXT)}${body.length > MAX_INLINE_TEXT ? "\n[truncated; read the saved file for the rest]" : ""}\n</file>`,
			);
			how = "inlined below";
		}
		lines.push(
			`- ${upload.name} (${upload.mimeType || "unknown type"}, ${size(bytes.length)}): saved at ${path}; ${how}`,
		);
	}
	const header = `${text}\n\n<attachments>\n${lines.join("\n")}\n</attachments>`;
	const body = [header, ...inline, context].join("\n\n");
	return [{ type: "text", text: body }, ...blocks];
}

/** The attached file names in a message built by `buildMessage`, for the chat view. */
export function attachmentNames(text: string): string[] {
	const block = text.match(/<attachments>\n([\s\S]*?)\n<\/attachments>/)?.[1];
	if (!block) return [];
	return block
		.split("\n")
		.map((line) => line.match(/^- (.*?) \(/)?.[1])
		.filter((name): name is string => Boolean(name));
}
