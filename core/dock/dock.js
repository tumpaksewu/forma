// forma dock: the agent panel added to every page of the app. It lives in the core, outside the app's source, so
// no change the agent makes to the app can take it away. Plain JS in a shadow root, so the app's CSS cannot reach it.

import { composerHeight, visibleArea } from "./viewport.js";

const API = "/__forma";
const STORE = "forma-dock";

const state = {
	open: false,
	tab: "chat",
	chat: { busy: false, items: [], partial: "", queued: 0 },
	app: { status: "running", head: "" },
	agentError: "",
	history: null,
	expanded: new Set(),
	statOf: {},
	connected: false,
	pending: [],
	memory: null,
};

// ---------- small helpers ----------

const esc = (s) =>
	String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function inline(s) {
	return s
		.replace(/`([^`]+)`/g, "<code>$1</code>")
		.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
		.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
		.replace(/\[([^\]]+)\]\((https?:[^)\s]+|#[^)\s]*)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

/** A tiny markdown renderer for agent replies: paragraphs, lists, code, emphasis, links. Escapes first. */
function markdown(text) {
	const blocks = esc(text).split(/```/);
	return blocks
		.map((block, i) => {
			if (i % 2 === 1) return `<pre><code>${block.replace(/^[a-z]*\n/, "")}</code></pre>`;
			const out = [];
			let list = null;
			const flush = () => {
				if (list) out.push(`<${list.tag}>${list.items.map((x) => `<li>${inline(x)}</li>`).join("")}</${list.tag}>`);
				list = null;
			};
			for (const raw of block.split("\n")) {
				const line = raw.trimEnd();
				const bullet = line.match(/^\s*[-*•]\s+(.*)/);
				const num = line.match(/^\s*\d+[.)]\s+(.*)/);
				if (bullet || num) {
					const tag = bullet ? "ul" : "ol";
					if (!list || list.tag !== tag) {
						flush();
						list = { tag, items: [] };
					}
					list.items.push((bullet || num)[1]);
					continue;
				}
				flush();
				if (!line.trim()) continue;
				const heading = line.match(/^#{1,6}\s+(.*)/);
				out.push(heading ? `<p><strong>${inline(heading[1])}</strong></p>` : `<p>${inline(line)}</p>`);
			}
			flush();
			return out.join("");
		})
		.join("");
}

function ago(iso) {
	const s = (Date.now() - new Date(iso).getTime()) / 1000;
	if (s < 60) return "just now";
	if (s < 3600) return `${Math.floor(s / 60)} min ago`;
	if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
	return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function save() {
	try {
		const draft = root?.querySelector("textarea")?.value ?? "";
		sessionStorage.setItem(STORE, JSON.stringify({ open: state.open, tab: state.tab, draft }));
	} catch {}
}

function load() {
	try {
		return JSON.parse(sessionStorage.getItem(STORE) || "{}");
	} catch {
		return {};
	}
}

async function post(path, body) {
	const response = await fetch(API + path, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body ?? {}),
	});
	const data = await response.json().catch(() => ({}));
	if (!response.ok) throw new Error(data.error || response.statusText);
	return data;
}

// ---------- error reporting for the agent ----------

const reported = new Set();
function report(where, message) {
	const key = `${where}:${message}`;
	if (reported.has(key) || reported.size > 50) return;
	reported.add(key);
	navigator.sendBeacon?.(
		`${API}/client-error`,
		new Blob([JSON.stringify({ where, message })], { type: "application/json" }),
	) || post("/client-error", { where, message }).catch(() => {});
}
window.addEventListener(
	"error",
	(e) => {
		if (e.target && e.target !== window && (e.target.src || e.target.href)) {
			report(location.hash || "/", `failed to load ${e.target.src || e.target.href}`);
			return;
		}
		report(location.hash || "/", `${e.message} at ${e.filename?.replace(location.origin, "")}:${e.lineno}:${e.colno}`);
	},
	true,
);
window.addEventListener("unhandledrejection", (e) =>
	report(location.hash || "/", `unhandled rejection: ${e.reason?.stack || e.reason}`),
);

// ---------- DOM ----------

const host = document.createElement("forma-dock");
const root = host.attachShadow({ mode: "open" });
root.innerHTML = `<link rel="stylesheet" href="${API}/dock.css">
<button class="fab" aria-label="Open agent" title="Agent (⌘K)">
  <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path fill="currentColor" d="M12 2l1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9zM19 14l.95 2.55L22.5 17.5l-2.55.95L19 21l-.95-2.55L15.5 17.5l2.55-.95z"/></svg>
  <span class="badge" hidden></span>
</button>
<section class="panel" role="dialog" aria-label="forma agent" hidden>
  <header>
    <div class="tabs">
      <button data-tab="chat" class="tab">Agent</button>
      <button data-tab="history" class="tab">History</button>
      <button data-tab="memory" class="tab">Memory</button>
    </div>
    <div class="actions">
      <button class="icon new" title="New conversation" aria-label="New conversation"><svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg></button>
      <button class="icon close" title="Close" aria-label="Close"><svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4 17.6 5 12 10.6z"/></svg></button>
    </div>
  </header>
  <div class="banner" hidden></div>
  <div class="body chat"></div>
  <div class="body history" hidden></div>
  <div class="body memory" hidden></div>
  <div class="pending" hidden></div>
  <form class="composer">
    <button type="button" class="attach" aria-label="Attach files" title="Attach scans, screenshots, PDFs, CSV"><svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M16.5 6.5v10.5a4.5 4.5 0 0 1-9 0V5a3 3 0 0 1 6 0v10.5a1.5 1.5 0 0 1-3 0V6.5H9v9a3 3 0 0 0 6 0V5a4.5 4.5 0 0 0-9 0v12a6 6 0 0 0 12 0V6.5z"/></svg></button>
    <input type="file" class="file" multiple hidden accept="image/*,application/pdf,.pdf,.csv,.tsv,.txt,.json,.md,.heic,.heif">
    <textarea rows="1" placeholder="Ask for a workout, or change anything about this app…" enterkeyhint="send"></textarea>
    <button type="button" class="stop" hidden title="Stop">■</button>
    <button type="submit" class="send" aria-label="Send"><svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M3 20.5V14l9-2-9-2V3.5L22 12z"/></svg></button>
  </form>
</section>`;

const $ = (sel) => root.querySelector(sel);
const fab = $(".fab");
const panel = $(".panel");
const chatEl = $(".body.chat");
const historyEl = $(".body.history");
const memoryEl = $(".body.memory");
const pendingEl = $(".pending");
const fileInput = $(".file");
const textarea = $("textarea");
const banner = $(".banner");

const SUGGESTIONS = [
	"Import my body scans (attach the Visbody PDFs or screenshots)",
	"Plan a 4-day upper/lower split for the next 4 weeks, starting Monday",
	"Add a rest timer that starts when I tick off a set",
	"Show a chart of my estimated 1RM per exercise",
	"Make the theme dark with a lime accent",
];

function toolGroup(tools, key) {
	const open = state.expanded.has(key);
	const running = tools.some((t) => t.state === "running");
	const failed = tools.filter((t) => t.state === "error").length;
	const last = tools[tools.length - 1];
	const label = `${tools.length} step${tools.length > 1 ? "s" : ""}${failed ? ` · ${failed} failed` : ""}`;
	const rows = open
		? `<ol class="steps">${tools
				.map(
					(t) =>
						`<li class="step ${t.state}"><div class="cmd">${esc(t.summary || t.name)}</div>${t.output ? `<pre>${esc(t.output)}</pre>` : ""}</li>`,
				)
				.join("")}</ol>`
		: "";
	return `<div class="group ${running ? "running" : ""}"><button class="group-head" data-group="${key}">
    <span class="spin" ${running ? "" : "hidden"}></span><span class="glabel">${label}</span><span class="glast">${esc(last.summary || last.name)}</span><span class="chev">${open ? "▾" : "▸"}</span>
  </button>${rows}</div>`;
}

function renderChat() {
	const { items, partial, busy, failure } = state.chat;
	const near = chatNearEnd();
	let html = "";
	if (!items.length && !partial && !busy) {
		html += `<div class="empty"><h3>Shape forma your way</h3><p>Plan training, log sessions, or change how the app looks and works. Every change is saved as a version you can undo.</p>
      <div class="chips">${SUGGESTIONS.map((s) => `<button class="chip">${esc(s)}</button>`).join("")}</div></div>`;
	}
	let tools = [];
	const flushTools = (_i) => {
		if (tools.length) html += toolGroup(tools, tools[0].id);
		tools = [];
	};
	items.forEach((item, i) => {
		if (item.type === "tool") {
			tools.push(item);
			return;
		}
		flushTools(i);
		if (item.type === "user") {
			const files = (item.files ?? []).map((f) => `<span class="file-chip">${esc(f)}</span>`).join("");
			html += `<div class="msg user">${files ? `<div class="files">${files}</div>` : ""}${esc(item.text).replace(/\n/g, "<br>")}</div>`;
		} else if (item.type === "assistant") html += `<div class="msg bot">${markdown(item.text)}</div>`;
		else html += `<div class="notice ${item.tone}">${esc(item.text)}</div>`;
	});
	flushTools(items.length);
	if (partial) html += `<div class="msg bot">${markdown(partial)}</div>`;
	if (busy && !partial) html += `<div class="typing"><i></i><i></i><i></i></div>`;
	if (failure && !busy) html += `<div class="notice error">Stopped: ${esc(failure)}</div>`;
	if (state.agentError) html += `<div class="notice error">${esc(state.agentError)}</div>`;
	chatEl.innerHTML = html;
	if (near || busy) scrollChatToEnd();
}

function chatNearEnd() {
	return chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight < 80;
}

function scrollChatToEnd() {
	chatEl.scrollTop = chatEl.scrollHeight;
}

// Keep the thread's end in view when the thread gets shorter (keyboard up, composer growing) if it was there.
let chatAtEnd = true;
chatEl.addEventListener("scroll", () => (chatAtEnd = chatNearEnd()), { passive: true });
new ResizeObserver(() => chatAtEnd && scrollChatToEnd()).observe(chatEl);

function renderHistory() {
	if (!state.history) {
		historyEl.innerHTML = `<div class="empty"><p>Loading…</p></div>`;
		return;
	}
	const { versions, head } = state.history;
	historyEl.innerHTML = `<p class="hint">Every agent change is a version. Restoring creates a new version, so it can be undone too. Your workout data is not affected.</p>
  <ol class="versions">${versions
		.map((v) => {
			const current = v.sha === head;
			const open = state.expanded.has(v.sha);
			return `<li class="version ${current ? "current" : ""}">
        <button class="vhead" data-sha="${v.sha}"><span class="vsub">${esc(v.subject)}</span><span class="vmeta">${ago(v.date)} · ${v.short}${current ? " · <b>current</b>" : ""}</span></button>
        ${open ? `<div class="vbody">${v.body ? `<div class="vnote">${markdown(v.body)}</div>` : ""}<pre>${esc(state.statOf[v.sha] ?? "…")}</pre>${current ? "" : `<button class="restore" data-sha="${v.sha}">Restore this version</button>`}</div>` : ""}
      </li>`;
		})
		.join("")}</ol>`;
}

function renderMemory() {
	const memory = state.memory;
	if (!memory) {
		memoryEl.innerHTML = `<div class="empty"><p>Loading…</p></div>`;
		return;
	}
	if (!memory.available) {
		memoryEl.innerHTML = `<div class="empty"><p>Memory is unavailable on this machine (it needs python3 and a one-time download of OptMem). See the server log.</p></div>`;
		return;
	}
	const lines = memory.text.split("\n").filter((line) => line.startsWith("#"));
	memoryEl.innerHTML = `<p class="hint">What the agent remembers about you, across every conversation. It writes these itself; ask it to remember or correct something. Older memories are folded into summaries.</p>
  ${
		lines.length
			? `<ol class="memories">${lines
					.map((line) => {
						const m = line.match(/^#(\S+)\s+(?:(\d{4}-\d{2}-\d{2})\s+)?(.*)$/);
						return `<li><span class="mid">#${esc(m?.[1] ?? "")}${m?.[2] ? ` · ${m[2]}` : ""}</span>${esc(m?.[3] ?? line)}</li>`;
					})
					.reverse()
					.join("")}</ol>`
			: `<div class="empty"><p>Nothing yet. Tell the agent about your goals, injuries, schedule and gym, and it will remember.</p></div>`
	}`;
}

function renderPending() {
	pendingEl.hidden = !state.pending.length || state.tab !== "chat";
	pendingEl.innerHTML = state.pending
		.map(
			(f, i) =>
				`<span class="file-chip">${esc(f.name)}<button class="unattach" data-i="${i}" aria-label="Remove">×</button></span>`,
		)
		.join("");
}

function renderChrome() {
	panel.hidden = !state.open;
	fab.hidden = state.open && window.matchMedia("(max-width: 720px)").matches;
	fab.classList.toggle("busy", state.chat.busy);
	const badge = $(".badge");
	const down = state.app.status === "crashed" || state.app.status === "stopped";
	badge.hidden = !down;
	for (const tab of root.querySelectorAll(".tab")) tab.classList.toggle("active", tab.dataset.tab === state.tab);
	chatEl.hidden = state.tab !== "chat";
	historyEl.hidden = state.tab !== "history";
	memoryEl.hidden = state.tab !== "memory";
	renderPending();
	$(".composer").hidden = state.tab !== "chat";
	$(".stop").hidden = !state.chat.busy;
	textarea.placeholder = state.chat.busy
		? "Add to what the agent is doing…"
		: "Ask for a workout, or change anything about this app…";
	banner.hidden = !down;
	if (down) {
		banner.innerHTML = `The app is ${state.app.status}. Ask the agent to fix it, or <button class="restore-prev">restore the previous version</button>.`;
	}
	document.documentElement.classList.toggle("forma-dock-open", state.open);
}

function render() {
	renderChrome();
	if (state.tab === "chat") renderChat();
	else if (state.tab === "memory") renderMemory();
	else renderHistory();
}

async function openMemory() {
	state.tab = "memory";
	save();
	render();
	try {
		state.memory = await (await fetch(`${API}/memory`)).json();
	} catch (_error) {
		state.memory = { available: false, text: "" };
	}
	render();
}

async function openHistory() {
	state.tab = "history";
	render();
	try {
		const res = await fetch(`${API}/history`);
		state.history = await res.json();
	} catch (_error) {
		state.history = { versions: [], head: "" };
	}
	render();
}

// ---------- events ----------

function setOpen(open) {
	state.open = open;
	save();
	render();
	syncViewport();
	if (open && state.tab === "chat") {
		autosize();
		scrollChatToEnd();
		setTimeout(() => textarea.focus({ preventScroll: true }), 50);
	}
}

fab.addEventListener("click", () => setOpen(!state.open));
$(".close").addEventListener("click", () => setOpen(false));
$(".new").addEventListener("click", async () => {
	if (!confirm("Start a new conversation? The agent forgets this chat (your app and data stay).")) return;
	await post("/reset").catch((e) => alert(e.message));
});
for (const tab of root.querySelectorAll(".tab")) {
	tab.addEventListener("click", () => {
		if (tab.dataset.tab === "history") openHistory();
		else if (tab.dataset.tab === "memory") openMemory();
		else {
			state.tab = "chat";
			save();
			render();
		}
	});
}
document.addEventListener("keydown", (e) => {
	if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
		e.preventDefault();
		setOpen(!state.open);
	} else if (e.key === "Escape" && state.open) setOpen(false);
});

/** Grows the composer with its text (limits in dock.css). */
function autosize() {
	textarea.style.height = "auto";
	const css = getComputedStyle(textarea);
	const borders = Number.parseFloat(css.borderTopWidth) + Number.parseFloat(css.borderBottomWidth);
	const size = composerHeight(
		textarea.scrollHeight,
		borders,
		Number.parseFloat(css.minHeight),
		Number.parseFloat(css.maxHeight),
	);
	textarea.style.height = `${size.height}px`;
	textarea.style.overflowY = size.scroll ? "auto" : "hidden";
}
textarea.addEventListener("input", () => {
	autosize();
	save();
});
// Typing: show the last message; the ResizeObserver above keeps it there as the keyboard and composer take room.
textarea.addEventListener("focus", () => {
	chatAtEnd = true;
	scrollChatToEnd();
});

// ---------- on-screen keyboard: size the full-screen panel to the visual viewport ----------

/**
 * iOS does not shrink the layout viewport for the keyboard, so a 100dvh panel would sit partly under it and iOS
 * would scroll the page to reveal the composer, pushing the thread off screen. dock.css sizes the mobile panel
 * with these variables instead. Only the open panel uses them, so nothing runs while it is closed: the agent button
 * and the app's tab bar are placed by CSS alone.
 */
function syncViewport() {
	const viewport = window.visualViewport;
	if (!viewport || !state.open) return;
	const area = visibleArea(viewport, document.documentElement.clientHeight);
	host.style.setProperty("--vv-height", `${area.height}px`);
	host.style.setProperty("--vv-top", `${area.top}px`);
	panel.classList.toggle("keyboard", area.keyboard);
}
window.visualViewport?.addEventListener("resize", syncViewport);
window.visualViewport?.addEventListener("scroll", syncViewport);
textarea.addEventListener("keydown", (e) => {
	if (e.key === "Enter" && !e.shiftKey && !e.isComposing && !("ontouchstart" in window)) {
		e.preventDefault();
		$(".composer").requestSubmit();
	}
});

// ---------- attachments: transport only; the model reads PDFs and images itself ----------

const MODEL_IMAGES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const MIME_BY_EXT = {
	pdf: "application/pdf",
	csv: "text/csv",
	tsv: "text/tab-separated-values",
	json: "application/json",
	txt: "text/plain",
	md: "text/markdown",
};

function base64(blob) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(blob);
	});
}

/** Re-encodes a photo the model cannot take as is (HEIC, huge) as a JPEG of at most 2400 px. */
async function toJpeg(file) {
	const url = URL.createObjectURL(file);
	try {
		const img = new Image();
		img.src = url;
		await img.decode();
		const scale = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
		const canvas = document.createElement("canvas");
		canvas.width = Math.round(img.naturalWidth * scale);
		canvas.height = Math.round(img.naturalHeight * scale);
		canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
		return await new Promise((resolve, reject) =>
			canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), "image/jpeg", 0.88),
		);
	} finally {
		URL.revokeObjectURL(url);
	}
}

async function prepare(file) {
	const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
	const mimeType = file.type || MIME_BY_EXT[ext] || "application/octet-stream";
	const isImage = mimeType.startsWith("image/") || ext === "heic" || ext === "heif";
	if (isImage && (!MODEL_IMAGES.includes(mimeType) || file.size > 3_500_000)) {
		try {
			const jpeg = await toJpeg(file);
			return { name: file.name.replace(/\.\w+$/, "") + ".jpg", mimeType: "image/jpeg", data: await base64(jpeg) };
		} catch {
			// The browser cannot decode it; send it as it is and let the agent say so.
		}
	}
	if (mimeType === "application/pdf" && file.size > 30_000_000)
		throw new Error(`${file.name} is over 30 MB, the model's limit for a PDF.`);
	return { name: file.name, mimeType, data: await base64(file) };
}

fileInput.addEventListener("change", () => {
	state.pending = [...state.pending, ...fileInput.files];
	fileInput.value = "";
	renderPending();
	textarea.focus({ preventScroll: true });
});
$(".attach").addEventListener("click", () => fileInput.click());

async function send(text) {
	const files = state.pending;
	if (!text.trim() && !files.length) return;
	state.pending = [];
	textarea.value = "";
	autosize();
	save();
	// Show the message at once; the server's view replaces it.
	state.chat = {
		...state.chat,
		busy: true,
		items: [...state.chat.items, { type: "user", id: `local-${Date.now()}`, text, files: files.map((f) => f.name) }],
	};
	render();
	try {
		const prepared = await Promise.all(files.map(prepare));
		await post("/chat", { text, files: prepared, screen: `${location.hash || "#/"} — ${document.title}` });
	} catch (error) {
		state.agentError = error.message;
		render();
	}
}

$(".composer").addEventListener("submit", (e) => {
	e.preventDefault();
	send(textarea.value);
});
$(".stop").addEventListener("click", () => post("/stop").catch(() => {}));

root.addEventListener("click", async (e) => {
	const target = e.target.closest?.("button");
	if (!target) return;
	if (target.classList.contains("unattach")) {
		state.pending.splice(Number(target.dataset.i), 1);
		renderPending();
	} else if (target.classList.contains("chip")) {
		if (target.textContent.startsWith("Import my body scans")) {
			textarea.value = "Import these body scans: ";
			autosize();
			fileInput.click();
		} else send(target.textContent);
	} else if (target.dataset.group) {
		const key = target.dataset.group;
		state.expanded.has(key) ? state.expanded.delete(key) : state.expanded.add(key);
		renderChat();
	} else if (target.classList.contains("vhead")) {
		const sha = target.dataset.sha;
		if (state.expanded.has(sha)) state.expanded.delete(sha);
		else {
			state.expanded.add(sha);
			if (!state.statOf[sha]) {
				fetch(`${API}/stat?sha=${sha}`)
					.then((r) => r.json())
					.then((d) => {
						state.statOf[sha] = d.stat || "(no file changes)";
						renderHistory();
					});
			}
		}
		renderHistory();
	} else if (target.classList.contains("restore")) {
		if (!confirm("Restore the app to this version? Your workout data stays as it is.")) return;
		target.disabled = true;
		target.textContent = "Restoring…";
		await post("/restore", { sha: target.dataset.sha }).catch((err) => alert(err.message));
	} else if (target.classList.contains("restore-prev")) {
		const res = await fetch(`${API}/history`).then((r) => r.json());
		const previous = res.versions[1];
		if (!previous) return;
		if (!confirm(`Restore "${previous.subject}"?`)) return;
		await post("/restore", { sha: previous.sha }).catch((err) => alert(err.message));
	}
});

// ---------- live connection ----------

function connect() {
	const source = new EventSource(`${API}/events`);
	source.addEventListener("chat", (e) => {
		state.chat = JSON.parse(e.data);
		state.agentError = "";
		if (state.open) render();
		else renderChrome();
	});
	source.addEventListener("app", (e) => {
		state.app = JSON.parse(e.data);
		renderChrome();
		if (state.tab === "history" && state.open) openHistory();
	});
	source.addEventListener("agent-error", (e) => {
		state.agentError = JSON.parse(e.data);
		render();
	});
	source.addEventListener("reload", () => {
		save();
		location.reload();
	});
	source.addEventListener("data", () => window.dispatchEvent(new CustomEvent("forma:data-changed")));
	source.onopen = () => {
		state.connected = true;
	};
}

// ---------- start ----------

const saved = load();
state.open = !!saved.open;
state.tab = ["history", "memory"].includes(saved.tab) ? saved.tab : "chat";
document.body.appendChild(host);
syncViewport();
if (saved.draft) textarea.value = saved.draft;
render();
autosize();
if (state.open && state.tab === "history") openHistory();
if (state.open && state.tab === "memory") openMemory();
connect();
window.forma = { open: () => setOpen(true), ask: (text) => (setOpen(true), send(text)) };
