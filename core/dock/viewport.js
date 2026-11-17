// Pure layout helpers for the dock: sizing the full-screen panel to what is visible above the on-screen keyboard,
// and the auto-growing composer. No DOM access here, so they can be tested in Node.

/** Below this many CSS px of lost height, a smaller visual viewport is browser chrome, not the keyboard. */
const KEYBOARD_MIN = 120;

/**
 * The part of the screen the dock can use, from `window.visualViewport` and the layout viewport's height
 * (`document.documentElement.clientHeight`, which iOS does not shrink for the keyboard).
 * @param {{ height: number, offsetTop: number, scale?: number }} viewport
 * @param {number} layoutHeight
 * @returns {{ height: number, top: number, keyboard: boolean }}
 */
export function visibleArea(viewport, layoutHeight) {
	const height = Math.round(viewport.height);
	const zoomed = (viewport.scale ?? 1) > 1.01;
	return {
		height,
		top: Math.max(0, Math.round(viewport.offsetTop)),
		keyboard: !zoomed && layoutHeight - height > KEYBOARD_MIN,
	};
}

/**
 * The composer's height for its content: `scrollHeight` (padding included) plus borders, kept within
 * [min, max]; past max it scrolls. A missing max (`NaN`, from `max-height: none`) means no limit.
 * @param {number} scrollHeight
 * @param {number} borders
 * @param {number} min
 * @param {number} max
 * @returns {{ height: number, scroll: boolean }}
 */
export function composerHeight(scrollHeight, borders, min, max) {
	const limit = Number.isFinite(max) ? max : Number.POSITIVE_INFINITY;
	const wanted = scrollHeight + borders;
	return { height: Math.min(Math.max(wanted, Number.isFinite(min) ? min : 0), limit), scroll: wanted > limit };
}
