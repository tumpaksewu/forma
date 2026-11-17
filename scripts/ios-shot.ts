// iPhone screenshots with Playwright WebKit, for layout checks: node scripts/ios-shot.ts [out-dir]
// Needs `pnpm exec playwright-core install webkit` once. Desktop WebKit reports no safe-area insets, so the page's
// --safe-top/--safe-bottom tokens (app styles.css and the dock) are overridden with an iPhone 15/16 Pro's values,
// and the on-screen keyboard is simulated by giving the dock a visual viewport that ends where the keyboard begins.
// The agent's chat comes from a canned event stream, so nothing is sent to the agent.
import { mkdirSync } from "node:fs";
import { type Page, webkit } from "playwright-core";

const out = process.argv[2] ?? "/tmp/forma-ios-shots";
const base = process.env.FORMA_URL ?? "http://localhost:4300";
const SAFE_TOP = 59;
const SAFE_BOTTOM = 34;
const KEYBOARD = 336;
mkdirSync(out, { recursive: true });

const INSETS = `:root { --safe-top: ${SAFE_TOP}px !important; --safe-bottom: ${SAFE_BOTTOM}px !important; }
forma-dock { --safe-top: ${SAFE_TOP}px; --safe-bottom: ${SAFE_BOTTOM}px; }`;

const chat = {
	busy: false,
	partial: "",
	queued: 0,
	items: [
		{ type: "user", id: "u1", text: "Plan a push day for Friday" },
		{ type: "tool", id: "t1", name: "bash", summary: "curl /api/exercises?q=bench", state: "done", output: "" },
		{
			type: "assistant",
			id: "a1",
			text: "Done: **Push** on Friday with bench press 4×6, overhead press 3×8, incline dumbbell press 3×10 and dips 3×12.",
		},
		{ type: "user", id: "u2", text: "Make the dips weighted and add a rest timer" },
		{
			type: "assistant",
			id: "a2",
			text: "Dips are now weighted (+10 kg). The rest timer starts when you tick off a set; tap it to skip.",
		},
	],
};

async function measure(page: Page) {
	return page.evaluate(() => {
		const bar = document.querySelector(".tabbar");
		const rect = bar?.getBoundingClientRect();
		return {
			innerHeight,
			barBottom: rect?.bottom,
			barHeight: rect?.height,
			barBg: bar ? getComputedStyle(bar).backgroundColor : null,
			bodyBg: getComputedStyle(document.body).backgroundColor,
			htmlBg: getComputedStyle(document.documentElement).backgroundColor,
		};
	});
}

const browser = await webkit.launch();
for (const scheme of ["dark", "light"] as const) {
	const context = await browser.newContext({
		viewport: { width: 393, height: 852 },
		deviceScaleFactor: 3,
		isMobile: true,
		hasTouch: true,
		colorScheme: scheme,
	});
	const page = await context.newPage();
	page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
	await page.route("**/__forma/events", (route) =>
		route.fulfill({
			status: 200,
			contentType: "text/event-stream",
			body: `retry: 600000\n\nevent: chat\ndata: ${JSON.stringify(chat)}\n\n`,
		}),
	);
	await page.addInitScript(() => sessionStorage.removeItem("forma-dock"));

	for (const hash of ["#/body", "#/"]) {
		await page.goto(`${base}/${hash}`);
		await page.addStyleTag({ content: INSETS });
		await page.waitForTimeout(1200);
		const name = `${out}/${scheme}-${hash === "#/" ? "calendar" : "body"}.png`;
		await page.screenshot({ path: name });
		console.log(name, JSON.stringify(await measure(page)));
		if (hash === "#/body") {
			// An app sheet over the tab bar: it should reach the bottom edge too.
			await page.getByRole("button", { name: "Weigh-in" }).click();
			await page.waitForTimeout(400);
			const sheet = `${out}/${scheme}-body-sheet.png`;
			await page.screenshot({ path: sheet });
			const bottom = await page.evaluate(() => document.querySelector(".sheet")?.getBoundingClientRect().bottom);
			console.log(sheet, JSON.stringify({ sheetBottom: bottom }));
		}
	}

	// The agent panel, keyboard up, a multi-line message in the composer.
	await page.click("forma-dock >> .fab");
	await page.waitForTimeout(300);
	const textarea = page.locator("forma-dock >> textarea");
	await textarea.focus();
	await textarea.fill(
		"Move Friday's push day to Saturday,\nswap overhead press for landmine press\nand keep the rest timer at 2 minutes",
	);
	await page.evaluate(
		({ keyboard }) => {
			const host = document.querySelector("forma-dock") as HTMLElement;
			host.style.setProperty("--vv-height", `${innerHeight - keyboard}px`);
			host.style.setProperty("--vv-top", "0px");
			host.shadowRoot?.querySelector(".panel")?.classList.add("keyboard");
			const kb = document.createElement("div");
			kb.textContent = "on-screen keyboard (simulated)";
			kb.style.cssText = `position:fixed;left:0;right:0;bottom:0;height:${keyboard}px;z-index:2147483647;background:#3a3a3c;color:#aaa;display:grid;place-items:center;font:14px system-ui`;
			document.body.appendChild(kb);
			host.shadowRoot?.querySelector("textarea")?.dispatchEvent(new Event("input"));
		},
		{ keyboard: KEYBOARD },
	);
	await page.waitForTimeout(300);
	const name = `${out}/${scheme}-agent-composer.png`;
	await page.screenshot({ path: name });
	const composer = await page.evaluate(() => {
		const root = document.querySelector("forma-dock")?.shadowRoot;
		const ta = root?.querySelector("textarea");
		const chat = root?.querySelector(".body.chat");
		const last = chat?.lastElementChild?.getBoundingClientRect();
		const panel = root?.querySelector(".panel")?.getBoundingClientRect();
		return {
			fontSize: ta ? getComputedStyle(ta).fontSize : null,
			textareaHeight: ta?.getBoundingClientRect().height,
			panelBottom: panel?.bottom,
			lastMessageVisible: !!last && !!chat && last.bottom <= chat.getBoundingClientRect().bottom + 1,
		};
	});
	console.log(name, JSON.stringify(composer));
	await context.close();
}
await browser.close();
