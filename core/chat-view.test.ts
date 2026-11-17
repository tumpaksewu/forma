import assert from "node:assert/strict";
import { test } from "node:test";
import { buildChatView, stripContext, summarizeCall } from "./chat-view.ts";

test("stripContext removes the app-context block forma appends", () => {
	// Arrange
	const text = "Plan legs\n\n<app-context>\nToday: Tuesday\n</app-context>";
	// Act
	const stripped = stripContext(text);
	// Assert
	assert.equal(stripped, "Plan legs");
});

test("summarizeCall describes common tools", () => {
	assert.equal(summarizeCall("bash", { command: "ls -la\necho hi" }), "ls -la");
	assert.equal(summarizeCall("edit", { path: "web/app.js" }), "Edit web/app.js");
	assert.equal(summarizeCall("app_check", {}), "Restart and check the app");
});

test("buildChatView pairs tool calls with their results", () => {
	// Arrange
	const entries = [
		{ id: 1, kind: "pi.user", model: [{ role: "user", content: "hi\n\n<app-context>x</app-context>" }] },
		{
			id: 2,
			kind: "pi.assistant",
			model: [
				{
					role: "assistant",
					content: [{ type: "toolCall", id: "t1", name: "bash", arguments: { command: "ls" } }],
				},
			],
		},
		{
			id: 3,
			kind: "pi.tool-result",
			model: [{ role: "toolResult", toolCallId: "t1", content: [{ type: "text", text: "a.txt" }], isError: false }],
		},
		{ id: 4, kind: "pi.assistant", model: [{ role: "assistant", content: [{ type: "text", text: "Done" }] }] },
	];
	// Act
	const view = buildChatView(entries, {});
	// Assert
	assert.equal(view.busy, false);
	assert.deepEqual(
		view.items.map((item) => item.type),
		["user", "tool", "assistant"],
	);
	const tool = view.items[1];
	assert.ok(tool?.type === "tool");
	assert.equal(tool.state, "done");
	assert.equal(tool.output, "a.txt");
	assert.equal(view.items[0]?.type === "user" && view.items[0].text, "hi");
});

test("buildChatView clears items at a reset and shows the live partial", () => {
	// Arrange
	const entries = [
		{ id: 1, kind: "pi.user", model: [{ role: "user", content: "old" }] },
		{ id: 2, kind: "pi.reset" },
		{ id: 3, kind: "pi.user", model: [{ role: "user", content: "new" }] },
	];
	const docs = {
		"pi.live": { run: { taskId: 1 }, generation: { message: { content: [{ type: "text", text: "Wor" }] } } },
	};
	// Act
	const view = buildChatView(entries, docs);
	// Assert
	assert.equal(view.items.length, 1);
	assert.equal(view.busy, true);
	assert.equal(view.partial, "Wor");
});

test("buildChatView reports why a run failed once idle", () => {
	const view = buildChatView([], { "pi.live": { runFailure: { reason: "model_error", detail: "429" } } });
	assert.equal(view.failure, "model error: 429");
});
