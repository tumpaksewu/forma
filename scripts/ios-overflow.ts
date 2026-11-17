// Horizontal overflow check on an emulated iPhone (Playwright WebKit): node scripts/ios-overflow.ts [out-dir] [label]
// Run by `pnpm test:ios`. Starts the seed app like ios-tabbar.ts, with long exercise names, titles, notes and file
// names seeded (seedLong in ios-harness.ts), at widths 375, 393 and 402 (dpr 3, simulated safe areas).
//
// The page must never be wider than the screen: on iOS a too-wide element makes the whole app pan sideways. On every
// tab (Calendar, Plan, Body with a scan opened, Exercises with a search), on a workout and on two exercises (the
// longest library name with history, and an owner-made name with no break opportunity), with the Reuse sheet open
// and with the agent panel open, it asserts:
// - document.documentElement.scrollWidth <= innerWidth;
// - no visible element (the dock's shadow tree included) extends past the viewport's left or right edge, except
//   inside a container that clips or scrolls horizontally (overflow-x not visible), which is then checked itself.
// Both run first with the global guard (overflow-x: clip on body, which clips the viewport) switched off, so the guard cannot hide a
// real overflow, then with it on, where it also asserts the guard is there and the page cannot be scrolled sideways.
// With the guard on it checks the fixed tab bar still spans the screen with its bottom at the viewport's bottom, the
// sheet sits at the bottom edge, and (at a desktop width) the calendar is still sticky.
// Screenshots of the Plan tab go to out-dir (default ~/forma-ios-shots/r4/after) as plan-<width>-<label>.png (label
// default "after"). Exits 1 on any failure.
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type Page, webkit } from "playwright-core";
import { checker, iPhone, prepare, seed, seedLong, startApp, UNBREAKABLE } from "./ios-harness.ts";

const out = process.argv[2] ?? join(homedir(), "forma-ios-shots", "r4", "after");
const label = process.argv[3] ?? "after";
const SIZES = [
	{ width: 375, height: 812 },
	{ width: 393, height: 852 },
	{ width: 402, height: 874 },
];
/** Switches the global guard off: what the page would do without it. */
const NO_GUARD = "body { overflow-x: visible !important; }";
const { failures, check } = checker();

/** Elements past the viewport's left or right edge that are not inside a horizontally clipping container. */
const OVERFLOWS = `() => {
	const vw = innerWidth;
	const parent = (el) => el.parentElement ?? (el.getRootNode() instanceof ShadowRoot ? el.getRootNode().host : null);
	const clipped = (el) => {
		for (let p = parent(el); p && p !== document.body && p !== document.documentElement; p = parent(p))
			if (getComputedStyle(p).overflowX !== "visible") return true;
		return false;
	};
	const name = (el) => el.tagName.toLowerCase() + (typeof el.className === "string" && el.className.trim()
		? "." + el.className.trim().split(/\\s+/).join(".") : "");
	const bad = [];
	const walk = (root) => {
		for (const el of root.querySelectorAll("*")) {
			if (el.shadowRoot) walk(el.shadowRoot);
			const r = el.getBoundingClientRect();
			if (!r.width || !r.height || getComputedStyle(el).visibility === "hidden") continue;
			if ((r.right > vw + 0.5 || r.left < -0.5) && !clipped(el))
				bad.push(name(el) + " " + Math.round(r.left) + ".." + Math.round(r.right) + " " + JSON.stringify((el.textContent ?? "").trim().slice(0, 40)));
		}
	};
	walk(document);
	return { vw, scrollWidth: document.documentElement.scrollWidth, bad };
}`;

type Overflow = { vw: number; scrollWidth: number; bad: string[] };

async function settle(page: Page) {
	// Load every lazy image (their intrinsic sizes must not widen anything), then back to the top.
	await page.evaluate(async () => {
		for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight / 2) {
			window.scrollTo(0, y);
			await new Promise((r) => setTimeout(r, 30));
		}
		window.scrollTo(0, 0);
	});
	await page.waitForLoadState("networkidle").catch(() => {});
	await page.waitForTimeout(300);
}

async function assertFits(page: Page, where: string, guarded: boolean) {
	const r = (await page.evaluate(`(${OVERFLOWS})()`)) as Overflow;
	const mode = guarded ? "guard on" : "guard off";
	check(r.scrollWidth <= r.vw, `${where} (${mode}): scrollWidth ${r.scrollWidth} > innerWidth ${r.vw}`);
	check(!r.bad.length, `${where} (${mode}): past the edge: ${r.bad.slice(0, 6).join(" | ")}`);
	if (!guarded) return;
	// On body (it reaches the viewport); html stays visible, or body.sheet-open's scroll lock would stop working.
	const css = await page.evaluate(() => ({
		html: getComputedStyle(document.documentElement).overflowX,
		body: getComputedStyle(document.body).overflowX,
		sheet: document.body.classList.contains("sheet-open"),
	}));
	check(
		css.html === "visible" && css.body === (css.sheet ? "hidden" : "clip"),
		`${where}: the guard is missing or moved (overflow-x ${JSON.stringify(css)})`,
	);
	const x = await page.evaluate(async () => {
		window.scrollTo(200, window.scrollY);
		await new Promise((r) => requestAnimationFrame(r));
		const x = window.scrollX;
		window.scrollTo(0, window.scrollY);
		return x;
	});
	check(x === 0, `${where}: the page scrolls sideways (scrollX ${x})`);
	const bar = await page.evaluate(() => {
		const r = document.querySelector(".tabbar")?.getBoundingClientRect();
		return r ? { left: r.left, right: r.right, bottom: r.bottom, vw: innerWidth, vh: innerHeight } : null;
	});
	check(
		!!bar && bar.left === 0 && bar.right === bar.vw && Math.abs(bar.bottom - bar.vh) < 0.5,
		`${where}: tab bar not flush with the screen: ${JSON.stringify(bar)}`,
	);
}

async function open(page: Page, base: string, hash: string, ready: string) {
	await page.goto(`${base}/${hash}`);
	await page.waitForSelector(ready);
	await settle(page);
}

async function screens(page: Page, base: string, ids: { workout: string; exercise: string }, size: string, guarded: boolean) {
	const at = (s: string) => `${s} @${size}`;

	await open(page, base, "#/", ".day-workouts .workout-summary");
	await assertFits(page, at("Calendar"), guarded);
	await page.locator(".day-workouts button", { hasText: "Reuse" }).dispatchEvent("click");
	await page.waitForSelector(".sheet .pick-list");
	await page.waitForTimeout(300);
	await assertFits(page, at("Calendar, Reuse sheet"), guarded);
	if (guarded) {
		const sheet = await page.evaluate(() => {
			const r = document.querySelector(".sheet")?.getBoundingClientRect();
			return r ? { left: r.left, right: r.right, bottom: r.bottom, vw: innerWidth, vh: innerHeight } : null;
		});
		check(
			!!sheet && sheet.left >= 0 && sheet.right <= sheet.vw && Math.abs(sheet.bottom - sheet.vh) < 0.5,
			`${at("Reuse sheet")}: not at the bottom edge: ${JSON.stringify(sheet)}`,
		);
	}
	await page.keyboard.press("Escape");

	await open(page, base, "#/plan", ".agenda-items .workout-summary");
	await assertFits(page, at("Plan"), guarded);
	if (guarded) {
		// Like Alex's screenshot: this week's Sunday "Gym A · Upper width" card, scrolled vertically only.
		await page.evaluate(() => {
			const cards = [...document.querySelectorAll(".week.current .workout-summary")];
			const card = cards.find((c) => c.textContent?.includes("Gym A")) ?? cards[0];
			if (card) window.scrollTo(0, window.scrollY + card.getBoundingClientRect().top - 180);
		});
		await page.waitForTimeout(300);
		await page.screenshot({ path: join(out, `plan-${size}-${label}.png`) });
	}

	await open(page, base, "#/body", ".scan-row");
	await page.locator(".scan-row").first().dispatchEvent("click");
	await page.waitForSelector(".scan-more");
	await assertFits(page, at("Body, scan opened"), guarded);

	await open(page, base, "#/library", ".ex-row");
	await page.fill(".search-box input", "triceps extension");
	await page.waitForTimeout(600);
	await settle(page);
	await assertFits(page, at("Exercises, searched"), guarded);

	await open(page, base, `#/workout/${ids.workout}`, ".entry");
	await assertFits(page, at("Workout"), guarded);

	await open(page, base, `#/exercise/${encodeURIComponent(ids.exercise)}`, ".history li");
	await assertFits(page, at("Exercise (long name, history)"), guarded);

	await open(page, base, `#/exercise/${UNBREAKABLE.id}`, ".exercise-page h1");
	await assertFits(page, at("Exercise (unbreakable name)"), guarded);

	await page.evaluate(() =>
		(document.querySelector("forma-dock")?.shadowRoot?.querySelector(".fab") as HTMLElement | null)?.click(),
	);
	await page.waitForTimeout(400);
	const panel = await page.evaluate(() => {
		const el = document.querySelector("forma-dock")?.shadowRoot?.querySelector(".panel");
		return !!el && !el.hasAttribute("hidden");
	});
	check(panel, `${at("Agent panel")}: did not open`);
	await assertFits(page, at("Agent panel open"), guarded);
}

const { base, child } = await startApp();
let browser: Awaited<ReturnType<typeof webkit.launch>> | undefined;
try {
	mkdirSync(out, { recursive: true });
	await seed(base, { images: true });
	const ids = await seedLong(base);
	browser = await webkit.launch();
	for (const guarded of [false, true]) {
		for (const size of SIZES) {
			const page = await iPhone(browser, "dark", size);
			await prepare(page, base);
			if (!guarded)
				await page.addInitScript((css) => {
					document.addEventListener("DOMContentLoaded", () => {
						const style = document.createElement("style");
						style.textContent = css;
						document.head.appendChild(style);
					});
				}, NO_GUARD);
			await screens(page, base, ids, String(size.width), guarded);
			await page.context().close();
		}
	}
	// The guard must not break position: sticky (the calendar sticks beside the day on wide screens).
	const context = await browser.newContext({ viewport: { width: 1000, height: 600 } });
	const desk = await context.newPage();
	await desk.goto(`${base}/#/`);
	await desk.waitForSelector(".day-workouts .workout-summary");
	await desk.evaluate(() => window.scrollTo(0, 300));
	await desk.waitForTimeout(200);
	const top = await desk.evaluate(() => document.querySelector(".calendar")?.getBoundingClientRect().top ?? null);
	check(top !== null && Math.abs(top - 16) < 1, `desktop: the calendar is not sticky with the guard (top ${top})`);
	await context.close();
} finally {
	await browser?.close();
	child.kill();
}

if (failures.length) {
	console.error(`ios-overflow: ${failures.length} failure(s)\n- ${failures.join("\n- ")}`);
	process.exit(1);
}
console.log(`ios-overflow: ok (widths ${SIZES.map((s) => s.width).join(", ")}; screenshots in ${out})`);
