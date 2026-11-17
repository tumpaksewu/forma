// In-app navigation. Routes live in the URL hash (#/plan), but the app never *navigates* to change them: no
// `location.hash = …`, and links to "#/…" are not followed. Safari (iOS Home Screen apps included) runs a page served
// over plain http from a LAN address in a separate "enhanced security" process, and every navigation of such a page,
// even a same-document hash change, ends in a full reload of the page in a new process: the screen renders, goes
// blank and renders again from scratch ~150ms later. `history.pushState` is not a navigation, so routes change with it.
//
//   navigate("#/plan")              go to a route (a new history entry)
//   navigate("#/day/…", { replace }) change the current entry instead
//   back("#/library")               the previous in-app screen, or the fallback when there is none
//   subscribe(fn)                   called with { hash, restore } after every route change
//
// Each entry's history.state is { forma: depth, key }: depth counts the in-app entries before it, so `back` knows
// whether history.back() stays in the app (a Home Screen app has no browser back, and its history may be empty).
// Scroll positions are kept per entry and restored on back/forward.

/**
 * The route a click should open in place, or null to let the browser handle it.
 *
 * Args:
 *   click: { href, target, download, button, modifier, prevented } of a click on an <a> (href is the attribute).
 */
export function linkRoute(click) {
	if (click.prevented || click.button !== 0 || click.modifier || click.download) return null;
	if (click.target && click.target !== "_self") return null;
	const href = click.href ?? "";
	return href === "#" || href.startsWith("#/") ? href : null;
}

/** Whether the history entry with this state has an in-app entry before it. */
export function canGoBack(state) {
	return typeof state?.forma === "number" && state.forma > 0;
}

const listeners = new Set();
const scrolls = new Map();
let current = "";
let currentKey = "";
let started = false;

const depth = () => (typeof history.state?.forma === "number" ? history.state.forma : 0);
const key = () => history.state?.key ?? "";
const newKey = () => Math.random().toString(36).slice(2, 10);
const normalize = (hash) => (hash.startsWith("#") ? hash : `#${hash}`);

function emit(restore) {
	// Runs before the new screen renders, so scrollY is still the one of the screen being left.
	scrolls.set(currentKey, window.scrollY);
	current = location.hash;
	currentKey = key();
	const scroll = restore ? (scrolls.get(key()) ?? 0) : 0;
	for (const listener of listeners) listener({ hash: current, restore, scroll });
}

/** Opens a route in place. Same route: nothing happens (no extra history entry). */
export function navigate(hash, { replace = false } = {}) {
	const target = normalize(hash);
	if (target === (location.hash || "#/") && !replace) return;
	const state = { forma: replace ? depth() : depth() + 1, key: newKey() };
	if (replace) history.replaceState(state, "", target);
	else history.pushState(state, "", target);
	emit(false);
}

/** Goes back to the previous in-app screen if there is one, else replaces this screen with `fallback`. */
export function back(fallback) {
	if (canGoBack(history.state)) history.back();
	else navigate(fallback, { replace: true });
}

/** Calls `listener({ hash, restore, scroll })` on every route change; returns the unsubscribe function. */
export function subscribe(listener) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/** Starts routing: marks the first entry, opens "#/…" links in place, follows back/forward. Call once. */
export function start() {
	if (started) return;
	started = true;
	history.scrollRestoration = "manual";
	if (typeof history.state?.forma !== "number") history.replaceState({ forma: 0, key: newKey() }, "");
	current = location.hash;
	currentKey = key();
	document.addEventListener("click", (e) => {
		const a = e.target.closest?.("a[href]");
		if (!a) return;
		const route = linkRoute({
			href: a.getAttribute("href"),
			target: a.getAttribute("target"),
			download: a.hasAttribute("download"),
			button: e.button,
			modifier: e.metaKey || e.ctrlKey || e.shiftKey || e.altKey,
			prevented: e.defaultPrevented,
		});
		if (route === null) return;
		e.preventDefault();
		navigate(route === "#" ? "#/" : route);
	});
	// Back/forward (a swipe, or history.back()). Safari fires hashchange too; act once per change.
	window.addEventListener("popstate", () => current !== location.hash && emit(true));
	// Code that still sets location.hash: render it, but that path reloads the page on Safari over http.
	window.addEventListener("hashchange", () => current !== location.hash && emit(false));
}
