// Types for router.js (plain JS, served to the browser as is). Only what the tests use.

export function linkRoute(click: {
	href: string | null;
	target: string | null;
	download: boolean;
	button: number;
	modifier: boolean;
	prevented: boolean;
}): string | null;

export function canGoBack(state: unknown): boolean;
