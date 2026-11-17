import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

/** A stored document: any JSON object with an `id`. */
export type Doc = { id: string; [field: string]: unknown };

/**
 * A small document store on SQLite: named collections of JSON objects. New fields need no migration; reshaping
 * existing documents is done with `migrate()`.
 */
export class Store {
	readonly #db: DatabaseSync;

	constructor(path: string) {
		this.#db = new DatabaseSync(path);
		this.#db.exec(`
			PRAGMA journal_mode = WAL;
			CREATE TABLE IF NOT EXISTS docs (
				collection TEXT NOT NULL,
				id TEXT NOT NULL,
				data TEXT NOT NULL,
				created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
				updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
				PRIMARY KEY (collection, id)
			);
			CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, ran_at TEXT NOT NULL);
		`);
	}

	/**
	 * Lists a collection, optionally keeping documents whose top-level fields equal the given values.
	 * Range filters: a key ending in `_gte` or `_lte` compares the field before it (e.g. `date_gte`).
	 */
	list(collection: string, where: Record<string, string> = {}): Doc[] {
		const clauses = ["collection = ?"];
		const params: (string | number)[] = [collection];
		for (const [key, value] of Object.entries(where)) {
			const range = key.match(/^(\w+)_(gte|lte)$/);
			const field = range ? range[1]! : key;
			if (!/^\w+$/.test(field)) continue;
			const op = range ? (range[2] === "gte" ? ">=" : "<=") : "=";
			clauses.push(`json_extract(data, '$.${field}') ${op} ?`);
			params.push(value === "true" ? 1 : value === "false" ? 0 : value);
		}
		const rows = this.#db
			.prepare(`SELECT data FROM docs WHERE ${clauses.join(" AND ")} ORDER BY created_at`)
			.all(...params) as { data: string }[];
		return rows.map((row) => JSON.parse(row.data) as Doc);
	}

	get(collection: string, id: string): Doc | undefined {
		const row = this.#db.prepare("SELECT data FROM docs WHERE collection = ? AND id = ?").get(collection, id) as
			| { data: string }
			| undefined;
		return row ? (JSON.parse(row.data) as Doc) : undefined;
	}

	/** Creates or replaces a document. Gives it an id when it has none. */
	put(collection: string, doc: Partial<Doc>): Doc {
		const stored = { ...doc, id: typeof doc.id === "string" && doc.id ? doc.id : randomUUID() } as Doc;
		this.#db
			.prepare(
				`INSERT INTO docs (collection, id, data) VALUES (?, ?, ?)
				 ON CONFLICT (collection, id) DO UPDATE SET data = excluded.data,
				 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
			)
			.run(collection, stored.id, JSON.stringify(stored));
		return stored;
	}

	/** Merges fields into a document; returns undefined when it does not exist. */
	patch(collection: string, id: string, fields: Record<string, unknown>): Doc | undefined {
		const current = this.get(collection, id);
		if (!current) return undefined;
		return this.put(collection, { ...current, ...fields, id });
	}

	delete(collection: string, id: string): boolean {
		return this.#db.prepare("DELETE FROM docs WHERE collection = ? AND id = ?").run(collection, id).changes > 0;
	}

	collections(): { collection: string; count: number }[] {
		return this.#db
			.prepare("SELECT collection, COUNT(*) AS count FROM docs GROUP BY collection ORDER BY collection")
			.all() as { collection: string; count: number }[];
	}

	/**
	 * Runs a data migration once, ever, in a transaction. Use it when the app's data shape changes.
	 *
	 * Args:
	 *   name: Unique, never reused, e.g. "2026-11-20-sets-to-objects".
	 *   run: Receives the store; reshape documents with list/put.
	 */
	migrate(name: string, run: (store: Store) => void): void {
		const done = this.#db.prepare("SELECT 1 FROM migrations WHERE name = ?").get(name);
		if (done) return;
		this.#db.exec("BEGIN");
		try {
			run(this);
			this.#db.prepare("INSERT INTO migrations (name, ran_at) VALUES (?, ?)").run(name, new Date().toISOString());
			this.#db.exec("COMMIT");
		} catch (error) {
			this.#db.exec("ROLLBACK");
			throw error;
		}
	}
}
