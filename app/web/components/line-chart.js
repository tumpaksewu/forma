// A single-series line chart over time: 2px line, 8px markers with a surface ring, recessive grid,
// and a tap/hover readout. One series, so no legend: the heading above the chart names it.

import { fmt, parse } from "../lib/dates.js";
import { html, useEffect, useRef, useState } from "../lib/preact.js";

const HEIGHT = 180;
const PAD = { top: 16, right: 14, bottom: 26, left: 44 };

/**
 * Args:
 *   points: [{ date: "YYYY-MM-DD", value: number }], oldest first, already in display units.
 *   format: value → label text.
 */
export function LineChart({ points, format = String }) {
	const box = useRef();
	const [width, setWidth] = useState(320);
	const [active, setActive] = useState(null);
	useEffect(() => {
		const el = box.current;
		if (!el) return;
		const observer = new ResizeObserver(() => setWidth(el.clientWidth));
		observer.observe(el);
		setWidth(el.clientWidth);
		return () => observer.disconnect();
	}, []);
	useEffect(() => setActive(null), [points]);

	if (points.length === 0) return null;
	const times = points.map((p) => parse(p.date).getTime());
	const values = points.map((p) => p.value);
	let lo = Math.min(...values);
	let hi = Math.max(...values);
	const pad = (hi - lo || Math.abs(hi) || 1) * 0.15;
	lo -= pad;
	hi += pad;
	const t0 = Math.min(...times);
	const t1 = Math.max(...times);
	const innerW = Math.max(10, width - PAD.left - PAD.right);
	const innerH = HEIGHT - PAD.top - PAD.bottom;
	const x = (t) => PAD.left + (t1 === t0 ? innerW / 2 : ((t - t0) / (t1 - t0)) * innerW);
	const y = (v) => PAD.top + (1 - (v - lo) / (hi - lo)) * innerH;
	const ticks = [lo + (hi - lo) * 0.1, (lo + hi) / 2, hi - (hi - lo) * 0.1];
	const path = points.map((p, i) => `${i ? "L" : "M"}${x(times[i]).toFixed(1)},${y(p.value).toFixed(1)}`).join("");

	const pick = (clientX) => {
		const rect = box.current.getBoundingClientRect();
		const px = clientX - rect.left;
		let best = 0;
		for (let i = 1; i < points.length; i++) if (Math.abs(x(times[i]) - px) < Math.abs(x(times[best]) - px)) best = i;
		setActive(best);
	};
	const a = active === null ? null : points[active];

	return html`<div class="line-chart" ref=${box}
		onPointerMove=${(e) => e.pointerType === "mouse" && pick(e.clientX)}
		onPointerDown=${(e) => pick(e.clientX)}
		onPointerLeave=${(e) => e.pointerType === "mouse" && setActive(null)}>
		<svg width=${width} height=${HEIGHT} role="img" aria-label="Trend chart">
			${ticks.map(
				(t) => html`<g>
					<line class="grid" x1=${PAD.left} x2=${width - PAD.right} y1=${y(t)} y2=${y(t)} />
					<text class="axis" x=${PAD.left - 6} y=${y(t) + 4} text-anchor="end">${format(t)}</text>
				</g>`,
			)}
			<text class="axis" x=${PAD.left} y=${HEIGHT - 6} text-anchor="start">${fmt(points[0].date, { month: "short", day: "numeric", year: "2-digit" })}</text>
			${
				points.length > 1
					? html`<text class="axis" x=${width - PAD.right} y=${HEIGHT - 6} text-anchor="end">${fmt(points.at(-1).date, { month: "short", day: "numeric", year: "2-digit" })}</text>`
					: null
			}
			${a ? html`<line class="crosshair" x1=${x(times[active])} x2=${x(times[active])} y1=${PAD.top} y2=${PAD.top + innerH} />` : null}
			${points.length > 1 ? html`<path class="series" d=${path} />` : null}
			${points.map(
				(p, i) =>
					html`<circle class=${`dot ${i === active ? "on" : ""}`} cx=${x(times[i])} cy=${y(p.value)} r=${i === active ? 6 : 4} />`,
			)}
		</svg>
		${
			a
				? html`<div class="chart-tip" style=${`left:${Math.min(Math.max(x(times[active]), 60), width - 60)}px`}>
					<strong>${format(a.value)}</strong><span>${fmt(a.date, { month: "short", day: "numeric", year: "numeric" })}</span>
				</div>`
				: null
		}
	</div>`;
}
