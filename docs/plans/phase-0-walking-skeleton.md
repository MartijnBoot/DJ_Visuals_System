# Plan: 0 — Walking skeleton

Spec: [docs/specs/phase-0-walking-skeleton.md](../specs/phase-0-walking-skeleton.md) (`Status: Approved`) ·
Status: Audited

ADRs honoured: [0001 Setup Decision Record](../adr/0001-setup-decision-record.md) — TypeScript end
to end, framework-free renderer in `engine/`, one Node process on `localhost`, SQLite file plus
`assets/` folder, no auth, JSON logs plus overlay, nothing Azure. New dependencies: the ones the
spec names (SD4, SD5) plus seven companion packages the spec implies but does not name — listed
under PD1, an **Owner** row (answered at audit, 2026-11-11).

Line references are to `main` at `29d405e`. `CLAUDE.md`, `README.md`, the SDR and the spec are
cited from the uncommitted working copy of 2026-11-11 (see Human steps, H1).

## Approach

The skeleton is built bottom-up along the request path, and the gate grows with it: each task
that introduces a layer also wires that layer's step into `scripts/check.sh`, so the gate is
never ahead of the product and never behind it. Order: workspace and `shared/` schema (T1),
static checks, setup and CI (T2), a server that boots fail-fast on `127.0.0.1` (T3), SQLite and
migrations (T4), health (T5), the engine (T6), the screen page (T7), overlay and dev mode (T8),
static serving and start mode (T9), the browser check (T10), docs as built (T11). All tooling
lives in the root `package.json`; `engine/package.json` declares nothing, which is what makes
AC16 checkable.

The server runs its TypeScript directly on Node 24's built-in type stripping, and `shared/` and
`engine/` export their `src/index.ts`, so there is no server build step, no watch-compile chain
and no extra runner. Probed on this machine (Node v24.15.0): a `.ts` entry importing a
workspace package through a `node_modules` junction runs with no flag and no warning;
`node:sqlite` imports with no warning; `--env-file-if-exists` handles inline comments, lets the
process environment win over the file, and prints its "not found" notice on stderr; a child
spawned with an explicit `env` still listens on a socket on Windows. `pnpm dev`, `pnpm start` and
`pnpm migrate` are root scripts that start `node --env-file-if-exists=.env.local` from the
repository root, so `.env.local` and a relative `DATA_DIR` always resolve against the root.

Rejected:

- **tsx or a `tsc` build for the server.** tsx is a dependency the spec does not name; a `tsc`
  build needs `shared/` built before the server starts and a second watcher in dev.
- **Wiring all seven gate steps in one final task.** Ten tasks would be built with no project
  check in the gate.
- **A package manifest for all four packages in T1** (so the lockfile is written once and more
  tasks could run in parallel). It creates empty packages that type-check nothing; `/build` runs
  tasks one at a time anyway. Tasks are serialised on `pnpm-lock.yaml` instead.
- **Vite reading `PORT` for the dev proxy** (`loadEnv` or `process.env` in `vite.config.ts`).
  That is a second reader of the environment; see PD9.
- **Hand-written static file serving.** About 40 lines with a path-traversal surface, to avoid
  one maintained plugin; see PD1.

## Decisions this plan makes

Readings of the spec the planner had to choose. **Confirm** rows are for the audit to confirm or
overrule; **Owner** rows are user-visible choices the spec left open, and each one is a stop
(CLAUDE.md hard stops).

| # | Question | Decision | Reason |
|---|---|---|---|
| PD1 · **Owner** (approved 2026-11-11) | SD4 says one dependency (Fastify) covers static serving and logging, and SD5 names React and Vite. Seven packages are needed that the spec does not name. A new dependency is a hard stop. | Approve: `@fastify/static` (serves `web/dist`), `pino` as a *direct* dependency of `server/` (already installed through Fastify; pnpm does not expose transitive packages, and the AC4 line is written before a Fastify instance exists), `react-dom`, `@vitejs/plugin-react`, `@types/node` (server and root tests only, never `engine/`), `@types/react`, `@types/react-dom`; and, raised at audit, `@eslint/js` and `globals` (ESLint flat config companions, MIT, maintained by the ESLint team). | All MIT, all maintained by the Fastify, Vite, React or DefinitelyTyped teams. Standard library alternative for static serving is hand-written `fs` streaming (rejected above). If `pino` direct is refused, the boot-failure line is written with `JSON.stringify` in pino's shape; if `@fastify/static` is refused, T9 grows by a hand-written handler and its traversal tests. |
| PD2 · **Owner** (decided 2026-11-11: as proposed) | AC12 allows the overlay's server line two values, `ok` and `unreachable`. The first health request starts when the overlay is shown; what does the line read until it settles? | `server: …` until the first response, then `ok` or `unreachable`. The request is sent immediately on show, then every 5 s. | The alternative inside AC12's words is to start at `unreachable`, which flashes a false alarm on every open. Two readings, different visible behaviour: the owner's call. |
| PD3 · Confirm | How does the server run TypeScript? | Node 24 native type stripping; `shared/` and `engine/` export `./src/index.ts`. Root `tsconfig.json` sets `erasableSyntaxOnly`, `verbatimModuleSyntax`, `allowImportingTsExtensions`, `noEmit`; relative imports carry `.ts`. | No dependency, no build chain; probed (Approach). |
| PD4 · Confirm | Where does the environment come from in the three run scripts? | `node --env-file-if-exists=.env.local`, started from the repository root. The process environment wins over the file. | Built in; keeps `process.env` reads inside `server/src/config.ts`. The "not found" notice goes to stderr, so AC14's stdout stays JSON. |
| PD5 · Confirm | Which values are valid (SD6, AC4)? | `APP_ENV`: `development`, `test`, `production`. `LOG_LEVEL`: `debug`, `info`, `warn`, `error`. `PORT`: integer 1 to 65535. `DATA_DIR`: non-empty path. | The first two are the existing contract at `.env.example:11-12`. |
| PD6 · Confirm | AC4 with several bad variables; and where is "`DATA_DIR` not writable" detected? | One `fatal` JSON line naming every bad variable with its reason, never a value. The schema in `config.ts` stays pure; the ensure-directory step right after it reports a directory it cannot create or write as `DATA_DIR` in the same format, before the database is opened. | "One line" (AC4) and "treated as a malformed variable" (spec edge cases) both hold. |
| PD7 · Confirm | "Never log the environment" against Verification step 4, which expects the database path and port in the logs. | Never log `process.env` or the config object whole. Individual non-secret facts (database path, port, migration name) are logged. An integration test asserts no log line carries a key from the inherited environment. | The only reading under which Verification 4 can pass. |
| PD8 · Confirm | What is "the database file is locked by another process" (AC7)? Probed: with WAL, a second process can open, set the pragma and read while another holds a write lock; only `BEGIN IMMEDIATE` fails (`errcode 5`, "database is locked"). | The runner takes `BEGIN IMMEDIATE` on every boot, also when nothing is pending, with the driver's busy timeout at 0. A held write lock therefore fails boot at once with one line. | Otherwise a fully migrated database boots happily beside a process that holds the lock, and AC7 is untestable. |
| PD9 · Confirm | How does the Vite dev server learn the server's port (AC18) without reading the environment (AC15)? | `pnpm dev` runs a root script, `scripts/dev.ts`, that calls `loadConfig()` from `server/src/config.ts`, starts the server under `node --watch`, and starts Vite through its JavaScript API with `/api` proxied to `http://127.0.0.1:<PORT>`. The dev page is on Vite's default port, 5173, strict. | One reader of the environment; `web/` imports nothing from `server/`. |
| PD10 · Confirm | `pnpm dev` runs the server before any `web/dist` exists. What does the server do without a build? | `scripts/dev.ts` passes `--api-only`. Without that flag a missing `web/dist/index.html` is a boot failure: one line, non-zero exit. | `pnpm start` can never come up serving 404 for `/`. A command-line flag is not the environment. |
| PD11 · Confirm | How are unit and integration tests told apart (SD9 has two gate steps)? | Vitest projects `unit` (`*.test.ts`, including `tests/meta/`) and `integration` (`*.int.test.ts`). Gate commands: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test --project unit`, `pnpm test --project integration`, `pnpm test:browser`. | One root `test` script, as the spec lists. If the installed Vitest has retired the workspace file, the projects live in the root `vitest.config.ts`. |
| PD12 · Confirm | What does Prettier cover? | Source, config and test files. `.prettierignore` excludes `*.md`, `docs/`, `.claude/`, `pnpm-lock.yaml`, `web/dist`. | Otherwise T2 reformats 2,300 lines of `docs/way-of-working.md` and every workflow file, and the diff is unreviewable. `.editorconfig` already governs Markdown. |
| PD13 · Confirm | AC16: "the engine's compiled output contains an import". | No bare module specifier, static or dynamic, in the compiler's output for any non-test file under `engine/src`; relative imports inside the package are allowed. The test also fails on `devDependencies` or `peerDependencies` in `engine/package.json`. | A multi-file engine imports itself. Stricter than AC16 on the manifest, cheaper than arguing later. |
| PD14 · Confirm | AC19 in an automated test on a machine that may have no LAN address. | Assert the listening address is exactly `127.0.0.1`, and that a connection to every non-internal IPv4 address of the machine is refused. Zero such addresses does not fail the test; H3 repeats it by hand. | CI runners and laptops differ; the address assertion never passes vacuously. |
| PD15 · Confirm | How fast is "slowly drifting" (SD8), given AC11 needs two reads 500 ms apart to differ? | One full hue cycle per 60 s, computed from the frame timestamp. | About 3° of hue per 500 ms: several 8-bit steps, visible in a test, calm to the eye. |
| PD16 · Confirm | pnpm version for `packageManager` (SD15). | `pnpm@9.15.9`, `engines.node` `>=24 <25`, `.nvmrc` `24`. | 9.15.9 is what is installed on the screen machine; pnpm 10 changes dependency build-script defaults, which is a change to make on purpose. |
| PD17 · Confirm | "Guarded areas filled" (spec, In scope): which paths? | Three cross-phase rows are made true or added (config boundary, engine boundary, loopback-only bind); the guarded-areas example row at `docs/invariants.md:36` is deleted and `.claude/agents/invariant-guardian.md` is left untouched. | `docs/invariants.md:38-39` offers exactly this when nothing qualifies. The skeleton holds nothing a person made (spec, Data). Alternative for the audit: guard `server/src/migrate.ts` and `server/src/db.ts` now, which also means filling in the guardian agent's contract, outside this spec. |
| PD18 · Confirm | How is AC2's step order proven other than by reading the output? | A workflow test parses `scripts/check.sh` and asserts the `project_step` names are exactly `format`, `lint`, `types`, `build`, `unit`, `integration`, `browser`, in that order. | A reordered or dropped step turns the gate red. |
| PD19 · Confirm | Migration files the runner does not recognise. | Only `*.sql` is considered. A `.sql` file not named `NNNN_<slug>.sql`, or two files with the same number, fails boot naming the file. `schemaVersion` is the number of the highest recorded name, 0 when none. | The spec fixes the name format (Data); silently skipping a misnamed migration is the expensive failure. |

## Files

| Path | Create/Modify | Purpose |
|---|---|---|
| `pnpm-workspace.yaml` | Create | The four packages (T1) |
| `package.json` | Create, then Modify | Root scripts, `packageManager`, `engines`, all tooling (T1, T2, T4, T7, T8, T9, T10) |
| `pnpm-lock.yaml` | Create, then Modify | Generated; never hand-edited (T1, T2, T3, T5, T6, T7, T9, T10) |
| `.nvmrc` | Create | `24` (T1) |
| `tsconfig.json` | Create | Base compiler options, strict (T1) |
| `vitest.config.ts` | Create | Projects `unit` and `integration` (T1) |
| `.gitignore` | Modify | `data/`, Playwright output (T1) |
| `shared/package.json`, `shared/tsconfig.json`, `shared/src/index.ts` | Create | `healthResponseSchema` and its type (T1) |
| `.prettierrc.json`, `.prettierignore`, `eslint.config.js` | Create | Format and lint, `process.env` rule (T2) |
| `tests/tsconfig.json`, `tests/meta/config-boundary.test.ts` | Create | AC15 proof (T2) |
| `scripts/setup.sh` | Modify | Project section at `:39-45` (T2, T10) |
| `scripts/check.sh` | Modify | Project steps at `:66-88` (T2, T3, T7, T10) |
| `.github/workflows/ci.yml` | Modify | Toolchain at `:41-52` (T2, T10) |
| `server/package.json`, `server/tsconfig.json` | Create, then Modify | Server package (T3, T5, T9) |
| `server/src/config.ts` | Create | The one reader of `process.env` (T3) |
| `server/src/log.ts` | Create | Boot logger and the one-line fatal exit (T3) |
| `server/src/app.ts` | Create, then Modify | Fastify instance, routes, static (T3, T5, T9) |
| `server/src/boot.ts` | Create, then Modify | Boot sequence with injectable paths (T3, T4, T5, T9) |
| `server/src/main.ts` | Create, then Modify | Entry: real paths into `boot.ts` (T3, T9) |
| `.env.example` | Modify | Rewritten to SD6; `:15-20` removed (T3) |
| `server/src/db.ts`, `server/src/migrate.ts`, `server/src/migrate-cli.ts` | Create | Driver wrapper, runner, `pnpm migrate` entry (T4) |
| `server/migrations/0001_init.sql` | Create | SD11 (T4) |
| `.claude/guard-paths.json` | Modify | `append_only` at `:10` (T4) |
| `tests/workflow/test_guard_paths.py` | Modify | AC17 proof against the real configuration (T4) |
| `server/src/health.ts` | Create | `GET /api/health` (T5) |
| `engine/package.json`, `engine/tsconfig.json`, `engine/src/index.ts`, `engine/src/stats.ts`, `engine/src/colour.ts` | Create | The renderer (T6) |
| `tests/meta/engine-boundary.test.ts` | Create | AC16 proof (T6) |
| `web/package.json`, `web/tsconfig.json`, `web/vite.config.ts`, `web/index.html`, `web/src/main.tsx`, `web/src/Screen.tsx` | Create | The screen page (T7) |
| `web/src/Overlay.tsx`, `web/src/health.ts` | Create | Overlay and health client (T8) |
| `scripts/dev.ts` | Create, then Modify | `pnpm dev` (T8, T9) |
| `playwright.config.ts`, `tests/browser/screen.spec.ts` | Create | The browser check (T10) |
| `tests/workflow/test_gate_steps.py` | Create | AC2 order proof (T10) |
| `CLAUDE.md`, `docs/invariants.md`, `docs/design/architecture.md`, `README.md` | Modify | As-built docs (T11) |
| Test files beside the code (`*.test.ts`, `*.int.test.ts`, `server/test/`) | Create | Named per task |

Existing tests and texts this change makes untrue:

- `README.md:40-41` ("green on the workflow checks, with a warning that no project checks are
  wired yet") — untrue after T2; corrected in T11.
- `.claude/commands/verify.md:13` mentions the same warning conditionally; it stays true and is
  not edited.
- No test in `tests/workflow/` asserts the warning or an empty `append_only`
  (`test_guard_paths.py:162-164` asserts only `.git/*`), so no existing test changes meaning.

## Tasks

Each task is one vertical slice that leaves the system working, reviewable in one sitting:
about ≤400 changed source lines (tests do not count) across ≤10 files.

### T1 — Workspace, TypeScript, Vitest and the shared health schema
- **Implements:** AC1 and AC9 (groundwork: the install that AC1 runs and the schema AC9 validates against), SD2, SD5, SD12, SD15
- **Expected output:** `pnpm install --frozen-lockfile` works from a clean clone on Node 24 and
  refuses on another major. Root `package.json` has `typecheck` and `test` scripts,
  `packageManager` and `engines` per PD16, and TypeScript, Vitest and zod installed.
  `shared/src/index.ts` exports `healthResponseSchema` (`status` literal `"ok"`, `schemaVersion`
  and `uptimeSeconds` non-negative integers) and the inferred `HealthResponse` type;
  `shared/src/index.test.ts` proves it accepts the spec's example body and rejects a missing
  field, a wrong status and a non-integer version. `.gitignore` ignores `data/`, `test-results/`
  and `playwright-report/`. About 90 source lines, 10 files.
- **Verification:** `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test --project unit`
- **Depends on:** —
- **Autonomy note:** Builder settles package names (suggested `@djv/shared` and so on), tsconfig
  layout, and exact versions (latest stable that are mutually compatible; see Risks on
  TypeScript 7). Stop and ask if pnpm does not refuse the wrong Node major without a further
  setting, or if any package beyond PD1 and SD4/SD5 is needed. Audit note: the root
  `typecheck` and `test` scripts must cover every workspace package without naming them, so a
  later package (T6's `engine/`) is picked up without editing the root `package.json`.

### T2 — Format, lint with the config boundary, setup, gate and CI
- **Implements:** AC1, AC2, AC15
- **Expected output:** `pnpm format`, `pnpm format:check` and `pnpm lint` exist (Prettier scope
  per PD12; ESLint flat config with typescript-eslint). `no-restricted-properties` fails any
  `process.env` access outside `server/src/config.ts`. `tests/meta/config-boundary.test.ts`
  proves it twice: ESLint run on a snippet reports the rule for `server/src/other.ts` and not
  for `server/src/config.ts`, and a scan of every tracked `.ts`, `.tsx` and `.js` file finds the
  text `process.env` nowhere else. `scripts/setup.sh:39-45` becomes: require `node` and `pnpm`,
  `pnpm install --frozen-lockfile`. `scripts/check.sh:66-88` becomes four `project_step` lines
  named `format`, `lint`, `types`, `unit`; the warning at `:92-95` no longer prints.
  `.github/workflows/ci.yml:41-52` becomes pnpm setup, Node from `.nvmrc` with the pnpm cache,
  and the frozen install. About 110 source lines, 9 files.
- **Verification:** `bash scripts/setup.sh && bash scripts/setup.sh && bash scripts/check.sh`
  (second setup run changes nothing: `git status --short` is identical before and after)
- **Depends on:** T1
- **Autonomy note:** Builder settles rule sets beyond the one named rule and the test's
  structure. The existing `step` and `project_step` functions at `scripts/check.sh:41-55` are
  reused unchanged. Stop if a lint plugin beyond typescript-eslint seems needed, or if Prettier
  wants to rewrite a file outside PD12's scope.

### T3 — The server boots fail-fast on 127.0.0.1 with JSON logs
- **Implements:** AC3, AC4, AC7, AC14, AC19, SD4, SD6, SD17
- **Expected output:** `node --env-file-if-exists=.env.local server/src/main.ts` validates the
  four variables (PD5), creates `DATA_DIR` and `DATA_DIR/assets/`, and listens on
  `127.0.0.1:PORT` with pino JSON logs at `LOG_LEVEL` and Fastify's request id on every request
  line. `loadConfig(env)` in `server/src/config.ts` is pure and is the only reader of
  `process.env`. `boot.ts` takes its paths as arguments so tests can inject them; `main.ts` only
  supplies the real ones. Every boot failure goes through one function in `log.ts`: one `fatal`
  JSON line, exit code 1, nothing listening. `.env.example` lists exactly `APP_ENV`,
  `LOG_LEVEL`, `PORT=8000`, `DATA_DIR=./data`. `scripts/check.sh` gains the `integration` step.
  Tests: `server/src/config.test.ts` (each variable missing, each malformed, several at once,
  all valid); `server/test/boot.int.test.ts` spawning the real entry through
  `server/test/spawn-server.ts` — boots and creates both directories; exits non-zero with one
  line naming the variable and no directory created (PD6); `DATA_DIR` under an existing file is
  reported as `DATA_DIR`; a second instance on the same port exits non-zero with one line; every
  stdout line parses as JSON, `debug` lines are absent at `info`, and both lines of a request
  carry the same `reqId`; no line carries an inherited environment key (PD7); listening address
  per PD14. About 230 source lines, 10 files.
- **Verification:** `pnpm test --project unit server/src/config.test.ts && pnpm test --project integration server/test/boot.int.test.ts`
- **Depends on:** T2
- **Autonomy note:** Builder settles module internals, log message wording and how the test
  finds a free port. The spawn helper passes an explicit `env` and never reads `process.env`
  (probed: works on Windows). Stop and ask if a fifth variable or a default in code seems
  needed, or if PD1's `pino` answer is no (then use the stated fallback).

### T4 — SQLite, the migration runner, `pnpm migrate` and the guard
- **Implements:** AC3, AC5, AC6, AC7, AC8, AC17, SD3, SD7, SD11, SD16
- **Expected output:** `server/src/db.ts` is the only file importing `node:sqlite`; it opens
  `DATA_DIR/djvisuals.sqlite` with WAL and foreign keys on. `migrate(db, dir, log)` in
  `server/src/migrate.ts` creates `schema_migrations`, takes `BEGIN IMMEDIATE` (PD8), applies
  each pending `NNNN_<slug>.sql` in name order in its own transaction together with its
  `schema_migrations` row, logs each applied name, and throws naming the file on failure after
  rolling that file back (PD19 for misnamed files). `boot.ts` runs it between ensure-directory
  and listen. `pnpm migrate` runs `server/src/migrate-cli.ts`: same config, same runner, no
  listening. `server/migrations/0001_init.sql` is the spec's SQL verbatim.
  `.claude/guard-paths.json` has `"append_only": ["server/migrations"]`. Tests:
  `server/src/migrate.test.ts` on an in-memory database (order, own transaction, rollback leaves
  no table and no row, already-recorded files skipped, misnamed file);
  `server/test/migrate.int.test.ts` (first boot applies `0001_init.sql` and `app_meta` holds
  `schema_created_at`; second boot applies none; a fixture entry booting with a temporary
  migrations folder whose second file is broken exits non-zero with one line naming it, the
  first stays recorded, nothing listens; a child holding a write lock makes boot exit non-zero
  with one line; `pnpm migrate` does the same three things and never listens);
  `tests/workflow/test_guard_paths.py` gains a case that plants the real configuration's
  `append_only` value and asserts `0001_init.sql` is blocked once `0002_x.sql` exists and
  editable before. About 220 source lines, 7 files.
- **Verification:** `pnpm test --project unit server/src/migrate.test.ts && pnpm test --project integration server/test/migrate.int.test.ts && python -m unittest tests/workflow/test_guard_paths.py`
- **Depends on:** T3
- **Autonomy note:** Builder settles the wrapper's shape, the fixture entry and SQL splitting
  (the driver's `exec` runs a whole file). The SQL in the spec's Data section is not to be
  changed. Stop and ask if `node:sqlite` cannot give one transaction per file, or if a missing
  file for a recorded migration needs a rule (Risks).

### T5 — The health endpoint through the shared schema
- **Implements:** AC9, AC14, SD12
- **Expected output:** `GET /api/health` returns 200 with a body built through
  `healthResponseSchema` from `shared/`: `status` `"ok"`, `schemaVersion` per PD19,
  `uptimeSeconds` whole seconds since listen. `server/package.json` depends on the shared
  package by workspace reference. Unknown `/api/*` paths return 404. Test
  `server/test/health.int.test.ts`: against a booted server the body parses with the shared
  schema and `schemaVersion` is 1; with a second temporary migration it is 2; the request's log
  lines carry one `reqId`. About 50 source lines, 5 files.
- **Verification:** `pnpm test --project integration server/test/health.int.test.ts`
- **Depends on:** T4
- **Autonomy note:** Builder settles the route module's shape. Stop if the response needs any
  field the spec's contract does not list.

### T6 — The engine: drifting clear colour and frame statistics
- **Implements:** AC11, AC16, SD2, SD8
- **Expected output:** `engine/src/index.ts` exports `createEngine(canvas)` returning
  `{ start(), stop(), stats() }`; it throws a named error when no WebGL2 context is available.
  Each animation frame clears to `driftColour(timestamp)` (PD15) and records the frame.
  `stats()` returns `{ fps, frameTimeMs, lastFrameAt }` as a rolling average over the last
  second. The maths lives in `stats.ts` and `colour.ts` as pure functions of timestamps.
  `engine/package.json` has no dependency fields at all; `engine/tsconfig.json` has the DOM
  library and no Node types. Tests: `engine/src/stats.test.ts` (steady 60 Hz reads 60 fps and
  16.7 ms; frames older than one second fall out; no frames reads zero);
  `engine/src/colour.test.ts` (two timestamps 500 ms apart differ by at least one 8-bit step in
  some channel; period 60 s); `tests/meta/engine-boundary.test.ts` (PD13), with a self-check
  that the detector does flag a sample containing a bare import. About 130 source lines, 5
  files.
- **Verification:** `pnpm test --project unit engine tests/meta/engine-boundary.test.ts && pnpm typecheck`
- **Depends on:** T3 (serialised after T3 only because both write pnpm-lock.yaml; shares no file with its group neighbour)
- **Autonomy note:** Builder settles internal structure and how the boundary test compiles the
  sources (compiler API or `tsc` to a temporary folder). Stop if anything needs a dependency in
  `engine/`, a shader, or a second WebGL call beyond clear. Audit note: T6 must not touch the
  root `package.json` (T4 writes it in the same group); if the root scripts do not pick up
  `engine/` on their own, that is a T1 defect to fix first.

### T7 — The screen page: a full-window canvas running the engine
- **Implements:** AC10, AC11, SD5
- **Expected output:** `web/` is a React and Vite app with one route, `/`. `Screen.tsx` mounts a
  canvas that fills the window with no chrome, creates the engine on mount, starts it, and stops
  it on unmount. If `createEngine` throws, the page shows one line of text in place of the
  canvas and logs to the console. Root `build` script runs the Vite build into `web/dist`;
  `scripts/check.sh` gains the `build` step between `types` and `unit`. About 120 source lines,
  9 files.
- **Verification:** `pnpm typecheck && pnpm lint && pnpm build && test -f web/dist/index.html`
- **Depends on:** T5, T6 (the health task only because both write pnpm-lock.yaml)
- **Autonomy note:** Builder settles component structure, styling approach and the wording of
  the WebGL2 message. The page's behaviour is proven in the browser in T10; no jsdom or
  component-test library is added. Stop if a router, a state library or a CSS framework seems
  needed.

### T8 — The overlay with server health, and dev mode
- **Implements:** AC12, AC13, AC18, SD10, SD13, SD14
- **Expected output:** Pressing `o` toggles a top-left monospace overlay, hidden on load, with
  `fps`, `frame ms` and `server: ok` or `server: unreachable` (PD2 for the first moment). Health
  is requested on show and every 5 s while shown, never while hidden. `web/src/health.ts`
  exports a function that fetches `/api/health`, parses with `healthResponseSchema`, and maps a
  network error, a non-200 or an invalid body to `unreachable`; the engine is never stopped by
  it. `pnpm dev` runs `scripts/dev.ts` (PD9): config validated, server in watch mode, Vite on
  port 5173 with hot reload and `/api` proxied. Test `web/src/health.test.ts` with an injected
  fetch: valid body gives `ok`; rejected fetch, status 500 and a body missing `schemaVersion`
  each give `unreachable`. About 150 source lines, 6 files.
- **Verification:** `pnpm test --project unit web/src/health.test.ts && pnpm typecheck`, then with
  `pnpm dev` running: `curl -s http://localhost:5173/api/health` returns the health JSON and
  `curl -s http://localhost:5173/` contains `/@vite/client`
- **Depends on:** T7
- **Autonomy note:** Builder settles the overlay's markup and the polling hook. Stop on PD2 if
  the owner has not answered it, and if Vite's JavaScript API cannot run from the root without
  moving a dependency.

### T9 — One process serves the built app: static serving and `pnpm start`
- **Implements:** AC10, SD10
- **Expected output:** The Fastify app serves a static folder given to it; `main.ts` passes
  `web/dist`, resolved from the server's own location. `/` returns the built `index.html`;
  unknown paths outside `/api` return 404. Without `--api-only`, a missing `index.html` fails
  boot with one line (PD10); `scripts/dev.ts` and the integration spawn helper pass the flag.
  Root `start` script is `pnpm build` followed by the server entry. Test
  `server/test/static.int.test.ts`: with a temporary folder holding an `index.html`, `/` returns
  it, `/nope` is 404, `/api/health` still answers, a `..` path does not escape the folder; with
  an empty folder and no flag, boot fails with one line. About 70 source lines, 7 files.
- **Verification:** `pnpm test --project integration server/test/static.int.test.ts`, then
  `pnpm start` and `curl -s http://127.0.0.1:8000/` returns the built page
- **Depends on:** T8
- **Autonomy note:** Builder settles plugin options. Stop if PD1's `@fastify/static` answer is
  no (the task then needs re-sizing), or if anything works under `pnpm dev` that does not under
  `pnpm start`.

### T10 — The browser check, in the gate, in setup and in CI
- **Implements:** AC1, AC2, AC10, AC11, AC12, AC13, SD9
- **Expected output:** `pnpm test:browser` runs Playwright, Chromium only, headless with the
  software-WebGL flags, against `pnpm start` on its own port and a temporary `DATA_DIR` passed
  through Playwright's `webServer.env`; it never reuses a running server and never targets
  Vite. `tests/browser/screen.spec.ts` proves: WebGL2 is available, else fail with that message;
  the canvas fills the viewport; two canvas reads 500 ms apart differ; the overlay is absent on
  load and no health request has been made; `o` shows it with `server: ok` and numeric fps and
  frame time; `o` hides it; with `/api/health` aborted, and again with an invalid body, it reads
  `server: unreachable` while the canvas keeps changing; with `getContext` stubbed to return
  null the one-line message shows. `scripts/setup.sh` adds
  `pnpm exec playwright install chromium`; CI adds the install with system dependencies;
  `scripts/check.sh` gains `browser` as the last step. `tests/workflow/test_gate_steps.py`
  asserts the seven names in order (PD18). About 60 source lines, 7 files.
- **Verification:** `pnpm test:browser && python -m unittest tests/workflow/test_gate_steps.py && bash scripts/check.sh`
  (paste the full gate output: seven project steps in the spec's order, no warning)
- **Depends on:** T9
- **Autonomy note:** Builder settles the test port, the flag set and how the canvas is read
  (screenshot comparison or pixel read). Waiting uses Playwright's polling assertions, not fixed
  sleeps, except the 500 ms the spec itself names. Stop if software WebGL2 cannot be made to
  work in headless Chromium on this machine, rather than skipping the assertion.

### T11 — Docs as built
- **Implements:** the spec's In scope Docs bullet (no AC tests the docs; audit accepted this
  as the one task with no criterion), SD2, SD7, SD10, SD16, SD18
- **Expected output:** `CLAUDE.md:24-29` names the seven gate steps, `pnpm dev`, `pnpm start`,
  `pnpm migrate` and how to add a migration; `:47-52` names `server/src/config.ts`, the meaning
  of `engine/`, `web/`, `server/`, `shared/`, `tests/meta/` and `tests/browser/`, and the
  quirks (erasable-only TypeScript with `.ts` import extensions, dev on 5173 against start on
  `PORT`, `--api-only`, the software-WebGL flags); `:60` names `pnpm-lock.yaml` and `web/dist`.
  `docs/invariants.md:22` names the real config module and its two enforcers; `:24` is now true;
  rows are added for the engine boundary and the loopback-only bind, each with the test that
  enforces it; `:36` per PD17. `docs/design/architecture.md:12-29` is filled as built:
  four-package text diagram, the modules table, data (SQLite file, migrations at boot and why
  that departs from way-of-working 5.6, per SD7), configuration, cross-cutting. `README.md`
  Setup names the two commands and the real requirements (`:19-20`), and `:40-41` no longer
  promises a warning. No source file changes.
- **Verification:** `bash scripts/check.sh`, and
  `grep -n '<' CLAUDE.md docs/design/architecture.md | grep -v 'phase-<id>\|<n>\|<slug>\|<plan>'`
  prints no placeholder
- **Depends on:** T10
- **Autonomy note:** Builder writes only what the code now does, with file references.
  `docs/design/` is an owner area: this task records the design the spec already approved. Stop
  if any sentence would state a decision that is not in the spec, the SDR or this plan. The
  interview probes and the product-wide out-of-scope list in `docs/invariants.md:41-56` are not
  touched.

## Task graph

| Group | Tasks | Files they touch |
|---|---|---|
| 1 | T1 | workspace root files, `.gitignore`, `shared/` |
| 2 | T2 | Prettier and ESLint config, `tests/tsconfig.json`, `tests/meta/config-boundary.test.ts`, `package.json`, `pnpm-lock.yaml`, `scripts/setup.sh`, `scripts/check.sh`, `ci.yml` |
| 3 | T3 | `server/` (package, tsconfig, `config.ts`, `log.ts`, `app.ts`, `boot.ts`, `main.ts`, tests), `.env.example`, `pnpm-lock.yaml`, `scripts/check.sh` |
| 4 | T4 | `server/src/db.ts`, `migrate.ts`, `migrate-cli.ts`, `boot.ts`, `server/migrations/`, `server/test/`, `package.json`, `.claude/guard-paths.json`, `tests/workflow/test_guard_paths.py` |
| 4 | T6 | `engine/`, `tests/meta/engine-boundary.test.ts`, `pnpm-lock.yaml` |
| 5 | T5 | `server/src/health.ts`, `app.ts`, `boot.ts`, `server/package.json`, `server/test/`, `pnpm-lock.yaml` |
| 6 | T7 | `web/`, `package.json`, `pnpm-lock.yaml`, `scripts/check.sh` |
| 7 | T8 | `web/src/Overlay.tsx`, `health.ts`, `Screen.tsx`, `scripts/dev.ts`, `package.json` |
| 8 | T9 | `server/src/app.ts`, `boot.ts`, `main.ts`, `server/package.json`, `server/test/`, `scripts/dev.ts`, `package.json`, `pnpm-lock.yaml` |
| 9 | T10 | `playwright.config.ts`, `tests/browser/`, `tests/workflow/test_gate_steps.py`, `package.json`, `pnpm-lock.yaml`, `scripts/setup.sh`, `scripts/check.sh`, `ci.yml` |
| 10 | T11 | `CLAUDE.md`, `docs/invariants.md`, `docs/design/architecture.md`, `README.md` |

No two tasks in one group write the same file. `python scripts/check_plans.py --graph <this
file>` prints the groups the `Depends on` fields actually give. Group 4 is the only parallel
group: T4 stays inside `server/`, the root `package.json`, the guard configuration and the
workflow test; T6 stays inside `engine/`, one new meta test and the lockfile.

## Data changes

As the spec's Data section, unchanged:

- `schema_migrations(name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`, created by the runner
  if absent (T4). `name` holds the file name, `applied_at` an ISO-8601 UTC timestamp.
- `server/migrations/0001_init.sql` creates `app_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)`
  and inserts `schema_created_at` (T4).
- `PRAGMA journal_mode = WAL` and `PRAGMA foreign_keys = ON` on every open.

No backfill, no expand/contract: the database does not exist before T4. Forward-only and
irreversible by the spec's design; the restore plan is to delete `DATA_DIR/djvisuals.sqlite`,
which holds nothing a person made. The audit checklist's "additive and reversible" is met as
"additive, and documented as irreversible with a restore plan" (way-of-working 5.6).

## Risks and unknowns

| Risk | Mitigation |
|---|---|
| The newest TypeScript on npm is 7.x; typescript-eslint or the compiler API used by the engine-boundary test may not support it yet. | T1 installs the newest TypeScript that typescript-eslint's peer range accepts. The boundary test may compile through the `tsc` command line instead of the API. |
| Native type stripping and `node:sqlite` are young Node features. Both ran clean on v24.15.0 here; a later 24.x could change a detail. | `.nvmrc` and `engines` pin the major (SD15); `db.ts` is the single wrapper (SD3). If type stripping fails for a reason the probe missed, the fallback (tsx) is a new dependency and an owner stop. |
| Headless Chromium without a GPU may not give WebGL2 on the CI runner, or the Chromium download may push the gate past three minutes. | Software-WebGL flags; the test fails loudly on no WebGL2 (spec edge case). Gate time is only measurable after the first push (H4); if it is over, cache the Playwright browser in CI as a follow-up. |
| Playwright's `webServer` may leave the Node child of `pnpm start` alive on Windows, holding the test port for the next run. | T10 verifies two consecutive `pnpm test:browser` runs. If it leaks, the builder stops and reports; the fix must still go through the `start` entry (SD10). |
| pnpm may only warn, not refuse, on a Node major outside `engines`. | T1 checks it; an `.npmrc` with `engine-strict=true` is the fix, and T1's autonomy note makes that a question first. |
| A database that records a migration whose file no longer exists (code older than data) has no rule in the spec. | Not handled in Phase 0: nothing a person made is in the file. Raise it in the B-02 spec, when profiles exist. |
| SD4's wording ("one dependency covers static serving") does not match Fastify, which needs `@fastify/static`. | PD1. Not a reason to reopen SD4. |
| `docs/adr/README.md:18` still lists ADR 0001 as `Draft` while the SDR itself says `Approved`. | Not in the spec's scope and not a task. H1 names it for the owner. |
| The plan's CLAUDE.md, README and SDR line references are to an uncommitted working copy. | H1 commits it before any task starts; `/build` needs a clean tree anyway. |
| T3 is the largest task (about 230 source lines, 10 files, eight criteria and decisions). | It is one slice: a process that boots or refuses to. If it passes 400 lines the builder stops (build rules) and the split is config-and-logging, then listen. |

## Human steps

- **H1 — before `/audit`.** Commit the working copy (`CLAUDE.md`, `README.md`, the SDR, the
  spec) and this plan on a branch. PD1 and PD2 answered at audit. Correct
  `docs/adr/README.md:18` to `Approved` (decided at audit).
- **H2 — after T3, on the screen machine.** `bash scripts/setup.sh` creates `.env.local` from
  the new `.env.example`. If a `.env.local` from before T3 exists, add `DATA_DIR=./data` to it.
- **H3 — after T10, on the screen machine: the spec's Verification steps 3 to 9 by hand.**
  These are the parts no test can see: the colour visibly drifts and fps is near the display's
  refresh rate (AC11, spec Non-functional); the overlay flips to `unreachable` within 5 s of
  stopping the server (AC13); `curl` to the LAN address is refused (AC19); `pnpm dev` hot-reloads
  an edit and shows `server: ok` (AC18, verified by hand only beyond T8's two `curl` checks);
  the guard blocks an edit to `0001_init.sql` in a live agent session once `0002_x.sql` exists
  (AC17). Paste what was seen into the review.
- **H4 — push and CI.** Push the branches and open the pull requests in order; confirm the
  `check` job is green and under three minutes (AC2 in CI, spec Verification step 10). Pushing
  is the owner's (CLAUDE.md hard stops).
- **H5 — after merge.** Protect `main` (`README.md:46-47`): pull request required, `check` and
  `secret-scan` required, no force-push.

## Out of scope for this plan

- Everything under the spec's "Out of scope", unchanged.
- The Azure-related Phase 0 exit criteria of way-of-working 3.4 (SD18).
- `docs/invariants.md` interview probes and product-wide out-of-scope list (`:41-56`), and the
  contract inside `.claude/agents/invariant-guardian.md`: the spec names only the cross-phase
  rows and guarded areas (PD17).
- `docs/adr/README.md` and the SDR: owner edits (H1).
- Component tests for `web/` under jsdom: the spec lists no web unit test beyond the schema
  boundary, and the browser check covers the page.
- Caching the Playwright browser in CI, and any second browser.

## Audit (PASS required before implementation starts)

- [x] Every AC maps to at least one task
- [x] Every task maps to at least one AC (no orphans)
- [x] Each task's expected output is concrete enough to check, and is what we actually need
- [x] Existing patterns reused; nothing reinvented
- [x] No new dependency without an approval note
- [x] Data changes additive and reversible
- [x] Errors, empty states and permissions are tasks, not afterthoughts
- [x] Each task reviewable in one sitting
- [x] Verification named per task
- [x] Nothing touches prod, secrets or infra it should not
- [x] Every task has a Depends on and an Autonomy note
- [x] No two tasks in one parallel group write the same file

Audited by: Martijn Boot  Date: 2026-11-11

Audit notes: AC17, AC18 and AC19 are automated only in part and are completed by H3. Data
changes are additive and documented as irreversible with a restore plan (Data changes). T11 is
the one task without an acceptance criterion, accepted because the spec puts the docs in scope.
