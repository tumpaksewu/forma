# Vendored: pi-claude-code

Source: https://github.com/earendil-works/pi-claude-code (copied from mercury's vendored copy)
Commit: 47f9e2bb408f8b5c351edf95f7b756bc5c8f45cf (2026-11-04)
License: MIT, see LICENSE.

`src/` is copied unchanged, without `index.ts` (the Pi coding-agent extension entry, which Mercury does not use).
`tsconfig.build.json` is ours. `pnpm vendor:build` compiles `src/` to `dist/`, which is not committed.

Why vendored instead of installed: the package ships TypeScript sources only and is not on npm. Node does not strip
types under `node_modules`, and one file uses a parameter property, so it has to be compiled either way.

Why this commit: the host enforces a seven-day minimum release age. This was the newest commit older than that on
2026-11-12. Newer upstream fixes worth taking on the next bump: 799943e (file mentions break replay) and d5b5e04
(native reminders in rebuilt user messages).

To update: replace `src/` from a commit that is at least seven days old, update this file, run `pnpm vendor:build`,
`pnpm check`, `pnpm test`, `pnpm gym`, and `node spikes/004-claude-code-bridge/smoke.ts`.

## Local patches (forma)

- `src/transcript.ts` `imageBlock()`: an `ImageContent` whose `mimeType` is `application/pdf` becomes Anthropic's
  native `document` block instead of an `image` block. pi-ai has no document content type, so this is how forma hands
  PDFs to Claude as they are. Without it the PDF is silently dropped. Re-apply on update, or upstream it.
