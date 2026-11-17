import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { injectDock } from "./http.ts";
import { Versions } from "./versions.ts";

const scratch = mkdtempSync(join(tmpdir(), "forma-test-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

function seed(): string {
	const dir = join(scratch, `seed-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir);
	writeFileSync(join(dir, "server.ts"), "// v1\n");
	return dir;
}

test("ensure seeds a repository once", () => {
	// Arrange
	const live = join(scratch, "live-a");
	const versions = new Versions(live);
	// Act
	const first = versions.ensure(seed());
	const second = versions.ensure(seed());
	// Assert
	assert.equal(first, true);
	assert.equal(second, false);
	assert.equal(versions.log().length, 1);
});

test("commit saves changes and skips when nothing changed", () => {
	// Arrange
	const live = join(scratch, "live-b");
	const versions = new Versions(live);
	versions.ensure(seed());
	// Act
	writeFileSync(join(live, "server.ts"), "// v2\n");
	const sha = versions.commit("Change", "body");
	const none = versions.commit("Nothing");
	// Assert
	assert.ok(sha);
	assert.equal(none, undefined);
	assert.equal(versions.log()[0]?.subject, "Change");
	assert.equal(versions.log()[0]?.body, "body");
});

test("restore brings back old files, drops new ones, and is itself a version", () => {
	// Arrange
	const live = join(scratch, "live-c");
	const versions = new Versions(live);
	versions.ensure(seed());
	const original = versions.head();
	writeFileSync(join(live, "server.ts"), "// broken\n");
	writeFileSync(join(live, "extra.js"), "x");
	versions.commit("Break it");
	// Act
	versions.restore(original);
	// Assert
	assert.equal(readFileSync(join(live, "server.ts"), "utf8"), "// v1\n");
	assert.throws(() => readFileSync(join(live, "extra.js")));
	assert.match(versions.log()[0]?.subject ?? "", /^Restore: Seed/);
	assert.equal(versions.log().length, 3);
});

test("injectDock adds the dock before </body> once", () => {
	const html = injectDock("<html><body><p>x</p></body></html>");
	assert.match(html, /<p>x<\/p><script type="module" src="\/__forma\/dock.js"><\/script><\/body>/);
	assert.equal(injectDock(html), html);
});
