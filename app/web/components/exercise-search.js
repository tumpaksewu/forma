// Search and filter the exercise library. Used by the Library screen and by the picker that adds to a workout.
import { exercises, meta, useData } from "../lib/api.js";
import { html, useEffect, useState } from "../lib/preact.js";
import { ExerciseMedia, Icon, Spinner, title } from "./ui.js";

export function ExerciseSearch({ onPick, picked = [], autofocus = false }) {
	const [q, setQ] = useState("");
	const [debounced, setDebounced] = useState("");
	const [muscle, setMuscle] = useState("");
	const [equipment, setEquipment] = useState("");
	useEffect(() => {
		const t = setTimeout(() => setDebounced(q), 180);
		return () => clearTimeout(t);
	}, [q]);
	const [info] = useData(meta, []);
	const filters = {};
	if (muscle) filters.muscle = muscle;
	if (equipment) filters.equipment = equipment;
	const [result, { loading }] = useData(() => exercises.search(debounced, filters, 80), [debounced, muscle, equipment]);

	return html`<div class="ex-search">
		<label class="search-box">
			<${Icon} name="search" />
			<input
				type="search"
				placeholder="Search 870+ exercises"
				value=${q}
				autofocus=${autofocus}
				onInput=${(e) => setQ(e.currentTarget.value)}
			/>
		</label>
		<div class="filters">
			<select value=${muscle} onChange=${(e) => setMuscle(e.currentTarget.value)} aria-label="Muscle">
				<option value="">All muscles</option>
				${(info?.facets.muscle ?? []).map((m) => html`<option value=${m}>${title(m)}</option>`)}
			</select>
			<select value=${equipment} onChange=${(e) => setEquipment(e.currentTarget.value)} aria-label="Equipment">
				<option value="">All equipment</option>
				${(info?.facets.equipment ?? []).map((m) => html`<option value=${m}>${title(m)}</option>`)}
			</select>
		</div>
		${loading && !result ? html`<${Spinner} />` : null}
		${
			result
				? html`<p class="muted small">${result.total} exercise${result.total === 1 ? "" : "s"}${result.total > result.items.length ? `, showing ${result.items.length}` : ""}</p>
					<ul class="ex-list">
						${result.items.map(
							(x) => html`<li key=${x.id}>
								<button class="ex-row" onClick=${() => onPick(x)}>
									<${ExerciseMedia} images=${x.images.slice(0, 1)} size="thumb" alt="" />
									<span class="ex-row-text">
										<strong>${x.name}</strong>
										<span class="muted small">${[title(x.primaryMuscles[0]), title(x.equipment)].filter(Boolean).join(" · ")}</span>
									</span>
									${picked.includes(x.id) ? html`<span class="pill ok"><${Icon} name="check" size="14" /></span>` : null}
								</button>
							</li>`,
						)}
					</ul>`
				: null
		}
	</div>`;
}
