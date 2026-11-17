// Body: scans and weigh-ins over time. Tiles for the headline metrics, a trend chart for the selected one, and the
// latest scan's detail (segments, circumferences, posture). Scans are usually imported by the agent from reports.
import { LineChart } from "../components/line-chart.js";
import { Icon, Sheet, Spinner } from "../components/ui.js";
import { changed, db, loadPrefs, useData } from "../lib/api.js";
import {
	display,
	fmtValue,
	HEADLINE,
	kindOf,
	labelOf,
	metricKeys,
	SEGMENTS,
	series,
	sortMeasurements,
	toMetric,
} from "../lib/body.js";
import { fmt, relative, today } from "../lib/dates.js";
import { html, useState } from "../lib/preact.js";

const segLabel = (s) => s.replace("_", " ").replace(/^\w/, (c) => c.toUpperCase());

function Delta({ kind, now, before, units }) {
	if (typeof before !== "number" || typeof now !== "number") return null;
	const a = display(kind, now, units)?.value ?? 0;
	const b = display(kind, before, units)?.value ?? 0;
	const d = Math.round((a - b) * 10) / 10;
	if (!d) return html`<span class="delta">±0</span>`;
	return html`<span class="delta">${d > 0 ? "▲" : "▼"} ${Math.abs(d).toLocaleString()}</span>`;
}

export function BodyView() {
	const [loaded, { loading }] = useData(() => db.list("measurements").then(sortMeasurements), []);
	const list = loaded ?? [];
	const [prefs] = useData(loadPrefs, []);
	const [selected, setSelected] = useState("weight_kg");
	const [adding, setAdding] = useState(false);
	const [open, setOpen] = useState(null);
	const units = prefs?.units ?? "kg";

	// Only before the first answer: an empty list (cached or fresh) renders the empty state at once.
	if (loading && !loaded) return html`<${Spinner} />`;

	const keys = metricKeys(list);
	const tiles = [...HEADLINE.filter((k) => keys.includes(k))];
	const metric = keys.includes(selected) ? selected : (tiles[0] ?? keys[0]);
	const latestWith = (k) => list.find((m) => typeof m.metrics?.[k] === "number");
	const previousWith = (k) => list.filter((m) => typeof m.metrics?.[k] === "number")[1];
	const scan = list.find((m) => m.segments || m.circumferences_cm || m.posture?.length);
	const previousScan = scan ? list.filter((m) => m.circumferences_cm && m !== scan && m.date <= scan.date)[0] : null;
	const kind = metric ? kindOf(metric) : "plain";
	const points = metric
		? series(list, metric).map((p) => ({ ...p, value: display(kind, p.value, units)?.value ?? p.value }))
		: [];

	return html`<div class="body-page">
		<div class="row">
			<h1 class="page-title grow">Body</h1>
			<button class="btn small" onClick=${() => setAdding(true)}><${Icon} name="plus" size="16" /> Weigh-in</button>
		</div>

		${
			!list.length
				? html`<div class="card body-empty">
					<h3>No measurements yet</h3>
					<p class="muted">Attach your Visbody reports (PDF or screenshots) in the agent panel and ask it to import them. It reads every value, including segments, circumferences and posture.</p>
					<button class="btn primary" onClick=${() => window.forma?.open()}>Open the agent</button>
				</div>`
				: html`
				<div class="tiles">
					${tiles.map((k) => {
						const latest = latestWith(k);
						return html`<button class=${`tile ${k === metric ? "active" : ""}`} onClick=${() => setSelected(k)}>
							<span class="tile-label">${labelOf(k)}</span>
							<span class="tile-value">${fmtValue(kindOf(k), latest?.metrics[k], units)}</span>
							<${Delta} kind=${kindOf(k)} now=${latest?.metrics[k]} before=${previousWith(k)?.metrics[k]} units=${units} />
						</button>`;
					})}
				</div>

				<section class="card chart-card">
					<div class="row gap">
						<h2 class="grow">${labelOf(metric)}</h2>
						<select value=${metric} onChange=${(e) => setSelected(e.currentTarget.value)} aria-label="Metric">
							${keys.map((k) => html`<option value=${k}>${labelOf(k)}</option>`)}
						</select>
					</div>
					${
						points.length > 1
							? html`<${LineChart} points=${points} format=${(v) => `${Math.round(v * 10) / 10}`} />`
							: html`<p class="muted small">One measurement so far: ${fmtValue(kind, series(list, metric)[0]?.value, units)}. The trend appears with the next one.</p>`
					}
				</section>

				${scan ? html`<${ScanDetail} scan=${scan} previous=${previousScan} units=${units} />` : null}

				<section>
					<h2 class="section-title">History</h2>
					<ul class="scan-list">
						${list.map(
							(m) => html`<li key=${m.id} class="card">
								<button class="scan-row" onClick=${() => setOpen(open === m.id ? null : m.id)}>
									<span class="grow">
										<strong>${relative(m.date)}</strong>
										<span class="muted small">${m.date !== today() ? fmt(m.date, { year: "numeric", month: "short", day: "numeric" }) : ""} · ${m.source ?? "manual"}</span>
									</span>
									<span class="muted small">${[
										fmtValue("mass", m.metrics?.weight_kg, units),
										typeof m.metrics?.body_fat_pct === "number" ? `${m.metrics.body_fat_pct}%` : null,
									]
										.filter((x) => x && x !== "–")
										.join(" · ")}</span>
								</button>
								${
									open === m.id
										? html`<div class="scan-more">
											<dl class="kv">
												${Object.entries(m.metrics ?? {}).map(
													([k, v]) => html`<div><dt>${labelOf(k)}</dt><dd>${fmtValue(kindOf(k), v, units)}</dd></div>`,
												)}
											</dl>
											${m.notes ? html`<p class="small">${m.notes}</p>` : null}
											${m.file ? html`<p class="muted small">From ${m.file.split("/").pop()}</p>` : null}
											<button class="btn small danger" onClick=${async () => {
												if (!confirm("Delete this measurement?")) return;
												await db.remove("measurements", m.id);
												changed();
											}}><${Icon} name="trash" size="16" /> Delete</button>
										</div>`
										: null
								}
							</li>`,
						)}
					</ul>
				</section>`
		}
		${adding ? html`<${WeighIn} units=${units} onClose=${() => setAdding(false)} />` : null}
	</div>`;
}

function ScanDetail({ scan, previous, units }) {
	const seg = scan.segments ?? {};
	const circ = scan.circumferences_cm ?? {};
	const prevCirc = previous?.circumferences_cm ?? {};
	return html`<section class="card scan-detail">
		<h2>Latest scan <span class="muted small">${relative(scan.date)} · ${scan.source ?? ""}</span></h2>
		${
			seg.lean_kg || seg.fat_kg
				? html`<h3 class="section-label">Segments</h3>
					<table class="seg-table">
						<thead><tr><th></th>${seg.lean_kg ? html`<th>Lean</th>` : null}${seg.fat_kg ? html`<th>Fat</th>` : null}</tr></thead>
						<tbody>
							${SEGMENTS.filter((s) => seg.lean_kg?.[s] !== undefined || seg.fat_kg?.[s] !== undefined).map(
								(s) => html`<tr><td>${segLabel(s)}</td>
									${seg.lean_kg ? html`<td>${fmtValue("mass", seg.lean_kg[s], units)}</td>` : null}
									${seg.fat_kg ? html`<td>${fmtValue("mass", seg.fat_kg[s], units)}</td>` : null}</tr>`,
							)}
						</tbody>
					</table>`
				: null
		}
		${
			Object.keys(circ).length
				? html`<h3 class="section-label">Circumferences</h3>
					<dl class="kv">
						${Object.entries(circ).map(
							([k, v]) =>
								html`<div><dt>${segLabel(k)}</dt><dd>${fmtValue("length", v, units)} <${Delta} kind="length" now=${v} before=${prevCirc[k]} units=${units} /></dd></div>`,
						)}
					</dl>`
				: null
		}
		${
			scan.posture?.length
				? html`<h3 class="section-label">Posture</h3>
					<ul class="posture">
						${scan.posture.map(
							(p) =>
								html`<li><span class="grow">${p.name}</span><span class="muted small">${p.value ?? ""}${p.unit ?? ""}</span>${p.finding ? html`<span class="finding">${p.finding}</span>` : null}</li>`,
						)}
					</ul>`
				: null
		}
	</section>`;
}

function WeighIn({ units, onClose }) {
	const [date, setDate] = useState(today());
	const [weight, setWeight] = useState("");
	const [fat, setFat] = useState("");
	const save = async () => {
		const metrics = {};
		if (weight) metrics.weight_kg = Math.round(toMetric("mass", Number(weight), units) * 100) / 100;
		if (fat) metrics.body_fat_pct = Number(fat);
		if (!Object.keys(metrics).length) return;
		await db.create("measurements", { date, source: "manual", metrics });
		changed();
		onClose();
	};
	return html`<${Sheet} title="Weigh-in" onClose=${onClose}>
		<div class="form">
			<label>Date <input type="date" value=${date} onInput=${(e) => setDate(e.currentTarget.value)} /></label>
			<label>Weight (${units === "lb" ? "lb" : "kg"}) <input type="number" inputmode="decimal" step="any" value=${weight} onInput=${(e) => setWeight(e.currentTarget.value)} /></label>
			<label>Body fat (%) — optional <input type="number" inputmode="decimal" step="any" value=${fat} onInput=${(e) => setFat(e.currentTarget.value)} /></label>
			<button class="btn primary wide" disabled=${!weight && !fat} onClick=${save}>Save</button>
		</div>
	</${Sheet}>`;
}
