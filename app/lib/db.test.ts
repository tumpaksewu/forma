import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { Store } from "./db.ts";

const dir = mkdtempSync(join(tmpdir(), "forma-db-"));
after(() => rmSync(dir, { recursive: true, force: true }));

test("put, get, patch and delete a document", () => {
	// Arrange
	const store = new Store(join(dir, "a.db"));
	// Act
	const created = store.put("workouts", { date: "2026-11-17", title: "Push" });
	const patched = store.patch("workouts", created.id, { title: "Push A" });
	// Assert
	assert.equal(store.get("workouts", created.id)?.title, "Push A");
	assert.equal(patched?.date, "2026-11-17");
	assert.equal(store.delete("workouts", created.id), true);
	assert.equal(store.get("workouts", created.id), undefined);
});

test("list filters by equality and date ranges", () => {
	// Arrange
	const store = new Store(join(dir, "b.db"));
	for (const date of ["2026-11-01", "2026-11-15", "2026-12-01"])
		store.put("workouts", { date, done: date < "2026-11-10" });
	// Act
	const november = store.list("workouts", { date_gte: "2026-11-01", date_lte: "2026-11-30" });
	const done = store.list("workouts", { done: "true" });
	// Assert
	assert.equal(november.length, 2);
	assert.deepEqual(
		done.map((d) => d.date),
		["2026-11-01"],
	);
});

test("migrate runs once and rolls back on failure", () => {
	// Arrange
	const store = new Store(join(dir, "c.db"));
	store.put("items", { id: "1", n: 1 });
	let runs = 0;
	// Act
	store.migrate("double", (s) => {
		runs++;
		for (const doc of s.list("items")) s.put("items", { ...doc, n: (doc.n as number) * 2 });
	});
	store.migrate("double", () => {
		runs++;
	});
	assert.throws(() =>
		store.migrate("bad", (s) => {
			s.put("items", { id: "2" });
			throw new Error("nope");
		}),
	);
	// Assert
	assert.equal(runs, 1);
	assert.equal(store.get("items", "1")?.n, 2);
	assert.equal(store.get("items", "2"), undefined);
});
