// Small shared UI pieces: icons, the bottom sheet, the exercise photo animation, empty states.
import { html, useEffect, useRef, useState } from "../lib/preact.js";

const PATHS = {
	calendar: "M7 2v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2zM5 9h14v11H5z",
	list: "M4 6h2v2H4zm4 0h12v2H8zM4 11h2v2H4zm4 0h12v2H8zm-4 5h2v2H4zm4 0h12v2H8z",
	library: "M6 4h2v16H6zm4 0h2v16h-2zm4.2.6 1.9-.6 4.6 15.3-1.9.6z",
	plus: "M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z",
	check: "M9.5 16.2 5.3 12l-1.4 1.4 5.6 5.6L20.1 8.4 18.7 7z",
	back: "M15.4 5.4 14 4l-8 8 8 8 1.4-1.4L8.8 12z",
	next: "M8.6 18.6 10 20l8-8-8-8-1.4 1.4 6.6 6.6z",
	more: "M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4m0 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4m0 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4",
	trash: "M9 3h6l1 2h4v2H4V5h4zM6 9h12l-1 12H7z",
	up: "M12 6 5 13l1.4 1.4L11 9.8V20h2V9.8l4.6 4.6L19 13z",
	down: "M12 18l7-7-1.4-1.4-4.6 4.6V4h-2v10.2L6.4 9.6 5 11z",
	search: "M10 3a7 7 0 0 1 5.6 11.2l5.1 5.1-1.4 1.4-5.1-5.1A7 7 0 1 1 10 3m0 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10",
	copy: "M8 3h11v13h-2V5H8zM4 7h11v14H4z",
	play: "M8 5v14l11-7z",
	pause: "M7 5h4v14H7zm6 0h4v14h-4z",
	dumbbell: "M2 10h2V7h3v10H4v-3H2zm20 0h-2V7h-3v10h3v-3h2zM8 11h8v2H8z",
	body: "M12 2a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5M7 8h10l-1 1.5-2 .5v4l1.5 8h-2.2L12 15.5 10.7 22H8.5l1.5-8v-4l-2-.5z",
	close: "M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4 17.6 5 12 10.6z",
};

export const Icon = ({ name, size = 20 }) =>
	html`<svg class="icon" viewBox="0 0 24 24" width=${size} height=${size} aria-hidden="true"><path fill="currentColor" d=${PATHS[name]} /></svg>`;

/** A modal that slides up from the bottom on phones and sits centered on wide screens. */
export function Sheet({ title, onClose, children, tall = false }) {
	useEffect(() => {
		const onKey = (e) => e.key === "Escape" && onClose();
		document.addEventListener("keydown", onKey);
		document.body.classList.add("sheet-open");
		return () => {
			document.removeEventListener("keydown", onKey);
			document.body.classList.remove("sheet-open");
		};
	}, []);
	return html`<div class="sheet-backdrop" onClick=${(e) => e.target === e.currentTarget && onClose()}>
		<div class=${`sheet ${tall ? "tall" : ""}`} role="dialog" aria-label=${title}>
			<div class="sheet-head">
				<h2>${title}</h2>
				<button class="icon-btn" onClick=${onClose} aria-label="Close"><${Icon} name="close" /></button>
			</div>
			<div class="sheet-body">${children}</div>
		</div>
	</div>`;
}

/**
 * An exercise's photos played as a loop (the library has a start and an end position), or a GIF when given one.
 * Tap to pause.
 */
export function ExerciseMedia({ images = [], gif, alt = "", size = "large" }) {
	const [frame, setFrame] = useState(0);
	const [playing, setPlaying] = useState(true);
	const timer = useRef();
	useEffect(() => {
		if (gif || images.length < 2 || !playing) return;
		timer.current = setInterval(() => setFrame((f) => (f + 1) % images.length), 900);
		return () => clearInterval(timer.current);
	}, [images.join(), gif, playing]);
	if (gif) return html`<div class=${`media ${size}`}><img src=${gif} alt=${alt} /></div>`;
	if (!images.length)
		return html`<div class=${`media ${size} none`}><${Icon} name="dumbbell" size=${size === "large" ? 48 : 22} /></div>`;
	return html`<div class=${`media ${size}`} onClick=${() => size === "large" && setPlaying((p) => !p)}>
		${images.map(
			(src, i) => html`<img src=${src} alt=${i === 0 ? alt : ""} loading="lazy" class=${i === frame ? "on" : ""} />`,
		)}
		${
			size === "large" && images.length > 1
				? html`<span class="media-badge"><${Icon} name=${playing ? "pause" : "play"} size="14" /></span>`
				: null
		}
	</div>`;
}

export const Empty = ({ title, children }) =>
	html`<div class="empty"><h3>${title}</h3>${children ? html`<p>${children}</p>` : null}</div>`;

export const Spinner = () => html`<div class="spinner" aria-label="Loading"></div>`;

export const Chip = ({ children, active, onClick }) =>
	html`<button class=${`chip ${active ? "active" : ""}`} onClick=${onClick}>${children}</button>`;

/** Capitalizes the first letter of each word, for muscle and equipment names. */
export const title = (s) => (s ? s.replace(/\b\w/g, (c) => c.toUpperCase()) : "");
