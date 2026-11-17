import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Store } from "./db.ts";

/**
 * The exercise library: free-exercise-db (public domain, ~870 exercises with start/end photos), downloaded once into
 * the data directory, plus the owner's own exercises from the `exercises_custom` collection. Photos are fetched on
 * first view and cached, so the app works offline afterwards. Optional animated GIFs come from ExerciseDB on RapidAPI
 * when `EXERCISEDB_RAPIDAPI_KEY` is set; each is fetched once, on request, and cached.
 */

const SOURCE = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main";
const RAPID_HOST = "exercisedb.p.rapidapi.com";

export type Exercise = {
	id: string;
	name: string;
	category: string;
	level: string;
	force: string | null;
	mechanic: string | null;
	equipment: string | null;
	primaryMuscles: string[];
	secondaryMuscles: string[];
	instructions: string[];
	/** URLs the browser can load. */
	images: string[];
	source: "free-exercise-db" | "custom";
	custom?: boolean;
};

type Raw = Omit<Exercise, "images" | "source"> & { images: string[] };

const COMMON_EQUIPMENT = new Set(["barbell", "dumbbell", "body only", "cable", "machine"]);

/** The lifts most people mean when they type a common name; they rank first among matches. */
const STAPLES = new Set([
	"Barbell_Bench_Press_-_Medium_Grip",
	"Barbell_Incline_Bench_Press_-_Medium_Grip",
	"Dumbbell_Bench_Press",
	"Incline_Dumbbell_Press",
	"Close-Grip_Barbell_Bench_Press",
	"Barbell_Squat",
	"Front_Barbell_Squat",
	"Goblet_Squat",
	"Bodyweight_Squat",
	"Leg_Press",
	"Barbell_Deadlift",
	"Romanian_Deadlift",
	"Sumo_Deadlift",
	"Standing_Military_Press",
	"Barbell_Shoulder_Press",
	"Dumbbell_Shoulder_Press",
	"Side_Lateral_Raise",
	"Bent_Over_Barbell_Row",
	"One-Arm_Dumbbell_Row",
	"Seated_Cable_Rows",
	"Wide-Grip_Lat_Pulldown",
	"Pullups",
	"Chin-Up",
	"Dips_-_Chest_Version",
	"Dips_-_Triceps_Version",
	"Pushups",
	"Barbell_Curl",
	"Dumbbell_Bicep_Curl",
	"Hammer_Curls",
	"Triceps_Pushdown",
	"Lying_Triceps_Press",
	"Face_Pull",
	"Dumbbell_Lunges",
	"Barbell_Lunge",
	"Barbell_Hip_Thrust",
	"Leg_Extensions",
	"Lying_Leg_Curls",
	"Standing_Calf_Raises",
	"Plank",
	"Crunches",
	"Hanging_Leg_Raise",
	"Dumbbell_Flyes",
	"Cable_Crossover",
]);

const safe = (id: string) => id.replace(/[^\w-]/g, "_");

export class Library {
	readonly #dir: string;
	readonly #store: Store;
	#base: Exercise[] = [];
	#loading: Promise<void> | undefined;

	constructor(dataDir: string, store: Store) {
		this.#dir = dataDir;
		this.#store = store;
	}

	get ready(): boolean {
		return this.#base.length > 0;
	}

	/** Loads the library from disk, downloading it first if this is the first run. Safe to call repeatedly. */
	load(): Promise<void> {
		this.#loading ??= this.#load().catch((error: unknown) => {
			this.#loading = undefined;
			console.error(`[library] ${(error as Error).message}`);
		});
		return this.#loading;
	}

	async #load(): Promise<void> {
		const file = join(this.#dir, "exercises.json");
		if (!existsSync(file)) {
			console.log("[library] downloading free-exercise-db…");
			const response = await fetch(`${SOURCE}/dist/exercises.json`);
			if (!response.ok) throw new Error(`download failed: ${response.status}`);
			mkdirSync(this.#dir, { recursive: true });
			writeFileSync(file, await response.text());
		}
		const raw = JSON.parse(readFileSync(file, "utf8")) as Raw[];
		this.#base = raw.map((x) => ({
			...x,
			images: x.images.map((_, n) => `/media/ex/${encodeURIComponent(x.id)}/${n}.jpg`),
			source: "free-exercise-db",
		}));
		console.log(`[library] ${this.#base.length} exercises`);
	}

	/** Every exercise: the owner's own first, then the library. */
	all(): Exercise[] {
		const custom = this.#store.list("exercises_custom").map(
			(doc) =>
				({
					category: "strength",
					level: "beginner",
					force: null,
					mechanic: null,
					equipment: null,
					primaryMuscles: [],
					secondaryMuscles: [],
					instructions: [],
					images: [],
					...doc,
					source: "custom",
					custom: true,
				}) as unknown as Exercise,
		);
		return [...custom, ...this.#base];
	}

	get(id: string): Exercise | undefined {
		return this.all().find((x) => x.id === id);
	}

	/**
	 * Finds exercises by words in their name and by filters.
	 *
	 * Args:
	 *   q: Words that must all appear in the name (any order).
	 *   filters: Exact values for muscle (primary or secondary), equipment, category, level.
	 */
	search(q: string, filters: { muscle?: string; equipment?: string; category?: string; level?: string }, limit = 60) {
		const words = q.toLowerCase().split(/\s+/).filter(Boolean);
		const scored: { x: Exercise; score: number }[] = [];
		for (const x of this.all()) {
			const name = x.name.toLowerCase();
			if (!words.every((w) => name.includes(w))) continue;
			if (filters.muscle && !x.primaryMuscles.includes(filters.muscle) && !x.secondaryMuscles.includes(filters.muscle))
				continue;
			if (filters.equipment && x.equipment !== filters.equipment) continue;
			if (filters.category && x.category !== filters.category) continue;
			if (filters.level && x.level !== filters.level) continue;
			let score = x.custom ? 50 : STAPLES.has(x.id) ? 30 : 0;
			const phrase = words.join(" ");
			if (phrase && name.includes(phrase)) score += 15;
			if (words.length && name.startsWith(words[0]!)) score += 10;
			if (filters.muscle && x.primaryMuscles.includes(filters.muscle)) score += 10;
			// Prefer the staples: free weights and bodyweight, at the levels most people train.
			if (x.equipment && COMMON_EQUIPMENT.has(x.equipment)) score += 6;
			if (x.level !== "expert") score += 3;
			if (/\b(with|from|on|to)\b/.test(name)) score -= 4;
			score -= name.length / 15;
			scored.push({ x, score });
		}
		scored.sort((a, b) => b.score - a.score);
		return { total: scored.length, items: scored.slice(0, limit).map((s) => s.x) };
	}

	/** The distinct values each filter can take. */
	facets(): Record<string, string[]> {
		const sets: Record<string, Set<string>> = {
			muscle: new Set(),
			equipment: new Set(),
			category: new Set(),
			level: new Set(),
		};
		for (const x of this.all()) {
			for (const m of x.primaryMuscles) sets.muscle!.add(m);
			if (x.equipment) sets.equipment!.add(x.equipment);
			sets.category!.add(x.category);
			sets.level!.add(x.level);
		}
		return Object.fromEntries(Object.entries(sets).map(([k, v]) => [k, [...v].sort()]));
	}

	/**
	 * A library photo, from the cache or fetched and cached.
	 *
	 * Returns:
	 *   The JPEG bytes, or undefined when it does not exist upstream.
	 */
	async photo(id: string, n: number): Promise<Buffer | undefined> {
		const path = join(this.#dir, "media", "ex", safe(id), `${n}.jpg`);
		if (existsSync(path)) return readFileSync(path);
		const response = await fetch(`${SOURCE}/exercises/${encodeURIComponent(id)}/${n}.jpg`);
		if (!response.ok) return undefined;
		const bytes = Buffer.from(await response.arrayBuffer());
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, bytes);
		return bytes;
	}

	/** Whether animated GIFs can be fetched (an ExerciseDB key is configured). */
	get gifsEnabled(): boolean {
		return Boolean(process.env.EXERCISEDB_RAPIDAPI_KEY);
	}

	/** Whether a GIF for this exercise is already cached, so showing it costs no API call. */
	gifCached(id: string): boolean {
		return existsSync(join(this.#dir, "media", "gif", `${safe(id)}.gif`));
	}

	/**
	 * An animated GIF from ExerciseDB, matched by name. Costs up to two API calls the first time, none after; a miss is
	 * remembered too, so the free tier's small quota is not spent twice on the same exercise.
	 */
	async gif(id: string): Promise<Buffer | undefined> {
		const dir = join(this.#dir, "media", "gif");
		const path = join(dir, `${safe(id)}.gif`);
		const miss = join(dir, `${safe(id)}.none`);
		if (existsSync(path)) return readFileSync(path);
		const key = process.env.EXERCISEDB_RAPIDAPI_KEY;
		if (!key || existsSync(miss)) return undefined;
		const exercise = this.get(id);
		if (!exercise) return undefined;
		mkdirSync(dir, { recursive: true });
		const headers = { "x-rapidapi-key": key, "x-rapidapi-host": RAPID_HOST };
		const name = exercise.name
			.toLowerCase()
			.replace(/\(.*?\)/g, "")
			.replace(/[^a-z0-9 ]/g, " ")
			.replace(/\s+/g, " ")
			.trim();
		const found = await fetch(`https://${RAPID_HOST}/exercises/name/${encodeURIComponent(name)}?limit=1`, { headers });
		if (!found.ok) throw new Error(`ExerciseDB search failed: ${found.status}`);
		const matches = (await found.json()) as { id: string }[];
		const match = matches[0];
		if (!match) {
			writeFileSync(miss, "");
			return undefined;
		}
		const image = await fetch(`https://${RAPID_HOST}/image?exerciseId=${match.id}&resolution=180`, { headers });
		if (!image.ok) throw new Error(`ExerciseDB image failed: ${image.status}`);
		const bytes = Buffer.from(await image.arrayBuffer());
		writeFileSync(path, bytes);
		return bytes;
	}
}
