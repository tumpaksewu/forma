// One day's workouts as cards, with ways to add one: blank, from a template, or copied from another day.
import { changed, db, useData } from "../lib/api.js";
import { relative } from "../lib/dates.js";
import { html, useState } from "../lib/preact.js";
import { navigate } from "../lib/router.js";
import { copyTo, listForDay, newWorkout, progress } from "../lib/workouts.js";
import { ExerciseMedia, Icon, Sheet } from "./ui.js";

export function WorkoutSummary({ workout, showDate = false }) {
	const { done, total } = progress(workout);
	const pct = total ? Math.round((done / total) * 100) : 0;
	return html`<a class=${`card workout-summary ${workout.done ? "is-done" : ""}`} href=${`#/workout/${workout.id}`} style=${workout.color ? `--wcolor:${workout.color}` : ""}>
		<div class="ws-head">
			<div>
				${showDate ? html`<div class="muted small">${relative(workout.date)}</div>` : null}
				<h3>${workout.title || "Workout"}</h3>
			</div>
			${
				workout.done
					? html`<span class="pill ok"><${Icon} name="check" size="14" /> Done</span>`
					: total
						? html`<span class="pill">${done}/${total} sets</span>`
						: null
			}
		</div>
		${
			workout.exercises.length
				? html`<ul class="ws-list">
					${workout.exercises.slice(0, 6).map(
						(e) => html`<li>
							<${ExerciseMedia} images=${e.image ? [e.image] : []} size="mini" />
							<span>${e.name}</span>
							<span class="muted small">${e.sets.length} × ${e.sets[0]?.reps ?? "–"}</span>
						</li>`,
					)}
					${workout.exercises.length > 6 ? html`<li class="muted small">+ ${workout.exercises.length - 6} more</li>` : null}
				</ul>`
				: html`<p class="muted small">No exercises yet. Tap to add some.</p>`
		}
		${total && !workout.done ? html`<div class="bar"><i style=${`width:${pct}%`}></i></div>` : null}
	</a>`;
}

export function DayWorkouts({ date }) {
	const [workouts, { loading }] = useData(() => listForDay(date), [date]);
	const [choosing, setChoosing] = useState(false);

	const create = async (fields) => {
		const w = await newWorkout(date, fields);
		changed();
		navigate(`#/workout/${w.id}`);
	};

	return html`<div class="day-workouts">
		${workouts?.map((w) => html`<${WorkoutSummary} key=${w.id} workout=${w} />`)}
		${workouts && !workouts.length && !loading ? html`<div class="rest-day"><p>Nothing planned.</p></div>` : null}
		<div class="row gap">
			<button class="btn primary grow" onClick=${() => create({})}><${Icon} name="plus" /> New workout</button>
			<button class="btn" onClick=${() => setChoosing(true)}><${Icon} name="copy" /> Reuse</button>
		</div>
		${choosing ? html`<${ReuseSheet} date=${date} onClose=${() => setChoosing(false)} onCreate=${create} />` : null}
	</div>`;
}

function ReuseSheet({ date, onClose, onCreate }) {
	const [templates = []] = useData(() => db.list("templates"), []);
	const [recent = []] = useData(
		() =>
			db.list("workouts").then((list) =>
				list
					.filter((w) => w.date !== date)
					.sort((a, b) => b.date.localeCompare(a.date))
					.slice(0, 12),
			),
		[date],
	);
	const copy = async (w) => {
		const created = await copyTo(w, date);
		changed();
		onClose();
		navigate(`#/workout/${created.id}`);
	};
	return html`<${Sheet} title=${`Add to ${relative(date)}`} onClose=${onClose}>
		<h4 class="section-label">Templates</h4>
		${
			templates.length
				? html`<ul class="pick-list">
					${templates.map(
						(t) =>
							html`<li><button onClick=${() => {
								onClose();
								onCreate({ title: t.title, exercises: t.exercises, color: t.color });
							}}><strong>${t.title}</strong><span class="muted small">${t.exercises.map((e) => e.name).join(", ")}</span></button></li>`,
					)}
				</ul>`
				: html`<p class="muted small">Save a workout as a template from its menu, or ask the agent to build a program.</p>`
		}
		<h4 class="section-label">Copy a recent workout</h4>
		${
			recent.length
				? html`<ul class="pick-list">
					${recent.map(
						(w) =>
							html`<li><button onClick=${() => copy(w)}><strong>${w.title}</strong><span class="muted small">${relative(w.date)} · ${w.exercises.length} exercises</span></button></li>`,
					)}
				</ul>`
				: html`<p class="muted small">No other workouts yet.</p>`
		}
	</${Sheet}>`;
}
