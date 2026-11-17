// The home screen: a month calendar with each day's workouts marked, and the selected day's workouts below it.
import { DayWorkouts } from "../components/day-workouts.js";
import { Icon } from "../components/ui.js";
import { useData } from "../lib/api.js";
import { addMonths, fmt, monthGrid, parse, relative, sameMonth, today, WEEKDAYS } from "../lib/dates.js";
import { html } from "../lib/preact.js";
import { listForRange } from "../lib/workouts.js";

export function CalendarView({ date }) {
	const selected = date || today();
	const grid = monthGrid(selected);
	const [workouts = []] = useData(() => listForRange(grid[0], grid[41]), [grid[0]]);
	const byDay = {};
	for (const w of workouts) (byDay[w.date] ||= []).push(w);
	const go = (d) => {
		location.hash = `#/day/${d}`;
	};
	const month = parse(selected);

	return html`<div class="calendar-page">
		<section class="card calendar">
			<div class="cal-head">
				<button class="icon-btn" onClick=${() => go(addMonths(selected, -1))} aria-label="Previous month"><${Icon} name="back" /></button>
				<button class="cal-title" onClick=${() => go(today())}>
					${month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
				</button>
				<button class="icon-btn" onClick=${() => go(addMonths(selected, 1))} aria-label="Next month"><${Icon} name="next" /></button>
			</div>
			<div class="cal-grid">
				${WEEKDAYS.map((d) => html`<div class="cal-dow">${d[0]}</div>`)}
				${grid.map((d) => {
					const list = byDay[d] ?? [];
					const cls = [
						"cal-day",
						sameMonth(d, selected) ? "" : "out",
						d === today() ? "today" : "",
						d === selected ? "selected" : "",
						list.length && list.every((w) => w.done) ? "complete" : "",
					].join(" ");
					return html`<button class=${cls} onClick=${() => go(d)} aria-label=${fmt(d, { dateStyle: "full" })}>
						<span class="num">${parse(d).getDate()}</span>
						<span class="dots">
							${list.slice(0, 3).map((w) => html`<i class=${w.done ? "done" : ""} style=${w.color ? `--dot:${w.color}` : ""}></i>`)}
						</span>
					</button>`;
				})}
			</div>
		</section>
		<section class="day-panel">
			<h2 class="day-title">${relative(selected)}<span class="muted">${selected === today() ? fmt(selected, { weekday: "long", month: "short", day: "numeric" }) : ""}</span></h2>
			<${DayWorkouts} date=${selected} />
		</section>
	</div>`;
}
