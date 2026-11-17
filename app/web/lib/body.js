// Body measurements: scans (Visbody and others) and weigh-ins, one document each in the `measurements` collection.
// Values are stored in metric units (kg, cm); the screen converts to the owner's units for display.
//
// {
//   id, date: "YYYY-MM-DD", time?: "HH:MM", source: "visbody" | "manual" | …, file?: saved upload path, notes?,
//   metrics: { weight_kg, body_fat_pct, skeletal_muscle_kg, … any snake_case key ending in its unit },
//   segments?: { lean_kg: { left_arm, right_arm, trunk, left_leg, right_leg }, fat_kg: { … } },
//   circumferences_cm?: { neck, chest, waist, hip, left_arm, right_arm, left_thigh, right_thigh, left_calf, right_calf },
//   posture?: [{ name, value, unit, finding }]
// }

/** Known metrics, in display order. Unknown keys still show, labelled from the key and united by its suffix. */
export const METRICS = {
	weight_kg: { label: "Weight" },
	body_fat_pct: { label: "Body fat" },
	skeletal_muscle_kg: { label: "Skeletal muscle" },
	fat_mass_kg: { label: "Fat mass" },
	muscle_mass_kg: { label: "Muscle mass" },
	lean_mass_kg: { label: "Lean mass" },
	visceral_fat: { label: "Visceral fat" },
	bmr_kcal: { label: "BMR" },
	bmi: { label: "BMI" },
	whr: { label: "Waist–hip ratio" },
	body_water_kg: { label: "Body water" },
	protein_kg: { label: "Protein" },
	minerals_kg: { label: "Minerals" },
	body_score: { label: "Body score" },
	posture_score: { label: "Posture score" },
	body_age: { label: "Body age" },
};

/** The headline metrics shown as tiles, when present. */
export const HEADLINE = ["weight_kg", "body_fat_pct", "skeletal_muscle_kg", "visceral_fat", "bmr_kcal", "body_score"];

export const SEGMENTS = ["left_arm", "right_arm", "trunk", "left_leg", "right_leg"];

const KG_PER_LB = 0.45359237;
const CM_PER_IN = 2.54;

/** How a key's value is measured, from its suffix. */
export function kindOf(key) {
	if (key.endsWith("_kg")) return "mass";
	if (key.endsWith("_cm")) return "length";
	if (key.endsWith("_pct")) return "pct";
	if (key.endsWith("_kcal")) return "kcal";
	if (key.endsWith("_deg")) return "deg";
	return "plain";
}

export function labelOf(key) {
	if (METRICS[key]) return METRICS[key].label;
	const words = key.replace(/_(kg|cm|pct|kcal|deg)$/, "").replaceAll("_", " ");
	return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * A stored value in the owner's units.
 *
 * Returns:
 *   { value, unit } with value rounded for display, or null when there is no value.
 */
export function display(kind, value, units = "kg") {
	if (value === null || value === undefined || Number.isNaN(Number(value))) return null;
	const v = Number(value);
	const imperial = units === "lb";
	switch (kind) {
		case "mass":
			return imperial ? { value: round(v / KG_PER_LB, 1), unit: "lb" } : { value: round(v, 1), unit: "kg" };
		case "length":
			return imperial ? { value: round(v / CM_PER_IN, 1), unit: "in" } : { value: round(v, 1), unit: "cm" };
		case "pct":
			return { value: round(v, 1), unit: "%" };
		case "kcal":
			return { value: Math.round(v), unit: "kcal" };
		case "deg":
			return { value: round(v, 1), unit: "°" };
		default:
			return { value: round(v, 2), unit: "" };
	}
}

/** A value in the owner's units back to the stored metric unit. */
export function toMetric(kind, value, units = "kg") {
	if (units !== "lb") return value;
	if (kind === "mass") return value * KG_PER_LB;
	if (kind === "length") return value * CM_PER_IN;
	return value;
}

const round = (v, digits) => Math.round(v * 10 ** digits) / 10 ** digits;

/** "82.4 kg" */
export function fmtValue(kind, value, units) {
	const d = display(kind, value, units);
	if (!d) return "–";
	return `${d.value.toLocaleString()}${d.unit && d.unit !== "%" && d.unit !== "°" ? " " : ""}${d.unit}`;
}

/** Every metric key present in any measurement, known ones first. */
export function metricKeys(list) {
	const seen = new Set();
	for (const m of list) for (const k of Object.keys(m.metrics ?? {})) seen.add(k);
	const known = Object.keys(METRICS).filter((k) => seen.has(k));
	return [...known, ...[...seen].filter((k) => !METRICS[k]).sort()];
}

/** The series of one metric, oldest first. */
export const series = (list, key) =>
	list
		.filter((m) => typeof m.metrics?.[key] === "number")
		.map((m) => ({ date: m.date, value: m.metrics[key], source: m.source }))
		.sort((a, b) => a.date.localeCompare(b.date));

export const sortMeasurements = (list) =>
	[...list].sort((a, b) => b.date.localeCompare(a.date) || (b.time ?? "").localeCompare(a.time ?? ""));
