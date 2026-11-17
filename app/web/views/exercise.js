// One exercise: how it looks (photos or GIF), how to do it, which muscles it works, and the owner's history with it.
import { ExerciseMedia, Icon, Spinner, title } from "../components/ui.js";
import { changed, db, exercises, meta, useData } from "../lib/api.js";
import { relative, today } from "../lib/dates.js";
import { html, useState } from "../lib/preact.js";
import { e1rm, entryFor, listForDay, newWorkout } from "../lib/workouts.js";

/** A tiny line chart of numbers, oldest left. */
function Sparkline({ values }) {
	if (values.length < 2) return null;
	const w = 280;
	const h = 60;
	const min = Math.min(...values);
	const max = Math.max(...values);
	const span = max - min || 1;
	const points = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - 6 - ((v - min) / span) * (h - 12)}`);
	return html`<svg class="spark" viewBox=${`0 0 ${w} ${h}`} preserveAspectRatio="none">
		<polyline points=${points.join(" ")} fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />
	</svg>`;
}

export function ExerciseView({ id }) {
	const [x, { error }] = useData(() => exercises.get(id), [id]);
	const [info] = useData(meta, []);
	const [sessions = []] = useData(() => exercises.history(id), [id]);
	const [gif, setGif] = useState(null);
	const [gifState, setGifState] = useState("");

	if (error) return html`<div class="empty"><h3>Exercise not found</h3></div>`;
	if (!x) return html`<${Spinner} />`;
	const showGif = gif || (x.gifCached ? exercises.gifUrl(id) : null);

	const loadGif = async () => {
		setGifState("loading");
		const response = await fetch(exercises.gifUrl(id));
		if (response.ok) {
			setGif(URL.createObjectURL(await response.blob()));
			setGifState("");
		} else {
			const body = await response.json().catch(() => ({}));
			setGifState(body.error || "No GIF found");
		}
	};

	const addToToday = async () => {
		const day = today();
		const existing = (await listForDay(day)).find((w) => !w.done);
		const entry = entryFor(x);
		const w = existing
			? await db.put("workouts", { ...existing, exercises: [...existing.exercises, entry] })
			: await newWorkout(day, { title: "Workout", exercises: [entry] });
		changed();
		location.hash = `#/workout/${w.id}`;
	};

	const best = sessions.map((s) => Math.max(...s.sets.map((set) => e1rm(set.weight, set.reps)))).filter(Boolean);

	return html`<article class="exercise-page">
		<div class="page-head">
			<button class="icon-btn" onClick=${() => window.history.back()} aria-label="Back"><${Icon} name="back" /></button>
			<h1 class="grow">${x.name}</h1>
		</div>
		<${ExerciseMedia} images=${x.images} gif=${showGif} alt=${x.name} />
		${
			info?.gifs && !showGif
				? html`<button class="btn small ghost" disabled=${gifState === "loading"} onClick=${loadGif}>
					${gifState === "loading" ? "Loading GIF…" : "Show animated GIF"}
				</button>
				${gifState && gifState !== "loading" ? html`<span class="muted small"> ${gifState}</span>` : null}`
				: null
		}

		<div class="tags">
			${x.primaryMuscles.map((m) => html`<span class="tag primary">${title(m)}</span>`)}
			${x.secondaryMuscles.map((m) => html`<span class="tag">${title(m)}</span>`)}
		</div>
		<dl class="facts">
			${x.equipment ? html`<div><dt>Equipment</dt><dd>${title(x.equipment)}</dd></div>` : null}
			<div><dt>Level</dt><dd>${title(x.level)}</dd></div>
			${x.mechanic ? html`<div><dt>Type</dt><dd>${title(x.mechanic)}</dd></div>` : null}
			${x.force ? html`<div><dt>Force</dt><dd>${title(x.force)}</dd></div>` : null}
		</dl>

		<button class="btn primary wide" onClick=${addToToday}><${Icon} name="plus" /> Add to today</button>

		${
			x.instructions?.length
				? html`<section><h2>How to</h2><ol class="steps">${x.instructions.map((s) => html`<li>${s}</li>`)}</ol></section>`
				: null
		}

		<section>
			<h2>Your history</h2>
			${
				sessions.length
					? html`${best.length > 1 ? html`<div class="card chart"><div class="muted small">Estimated 1RM</div><${Sparkline} values=${[...best].reverse()} /></div>` : null}
					<ul class="history">
						${sessions
							.slice(0, 12)
							.map(
								(s) =>
									html`<li><span>${relative(s.date)}</span><span class="muted">${s.sets.map((set) => `${set.weight ?? "–"}×${set.reps ?? "–"}`).join("  ")}</span></li>`,
							)}
					</ul>`
					: html`<p class="muted">No logged sets yet.</p>`
			}
		</section>
	</article>`;
}
