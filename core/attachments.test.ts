import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { attachmentNames, buildMessage, safeName } from "./attachments.ts";
import { stripContext } from "./chat-view.ts";
import { Memory } from "./memory.ts";

const dir = mkdtempSync(join(tmpdir(), "forma-att-"));
after(() => rmSync(dir, { recursive: true, force: true }));
const b64 = (text: string) => Buffer.from(text).toString("base64");

test("a message without files stays plain text", () => {
	assert.equal(
		buildMessage(dir, "hi", [], "<app-context>x</app-context>", "2026-11-17"),
		"hi\n\n<app-context>x</app-context>",
	);
});

test("PDFs and images ride as blocks, text inline, all saved", () => {
	// Arrange
	const uploads = [
		{ name: "scan 1.pdf", mimeType: "application/pdf", data: b64("%PDF") },
		{ name: "shot.png", mimeType: "image/png", data: b64("png") },
		{ name: "log.csv", mimeType: "text/csv", data: b64("date,kg\n2026-01-01,80") },
	];
	// Act
	const content = buildMessage(join(dir, "up"), "import", uploads, "<app-context>x</app-context>", "2026-11-17");
	// Assert
	assert.ok(Array.isArray(content));
	assert.equal(content.length, 3);
	assert.deepEqual(
		content.slice(1).map((block) => block.type === "image" && block.mimeType),
		["application/pdf", "image/png"],
	);
	const text = content[0]?.type === "text" ? content[0].text : "";
	assert.match(text, /<file name="log.csv">\ndate,kg/);
	assert.equal(readFileSync(join(dir, "up", "2026-11-17-scan-1.pdf"), "utf8"), "%PDF");
	assert.deepEqual(attachmentNames(text), ["scan 1.pdf", "shot.png", "log.csv"]);
	assert.equal(stripContext(text), "import");
});

test("a second upload with the same name does not overwrite the first", () => {
	const up = join(dir, "dup");
	buildMessage(up, "a", [{ name: "x.pdf", mimeType: "application/pdf", data: b64("1") }], "", "2026-11-17");
	buildMessage(up, "b", [{ name: "x.pdf", mimeType: "application/pdf", data: b64("2") }], "", "2026-11-17");
	assert.equal(readFileSync(join(up, "2026-11-17-x.pdf"), "utf8"), "1");
	assert.equal(readFileSync(join(up, "2026-11-17-2-x.pdf"), "utf8"), "2");
});

test("safeName drops directories and odd characters", () => {
	assert.equal(safeName("../../etc/pass wd?.pdf"), "pass-wd_.pdf");
});

test("wake joins every part the memory is printed in", async () => {
	// Arrange: a stand-in for the memo script that prints two parts.
	const tool = join(dir, "memo");
	writeFileSync(
		tool,
		`import sys
a = sys.argv[1:]
if a == ["wake"]:
    print("#0 2026-11-01 first"); print("Not awake yet. Run: memo wake 2 2")
elif a == ["wake", "2", "2"]:
    print("#1 2026-11-02 second"); print("You are awake.")
`,
	);
	chmodSync(tool, 0o755);
	const memory = new Memory(tool, join(dir, "mem"));
	// Act
	const text = await memory.wake();
	// Assert
	assert.match(text, /#0 2026-11-01 first[\s\S]*#1 2026-11-02 second[\s\S]*You are awake\./);
});
