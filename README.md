<img src="assets/icon.svg" width="64" height="64" alt="">

# forma

A workout planner and fitness tracker that you reshape by talking to it. The calendar, the day list, the workout
logger and the exercise library are only the starting point: a built-in agent (pi-durable, running Claude through
your Claude Code login) can plan your training *and* rewrite any part of the app — its screens, features, data
model and server — while it runs. Every change is a version you can roll back from the app.

Created in [T3 Code](https://t3.codes).

## Run

```bash
pnpm install          # also compiles the vendored Claude Code bridge
pnpm start            # http://localhost:4300, and on your LAN (addresses are printed)
```

Needs Node 24+, and the `claude` CLI logged in (`claude auth status`). Open the printed LAN address on your phone
and "Add to Home Screen" for a full-screen app. The first start downloads the exercise library (~1 MB); photos are
fetched once each, on first view, and cached.

| Variable | Default | |
| --- | --- | --- |
| `PORT` / `HOST` | `4300` / `0.0.0.0` | Public address. The app itself runs on `PORT+1`, loopback only. |
| `FORMA_HOME` | `./.forma` | Where the live app, its data and the agent's storage live. |
| `FORMA_MODEL` | `claude-opus-5-5` | Model on the Claude Code provider. |
| `FORMA_THINKING` | `medium` | `minimal` … `xhigh`. |
| `FORMA_MEMORY_DIR` | `./.forma/memory` | The agent's OptMem memories. Point it at `~/.optmem/memory` to share one memory with your other agents. |
| `EXERCISEDB_RAPIDAPI_KEY` | — | Optional. Enables "Show animated GIF" (ExerciseDB on RapidAPI). Each GIF costs ≤2 calls once, then is cached; misses are remembered, so the small free tier lasts. |

There is no login: anyone on your network can open it, and the agent can run shell commands on this machine.
Keep it on a network you trust.

## How it works

```
phone ──HTTP──▶ core (:4300, stable)  ──proxy──▶ app (:4301, malleable, node server.ts)
                 ├─ /__forma/*  agent API + SSE, dock UI injected into every page
                 ├─ pi-durable harness (.forma/agent.sqlite), cwd = .forma/app
                 ├─ supervisor: restarts the app, notices crashes
                 └─ versions: .forma/app is its own git repo; one commit per agent run
```

- **`core/`** never changes at runtime. It serves the agent panel ("dock") into every page from outside the app, so
  no change can lock you out: if the app crashes, you get a fallback page with the dock, the error, and a one-tap
  restore.
- **`app/`** is the seed. On first start it is copied to `.forma/app`, which the agent edits. Your edits to `app/`
  reach new installs only; to start over from the seed, delete `.forma/app` (your data in `.forma/data` stays).
- **Data** lives in `.forma/data/app.db` (JSON documents in SQLite), outside the app's git history, so restoring a
  version never loses workouts. It is snapshotted to `.forma/data/backups/` before every agent run (last 20 kept).
- **The agent** has `read`/`write`/`edit`/`bash` in the live app plus `app_check` (restart, parse every module,
  collect server logs and errors the dock caught in your browser, reload open pages). Runs are durable: kill the
  process mid-run and it resumes on the next start. Each message carries which screen you are on, so "move this to
  Friday" works.
- **Your data**: workouts and every logged set; body measurements (Body tab: scans and weigh-ins, trends,
  segmental lean/fat, circumferences, posture). To onboard Visbody (or any) reports, tap the paperclip in the agent
  panel, attach the PDFs or screenshots, and ask it to import them. Files go to the model as they are (Claude reads
  PDFs and images natively; iPhone HEIC photos are converted to JPEG in the browser) and are kept in
  `.forma/data/uploads/`. The agent writes the values into the `measurements` collection, in kg and cm.
- **Memory**: [OptMem](https://github.com/VictorTaelin/OptMem). The agent notes what it learns about you (goals,
  injuries, schedule, preferences, decisions) as one-line memories, so they survive new conversations, compaction and
  restarts; the Memory tab shows them. Measurements and workouts stay in the database, not in memory. The script is
  downloaded on first start from a pinned commit and checked against a pinned SHA-256 (the repository has no
  license, so it is not copied into forma); it needs `python3`. The memory is always in the system prompt, and the
  agent uses it through one `memory` tool.
- **Exercises**: [free-exercise-db](https://github.com/yuhonas/free-exercise-db) (public domain, ~870 exercises,
  start/end photos played as a loop, instructions, muscles), plus your own via the `exercises_custom` collection.

## Develop

```bash
pnpm check   # biome + tsc
pnpm test    # node:test
node scripts/shot.ts .forma/shots '#/' '#/library'   # light/dark phone screenshots via local Chrome
node scripts/ios-shot.ts /tmp/forma-ios-shots           # iPhone WebKit: tab bar, sheet, agent composer (needs `pnpm exec playwright-core install webkit`)
pnpm test:ios   # iPhone WebKit: asserts the tab bar and agent button are flush and identical on every tab, empty and seeded
```

`pnpm test:ios` (`node scripts/ios-tabbar.ts [out-dir]`) starts the seed app on a spare port with a throwaway
database and saves per-tab screenshots to `~/forma-ios-shots/r2`. `FORMA_APP=.forma/app` checks the live copy
instead. Emulation has no Home Screen mode, so it checks the conditions the layout relies on (see `app/AGENTS.md`),
not iOS itself.

See `AGENTS.md` for the layout, and `app/AGENTS.md` for the guide the in-app agent reads.
