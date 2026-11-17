// Dates are local calendar days written as "YYYY-MM-DD" strings everywhere in the app and its data.

const pad = (n) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" of a Date, in local time. */
export const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Local Date of a "YYYY-MM-DD" string, at midnight. */
export const parse = (s) => {
	const [y, m, d] = s.split("-").map(Number);
	return new Date(y, m - 1, d);
};

export const today = () => iso(new Date());

export const addDays = (s, n) => {
	const d = parse(s);
	d.setDate(d.getDate() + n);
	return iso(d);
};

export const addMonths = (s, n) => {
	const d = parse(s);
	return iso(new Date(d.getFullYear(), d.getMonth() + n, 1));
};

/** Monday of the week containing the day. */
export const weekStart = (s) => {
	const d = parse(s);
	const offset = (d.getDay() + 6) % 7;
	d.setDate(d.getDate() - offset);
	return iso(d);
};

/** The 6×7 grid of days shown for the month containing the day, starting on a Monday. */
export function monthGrid(s) {
	const d = parse(s);
	const first = iso(new Date(d.getFullYear(), d.getMonth(), 1));
	const start = weekStart(first);
	return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export const sameMonth = (a, b) => a.slice(0, 7) === b.slice(0, 7);

export const fmt = (s, opts) => parse(s).toLocaleDateString(undefined, opts);

/** "Today", "Tomorrow", "Yesterday", or a weekday and date. */
export function relative(s) {
	const t = today();
	if (s === t) return "Today";
	if (s === addDays(t, 1)) return "Tomorrow";
	if (s === addDays(t, -1)) return "Yesterday";
	return fmt(s, { weekday: "long", month: "short", day: "numeric" });
}

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
