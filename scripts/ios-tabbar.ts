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
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type Page, webkit } from "playwright-core";
import { checker, iPhone, prepare, type Rect, SAFE_BOTTOM, same, seed, show, startApp, TABS } from "./ios-harness.ts";

const out = process.argv[2] ?? join(homedir(), "forma-ios-shots", "r2");

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

const { failures, check } = checker();

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

/** Clicks a tab and reads the geometry two frames later: the new screen has rendered. */
async function switchTo(page: Page, href: string): Promise<Reading> {
	return page.evaluate(
		`new Promise((resolve) => {
			// The router changes the route in place (pushState, no hashchange) and renders before the next frame.
			document.querySelector('.tabbar a[href="${href}"]').click();
			requestAnimationFrame(() => requestAnimationFrame(() => resolve((${READ})())));
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
			const page = await iPhone(browser, scheme);
			const context = page.context();
			page.on("pageerror", (e) => failures.push(`[pageerror] ${e.message}`));
			await prepare(page, base);
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
