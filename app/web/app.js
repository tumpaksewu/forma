// forma's browser app: a hash router, the shell (content + bottom navigation), and the screens.
//
// Routes:
//   #/                 calendar, today selected
//   #/day/YYYY-MM-DD   calendar, that day selected
//   #/plan             the plan as a list of weeks
//   #/workout/:id      one workout (plan and log it)
//   #/body             body measurements: scans, weigh-ins, trends
//   #/library          the exercise library
//   #/exercise/:id     one exercise
//
// Change routes with navigate()/back() from lib/router.js or plain <a href="#/…"> links (the router opens them in
// place). Never set location.hash: on Safari over http that reloads the whole page (see lib/router.js).
import { Icon } from "./components/ui.js";
import { html, render, useEffect, useLayoutEffect, useState } from "./lib/preact.js";
import { start, subscribe } from "./lib/router.js";
import { AgendaView } from "./views/agenda.js";
import { BodyView } from "./views/body.js";
import { CalendarView } from "./views/calendar.js";
import { ExerciseView } from "./views/exercise.js";
import { LibraryView } from "./views/library.js";
import { WorkoutView } from "./views/workout.js";

function parseRoute(hash) {
	const parts = hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
	switch (parts[0]) {
		case "day":
			return { name: "calendar", date: parts[1] };
		case "plan":
			return { name: "plan" };
		case "workout":
			return { name: "workout", id: parts[1] };
		case "library":
			return { name: "library" };
		case "body":
			return { name: "body" };
		case "exercise":
			return { name: "exercise", id: parts.slice(1).join("/") };
		default:
			return { name: "calendar" };
	}
}

const TITLES = {
	calendar: "Calendar",
	plan: "Plan",
	workout: "Workout",
	library: "Exercises",
	exercise: "Exercise",
	body: "Body",
};

const NAV = [
	{ name: "calendar", href: "#/", icon: "calendar", label: "Calendar" },
	{ name: "plan", href: "#/plan", icon: "list", label: "Plan" },
	{ name: "body", href: "#/body", icon: "body", label: "Body" },
	{ name: "library", href: "#/library", icon: "library", label: "Exercises" },
];

function App() {
	const [route, setRoute] = useState(() => ({ ...parseRoute(location.hash), scroll: null }));
	useEffect(
		() =>
			subscribe(({ hash, restore, scroll }) => {
				// A new screen starts at the top; back/forward returns to where that screen was left.
				if (!restore) window.scrollTo(0, 0);
				setRoute({ ...parseRoute(hash), scroll: restore ? scroll : null });
			}),
		[],
	);
	// After the restored screen rendered (from cached data), before it is painted.
	useLayoutEffect(() => {
		if (route.scroll !== null) window.scrollTo(0, route.scroll);
	}, [route]);
	useEffect(() => {
		document.title = `${TITLES[route.name]} · forma`;
	}, [route.name]);

	let screen;
	if (route.name === "workout") screen = html`<${WorkoutView} id=${route.id} />`;
	else if (route.name === "exercise") screen = html`<${ExerciseView} id=${route.id} />`;
	else if (route.name === "library") screen = html`<${LibraryView} />`;
	else if (route.name === "body") screen = html`<${BodyView} />`;
	else if (route.name === "plan") screen = html`<${AgendaView} />`;
	else screen = html`<${CalendarView} date=${route.date} />`;

	const section = route.name === "workout" || route.name === "exercise" ? null : route.name;
	return html`<div class="shell">
		<main class="content">${screen}</main>
		<nav class="tabbar">
			${NAV.map(
				(item) => html`<a href=${item.href} class=${`tab ${section === item.name ? "active" : ""}`}>
					<${Icon} name=${item.icon} size="22" /><span>${item.label}</span>
				</a>`,
			)}
		</nav>
	</div>`;
}

start();
render(html`<${App} />`, document.getElementById("app"));
