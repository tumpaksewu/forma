// One workout, for planning and for logging at the gym: exercises, sets of weight × reps, ticking sets off.
import { ExerciseSearch } from "../components/exercise-search.js";
import { ExerciseMedia, Icon, Sheet, Spinner } from "../components/ui.js";
import { changed, db, exercises as exerciseApi, loadPrefs, useData } from "../lib/api.js";
import { relative } from "../lib/dates.js";
import { html, useEffect, useState } from "../lib/preact.js";
import { copyTo, entryFor, progress, volume } from "../lib/workouts.js";

export function WorkoutView({ id }) {
	const [loaded, { error }] = useData(() => db.get("workouts", id), [id]);
	const [prefs] = useData(loadPrefs, []);
	const [w, setW] = useState(null);
	const [picking, setPicking] = useState(false);
	const [menu, setMenu] = useState(false);
	useEffect(() => {
		if (loaded) setW(loaded);
	}, [loaded]);

	if (error) return html`<div class="empty"><h3>Workout not found</h3><p><a href="#/">Back to calendar</a></p></div>`;
	if (!w) return html`<${Spinner} />`;
	const units = prefs?.units ?? "kg";

	const save = (next) => {
		setW(next);
		return db.put("workouts", next).catch((e) => alert(`Could not save: ${e.message}`));
	};
	const setExercise = (i, entry) => save({ ...w, exercises: w.exercises.map((e, j) => (j === i ? entry : e)) });
	const move = (i, by) => {
		const list = [...w.exercises];
		const [item] = list.splice(i, 1);
		list.splice(Math.max(0, Math.min(list.length, i + by)), 0, item);
		save({ ...w, exercises: list });
	};
	const { done, total } = progress(w);

	return html`<div class="workout-page">
		<div class="page-head">
			<a class="icon-btn" href=${`#/day/${w.date}`} aria-label="Back"><${Icon} name="back" /></a>
			<div class="grow">
				<input class="title-input" value=${w.title} aria-label="Workout name" onChange=${(e) => save({ ...w, title: e.currentTarget.value })} />
				<div class="muted small">${relative(w.date)}${total ? ` · ${done}/${total} sets` : ""}${volume(w) ? ` · ${Math.round(volume(w)).toLocaleString()} ${units} volume` : ""}</div>
			</div>
			<button class="icon-btn" onClick=${() => setMenu(true)} aria-label="Workout options"><${Icon} name="more" /></button>
		</div>

		${w.exercises.map(
			(entry, i) => html`<${ExerciseEntry}
				key=${entry.uid}
				entry=${entry}
				units=${units}
				date=${w.date}
				first=${i === 0}
				last=${i === w.exercises.length - 1}
				onChange=${(next) => setExercise(i, next)}
				onMove=${(by) => move(i, by)}
				onRemove=${() => confirm(`Remove ${entry.name}?`) && save({ ...w, exercises: w.exercises.filter((_, j) => j !== i) })}
			/>`,
		)}

		<button class="btn wide" onClick=${() => setPicking(true)}><${Icon} name="plus" /> Add exercise</button>
		<textarea class="notes" placeholder="Notes" value=${w.notes} onChange=${(e) => save({ ...w, notes: e.currentTarget.value })}></textarea>
		${
			w.exercises.length
				? html`<button class=${`btn wide ${w.done ? "" : "primary"}`} onClick=${() => {
						save({ ...w, done: !w.done }).then(changed);
					}}>
					${w.done ? "Mark as not done" : html`<${Icon} name="check" /> Finish workout`}
				</button>`
				: null
		}

		${
			picking
				? html`<${Sheet} title="Add exercise" tall onClose=${() => setPicking(false)}>
					<${ExerciseSearch}
						autofocus
						picked=${w.exercises.map((e) => e.exerciseId)}
						onPick=${(x) => save({ ...w, exercises: [...w.exercises, entryFor(x)] })}
					/>
				</${Sheet}>`
				: null
		}
		${menu ? html`<${WorkoutMenu} workout=${w} onClose=${() => setMenu(false)} onSave=${save} />` : null}
	</div>`;
}

function ExerciseEntry({ entry, units, date, first, last, onChange, onMove, onRemove }) {
	const [open, setOpen] = useState(false);
	const [history] = useData(() => exerciseApi.history(entry.exerciseId), [entry.exerciseId]);
	const previous = history?.find((s) => s.date < date);
	const setSet = (i, fields) =>
		onChange({ ...entry, sets: entry.sets.map((s, j) => (j === i ? { ...s, ...fields } : s)) });
	const num = (v) => (v === "" ? null : Number(v));

	return html`<section class="card entry">
		<div class="entry-head">
			<a href=${`#/exercise/${encodeURIComponent(entry.exerciseId)}`} class="entry-link">
				<${ExerciseMedia} images=${entry.image ? [entry.image] : []} size="thumb" alt="" />
				<span>
					<strong>${entry.name}</strong>
					${
						previous
							? html`<span class="muted small">Last: ${previous.sets.map((s) => `${s.weight ?? "–"}×${s.reps ?? "–"}`).join(", ")}</span>`
							: null
					}
				</span>
			</a>
			<button class="icon-btn" onClick=${() => setOpen(!open)} aria-label="Exercise options"><${Icon} name="more" /></button>
		</div>
		${
			open
				? html`<div class="entry-tools">
					<button class="btn small" disabled=${first} onClick=${() => onMove(-1)}><${Icon} name="up" size="16" /> Up</button>
					<button class="btn small" disabled=${last} onClick=${() => onMove(1)}><${Icon} name="down" size="16" /> Down</button>
					<label class="rest">Rest <input type="number" inputmode="numeric" value=${entry.restSec} onChange=${(e) => onChange({ ...entry, restSec: num(e.currentTarget.value) })} /> s</label>
					<button class="btn small danger" onClick=${onRemove}><${Icon} name="trash" size="16" /> Remove</button>
				</div>`
				: null
		}
		<table class="sets">
			<thead><tr><th>Set</th><th>${units}</th><th>Reps</th><th></th></tr></thead>
			<tbody>
				${entry.sets.map(
					(s, i) => html`<tr class=${s.done ? "done" : ""}>
						<td class="set-n">${i + 1}</td>
						<td><input type="number" inputmode="decimal" step="any" placeholder="–" value=${s.weight ?? ""} onChange=${(e) => setSet(i, { weight: num(e.currentTarget.value) })} /></td>
						<td><input type="number" inputmode="numeric" placeholder="–" value=${s.reps ?? ""} onChange=${(e) => setSet(i, { reps: num(e.currentTarget.value) })} /></td>
						<td><button class=${`tick ${s.done ? "on" : ""}`} aria-label=${s.done ? "Mark set not done" : "Mark set done"} onClick=${() => setSet(i, { done: !s.done })}><${Icon} name="check" size="18" /></button></td>
					</tr>`,
				)}
			</tbody>
		</table>
		<div class="row gap">
			<button class="btn small ghost" onClick=${() => onChange({ ...entry, sets: [...entry.sets, { ...(entry.sets.at(-1) ?? { reps: 10, weight: null }), done: false }] })}><${Icon} name="plus" size="16" /> Set</button>
			${
				entry.sets.length > 1
					? html`<button class="btn small ghost" onClick=${() => onChange({ ...entry, sets: entry.sets.slice(0, -1) })}>Remove last set</button>`
					: null
			}
		</div>
	</section>`;
}

function WorkoutMenu({ workout, onClose, onSave }) {
	const [date, setDate] = useState(workout.date);
	const [copyDate, setCopyDate] = useState(workout.date);
	return html`<${Sheet} title="Workout" onClose=${onClose}>
		<div class="form">
			<label>Date
				<div class="row gap"><input type="date" value=${date} onInput=${(e) => setDate(e.currentTarget.value)} />
				<button class="btn" disabled=${!date || date === workout.date} onClick=${() => {
					onSave({ ...workout, date }).then(changed);
					onClose();
				}}>Move</button></div>
			</label>
			<label>Copy to another day
				<div class="row gap"><input type="date" value=${copyDate} onInput=${(e) => setCopyDate(e.currentTarget.value)} />
				<button class="btn" disabled=${!copyDate} onClick=${async () => {
					const created = await copyTo(workout, copyDate);
					changed();
					onClose();
					location.hash = `#/workout/${created.id}`;
				}}>Copy</button></div>
			</label>
			<label>Color
				<input type="color" value=${workout.color || "#6d4aff"} onChange=${(e) => onSave({ ...workout, color: e.currentTarget.value })} />
			</label>
			<button class="btn wide" onClick=${async () => {
				await db.create("templates", {
					title: workout.title,
					color: workout.color,
					exercises: workout.exercises.map((e) => ({ ...e, sets: e.sets.map((s) => ({ ...s, done: false })) })),
				});
				onClose();
				alert("Saved as a template. Use “Reuse” on any day to add it.");
			}}><${Icon} name="copy" /> Save as template</button>
			<button class="btn wide danger" onClick=${async () => {
				if (!confirm("Delete this workout?")) return;
				await db.remove("workouts", workout.id);
				changed();
				location.hash = `#/day/${workout.date}`;
			}}><${Icon} name="trash" /> Delete workout</button>
		</div>
	</${Sheet}>`;
}
