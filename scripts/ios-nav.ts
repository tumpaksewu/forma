// Navigation check on an emulated iPhone (Playwright WebKit): node scripts/ios-nav.ts [out-dir]
// Run by `pnpm test:ios` after ios-tabbar.ts. Starts the seed app like ios-tabbar.ts (or uses a running forma core
// at FORMA_URL, e.g. http://127.0.0.1:4300, with its real dock and event stream; it then does not seed data).
//
// A tab switch must be one in-place render. On Safari over plain http from a LAN address, any real navigation (even
// a same-document hash change) reloads the page in a new process (see app/web/lib/router.js), so the app changes
// routes with history.pushState. Emulation does not reload, so the page here does it like Safari: a fragment
// navigation (a hashchange not caused by back/forward) reloads it 150ms later. For every tab switch, tapped like on
// the phone, it asserts:
// - no navigation: a marker set on window survives, performance navigation entries and pagehide events don't grow,
//   the dock's host element is the same node, and the hash changed without a hashchange-driven navigation;
// - no blank frame: at every animation frame for 600ms after the tap, the tab bar, the screen's content and the
//   agent button exist and have size;
// - nothing moves: the page title and the first content block sit at the same place on Plan, Body and Exercises
//   (Calendar's first block at the same place on every visit), right after the switch and 500ms later; the tab bar
//   rect and the viewport (innerHeight, visualViewport.height) never change;
// - revisiting a tab renders its last data at once: no spinner.
// Back button on an exercise (and a workout): opened by URL with no history, back goes to the list (the day); opened
// from the list, back returns to it with its search and scroll; the button is at least 44x44 and nothing covers it.
// Screenshots (per tab, and frames of one switch) go to out-dir (default ~/forma-ios-shots/r3/after). Exits 1 on any
// failure.
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type Page, webkit } from "playwright-core";
import { checker, iPhone, prepare, type Rect, SAFE_TOP, same, seed, show, startApp, TABS } from "./ios-harness.ts";

const out = process.argv[2] ?? join(homedir(), "forma-ios-shots", "r3", "after");
const { failures, check } = checker();

type Sample = {
	t: number;
	hash: string;
	bar: Rect | null;
	fab: Rect | null;
	content: Rect | null;
	title: Rect | null;
	first: Rect | null;
	spinner: boolean;
	innerHeight: number;
	vv: number;
};

/** Marks the page, so a reload or a new document shows: the marker would be gone. */
const MARK = `() => {
	window.__formaMarker = Math.random();
	window.__formaDock = document.querySelector("forma-dock");
	return {
		marker: window.__formaMarker,
		navigations: performance.getEntriesByType("navigation").length,
		pagehides: Number(sessionStorage.getItem("pagehides") || 0),
	};
}`;

const SAME_DOCUMENT = `() => ({
	marker: window.__formaMarker,
	dock: window.__formaDock === document.querySelector("forma-dock"),
	navigations: performance.getEntriesByType("navigation").length,
	pagehides: Number(sessionStorage.getItem("pagehides") || 0),
})`;

/** Samples the screen at every animation frame for `ms`. */
const SAMPLE = `(ms) => new Promise((resolve) => {
	const box = (el) => {
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height };
	};
	const visible = (el) => { const r = box(el); return r && r.height > 0 ? r : null; };
	const samples = [];
	const t0 = performance.now();
	const frame = () => {
		const page = document.querySelector("#app .content > *");
		const header = page?.firstElementChild;
		const title = document.querySelector("#app .content h1");
		// The first block under the title (Calendar has no title: its first block).
		const first = title ? header?.nextElementSibling : header;
		samples.push({
			t: Math.round(performance.now() - t0),
			hash: location.hash,
			bar: visible(document.querySelector(".tabbar")),
			fab: visible(document.querySelector("forma-dock")?.shadowRoot?.querySelector(".fab")),
			content: visible(page),
			title: box(title),
			first: box(first),
			spinner: !!document.querySelector("#app .spinner"),
			innerHeight,
			vv: visualViewport?.height ?? innerHeight,
		});
		if (performance.now() - t0 < ms) requestAnimationFrame(frame);
		else resolve(samples);
	};
	requestAnimationFrame(frame);
})`;

/** Taps a tab and samples every frame for 600ms; checks it stayed one document with no blank frame. */
async function tapTab(page: Page, label: string, href: string): Promise<Sample[]> {
	const before = (await page.evaluate(`(${MARK})()`)) as { marker: number; navigations: number; pagehides: number };
	const sampling = page.evaluate(`(${SAMPLE})(600)`) as Promise<Sample[]>;
	await page.tap(`.tabbar a[href="${href}"]`);
	const samples = await sampling.catch((error: Error) => {
		throw new Error(`${label}: the page reloaded during the switch (${error.message.split("\n")[0]})`);
	});
	const after = (await page.evaluate(`(${SAME_DOCUMENT})()`)) as {
		marker: number;
		dock: boolean;
		navigations: number;
		pagehides: number;
	};
	check(after.marker === before.marker, `${label}: the page was replaced (window marker gone): a reload`);
	check(after.dock, `${label}: the dock was re-created`);
	check(after.navigations === before.navigations, `${label}: navigation entries ${before.navigations} -> ${after.navigations}`);
	check(after.pagehides === before.pagehides, `${label}: pagehide fired`);
	const want = href === "#/" ? ["#/", ""] : [href];
	check(want.includes(samples.at(-1)?.hash ?? ""), `${label}: ended on ${samples.at(-1)?.hash}, want ${href}`);
	for (const s of samples) {
		const missing = [!s.bar && "tab bar", !s.fab && "agent button", !s.content && "content"].filter(Boolean);
		check(!missing.length, `${label}: blank frame at +${s.t}ms (no ${missing.join(", ")})`);
	}
	return samples.filter((s) => want.includes(s.hash));
}

const shots: string[] = [];
const external = process.env.FORMA_URL;
const app = external ? null : await startApp();
const base = external ?? app!.base;
mkdirSync(out, { recursive: true });
const browser = await webkit.launch();
try {
	const page = await iPhone(browser, "dark");
	page.on("pageerror", (e) => failures.push(`[pageerror] ${e.message}`));
	await prepare(page, base, { dock: !external });
	await page.addInitScript(() => {
		if (location.protocol === "about:") return;
		addEventListener("pagehide", () =>
			sessionStorage.setItem("pagehides", String(Number(sessionStorage.getItem("pagehides") || 0) + 1)),
		);
		// Does what Safari does over http on a LAN: a fragment navigation (location.hash = …, a followed "#/…" link)
		// reloads the page ~150ms later. Such an entry has no state; the router's entries (pushState, and back/forward
		// between them) have { forma }.
		addEventListener("hashchange", () => {
			if (typeof history.state?.forma !== "number") setTimeout(() => location.reload(), 150);
		});
	});
	await page.goto(`${base}/#/`);
	await page.waitForSelector("forma-dock", { state: "attached" });
	await page.waitForTimeout(800);

	if (!external) {
		await switchTabs(page, "empty");
		await seed(base, { images: true });
		// A new document (going to "#/" from "#/plan" would be a fragment navigation).
		await page.goto("about:blank");
		await page.goto(`${base}/#/`);
		await page.waitForTimeout(800);
	}

	// Frames of the first switch, Calendar -> Plan, as close together as screenshots go.
	await page.tap('.tabbar a[href="#/plan"]');
	const t0 = Date.now();
	for (let i = 0; i < 6; i++) {
		const name = join(out, `switch-calendar-to-plan-${i}.png`);
		const at = Date.now() - t0;
		await page.screenshot({ path: name });
		shots.push(`${name}  (+${at}ms after the tap)`);
	}
	await page.tap('.tabbar a[href="#/"]');
	await page.waitForTimeout(600);

	await switchTabs(page, external ? "live" : "seeded");

	// Back from an exercise opened by URL: a fresh document, no in-app history.
	const firstId = ((await (await fetch(`${base}/api/exercises?limit=1`)).json()) as { items: { id: string }[] }).items[0]!.id;
	await page.goto("about:blank");
	await page.goto(`${base}/#/exercise/${encodeURIComponent(firstId)}`);
	await page.waitForSelector(".exercise-page");
	await backButton(page, "exercise by URL");
	await page.screenshot({ path: join(out, "exercise-detail.png") });
	shots.push(join(out, "exercise-detail.png"));
	await page.tap('.page-head [aria-label="Back"]');
	await page.waitForSelector(".library-page .ex-row", { timeout: 5000 }).catch(() => null);
	check((await page.evaluate("location.hash")) === "#/library", "exercise by URL: back did not open #/library");
	check((await page.$(".library-page .ex-row")) !== null, "exercise by URL: back did not show the list");

	// Back from an exercise opened from a searched, scrolled list: the same list, search and scroll.
	await page.fill(".library-page input[type=search]", "press");
	await page.waitForFunction(() => document.querySelector(".ex-search .muted.small")?.textContent?.includes("exercise"));
	await page.waitForTimeout(600);
	await page.evaluate("window.scrollTo(0, 700)");
	await page.waitForTimeout(100);
	const scrolled = (await page.evaluate("scrollY")) as number;
	const mark = (await page.evaluate(`(${MARK})()`)) as { marker: number };
	const row = await page.evaluateHandle(
		"document.elementFromPoint(innerWidth / 2, innerHeight / 2).closest('.ex-row')",
	);
	await row.asElement()!.tap();
	await page.waitForSelector(".exercise-page");
	await backButton(page, "exercise from list");
	await page.tap('.page-head [aria-label="Back"]');
	await page.waitForSelector(".library-page");
	const back = (await page.evaluate(
		`({ hash: location.hash, q: document.querySelector(".library-page input[type=search]").value, y: scrollY, ...(${SAME_DOCUMENT})() })`,
	)) as { hash: string; q: string; y: number; marker: number };
	check(back.hash === "#/library", `exercise from list: back opened ${back.hash}`);
	check(back.q === "press", `exercise from list: search "${back.q}", want "press"`);
	check(Math.abs(back.y - scrolled) < 2, `exercise from list: scroll ${back.y}, want ${scrolled}`);
	check(back.marker === mark.marker, "exercise from list: the page reloaded");

	// The workout screen's back: by URL it opens the workout's day; from the calendar it returns there.
	const workouts = (await (await fetch(`${base}/api/c/workouts`)).json()) as { id: string; date: string }[];
	if (workouts[0]) {
		await page.goto("about:blank");
		await page.goto(`${base}/#/workout/${workouts[0].id}`);
		await page.waitForSelector(".workout-page");
		await backButton(page, "workout by URL");
		await page.tap('.page-head [aria-label="Back"]');
		await page.waitForSelector(".calendar-page");
		const hash = await page.evaluate("location.hash");
		check(hash === `#/day/${workouts[0].date}`, `workout by URL: back opened ${hash}`);
		await page.tap(".day-workouts .workout-summary");
		await page.waitForSelector(".workout-page");
		await page.tap('.page-head [aria-label="Back"]');
		await page.waitForSelector(".calendar-page");
		const again = await page.evaluate("location.hash");
		check(again === `#/day/${workouts[0].date}`, `workout from calendar: back opened ${again}`);
	}
	await page.context().close();
} catch (error) {
	failures.push(`[stopped] ${(error as Error).message.split("\n")[0]}`);
} finally {
	await browser.close();
	app?.child.kill();
}

/**
 * Switches through every tab (each one visited, then revisited) and checks each switch: one document, no blank
 * frame, nothing moving, no spinner on a revisit.
 */
async function switchTabs(page: Page, data: string) {
	const viewport = (await page.evaluate("({ h: innerHeight, vv: visualViewport.height })")) as { h: number; vv: number };
	let bar: Rect | null = null;
	let title: { rect: Rect; tab: string } | null = null;
	let first: { rect: Rect; tab: string } | null = null;
	let calendarFirst: Rect | null = null;
	const order = [...TABS.slice(1), TABS[0], TABS[2], TABS[1], TABS[3], TABS[0], TABS[3], TABS[2], TABS[1]];
	const visited = new Set(["calendar"]);
	for (const tab of order) {
		const label = `${data}/${tab.name} (switch)`;
		const revisit = visited.has(tab.name);
		visited.add(tab.name);
		const samples = await tapTab(page, label, tab.href);
		await page.waitForTimeout(500);
		const [later] = (await page.evaluate(`(${SAMPLE})(0)`)) as Sample[];
		const all = [...samples, ...(later ? [later] : [])];
		for (const s of all) {
			bar ??= s.bar;
			check(same(s.bar, bar), `${label}: tab bar moved ${show(bar)} -> ${show(s.bar)} at +${s.t}ms`);
			check(
				s.innerHeight === viewport.h && Math.abs(s.vv - viewport.vv) < 0.5,
				`${label}: viewport changed to ${s.innerHeight}/${s.vv} (was ${viewport.h}/${viewport.vv}) at +${s.t}ms`,
			);
		}
		if (revisit) check(!samples.some((s) => s.spinner), `${label}: spinner shown on a revisit (cached data unused)`);
		// Positions once the new screen's header is up: right after the switch, and 500ms later.
		const settled = all.filter((s) => s.first);
		if (revisit) check(!!samples[0]?.first, `${label}: the first frame of a revisit has no content yet`);
		for (const s of settled) {
			if (tab.name === "calendar") {
				calendarFirst ??= s.first;
				check(same(s.first, calendarFirst), `${label}: first block at ${show(s.first)}, was ${show(calendarFirst)}`);
				continue;
			}
			title ??= s.title ? { rect: s.title, tab: tab.name } : null;
			first ??= s.first ? { rect: s.first, tab: tab.name } : null;
			// Top and height: Body's title shares its row with a button, so its width differs.
			const t = s.title;
			const want = title?.rect;
			check(
				!!t && !!want && Math.abs(t.top - want.top) < 0.5 && Math.abs(t.height - want.height) < 0.5,
				`${label}: title at ${show(s.title)}, ${title?.tab} has ${show(title?.rect ?? null)}`,
			);
			check(
				!!s.first && !!first && Math.abs(s.first.top - first.rect.top) < 0.5,
				`${label}: first content at ${show(s.first)}, ${first?.tab} has ${show(first?.rect ?? null)} (+${s.t}ms)`,
			);
		}
		const name = join(out, `tab-${data}-${tab.name}.png`);
		if (!shots.includes(name)) {
			await page.screenshot({ path: name });
			shots.push(name);
		}
	}
	console.log(`${data} tabs: title ${show(title?.rect ?? null)}, first content top ${first?.rect.top}, bar ${show(bar)}`);

}

/** The back button is at least 44x44, below the status bar, and the topmost element at its center. */
async function backButton(page: Page, label: string) {
	const b = (await page.evaluate(`(() => {
		const button = document.querySelector('.page-head [aria-label="Back"]');
		const r = button.getBoundingClientRect();
		const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
		return { w: r.width, h: r.height, top: r.top, hit: !!hit && button.contains(hit) };
	})()`)) as { w: number; h: number; top: number; hit: boolean };
	check(b.w >= 44 && b.h >= 44, `${label}: back button ${b.w}x${b.h}, want at least 44x44`);
	check(b.top >= SAFE_TOP, `${label}: back button at ${b.top}, under the status bar`);
	check(b.hit, `${label}: something covers the back button`);
}

if (failures.length) {
	console.error(`\n${failures.length} failure(s):\n${failures.join("\n")}`);
	process.exit(1);
}
console.log(`\nok: tab switches render in place, back buttons work (${shots.length} screenshots in ${out}):`);
for (const shot of shots) console.log(`  ${shot}`);
