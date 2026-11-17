import assert from "node:assert/strict";
import { test } from "node:test";
import { canGoBack, linkRoute } from "./router.js";

const click = { href: "#/plan", target: null, download: false, button: 0, modifier: false, prevented: false };

test("linkRoute opens an in-app route link in place", () => {
	// Arrange
	const tab = { ...click };
	const home = { ...click, href: "#" };
	// Act
	const routes = [linkRoute(tab), linkRoute(home)];
	// Assert
	assert.deepEqual(routes, ["#/plan", "#"]);
});

test("linkRoute leaves other links and modified clicks to the browser", () => {
	// Arrange
	const others = [
		{ ...click, href: "/media/x.jpg" },
		{ ...click, href: "https://example.com/#/plan" },
		{ ...click, href: "#section" },
		{ ...click, href: null },
		{ ...click, target: "_blank" },
		{ ...click, download: true },
		{ ...click, button: 1 },
		{ ...click, modifier: true },
		{ ...click, prevented: true },
	];
	// Act
	const routes = others.map(linkRoute);
	// Assert
	assert.deepEqual(
		routes,
		others.map(() => null),
	);
});

test("canGoBack is true only for an entry with an in-app entry before it", () => {
	// Arrange
	const states = [{ forma: 2, key: "a" }, { forma: 0, key: "b" }, null, undefined, { other: 1 }, { forma: "1" }];
	// Act
	const answers = states.map(canGoBack);
	// Assert
	assert.deepEqual(answers, [true, false, false, false, false, false]);
});
