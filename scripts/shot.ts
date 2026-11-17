// Screenshots of the running app for development: node scripts/shot.ts <out-dir> [hash ...]
import { chromium } from "playwright-core";

const [out = ".forma/shots", ...hashes] = process.argv.slice(2);
const base = process.env.FORMA_URL ?? "http://localhost:4300";
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
for (const scheme of ["light", "dark"] as const) {
	const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme });
	page.on("console", (m) => m.type() === "error" && console.log(`[console] ${m.text()}`));
	page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
	for (const hash of hashes.length ? hashes : ["#/"]) {
		await page.goto(`${base}/${hash}`);
		await page.waitForTimeout(1500);
		const name = `${out}/${scheme}-${hash.replace(/[^\w]+/g, "_") || "home"}.png`;
		await page.screenshot({ path: name, fullPage: false });
		console.log(name);
	}
	await page.close();
}
await browser.close();
