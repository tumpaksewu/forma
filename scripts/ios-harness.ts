// Shared setup for the iPhone WebKit checks (ios-tabbar.ts, ios-nav.ts): an emulated iPhone, the seed app on a spare
// port with a throwaway database, seed data, and the dock injected from core/dock with a canned event stream.
import { type ChildProcess, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Browser, Page } from "playwright-core";

export const ROOT = resolve(import.meta.dirname, "..");
export const SAFE_TOP = 59;
export const SAFE_BOTTOM = 34;
export const VIEWPORT = { width: 393, height: 852 };
export const TABS = [
	{ name: "calendar", href: "#/" },
	{ name: "plan", href: "#/plan" },
	{ name: "body", href: "#/body" },
	{ name: "exercises", href: "#/library" },
];
const INSETS = `:root { --safe-top: ${SAFE_TOP}px !important; --safe-bottom: ${SAFE_BOTTOM}px !important; }
forma-dock { --safe-top: ${SAFE_TOP}px; --safe-bottom: ${SAFE_BOTTOM}px; }`;

export type Rect = { top: number; bottom: number; left: number; right: number; height: number };

export const same = (a: Rect | null, b: Rect | null) =>
	!!a && !!b && (["top", "bottom", "left", "right", "height"] as const).every((k) => Math.abs(a[k] - b[k]) < 0.5);
export const show = (r: Rect | null) => (r ? `${r.top}..${r.bottom}` : "none");

/** Collects failures; the script exits 1 at the end if there are any. */
export function checker() {
	const failures: string[] = [];
	const check = (ok: boolean, message: string) => {
		if (!ok) failures.push(message);
	};
	return { failures, check };
}

function freePort(): Promise<number> {
	return new Promise((done, fail) => {
		const server = createServer().listen(0, "127.0.0.1", () => {
			const address = server.address();
			server.close(() => (typeof address === "object" && address ? done(address.port) : fail(new Error("no port"))));
		});
	});
}

/** Starts the seed app (or FORMA_APP) with a throwaway data directory. */
export async function startApp(): Promise<{ base: string; child: ChildProcess }> {
	const data = mkdtempSync(join(tmpdir(), "forma-ios-"));
	// The exercise library is downloaded on first start; reuse a local copy when there is one.
	const cached = process.env.FORMA_EXERCISES ?? join(ROOT, ".forma", "data", "exercises.json");
	if (existsSync(cached)) copyFileSync(cached, join(data, "exercises.json"));
	const port = await freePort();
	const child = spawn(process.execPath, ["server.ts"], {
		cwd: resolve(ROOT, process.env.FORMA_APP ?? "app"),
		env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", FORMA_DATA: data },
		stdio: ["ignore", "ignore", "inherit"],
	});
	const base = `http://127.0.0.1:${port}`;
	for (let i = 0; i < 300; i++) {
		const ready = await fetch(`${base}/api/exercises?limit=1`)
			.then((r) => r.ok)
			.catch(() => false);
		if (ready) return { base, child };
		await new Promise((r) => setTimeout(r, 100));
	}
	child.kill();
	throw new Error("the app did not start");
}

export const day = (offset: number) => {
	const d = new Date();
	d.setDate(d.getDate() + offset);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * Enough data that every tab is longer than the screen: workouts every other day for six weeks, three today, scans.
 * With `images`, the workouts use real library exercises and photos (thumbnails load like on the phone).
 */
export async function seed(base: string, { images = false } = {}) {
	const post = (collection: string, doc: unknown) =>
		fetch(`${base}/api/c/${collection}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(doc),
		});
	const library = images
		? ((await (await fetch(`${base}/api/exercises?q=&limit=6`)).json()) as {
				items: { id: string; name: string; images: string[] }[];
			}).items
		: ["Bench Press", "Overhead Press", "Dips"].map((name) => ({ id: name, name, images: [""] }));
	const entry = (x: { id: string; name: string; images: string[] }, n: number) => ({
		uid: `${x.id}-${n}`,
		exerciseId: x.id,
		name: x.name,
		image: x.images[0] ?? "",
		notes: "",
		restSec: 120,
		sets: [1, 2, 3].map(() => ({ reps: 8, weight: 60, done: false })),
	});
	const days = [0, 0, 0, ...Array.from({ length: 21 }, (_, i) => i * 2 - 7)];
	await Promise.all(
		days.map((offset, i) =>
			post("workouts", {
				date: day(offset),
				title: ["Push", "Pull", "Legs"][i % 3],
				notes: "",
				done: offset < 0,
				order: i,
				exercises: library.map(entry),
			}),
		),
	);
	await Promise.all(
		Array.from({ length: 6 }, (_, i) =>
			post("measurements", {
				date: day(-30 * (i + 1)),
				source: "visbody",
				metrics: { weight_kg: 80 - i, body_fat_pct: 18 + i / 2, skeletal_muscle_kg: 36, visceral_fat: 6, bmi: 24 },
				segments: {
					lean_kg: { left_arm: 3.5, right_arm: 3.6, trunk: 27, left_leg: 9.8, right_leg: 9.9 },
					fat_kg: { left_arm: 0.9, right_arm: 0.9, trunk: 8, left_leg: 2.6, right_leg: 2.6 },
				},
				circumferences_cm: { neck: 39, chest: 104, waist: 84, hip: 98 },
				posture: [{ name: "Head forward", value: 4, unit: "deg", finding: "slight" }],
			}),
		),
	);
}

/** An emulated iPhone 15/16/17 Pro-sized page. */
export async function iPhone(browser: Browser, scheme: "dark" | "light" = "dark"): Promise<Page> {
	const context = await browser.newContext({
		viewport: VIEWPORT,
		deviceScaleFactor: 3,
		isMobile: true,
		hasTouch: true,
		colorScheme: scheme,
	});
	return context.newPage();
}

/**
 * Simulates the safe-area insets. With `dock`, also serves the dock from core/dock into every page, as the core
 * does, with a canned (empty) agent stream; leave it off when `base` is a real core, which injects it itself.
 */
export async function prepare(page: Page, base: string, { dock = true } = {}) {
	if (dock) {
		await page.route(`${base}/`, async (route) => {
			const response = await route.fetch();
			const body = (await response.text()).replace(
				"</body>",
				`<script type="module" src="/__forma/dock.js"></script></body>`,
			);
			await route.fulfill({ response, body });
		});
		await page.route(`${base}/__forma/**`, (route) => {
			const path = new URL(route.request().url()).pathname.replace("/__forma/", "");
			if (["dock.js", "dock.css", "viewport.js"].includes(path)) {
				const type = path.endsWith(".css") ? "text/css" : "text/javascript";
				return route.fulfill({ contentType: type, body: readFileSync(join(ROOT, "core", "dock", path)) });
			}
			if (path === "events") {
				const chat = { busy: false, partial: "", queued: 0, items: [] };
				return route.fulfill({
					contentType: "text/event-stream",
					body: `retry: 600000\n\nevent: chat\ndata: ${JSON.stringify(chat)}\n\n`,
				});
			}
			return route.fulfill({ contentType: "application/json", body: "{}" });
		});
	}
	await page.addInitScript((css) => {
		if (location.protocol === "about:") return;
		sessionStorage.removeItem("forma-dock");
		document.addEventListener("DOMContentLoaded", () => {
			const style = document.createElement("style");
			style.textContent = css;
			document.head.appendChild(style);
		});
	}, INSETS);
}
