import assert from "node:assert/strict";
import { test } from "node:test";
import { composerHeight, visibleArea } from "./viewport.js";

test("visibleArea reports the keyboard when the visual viewport loses a keyboard's height", () => {
	// Arrange
	const viewport = { height: 452.4, offsetTop: 18.6, scale: 1 };
	// Act
	const area = visibleArea(viewport, 852);
	// Assert
	assert.deepEqual(area, { height: 452, top: 19, keyboard: true });
});

test("visibleArea ignores small changes and pinch zoom", () => {
	// Arrange
	const chrome = { height: 800, offsetTop: 0, scale: 1 };
	const zoomed = { height: 400, offsetTop: 120, scale: 2 };
	// Act
	const withChrome = visibleArea(chrome, 852);
	const withZoom = visibleArea(zoomed, 852);
	// Assert
	assert.equal(withChrome.keyboard, false);
	assert.equal(withZoom.keyboard, false);
	assert.equal(withZoom.top, 120);
});

test("visibleArea never places the panel above the layout viewport", () => {
	// Arrange
	const bounce = { height: 852, offsetTop: -12 };
	// Act
	const area = visibleArea(bounce, 852);
	// Assert
	assert.equal(area.top, 0);
});

test("composerHeight grows with the text between min and max", () => {
	// Arrange
	const oneLine = 42;
	const threeLines = 82;
	// Act
	const short = composerHeight(oneLine, 2, 44, 340);
	const taller = composerHeight(threeLines, 2, 44, 340);
	// Assert
	assert.deepEqual(short, { height: 44, scroll: false });
	assert.deepEqual(taller, { height: 84, scroll: false });
});

test("composerHeight stops at max and scrolls past it", () => {
	// Act
	const capped = composerHeight(600, 2, 44, 340);
	const unlimited = composerHeight(600, 2, 44, Number.NaN);
	// Assert
	assert.deepEqual(capped, { height: 340, scroll: true });
	assert.deepEqual(unlimited, { height: 602, scroll: false });
});
