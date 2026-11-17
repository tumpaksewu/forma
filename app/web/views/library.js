// Browse the exercise library.
import { ExerciseSearch } from "../components/exercise-search.js";
import { html } from "../lib/preact.js";

export function LibraryView() {
	return html`<div class="library-page">
		<h1 class="page-title">Exercises</h1>
		<${ExerciseSearch} onPick=${(x) => {
			location.hash = `#/exercise/${encodeURIComponent(x.id)}`;
		}} />
	</div>`;
}
