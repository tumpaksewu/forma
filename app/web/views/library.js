// Browse the exercise library.
import { ExerciseSearch } from "../components/exercise-search.js";
import { html } from "../lib/preact.js";
import { navigate } from "../lib/router.js";

// The search and filters, kept for the session: back from an exercise returns to the same list (and scroll).
const search = { q: "", muscle: "", equipment: "" };

export function LibraryView() {
	return html`<div class="library-page">
		<h1 class="page-title">Exercises</h1>
		<${ExerciseSearch} memory=${search} onPick=${(x) => {
			navigate(`#/exercise/${encodeURIComponent(x.id)}`);
		}} />
	</div>`;
}
