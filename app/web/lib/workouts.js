// The workout data model and the operations on it. A workout is one document in the `workouts` collection:
//
// {
//   id, date: "YYYY-MM-DD", title, notes, done: boolean, order: number,
//   exercises: [{ uid, exerciseId, name, image, notes, restSec, sets: [{ reps, weight, done }] }]
// }
//
// `name` and `image` are copied from the library when an exercise is added, so a workout renders without lookups.
import { db } from "./api.js";

export const uid = () => Math.random().toString(36).slice(2, 10);

export const listForRange = (from, to) => db.list("workouts", { date_gte: from, date_lte: to }).then(sortWorkouts);

export const listForDay = (date) => db.list("workouts", { date }).then(sortWorkouts);

export const sortWorkouts = (list) =>
	[...list].sort((a, b) => a.date.localeCompare(b.date) || (a.order ?? 0) - (b.order ?? 0));

export function newWorkout(date, fields = {}) {
	return db.create("workouts", {
		date,
		title: "Workout",
		notes: "",
		done: false,
		order: Date.now(),
		exercises: [],
		...fields,
	});
}

/** A workout entry for a library exercise, with three empty sets. */
export function entryFor(exercise, sets = 3) {
	return {
		uid: uid(),
		exerciseId: exercise.id,
		name: exercise.name,
		image: exercise.images?.[0] ?? null,
		notes: "",
		restSec: 90,
		sets: Array.from({ length: sets }, () => ({ reps: 10, weight: null, done: false })),
	};
}

/** Copies a workout's plan (not its logged results) to another day. */
export function copyTo(workout, date) {
	const { id, ...rest } = workout;
	return db.create("workouts", {
		...rest,
		date,
		done: false,
		order: Date.now(),
		exercises: workout.exercises.map((e) => ({ ...e, uid: uid(), sets: e.sets.map((s) => ({ ...s, done: false })) })),
	});
}

export const progress = (workout) => {
	const sets = workout.exercises.flatMap((e) => e.sets);
	const done = sets.filter((s) => s.done).length;
	return { done, total: sets.length };
};

/** Total weight moved in the done sets. */
export const volume = (workout) =>
	workout.exercises
		.flatMap((e) => e.sets)
		.filter((s) => s.done && s.weight && s.reps)
		.reduce((sum, s) => sum + s.weight * s.reps, 0);

/** Estimated one-rep max (Epley). */
export const e1rm = (weight, reps) => (weight && reps ? Math.round(weight * (1 + reps / 30)) : 0);
