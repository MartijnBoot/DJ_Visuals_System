# Spec: 0 — Walking skeleton

Status: Approved · Depends on: `docs/adr/0001-setup-decision-record.md` (must be Approved before
this spec is) · Fixes: — · Backlog: — (Phase 0 is not a backlog item; every item assumes it)

Line references are to `main` at `29d405e`. The Setup Decision Record (SDR) is cited from the
uncommitted working copy of the same date.

## Problem

The repository is a workflow with no product in it. The SDR decides the stack, database,
hosting, auth and observability, but nothing proves those decisions hold together, and every
command the workflow relies on is still a placeholder:

- The gate has no project checks: `scripts/check.sh:66-88` is a commented example block, and
  `scripts/check.sh:92-95` prints a warning that green proves only the workflow files. CI
  (`.github/workflows/ci.yml:41-52`) has the toolchain steps commented out for the same reason.
- Setup installs nothing: `scripts/setup.sh:39-45` is an example block.
- The environment contract is a template: `.env.example:15-20` names a Postgres URL and a
  session secret the SDR rules out, and no config module exists to validate anything.
- `CLAUDE.md:27-29` has no run or migrate command, and `CLAUDE.md:47-52` has no config
  module or environment quirks. `docs/invariants.md:22` names a config module and a test that
  do not exist; `docs/invariants.md:36` guards a path that does not exist.
  `docs/design/architecture.md:12-29` is empty.
- The migrations invariant (`docs/invariants.md:24`) says it is enforced by
  `.claude/guard-paths.json` → `append_only`, which is an empty list.

The cost: B-01, the largest item in the backlog, would start by building all of this and the
SDR's central claims (one process serves everything, the renderer has no UI or server
dependencies, config fails fast) would be proven for the first time inside a feature branch.

## Decisions

- **SD1 — Walking skeleton, not tooling only.** Phase 0 delivers the thinnest slice through
  every layer the SDR names, running end to end, plus the tooling and gate around it. Reason:
  the SDR's claims are only proven by a running slice, and the first feature should start from
  a measured baseline.
- **SD2 — pnpm workspace with four packages: `web/`, `server/`, `shared/`, `engine/`.** The
  renderer is its own package whose manifest depends on neither React, Vite, Fastify nor Node
  types, so the SDR's "framework-free renderer" constraint is enforced by the package boundary
  and the type checker, not by a lint rule. The SDR's reference to `web/src/engine/` becomes
  `engine/`; that one-line SDR edit is the owner's, made when approving this spec.
- **SD3 — SQLite through the built-in `node:sqlite` module, no ORM.** Zero dependencies and
  no native build. Migrations are plain SQL files in `server/migrations/`, applied in file-name
  order by a runner the server owns, tracked in a `schema_migrations` table. The driver is
  wrapped in one module so that an API change in a future Node release, or a swap to
  better-sqlite3, touches one file.
- **SD4 — Fastify as HTTP framework, pino (bundled with Fastify) as logger.** One dependency
  covers structured JSON logging with a configurable level (SDR observability decision),
  static file serving now, and WebSockets for B-04 later.
- **SD5 — Remaining tooling:** zod for config validation now and the shared profile schema
  later; TypeScript strict with one root base config; Prettier; ESLint flat config with
  typescript-eslint; Vitest for unit and integration tests; Playwright with Chromium only for
  the browser check; no WebGL wrapper (raw WebGL2); React and Vite for the web UI as the SDR
  decides.
- **SD6 — Environment contract: `APP_ENV`, `LOG_LEVEL`, `PORT`, `DATA_DIR`, all required, no
  defaults in code.** Defaults live only in `.env.example`. A missing or malformed variable
  fails boot with a message naming the variable. The server binds to `127.0.0.1` and that is
  not configurable; B-04 introduces a bind address together with the pairing token.
- **SD7 — Migrations run at boot.** The server opens the database, applies pending migrations
  each in its own transaction, then listens. This is a conscious deviation from
  way-of-working 5.6 ("never on application start-up, which races across replicas"): the SDR
  decides one process on one machine, so no race exists. The hosting trigger in SDR §7
  reopens this decision. A `pnpm migrate` script runs the same runner without starting the
  server. A failed migration, a port already in use, or a locked database file each log one
  line with the reason and exit non-zero without listening.
- **SD8 — The overlay starts now with fps and frame time; latency comes with B-01.** The
  engine exposes per-frame statistics; the screen page draws them in an overlay toggled by a
  key. The skeleton render is a solid clear colour that drifts slowly over time, so a stuck
  frame is visible to a person and testable by reading the canvas twice.
- **SD9 — The browser check is part of the gate, locally and in CI.** Gate order: format,
  lint, types, build, unit, integration, browser. CI installs Chromium via Playwright and runs
  it headless with software WebGL. The browser test runs against the production build served
  by the Node process, never against the Vite dev server.
- **SD10 — Two run scripts.** `pnpm dev` runs the server in watch mode and the Vite dev server
  with hot reload, Vite proxying `/api/*` to the server. `pnpm start` builds the web app and
  serves it from the one Node process. Rule: nothing may work in dev mode that does not also
  work in start mode; the browser test only ever runs against start mode.
- **SD11 — First migration creates `app_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)` with
  one row `schema_created_at`.** Gives integration tests a real table to read without
  pre-empting B-02's profile model. *(default, not asked — object at review)*
- **SD12 — Health endpoint `GET /api/health` returns `{ status: "ok", schemaVersion, uptimeSeconds }`.**
  Its response schema lives in `shared/` as a zod schema and is validated on the web side
  before use, so the shared package has one real consumer from day one. *(default, not asked)*
- **SD13 — The overlay also shows server health: `ok` or `unreachable`.** Proves the web →
  server call through the shared schema in the same test that proves the engine draws.
  *(default, not asked)*
- **SD14 — Overlay toggle key: `o`.** No modifier, so it works on a laptop keyboard with one
  hand. *(default, not asked)*
- **SD15 — Node 24 pinned in `.nvmrc`; pnpm pinned via the root `packageManager` field.**
  `node:sqlite` needs Node 22.5 or later; pinning stops a minor Node drift from changing the
  driver API silently. *(default, not asked)*
- **SD16 — `server/migrations` goes into `.claude/guard-paths.json` → `append_only`.** Makes
  the existing migrations invariant true. *(default, not asked)*
- **SD17 — Every request gets a correlation id (Fastify's request id), logged on every line
  for that request.** Way-of-working 5.3. *(default, not asked)*
- **SD18 — Way-of-working 3.4 exit criteria that concern Azure (budgets, resource groups, DNS,
  Entra, `infra/`) are not met by this phase.** The SDR defers all of them to the hosting
  trigger. *(default, not asked)*

## Users and permissions

| Role | Can | Cannot |
|---|---|---|
| Owner on the screen machine | Run the app on `localhost`, open the screen page, toggle the overlay, read health | Reach the server from another device (bound to `127.0.0.1`) |

No auth, per SDR question 3.

## In scope

- Root: `pnpm-workspace.yaml`, root `package.json` with `dev`, `start`, `migrate`, `format`,
  `format:check`, `lint`, `typecheck`, `build`, `test`, `test:browser` scripts; `.nvmrc`;
  base `tsconfig.json`, ESLint flat config, Prettier config, Vitest workspace config,
  Playwright config.
- `shared/`: zod schema and TypeScript type for the health response. Public surface:
  `shared/src/index.ts`.
- `engine/`: `createEngine(canvas: HTMLCanvasElement)` returning `{ start(), stop(), stats() }`
  where `stats()` returns `{ fps, frameTimeMs, lastFrameAt }` (fps and frame time as a rolling
  average over the last second). Renders a slowly drifting solid clear colour via WebGL2 and
  `requestAnimationFrame`. Dependencies: none. Public surface: `engine/src/index.ts`.
- `server/`: `server/src/config.ts` (the one module that reads `process.env`, zod schema,
  throws at boot); `server/src/db.ts` (opens `DATA_DIR/djvisuals.sqlite` via `node:sqlite`,
  wraps the driver); `server/src/migrate.ts` (runner, `schema_migrations` table, each file in
  its own transaction, in file-name order); `server/migrations/0001_init.sql` (SD11); Fastify
  app with `GET /api/health` and static serving of `web/dist`; pino JSON logs with level from
  config; boot sequence: config → ensure `DATA_DIR` → open db → migrate → listen on
  `127.0.0.1:PORT`.
- `web/`: React + Vite app with one route `/` (the screen page): full-window canvas mounting
  the engine, overlay toggled with `o` showing fps, frame time and server health.
- `scripts/setup.sh`: requires `node` and `pnpm`; `pnpm install --frozen-lockfile`;
  `pnpm exec playwright install chromium`; creates `.env.local`; prints the next command.
- `scripts/check.sh`: project steps per SD9. `.github/workflows/ci.yml`: pnpm + Node 24 setup,
  Playwright Chromium with system deps, then the gate.
- `.env.example` rewritten to SD6. `.gitignore` adds `data/` and Playwright output.
- `.claude/guard-paths.json`: SD16.
- Docs: `CLAUDE.md` placeholders at lines 24-29, 47-52 and 60 filled; `docs/invariants.md`
  cross-phase rows and guarded areas filled (config boundary enforced by the ESLint
  `no-restricted-properties` rule on `process.env` outside `server/src/config.ts` plus a
  unit test that greps for it; engine framework-freedom enforced by a test that asserts
  `engine/package.json` has no dependencies and the engine's compiled output imports nothing);
  `docs/design/architecture.md` filled with the as-built four-package diagram, data,
  configuration and cross-cutting sections; `README.md` Setup section with the two commands.
- Tests: unit (config schema, migration runner ordering and failure, engine stats maths
  without a GPU, shared schema); integration (server boots against a temp `DATA_DIR`, applies
  the migration, serves health with the right schema version, refuses to boot on a bad env, on
  a failing migration, and on a port in use); browser (Playwright against `pnpm start`:
  canvas colour changes between two reads, overlay toggles with `o`, overlay shows `ok`).

## Out of scope

- Audio capture, audio analysis, camera capture, any shader beyond a clear colour (B-01).
- The latency number in the overlay (B-01).
- Profiles table, profiles API, assets folder contents, builder UI (B-02). The skeleton
  creates `DATA_DIR/assets/` as an empty directory only so the SDR's layout is real; nothing
  reads or writes it.
- WebSocket, WebRTC signalling, pairing token, any bind address other than `127.0.0.1`, any
  second device (B-04, B-01 phone camera).
- Fullscreen, Screen Wake Lock, OS power settings (B-01 risk mitigations).
- Profile export/import (B-02).
- Any Azure resource, `infra/`, Bicep, Key Vault, OIDC, budgets, Application Insights,
  Dockerfile (SDR §7, deferred to hosting).
- Dev and prod environments (SDR §3).
- A WebGL wrapper, an ORM, a second browser in Playwright, Vitest browser mode.
- Seed data: there is nothing to seed.
- Backup of the SQLite file: profile export is the SDR's backup path and arrives with B-02.
- Feature flags, email, cache, queue, search, background jobs (SDR questions 5 to 9).

## Acceptance criteria

- **AC1.** When `bash scripts/setup.sh` runs on a clean clone with Node 24 and pnpm installed,
  the system shall install all workspace dependencies and the Playwright Chromium build,
  create `.env.local` from `.env.example` if absent, and exit 0; running it a second time shall
  also exit 0 without changing anything.
- **AC2.** When `bash scripts/check.sh` runs, the system shall execute the steps format, lint,
  types, build, unit, integration and browser in that order after the workflow's own checks,
  stop at the first failure with the step name, and print no "no project checks are wired"
  warning.
- **AC3.** When the server boots with all four variables valid, the system shall create
  `DATA_DIR` and `DATA_DIR/assets/` if missing, open `DATA_DIR/djvisuals.sqlite`, apply every
  pending migration in file-name order each in its own transaction, record each in
  `schema_migrations`, and then listen on `127.0.0.1:PORT`.
- **AC4.** If any of `APP_ENV`, `LOG_LEVEL`, `PORT` or `DATA_DIR` is missing or malformed,
  then the system shall log one line naming the variable and the reason, and exit non-zero
  before opening the database or listening.
- **AC5.** If a migration fails, then the system shall roll back that migration, log one line
  with the migration file name and the error, leave `schema_migrations` without that entry,
  and exit non-zero without listening.
- **AC6.** When the server boots against a database where all migrations are already
  recorded, the system shall apply none and listen.
- **AC7.** If `PORT` is already in use, or the database file is locked by another process,
  then the system shall log one line with the reason and exit non-zero.
- **AC8.** When `pnpm migrate` runs, the system shall apply pending migrations exactly as at
  boot (AC3, AC5, AC6) and exit without listening.
- **AC9.** When a client requests `GET /api/health`, the system shall respond 200 with a JSON
  body that validates against the shared health schema, where `schemaVersion` equals the
  highest applied migration number and `status` is `"ok"`.
- **AC10.** When a client requests `/` on the listening server, the system shall serve the
  built web app from `web/dist`, and the page shall mount a canvas filling the window.
- **AC11.** While the engine is started, the system shall render a frame on every animation
  frame, such that two canvas reads 500 ms apart differ in colour, and `stats()` shall report
  fps and frame time as a rolling one-second average.
- **AC12.** When the `o` key is pressed on the screen page, the system shall toggle an overlay
  showing fps, frame time and the server health status (`ok` or `unreachable`); the overlay
  shall be hidden on load.
- **AC13.** If the health request fails or the body does not validate against the shared
  schema, then the overlay shall show `unreachable` and the engine shall keep rendering.
- **AC14.** While the server is running, the system shall write every log line as one JSON
  object to stdout, with the level filtered by `LOG_LEVEL` and a request id on every line
  belonging to a request.
- **AC15.** When any file outside `server/src/config.ts` references `process.env`, the lint
  step shall fail.
- **AC16.** When `engine/package.json` gains a `dependencies` entry or the engine's compiled
  output contains an import, the unit step shall fail.
- **AC17.** When an agent uses Write or Edit on any file in `server/migrations/` other than
  the newest by name, the guard hook shall block it.
- **AC18.** When `pnpm dev` runs, the system shall serve the screen page with hot reload and
  proxy `/api/*` to the server, and the overlay shall show `ok`.
- **AC19.** When the server listens, the system shall accept connections on `127.0.0.1` only;
  a connection to the machine's LAN address on the same port shall be refused.

## Data

New: `DATA_DIR/djvisuals.sqlite`, created at first boot. `PRAGMA journal_mode = WAL` and
`PRAGMA foreign_keys = ON` set on open.

Owned by the runner, created if absent before any migration:

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  name       TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);
```

`server/migrations/0001_init.sql`:

```sql
CREATE TABLE app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO app_meta (key, value) VALUES ('schema_created_at', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
```

Migration files are named `NNNN_<slug>.sql`, four digits, applied in lexical order, each in
its own transaction. Forward-only; there is no down path. Irreversible by design: the restore
plan is "delete the file", since the skeleton holds nothing a person made.

## API contract

| Method | Path | Request | Response | Errors |
|---|---|---|---|---|
| GET | `/api/health` | — | 200 `{ "status": "ok", "schemaVersion": 1, "uptimeSeconds": 12 }` | none; the process not answering is the error |
| GET | `/` and static assets | — | 200 the built web app | 404 for unknown paths outside `/api` |

The health response schema is `healthResponseSchema` in `shared/src/index.ts`, used by the
server to build the response and by the web to parse it.

## UI

One screen, `/`:

- **Loading:** black canvas until the first frame, which is within one animation frame of
  mount.
- **Running:** full-window canvas, slowly drifting solid colour. No chrome, no cursor change.
- **Overlay hidden (default):** nothing but the canvas.
- **Overlay shown (`o`):** top-left monospace block with `fps`, `frame ms`, `server: ok` or
  `server: unreachable`. Health is polled every 5 s while the overlay is shown and not at all
  while hidden.
- **Error:** the engine failing to get a WebGL2 context shows a one-line message on the page
  in place of the canvas and logs to the console. Nothing else can fail visibly.

## Non-functional

- Performance: the clear-colour render holds the display's refresh rate on the owner's screen
  machine; the overlay reports it. No budget beyond that; B-01 sets the latency budget.
- Authorisation: none; `127.0.0.1` only.
- Logging: structured JSON, one line per event, request id per request, level from config.
  Never log the environment.
- Limits: none. One user, one process.
- Gate time: the full gate under three minutes in CI.

## Edge cases and failure modes

- **Restart mid-boot** (process killed between migrations): each migration is its own
  transaction, so the next boot resumes from the first unrecorded file (AC5, AC6).
- **Two instances:** the second fails on the port (AC7). If the first died without releasing
  the SQLite lock, the second reports the lock (AC7); WAL mode keeps a crashed reader from
  holding a lock across a restart.
- **No network:** nothing in the skeleton uses a network beyond loopback. Setup needs the
  network for `pnpm install` and the Chromium download, and says so when it fails.
- **`DATA_DIR` not writable:** AC4's fail-fast path, treated as a malformed variable.
- **Headless Chromium without a GPU:** the browser test launches Chromium with the software
  WebGL flags; if WebGL2 is still unavailable, the test fails with that message rather than
  passing vacuously.
- **Overlay key pressed while typing:** there is nothing to type on the screen page. B-04's
  control surface is a different page.
- **Node version drift:** `.nvmrc` plus `engines` in the root `package.json` so pnpm refuses
  to install on the wrong major.

## Verification

1. Fresh clone, Node 24 and pnpm installed. `bash scripts/setup.sh` exits 0 and prints the
   next command. Run it again: exits 0, nothing changed.
2. `bash scripts/check.sh`: all steps pass, in the order of AC2, no warning about missing
   project checks. Paste the output.
3. Delete `.env.local`'s `PORT` line, `pnpm start`: one JSON line naming `PORT`, exit code
   non-zero, no `data/` created. Restore the line.
4. `pnpm start`: logs show config loaded, `data/djvisuals.sqlite` created, `0001_init.sql`
   applied, listening on `127.0.0.1:8000`. `curl http://127.0.0.1:8000/api/health` returns
   `schemaVersion: 1`. Stop and start again: logs show no migration applied.
5. Open `http://localhost:8000/` in Chromium: a full-window colour that visibly drifts. Press
   `o`: overlay shows fps near the display refresh rate, frame time, `server: ok`. Press `o`:
   gone.
6. Stop the server with the page open; the overlay flips to `server: unreachable` within 5 s
   and the colour keeps drifting.
7. From a second terminal with the server running, `curl http://<LAN address>:8000/api/health`
   is refused.
8. Start a second `pnpm start`: one JSON line about the port, non-zero exit.
9. In an agent session, attempt to edit `server/migrations/0001_init.sql` after adding a
   `0002_x.sql`: the guard blocks it.
10. Push a branch: CI runs the same gate and is green.

## Exit condition

One Node process on `localhost` serves a WebGL2 screen page and a health endpoint over a
migrated SQLite file, with fail-fast config, JSON logs and an fps overlay, and
`bash scripts/check.sh` proves all of it locally and in CI.

## Open questions

- SDR: `web/src/engine/` → `engine/` (SD2) and `Status: Approved`, both the owner's edits
  before this spec is approved.
