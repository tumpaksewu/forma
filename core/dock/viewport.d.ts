// Types for viewport.js (plain JS, served to the browser as is).

export function visibleArea(
	viewport: { height: number; offsetTop: number; scale?: number },
	layoutHeight: number,
): { height: number; top: number; keyboard: boolean };

export function composerHeight(
	scrollHeight: number,
	borders: number,
	min: number,
	max: number,
): { height: number; scroll: boolean };
