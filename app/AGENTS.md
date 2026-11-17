# forma app — guide for the agent

This directory is the whole app. You may change any file in it, add files, or restructure it. Keep this guide true:
when you change the architecture, data model, or conventions, update this file in the same change.

## How it runs

- `node server.ts` (Node 24, TypeScript run directly by type stripping: no enums, no parameter properties).
  The forma core starts it with `PORT`, `HOST=127.0.0.1` and `FORMA_DATA` set, and proxies the owner's browser to it.
- No build step and no npm dependencies. The browser loads `web/` as native ES modules. If you truly need a package,
  vendor a single ESM file into `web/vendor/` (browser) or add a `package.json` dependency and run `npm install`
  (server), but prefer plain code.
- The agent panel (the floating button) is injected by the core into every HTML page. It is not part of this
  directory and you cannot change it. Keep the bottom-right corner (about 70×140 px above the tab bar) free of
  important controls.
- After code changes, call `app_check`. Server changes need its restart; browser changes need a reload, which it does.

## Files

- `server.ts` — HTTP server: static files from `web/`, JSON API under `/api`, exercise photos under `/media`.
- `lib/db.ts` — `Store`: collections of JSON documents in SQLite (`$FORMA_DATA/app.db`), plus `migrate(name, fn)`.
- `lib/exercises.ts` — `Library`: free-exercise-db (downloaded to `$FORMA_DATA/exercises.json`), merged with the
  owner's custom exercises; photo cache; optional ExerciseDB GIFs (`EXERCISEDB_RAPIDAPI_KEY`).
- `web/index.html`, `web/styles.css` — page shell and all styles. Colors are CSS variables on `:root`, redefined
  for dark mode under `prefers-color-scheme: dark`. Change the theme there.
- `web/app.js` — hash router, shell, bottom tab bar (`NAV`). Add a screen: write `web/views/<name>.js`, add a
  route in `parseRoute`, render it in `App`, and optionally a `NAV` entry.
- `web/lib/preact.js` — import `html`, `render`, hooks from here (Preact + htm, vendored in `web/vendor/`).
  Components use `html\`...\``tagged templates:`<${Comp} prop=${x} />`, `class=`not`className`.
- `web/lib/api.js` — `db` (collections CRUD), `exercises`, `meta`, `useData(loader, deps)` (refetches on deps or on
  the `forma:data-changed` event), `changed()` (fire that event after writing data).
- `web/lib/dates.js` — dates are local `"YYYY-MM-DD"` strings everywhere.
- `web/lib/workouts.js` — the workout model (see below) and helpers.
- `web/components/` — `ui.js` (Icon, Sheet, ExerciseMedia, Empty, Spinner, Chip), `exercise-search.js`,
  `day-workouts.js` (day's workout cards + "New workout"/"Reuse").
- `web/views/` — `calendar.js` (home), `agenda.js` (plan list), `workout.js` (plan/log one workout),
  `exercise.js` (detail with photos, instructions, history chart), `library.js`, `body.js` (measurements:
  tiles, trend chart, latest scan's segments/circumferences/posture, history, manual weigh-in).
- `web/lib/body.js` — the measurement model: metric labels, unit kinds by key suffix, unit conversion.
- `web/components/line-chart.js` — single-series time chart (use it for any new trend).

## Data

Collections (all JSON documents with a string `id`):

- `workouts`: `{ id, date: "YYYY-MM-DD", title, notes, done, order, color?, exercises: [{ uid, exerciseId, name,
  image, notes, restSec, sets: [{ reps, weight, done }] }] }`. Weight is in the owner's unit (`settings/prefs.units`).
- `templates`: `{ id, title, color?, exercises }` (same exercise shape, sets not done).
- `exercises_custom`: the owner's own exercises, same shape as library ones (`name`, `category`, `equipment`,
  `primaryMuscles`, `secondaryMuscles`, `instructions`, `images` as URLs). Ids should not clash with library ids.
- `measurements`: one per body scan or weigh-in, values ALWAYS stored metric (kg, cm), whatever the report used:
  `{ id, date, time?, source: "visbody" | "manual" | …, file?, notes?, metrics: { weight_kg, body_fat_pct,
  skeletal_muscle_kg, fat_mass_kg, muscle_mass_kg, lean_mass_kg, body_water_kg, protein_kg, minerals_kg,
  visceral_fat, bmr_kcal, bmi, whr, body_score, posture_score, body_age, …any other snake_case key ending in its
  unit: _kg _cm _pct _kcal _deg }, segments?: { lean_kg: { left_arm, right_arm, trunk, left_leg, right_leg },
  fat_kg: {…} }, circumferences_cm?: { neck, chest, waist, hip, left_arm, right_arm, left_thigh, right_thigh,
  left_calf, right_calf }, posture?: [{ name, value, unit, finding }] }`. The Body screen shows unknown metric keys
  too. Importing a report: one document per scan date, `file` = the saved upload path, every value the report
  has (convert lb→kg ×0.45359237, in→cm ×2.54); skip a scan whose date and source already exist unless asked.
- `settings`: document `prefs` = `{ units: "kg" | "lb" }` (also decides how body values are displayed).

Add new collections freely; no schema needed. When you change the shape of existing documents, add a
`store.migrate("YYYY-MM-DD-what", (s) => ...)` call in `server.ts` at startup so old data is converted once.

## HTTP API (for curl, at the URL in your instructions)

- `GET /api/c/:collection?field=value&date_gte=…&date_lte=…` list; `POST /api/c/:collection` create (id optional);
  `GET|PUT|PATCH|DELETE /api/c/:collection/:id`.
- `GET /api/exercises?q=bench&muscle=chest&equipment=barbell&category=strength&level=beginner&limit=20` →
  `{ total, items }`; `GET /api/exercises/:id`; `GET /api/exercises/:id/history` (logged sets by date).
- `GET /api/meta` → `{ gifs, facets, collections }`. `GET /api/health`.

Planning workouts for the owner: look up real library ids with `/api/exercises?q=…` first, then POST workouts with
`exerciseId`, `name` and `image` (the first of the exercise's `images`) copied from the library, and a fresh short
`uid` per entry. One request per workout is fine; use a small shell loop or a node script for programs.

## Conventions

- Mobile first: the owner uses this on a phone at the gym. Tap targets ≥ 44 px, inputs ≥ 16 px font (no iOS zoom),
  respect the safe-area insets through the `--safe-top` / `--safe-bottom` tokens in `styles.css` (not `env()`).
- The owner runs it from the iPhone Home Screen. There iOS does not give the page the strip under the home
  indicator: it paints it itself in a colour taken from the page background, and no element (and no JS offset) can
  reach it. So the page background (`html`, `body`), the tab bar and anything else fixed to the bottom edge stay one
  opaque colour, `--bg`; a translucent or different bar shows a band below it. Don't add `maximum-scale` or
  `user-scalable=no` to the viewport.
- Keep files under ~400 lines; split components into `web/components/`.
- Don't break existing data. Don't delete the owner's workouts unless asked.
