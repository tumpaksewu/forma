// Tab bar check on an emulated iPhone (Playwright WebKit): node scripts/ios-tabbar.ts [out-dir]
// Needs `pnpm exec playwright-core install webkit` once. Self-contained: starts the seed app (app/server.ts) on a
// spare port with a throwaway data directory, injects the dock from core/dock (its event stream is canned, so nothing
// reaches the agent), and runs every tab twice, with an empty database (short pages) and a seeded one (long pages).
//
// For each tab, after a fresh load and after switching to it with the tab bar, it asserts:
// - the tab bar's bottom is the viewport's bottom, its background is opaque and reaches the edge (the point 1px above
//   the bottom edge belongs to the bar), and the safe-area inset is padding inside it;
// - the bar's and the agent button's rects are the same on every tab, and the same right after the switch and 500ms
//   later (data loading in must not move them);
// - the document (html) is at least as tall as the viewport on every tab, short or long, and a page whose content
//   fits is not made scrollable. On iOS 26+ Home Screen apps a document shorter than the screen gets a short
//   viewport, and the fixed bar ends above the home indicator; see app/AGENTS.md.
// Emulation cannot reproduce that iOS behaviour itself (desktop WebKit has no Home Screen mode and no safe areas;
// the insets are simulated with the --safe-top/--safe-bottom tokens). It checks the conditions the fix relies on.
// Screenshots go to out-dir (default ~/forma-ios-shots/r2). Exits 1 on any failure. FORMA_APP=.forma/app checks the
// live copy instead of the seed; FORMA_EXERCISES points at a downloaded exercises.json to skip the download.
import { type ChildProcess, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type Page, webkit } from "playwright-core";

const ROOT = resolve(import.meta.dirname, "..");
const out = process.argv[2] ?? join(homedir(), "forma-ios-shots", "r2");
const SAFE_TOP = 59;
const SAFE_BOTTOM = 34;
const VIEWPORT = { width: 393, height: 852 };
const TABS = [
	{ name: "calendar", href: "#/" },
	{ name: "plan", href: "#/plan" },
	{ name: "body", href: "#/body" },
	{ name: "exercises", href: "#/library" },
];
const INSETS = `:root { --safe-top: ${SAFE_TOP}px !important; --safe-bottom: ${SAFE_BOTTOM}px !important; }
forma-dock { --safe-top: ${SAFE_TOP}px; --safe-bottom: ${SAFE_BOTTOM}px; }`;

type Rect = { top: number; bottom: number; left: number; right: number; height: number };
type Reading = {
	innerHeight: number;
	bar: Rect;
	fab: Rect | null;
	barBg: string;
	barPadBottom: string;
	edgeIsBar: boolean;
	htmlHeight: number;
	htmlMinHeight: string;
	scrollHeight: number;
	contentBottom: number;
};

const failures: string[] = [];
const check = (ok: boolean, message: string) => {
	if (!ok) failures.push(message);
};
const same = (a: Rect | null, b: Rect | null) =>
	!!a && !!b && (["top", "bottom", "left", "right", "height"] as const).every((k) => Math.abs(a[k] - b[k]) < 0.5);
const show = (r: Rect | null) => (r ? `${r.top}..${r.bottom}` : "none");

function freePort(): Promise<number> {
	return new Promise((done, fail) => {
		const server = createServer().listen(0, "127.0.0.1", () => {
			const address = server.address();
			server.close(() => (typeof address === "object" && address ? done(address.port) : fail(new Error("no port"))));
		});
	});
}

async function startApp(): Promise<{ base: string; child: ChildProcess }> {
	const data = mkdtempSync(join(tmpdir(), "forma-tabbar-"));
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

const day = (offset: number) => {
	const d = new Date();
	d.setDate(d.getDate() + offset);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Enough data that every tab is longer than the screen: workouts every other day for six weeks, three today, scans. */
async function seed(base: string) {
	const post = (collection: string, doc: unknown) =>
		fetch(`${base}/api/c/${collection}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(doc),
		});
	const entry = (name: string, n: number) => ({
		uid: `${name}-${n}`,
		exerciseId: name,
		name,
		image: "",
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
				exercises: ["Bench Press", "Overhead Press", "Dips"].map(entry),
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

/** Serves the dock from core/dock into every page, as the core does, with a canned (empty) agent stream. */
async function withDock(page: Page, base: string) {
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
	await page.addInitScript((css) => {
		sessionStorage.removeItem("forma-dock");
		document.addEventListener("DOMContentLoaded", () => {
			const style = document.createElement("style");
			style.textContent = css;
			document.head.appendChild(style);
		});
	}, INSETS);
}

/** Reads the geometry in the page. Kept as source so the same function runs right after a switch. */
const READ = `() => {
	const box = (el) => {
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height };
	};
	const bar = document.querySelector(".tabbar");
	const css = getComputedStyle(bar);
	const edge = document.elementFromPoint(innerWidth / 2, innerHeight - 1);
	const content = document.querySelector(".content");
	return {
		innerHeight,
		bar: box(bar),
		fab: box(document.querySelector("forma-dock")?.shadowRoot?.querySelector(".fab")),
		barBg: css.backgroundColor,
		barPadBottom: css.paddingBottom,
		edgeIsBar: !!edge && bar.contains(edge),
		htmlHeight: document.documentElement.getBoundingClientRect().height,
		htmlMinHeight: getComputedStyle(document.documentElement).minHeight,
		scrollHeight: document.documentElement.scrollHeight,
		contentBottom: content.getBoundingClientRect().bottom + scrollY,
	};
}`;

async function read(page: Page): Promise<Reading> {
	return page.evaluate(`(${READ})()`) as Promise<Reading>;
}

/** Clicks a tab and reads the geometry two frames after the route changed: the new screen has rendered. */
async function switchTo(page: Page, href: string): Promise<Reading> {
	return page.evaluate(
		`new Promise((resolve) => {
			addEventListener("hashchange", () => requestAnimationFrame(() => requestAnimationFrame(() => resolve((${READ})()))), { once: true });
			document.querySelector('.tabbar a[href="${href}"]').click();
		})`,
	) as Promise<Reading>;
}

function verify(label: string, r: Reading, reference: { bar: Rect; fab: Rect | null } | null) {
	check(Math.abs(r.bar.bottom - r.innerHeight) < 0.5, `${label}: bar bottom ${r.bar.bottom} != viewport ${r.innerHeight}`);
	check(r.barPadBottom === `${SAFE_BOTTOM}px`, `${label}: bar padding-bottom ${r.barPadBottom}, want the inset`);
	check(!/rgba\(.*,\s*0(\.\d+)?\)$/.test(r.barBg), `${label}: bar background not opaque: ${r.barBg}`);
	check(r.edgeIsBar, `${label}: the bottom edge is not painted by the bar`);
	check(r.fab !== null, `${label}: no agent button`);
	check(r.htmlHeight >= r.innerHeight - 0.5, `${label}: document ${r.htmlHeight}px is shorter than the viewport`);
	// html itself must cover the screen with 100lvh. A tall body or shell is not enough: in a Home Screen app iOS sizes
	// 100%/100dvh to the short viewport (computed, 100lvh shows as the viewport height in px).
	check(
		r.htmlMinHeight.startsWith(`min(${r.innerHeight}px,`),
		`${label}: html min-height is ${r.htmlMinHeight}, want min(100lvh, 100% + safe top)`,
	);
	if (r.contentBottom <= r.innerHeight)
		check(r.scrollHeight <= r.innerHeight, `${label}: short page scrolls (${r.scrollHeight} > ${r.innerHeight})`);
	if (reference) {
		check(same(r.bar, reference.bar), `${label}: bar moved ${show(reference.bar)} -> ${show(r.bar)}`);
		check(same(r.fab, reference.fab), `${label}: agent button moved ${show(reference.fab)} -> ${show(r.fab)}`);
	}
}

mkdirSync(out, { recursive: true });
const { base, child } = await startApp();
const browser = await webkit.launch();
const shots: string[] = [];
try {
	for (const data of ["empty", "seeded"] as const) {
		if (data === "seeded") await seed(base);
		for (const scheme of ["dark", "light"] as const) {
			const context = await browser.newContext({
				viewport: VIEWPORT,
				deviceScaleFactor: 3,
				isMobile: true,
				hasTouch: true,
				colorScheme: scheme,
			});
			const page = await context.newPage();
			page.on("pageerror", (e) => failures.push(`[pageerror] ${e.message}`));
			await withDock(page, base);
			let reference: { bar: Rect; fab: Rect | null } | null = null;

			// A fresh load of each tab.
			for (const tab of TABS) {
				await page.goto(`${base}/${tab.href}`);
				await page.waitForSelector("forma-dock", { state: "attached" });
				await page.waitForTimeout(600);
				const r = await read(page);
				reference ??= { bar: r.bar, fab: r.fab };
				verify(`${data}/${scheme}/${tab.name} (load)`, r, reference);
			}

			// Switching with the tab bar, in an order that alternates short and long pages, then back to the start.
			for (const tab of [...TABS.slice(1), TABS[0], TABS[2], TABS[1], TABS[3], TABS[0]]) {
				const label = `${data}/${scheme}/${tab.name} (switch)`;
				const now = await switchTo(page, tab.href);
				verify(`${label} immediately`, now, reference);
				await page.waitForTimeout(500);
				const later = await read(page);
				verify(`${label} after 500ms`, later, reference);
				check(same(now.bar, later.bar) && same(now.fab, later.fab), `${label}: moved after render`);
				const name = join(out, `${data}-${scheme}-${tab.name}.png`);
				if (!shots.includes(name)) {
					await page.waitForFunction(() => !document.querySelector(".spinner"), null, { timeout: 10000 });
					await page.screenshot({ path: name });
					shots.push(name);
					const length = later.contentBottom <= later.innerHeight ? "short" : "long";
					console.log(
						`${name}  ${length} page, document ${later.scrollHeight}px, bar ${show(later.bar)} ${later.barBg}, agent button ${show(later.fab)}`,
					);
				}
			}

			// The dock's visual-viewport sizing is for its open panel only: nothing is set while it is closed.
			const dock = () =>
				page.evaluate(() => {
					const host = document.querySelector("forma-dock") as HTMLElement;
					const panel = host.shadowRoot?.querySelector(".panel") as HTMLElement;
					return {
						vv: host.style.getPropertyValue("--vv-height"),
						open: !panel.hidden,
						panelBottom: panel.getBoundingClientRect().bottom,
						innerHeight,
					};
				});
			const closed = await dock();
			check(closed.vv === "", `${data}/${scheme}: dock set --vv-height (${closed.vv}) while closed`);
			await page.click("forma-dock >> .fab");
			const opened = await dock();
			check(
				opened.open && opened.vv === `${opened.innerHeight}px` && opened.panelBottom === opened.innerHeight,
				`${data}/${scheme}: open panel not sized to the visual viewport: ${JSON.stringify(opened)}`,
			);
			await context.close();
		}
	}
} finally {
	await browser.close();
	child.kill();
}

if (failures.length) {
	console.error(`\n${failures.length} failure(s):\n${failures.join("\n")}`);
	process.exit(1);
}
console.log(`\nok: tab bar and agent button flush and identical on every tab (${shots.length} screenshots in ${out})`);
