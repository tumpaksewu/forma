# AGENTS.md

forma is a malleable workout app: a stable core hosts a pi-durable agent that edits a live copy of the app at runtime.
README.md explains the architecture; read it first.

## Map

- `core/` — the stable host. The in-app agent never edits it.
  - `main.ts` wiring and startup; `config.ts` paths, ports, model; `http.ts` public server, proxy, dock injection,
    `/__forma/*` API; `supervisor.ts` app process; `versions.ts` git history of the live app; `agent.ts` the
    pi-durable harness, prompt, `app_check` and `memory` tools; `memory.ts` OptMem (pinned download, wake);
    `attachments.ts` dock uploads → saved files + model content (PDFs/images as is); `chat-view.ts` pure
    transcript → dock view.
  - `dock/` the agent panel (plain JS in a shadow root), injected into every HTML page; `viewport.js` its pure
    layout helpers (keyboard-aware panel size, auto-growing composer).
- `app/` — the seed of the malleable app (zero dependencies, no build). `app/AGENTS.md` is the in-app agent's guide
  and is rendered into its system prompt; keep it true when you change the seed.
- `vendor/pi-claude-code/` — third-party, copied from mercury's vendored copy with one local patch (PDFs as
  document blocks), listed in `VENDORED.md`. Do not edit otherwise. `pnpm vendor:build` compiles it (runs on install).
- `scripts/` — dev helpers (screenshots with local Chrome, and iPhone WebKit shots with simulated safe areas and
  keyboard, via playwright-core). `pnpm test:ios` runs `ios-tabbar.ts` (tab bar and FAB flush and still) and
  `ios-nav.ts` (a tab switch is one in-place render with no reload or blank frame; back buttons work) and
  `ios-overflow.ts` (nothing wider than the screen at 375/393/402 with long names, with the guard off and on),
  sharing `ios-harness.ts`; run it when you touch the app's layout, navigation, or the dock's FAB. `FORMA_URL=<core url>
  node scripts/ios-nav.ts` checks a running core (proxy, dock, event stream) instead of the bare seed app.
- `.forma/` — runtime state (gitignored): live app, data, agent storage.

## Rules

- TypeScript run by Node 24 type stripping: no enums, no parameter properties. Strict tsc, biome, node:test with
  arrange-act-assert. Tests for new functions.
- Only `core/agent.ts` imports `@earendil-works/*`.
- The live app must keep running from `.forma/app` with `node server.ts` and no `node_modules`.
- Commands: `pnpm check`, `pnpm test`, `pnpm start`.
