// The plan as a list: one row per day from last week to four weeks ahead, grouped by week.
import { WorkoutSummary } from "../components/day-workouts.js";
import { useData } from "../lib/api.js";
import { addDays, fmt, parse, today, weekStart } from "../lib/dates.js";
import { html } from "../lib/preact.js";
import { listForRange } from "../lib/workouts.js";

export function AgendaView() {
	const start = weekStart(addDays(today(), -7));
	const end = addDays(start, 7 * 6 - 1);
	const [workouts = []] = useData(() => listForRange(start, end), [start]);
	const byDay = {};
	for (const w of workouts) (byDay[w.date] ||= []).push(w);
	const weeks = Array.from({ length: 6 }, (_, i) => addDays(start, i * 7));

	return html`<div class="agenda-page">
		<h1 class="page-title">Plan</h1>
		${weeks.map((week) => {
			const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
			const planned = days.flatMap((d) => byDay[d] ?? []);
			const done = planned.filter((w) => w.done).length;
			const current = days.includes(today());
			return html`<section class=${`week ${current ? "current" : ""}`}>
				<h2 class="week-title">
					${current ? "This week" : `Week of ${fmt(week, { month: "short", day: "numeric" })}`}
					<span class="muted small">${planned.length ? `${done}/${planned.length} done` : "Nothing planned"}</span>
				</h2>
				${days.map((d) => {
					const list = byDay[d] ?? [];
					if (!list.length && d !== today()) return null;
					return html`<div class=${`agenda-day ${d === today() ? "today" : ""} ${d < today() ? "past" : ""}`}>
						<a class="agenda-date" href=${`#/day/${d}`}>
							<span class="dow">${fmt(d, { weekday: "short" })}</span>
							<span class="dnum">${parse(d).getDate()}</span>
						</a>
						<div class="agenda-items">
							${list.length ? list.map((w) => html`<${WorkoutSummary} key=${w.id} workout=${w} />`) : html`<p class="muted small rest-line">Rest day</p>`}
						</div>
					</div>`;
				})}
			</section>`;
		})}
	</div>`;
}
