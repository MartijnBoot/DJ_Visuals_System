# Plan: b-08 — A gate that load cannot turn red

Spec: [docs/specs/phase-b-08-load-proof-gate.md](../specs/phase-b-08-load-proof-gate.md) (`Status: Approved`) ·
Status: Audited

ADRs honoured: [0001 Setup Decision Record](../adr/0001-setup-decision-record.md) — rendering
stays in the browser on the screen machine and the latency budget belongs to that machine
(constraints), which is where SD2 puts the 50 ms; the server still listens on `127.0.0.1` only
(the load's own server uses the same `boot`); the environment keeps one reader
(`server/src/config.ts`). Nothing in `docs/design/` changes: `architecture.md:109` (the compat
file makes the type check fail) and `:178` (the overlay's latency line) stay true as written.
The spec's edits to `docs/invariants.md` (SD6) are approved by the spec and made in T8. New
dependencies: none.

Line references are to `main` at `73aeb66` (`origin/main`; the local `main` branch is still at
`ebc2df2`, see H1). The spec and `docs/backlog.md` are cited from the uncommitted working copy
of 2026-11-14.

## Approach

The spec makes this a bug fix whose failing test is a reproduction (SD10), so the order is
fixed: build the load harness first, on a tree where nothing else has changed (T1); run it
three times and write down what went red (T2); only then change the checks (T3 to T6, four
tasks with no file in common, so they can run side by side); then run the harness three more
times and do the spec's drift and port demonstrations (T7); then write the docs as built (T8).
T2 is a stop point as well as evidence: if no run is red on a D-02 check the load is too weak
and nobody tunes it (SD10), and if a check outside D-02 goes red it is in scope (SD7) but this
plan does not yet say how to fix it, so the plan is amended and the amendment audited before
the build goes on.

Every fix replaces a wall-clock assertion with a property load cannot break. The compat tests
lose the case the `types` step already proves and keep the mutation cases with no time limit
(T3). The browser latency check keeps both looks and asserts only that samples exist and are
ordered (T4). The "newest audio in every frame" claim moves from a comment in `Screen.tsx` to
a unit test on a controlled frame clock, plus one engine test that the draw itself uses the
features set before the frame (T5). The harness reuses what exists instead of restating it:
the gate's Chromium flags and port move into one small module that both `playwright.config.ts`
and the harness import; the load's server is the server's own `boot()` called in-process with
a config object; the port probe is one function used by the harness (8124) and by `check.sh`
(8123).

Rejected:

- Planning the SD7 fixes now for checks that might go red (the 30 s limits in
  `tests/meta/config-boundary.test.ts:26`, the `expect` timeouts in `live.spec.ts`). Without
  the reproduction this is a guess, and a guess here means weakening checks that did not fail.
- Spawning the load's server as a child process. A child that outlives a crashed parent is the
  exact orphan this machine is known for; an in-process server cannot be left behind (PD2).
- Importing `playwright.config.ts` from the harness to read its flags. It creates a temporary
  directory and fixes port 8123 at import; a shared module has neither side effect (PD3).
- A global `testTimeout` in `vitest.config.ts`. It would lift the limit from every unit test;
  SD3 lifts it from the four mutation tests only (PD7).
- Keeping the 20 s sleep in the latency test. It existed so that start-up left the 10 s window
  before a millisecond bound was read; with no bound there is nothing to wait out (PD9).

## Decisions this plan makes

Readings of the spec the planner had to choose. **Confirm** rows are for the audit to confirm or
overrule; **Owner** rows are user-visible choices the spec left open, and each one is a stop
(CLAUDE.md hard stops).

| # | Question | Decision | Reason |
|---|---|---|---|
| PD1 · Confirm | In what order do the harness, the reproduction and the fixes land (SD10)? | T1 builds the harness and changes no check. T2 runs it three times on that tree. T3 to T6 start only after T2's evidence is in this file. | SD10: "before any fix". A harness built after the fixes cannot show the "before" half of AC1. |
| PD2 · Confirm | How does the load's server run (SD4, AC2, "passes the server's environment explicitly")? | In the harness's own process: `boot(loadConfig({ APP_ENV: "test", LOG_LEVEL: "warn", PORT: "8124", DATA_DIR: <temp> }), { migrationsDir, staticDir: web/dist })`, the call `server/src/main.ts:14-17` makes, with a literal object instead of the process environment. `scripts/dev.ts:9` already imports `config.ts` this way. | No child process exists to orphan, on a machine where orphaned `node` servers are the known failure. No `process.env` read, so the ESLint rule and `tests/meta/config-boundary.test.ts` hold. Fallback if the import cannot work: spawn `server/src/main.ts` with exactly those four variables, as `server/test/spawn-server.ts:35` does; that is a stop-and-report, not a silent switch. |
| PD3 · Confirm | Where do the gate's Chromium flags and port come from, for the harness (SD4 "the gate's WebGL and fake-device flags")? | A new module `tests/browser/fixtures/launch.ts` exports `GATE_PORT = 8123`, `LOAD_PORT = 8124`, `VIEWPORT` and `chromiumArgs(media)` (the seven flags at `playwright.config.ts:33-43`). `playwright.config.ts` imports them; its behaviour is unchanged. The harness imports the same. | One definition; the load cannot drift from the gate's flags. |
| PD4 · Confirm | What does the load page render (SD4 "a started set on the built app")? | The built-in look at 640×360 on the fake devices: `goto /`, press Start, panel closed (the steps of `tests/browser/helpers.ts:198-200`). Not the twelve-effect profile. | The spec says a started set and no more. Choosing a heavier look is tuning the load, which SD10 forbids. |
| PD5 · Owner (answered 2026-11-14) | A load dies during the run (Chromium crashes, a worker exits) and the gate still finishes green. AC2 says both "keep the loads for the whole gate run" and "exit with the gate's exit code". Which wins? | **Owner chose the recommendation:** the harness checks at the gate's end that the page is open, the browser connected and every worker alive. If not, it prints `load died: this run proves nothing` and exits 1 when the gate was green; a red gate keeps its own code. (Rejected alternative: always the gate's code, with the same line printed as a warning only.) | The spec's own edge case for a held 8124 says "a silently weaker load would make AC1 meaningless"; the same holds for a load that dies. The alternative follows AC2's last sentence to the letter and relies on a person reading the output. |
| PD6 · Confirm | What does Ctrl-C stop (AC2, edge case)? | The harness stops what it started: the workers, its Chromium, its server, its temporary directory, and it signals the gate child. It does not look for or kill the gate's own descendants. A gate interrupted mid-browser-step may leave its `pnpm start` on 8123, as it does today; T6's warning then names it. | The spec: "the gate never kills anything", and killing an orphan on 8123 is out of scope. AC2 names the load's processes. |
| PD7 · Confirm | "No per-test time limit" on the mutation tests (SD3, AC6): how? | `describe(..., { timeout: 0 }, ...)` on the one `describe` in each compat test file. `vitest.config.ts` is not changed. | Scoped to the four tests SD3 names. The builder proves `0` means "none" in the installed vitest (5.1.0) before relying on it. |
| PD8 · Confirm | How does the AC7 test read the file list without compiling? | `ts.parseJsonConfigFileContent(...).fileNames` for `web/tsconfig.json`: the parsed config resolves `include` against the disk and type-checks nothing. The config read at `tests/meta/compat-check.ts:32-34` moves into an exported `webConfig()` that both the helper and the new test use. The test also parses a planted config whose `include` leaves `src` out and sees both files missing, so it cannot agree vacuously. | AC7's words. One config reader. |
| PD9 · Confirm | Does the latency test still wait 20 s (`live.spec.ts:288`)? | No. It waits, with a web-first assertion, until the overlay's latency line holds three numbers, then reads the line once and asserts on that one reading. The wait has no limit of its own shorter than the test's. | The 20 s existed for the millisecond bound (owner's decision 2026-11-11). Without a bound it is 40 s of gate time and, under load, 20 s out of a 30 s test limit. The remaining wait is a liveness wait: it asserts that samples appear, which is AC3. |
| PD10 · Confirm | Where does the "read before draw" wiring go so it can be tested (AC4)? | `web/src/frame-feed.ts` exports `startFrameFeed(engine, read)`: it registers the feed callback, then calls `engine.start()`, and returns a stop function. `Screen.tsx:97-103` and `:105` call it. The function owns the order, so the test covers the order the product runs. Behaviour is unchanged. | The spec allows moving the wiring. Leaving `engine.start()` in `Screen.tsx` would leave the order itself untested. |
| PD11 · Confirm | The spec asks the planner to confirm that `engine/src/index.test.ts:134` proves "the engine draws with the features set before the frame" (SD1, AC5). | It does not, fully. `:132-140` proves the frame's latency sample is paired with the features set before it. No test reads a draw uniform after `setFeatures`. T5 adds one: set `beat: 1`, run a frame, the frame's `uFlash` is above zero; set zero features, the next frame's is zero. The audio half (`audio/src/source.test.ts:97`) does prove "newest window" and is kept as it is. | AC5 says "existing or new". The helper `uniform(frame, name)` at `index.test.ts:103` already reads a frame's uniforms. |
| PD12 · Confirm | How does `check.sh` test whether 8123 can be bound (SD5, AC8)? | `scripts/port-check.ts` exports `canBind(port)` (Node `net`, `127.0.0.1`) and, run as a script, exits 0 or 1. `check.sh` calls it through a plain function before the `browser` line. The call is not a `project_step`, so the step list and numbering are unchanged (AC9). A failure of the probe itself counts as "cannot tell" and prints nothing. The warning goes to stderr and names: port 8123; the likely cause (an orphaned `node` from a stopped `pnpm start` or a crashed Playwright run); how to find it (`netstat -ano \| grep ':8123 '` on Windows, `lsof -i :8123` elsewhere). | Node is the one tool every gate machine has. The same function is the harness's 8124 check. |
| PD13 · Confirm | AC9's "no retry configured anywhere": proven once, or kept? | Kept, by a workflow test that reads `vitest.config.ts`, `playwright.config.ts`, the root `package.json` scripts and `scripts/check.sh` as text and fails on a `retry` or `retries` setting or flag other than 0. | A retry is the cheapest way to make a flake look fixed; the spec forbids it for good, not for this change only. Text, because importing `playwright.config.ts` creates a directory. |
| PD14 · Confirm | Where does the runbook line go, and does `CLAUDE.md` get one? | A short section "The gate under load" in `docs/runbooks/README.md` (what `pnpm check:load` does, when to run it, that it is not the gate). One line under Commands in `CLAUDE.md`. | The spec asks for "a line" in `docs/runbooks/`. `CLAUDE.md`'s command list is what every session reads; the spec does not name it, so the audit may strike it. |
| PD15 · Confirm | Where does the reproduction evidence go (SD10 "into the plan's evidence")? | The `## Evidence` section at the end of this file, written by T2 and T7: per run, the date, the commit, the exit code, the failing step and the failing lines; full outputs in the task's report. | The spec's words. |
| PD16 · Confirm | Does the harness build the web app first? | No. It needs `web/dist/index.html`; without it `boot()` already fails with "run pnpm build" (`server/src/boot.ts:73-75`), and the harness lets that message through and exits before starting the gate. | AC1 runs on a tree whose gate is green, so the build exists. No second way to build. |

## Files

| Path | Create/Modify | Purpose |
|---|---|---|
| `tests/browser/fixtures/launch.ts` | Create | The gate's port, the load's port, the viewport and the Chromium flags, in one place (PD3) |
| `playwright.config.ts` | Modify | Import the above; behaviour unchanged |
| `scripts/port-check.ts` | Create | `canBind(port)`; exits 0/1 as a script (PD12) |
| `scripts/port-check.test.ts` | Create | Unit test of `canBind` |
| `scripts/under-load.ts` | Create | `runUnderLoad(options)`: the workers, the server, the Chromium, the gate child, the teardown (SD4) |
| `scripts/check-under-load.ts` | Create | The entry `pnpm check:load` runs: `runUnderLoad` with port 8124 and `bash scripts/check.sh` |
| `package.json` | Modify | The `check:load` script |
| `tests/browser/under-load.spec.ts` | Create | AC2 against a stand-in gate |
| `tests/meta/compat-check.ts` | Modify | Export `webConfig()` (PD8) |
| `tests/meta/profile-compat.test.ts` | Modify | Remove the unmutated case; no time limit (SD3) |
| `tests/meta/features-compat.test.ts` | Modify | The same |
| `tests/meta/compat-coverage.test.ts` | Create | AC7 |
| `tests/browser/live.spec.ts` | Modify | The latency check per SD1 (`:1-4`, `:273-299`) |
| `web/src/frame-feed.ts` | Create | `startFrameFeed` (PD10) |
| `web/src/frame-feed.test.ts` | Create | AC4 |
| `web/src/Screen.tsx` | Modify | Call `startFrameFeed` (`:97-105`) |
| `engine/src/index.test.ts` | Modify | One new test: the draw uses the features set before the frame (PD11) |
| `scripts/check.sh` | Modify | The port warning before the browser step (SD5) |
| `tests/workflow/test_gate_shape.py` | Create | The warning's place and words; no retry anywhere (PD12, PD13) |
| `docs/invariants.md` | Modify | The two compat rows (SD6) |
| `docs/specs/defect-register.md` | Modify | D-02 fixed |
| `docs/plans/phase-b-01-live-visual-engine.md` | Modify | "superseded by B-08 SD1" at `:78` and `:102` (SD9) |
| `docs/specs/phase-b-01-live-visual-engine.md` | Modify | A pointer at `:278` (SD9) |
| `docs/runbooks/README.md` | Modify | "The gate under load" (PD14) |
| `CLAUDE.md` | Modify | One command line (PD14) |
| `docs/backlog.md` | Modify | B-08 built |
| `docs/plans/phase-b-08-load-proof-gate.md` | Modify | The Evidence section (T2, T7) |

Not changed: `vitest.config.ts`, `.github/workflows/`, `tests/workflow/test_gate_steps.py`,
anything in `engine/src/` or `audio/src/` except the one test file, `docs/design/`.

## Tasks

Each task is one vertical slice that leaves the system working, reviewable in one sitting:
about ≤400 changed source lines (tests do not count) across ≤10 files.

### T1 — The load harness: `pnpm check:load`
- **Implements:** AC2, SD4, SD8
- **Expected output:** No existing check changes in this task.
  `tests/browser/fixtures/launch.ts` exports `GATE_PORT`, `LOAD_PORT`, `VIEWPORT` and
  `chromiumArgs(media)`; `playwright.config.ts` uses them and the 91 existing browser tests pass
  unchanged, plus the new `tests/browser/under-load.spec.ts`. `scripts/port-check.ts` exports `canBind(port): Promise<boolean>`, proven by
  `scripts/port-check.test.ts` (false while a listener holds the port, true after it closes).
  `scripts/under-load.ts` exports `runUnderLoad({ port, gate })`, which in this order:
  (1) fails with a message naming the port if `canBind(port)` is false, before anything starts;
  (2) boots the server in-process on `port` with a temporary `DATA_DIR` (PD2, PD16);
  (3) starts ⌈`os.availableParallelism()` / 2⌉ `worker_threads` busy-loops at normal priority;
  (4) launches headless Chromium with `chromiumArgs` and the fake media written by
  `writeFakeMedia` into the temporary directory, opens the page, presses Start and sees the
  panel close (PD4);
  (5) prints one line stating the worker count and the port;
  (6) runs `gate` and waits for its exit code;
  (7) checks the page is open, the browser connected and every worker alive; if not, prints
  `load died: this run proves nothing` and, when the gate was green, makes the result 1 (PD5);
  (8) in a `finally`, and on SIGINT and SIGTERM, terminates the workers, closes the browser and
  the server and removes the temporary directory (PD6);
  (9) resolves with the exit code.
  `scripts/check-under-load.ts` calls it with `LOAD_PORT` and `bash scripts/check.sh` (stdio
  inherited) and exits with the result. The root `package.json` has
  `"check:load": "node scripts/check-under-load.ts"`. `scripts/check.sh` and
  `.github/workflows/` do not mention it (SD8).
  `tests/browser/under-load.spec.ts` runs `runUnderLoad` on a free port with a stand-in gate
  and proves: while the gate runs, `/api/health` on that port answers, the worker count is
  ⌈parallelism / 2⌉ and the load page's canvas is changing (`expectCanvasChanging`,
  `tests/browser/helpers.ts:218`); a worker terminated mid-run with a green stand-in gives 1
  and the `load died` line (PD5); the stand-in's exit code (3, then
  0) is what `runUnderLoad` returns; afterwards the port can be bound, every worker has
  exited and the browser is disconnected; a stand-in that throws still leaves the port
  bindable; a held port fails before the gate is called, with the port in the message.
- **Verification:** `pnpm run test --project unit scripts/port-check.test.ts`, then
  `pnpm exec playwright test tests/browser/under-load.spec.ts`, then `bash scripts/check.sh`
- **Depends on:** —
- **Autonomy note:** Builder settles names, the options' shape, how the stand-in gate is
  injected, how the workers' code is supplied and how the entry is told apart from an import.
  The test must not use port 8124 or 8123: the real harness may be holding them while the gate
  runs this test. No `process.env` in either script. Stop and report if: Playwright's runner
  or plain Node cannot import `server/src/boot.ts` or `@playwright/test`'s `chromium` (PD2's
  fallback is the owner's to pick); a new package would be needed; `bash` does not resolve to
  Git Bash from `pnpm` on this machine; the size passes about 400 source lines (then split the
  port probe and `launch.ts` into their own task first).

### T2 — Reproduce D-02 under load, before any fix
- **Implements:** SD10, SD7, AC1 (the "before" half)
- **Expected output:** On the Windows dev machine, on the tree as T1 left it, with
  `bash scripts/check.sh` green first: `pnpm check:load` run three times, nothing else changed
  between runs. This file's Evidence section holds, per run: date, commit, exit code, the
  failing step, the failing test and its lines; and one list of every check that went red in
  any run, each marked "D-02" or "other". After each run, `netstat -ano | grep -E ':(8123|8124) '`
  shows no listener; a leftover is recorded, cleared by hand and reported.
- **Verification:** `pnpm check:load` three times; the Evidence section shows at least one run
  red on `tests/meta/profile-compat.test.ts`, `tests/meta/features-compat.test.ts` or
  `tests/browser/live.spec.ts:274`
- **Depends on:** T1
- **Autonomy note:** Builder changes no source file and no check. Stop and report, with the
  three outputs, if: no run is red on a D-02 check (the load is too weak; do not strengthen
  it); a check outside D-02 goes red (it is in scope by SD7, but this plan must be amended
  with its property fix and the amendment audited before T3 to T6 start); the render-scale
  test (`live.spec.ts:395-430`) changes its verdict (the owner's question, never a redesign);
  the harness itself fails or leaves a process behind (that is a T1 defect: fix it there,
  test first, and start the three runs again).

### T3 — The compat tests stop timing the compiler
- **Implements:** AC6, AC7, SD3
- **Expected output:** `tests/meta/profile-compat.test.ts:12-14` and
  `tests/meta/features-compat.test.ts:12-14` ("type-checks against the real shapes") are gone,
  and each file's header says the unmutated case is the `types` step's. The four mutation
  tests are unchanged in what they assert and run under `{ timeout: 0 }` (PD7).
  `tests/meta/compat-check.ts` exports `webConfig()` and `compatDiagnostics` uses it.
  `tests/meta/compat-coverage.test.ts` asserts that `webConfig().fileNames` holds
  `web/src/profile-compat.ts` and `web/src/features-compat.ts`, and that a planted config
  without `src` holds neither (PD8); it creates no `ts.Program`.
- **Verification:** `pnpm run test --project unit tests/meta`, then `pnpm typecheck`
- **Depends on:** T2
- **Autonomy note:** Builder settles the test names and the shape of `webConfig()`. Before
  relying on it, prove that timeout `0` means "no limit" in vitest 5.1.0 (a throwaway test
  that outlives 5 s, not committed); if it does not, stop and report rather than write a large
  number. Do not touch `web/src/*-compat.ts`, `web/tsconfig.json` or `vitest.config.ts`.

### T4 — The browser latency check proves structure
- **Implements:** AC3, SD1
- **Expected output:** In `tests/browser/live.spec.ts:273-299`, for both entries of `LOOKS`:
  the overlay names the look (`:282-284`, kept); the test waits until `overlay-latency` holds
  three numbers (PD9), reads the line once, and asserts that last, p95 and worst are finite,
  that 0 ≤ last ≤ worst and that 0 ≤ p95 ≤ worst. No millisecond bound and no 20 s sleep
  remain. The line, the scale and the fps are still attached with `note`, as measurements. The
  test title and the file header (`:1-4`) say B-08 AC3 and no longer "at most 50 ms" or PD13.
- **Verification:** `pnpm exec playwright test tests/browser/live.spec.ts -g "latency"`
- **Depends on:** T2
- **Autonomy note:** Builder settles the title and the regular expression. The three numbers
  come from one read of the line, never from three reads. Do not touch the render-scale test
  (`:301` onward), the other tests in the file, `web/src/Overlay.tsx` or the engine. Stop if
  the line can show numbers that break the ordering on a quiet machine: that is a product
  defect to report, not a tolerance to add.

### T5 — The screen reads the features before the engine draws
- **Implements:** AC4, AC5
- **Expected output:** `web/src/frame-feed.ts` exports `startFrameFeed(engine, read)` (PD10);
  `web/src/Screen.tsx:97-105` calls it and its cleanup calls the returned stop; the comment at
  `:97-98` moves with the code. `web/src/frame-feed.test.ts` drives a frame clock that queues
  every `requestAnimationFrame` callback and runs each frame's callbacks in registration order
  (stubbed with `vi.stubGlobal` in the style of `engine/src/index.test.ts:109-117`, whose stub
  holds only one callback and so is not reused as is), with a stand-in engine whose frame callback records the features it
  holds when it draws. It proves, over several frames with a new window before each: the read
  comes before the draw in every frame; the draw of frame N holds the window that was newest
  at frame N. It fails when `engine.start()` is moved before the feed's registration, and when
  the read is deferred to the next frame; both are shown once by hand and reverted, with the
  failing output in the task report.
  `engine/src/index.test.ts` gains the test in PD11. `audio/src/source.test.ts:97` is cited,
  not changed.
- **Verification:** `pnpm run test --project unit web/src/frame-feed.test.ts engine/src/index.test.ts audio/src/source.test.ts`,
  then `pnpm exec playwright test tests/browser/live.spec.ts tests/browser/screen.spec.ts`
- **Depends on:** T2
- **Autonomy note:** Builder settles the function's signature and the stand-in engine. The
  product's behaviour must not change: same callbacks, same order, same cleanup. No new engine
  method, counter or export for the test (spec, Out of scope). Stop if the test cannot be made
  to fail on a swapped order without changing `engine/` source.

### T6 — `check.sh` says why the browser step will fail
- **Implements:** AC8, AC9, SD5
- **Expected output:** `scripts/check.sh` has a function, called once immediately before
  `project_step "browser"` (`:75`), that runs `scripts/port-check.ts` for 8123 and, when the
  port cannot be bound, prints the warning in PD12 to stderr and returns 0. The seven
  `project_step` lines are byte-for-byte as before. `tests/workflow/test_gate_shape.py`
  proves: the call sits between the `integration` and `browser` lines; the warning text holds
  `8123`, `node`, `pnpm start` and a command to find the process; the port in `check.sh` equals
  `GATE_PORT` in `tests/browser/fixtures/launch.ts`; no retry is configured anywhere (PD13);
  each parser sees a planted violation. `tests/workflow/test_gate_steps.py` passes unchanged.
- **Verification:** `python -m unittest discover -s tests/workflow -p "test_*.py"`, then
  `bash scripts/check.sh`
- **Depends on:** T2
- **Autonomy note:** Builder settles the function's name and the warning's wording within
  PD12. The gate must never refuse, kill or wait because of the port. No change to
  `playwright.config.ts`'s `reuseExistingServer`. Stop if the probe cannot be made to work
  from Git Bash on Windows and from `ubuntu-latest` with the same line.

### T7 — Prove it: three green runs under load, drift, the held port
- **Implements:** AC1, AC2, AC6, AC8
- **Expected output:** With T3 to T6 merged into one tree, on the Windows dev machine, in this
  file's Evidence section:
  (a) `bash scripts/check.sh` green, output pasted in the report;
  (b) `pnpm check:load` three times in a row, all exit 0, and after each one no listener on
  8123 or 8124 and no headless Chromium process;
  (c) `amount` renamed in `engine/src/profile.ts`: `pnpm typecheck` fails and the
  `profile-compat` mutation tests fail; reverted. `level` renamed in `audio/src/features.ts`:
  the same for `features-compat`; reverted; `git status` clean;
  (d) a server held on 8123, then `bash scripts/check.sh`: the warning appears before the
  browser step, the browser step then fails as it does today; the server is stopped and the
  port is free.
- **Verification:** `bash scripts/check.sh`, then `pnpm check:load` three times, then the two
  renames with `pnpm typecheck` and `pnpm run test --project unit tests/meta`, then
  `bash scripts/check.sh` with 8123 held
- **Depends on:** T3, T4, T5, T6
- **Autonomy note:** Builder changes no source file; the renames are temporary and reverted.
  The three runs are consecutive: a red run is not re-run to get three greens. Stop and report
  with the output if any run is red (SD7: a new check gets a plan amendment and an audit; the
  render-scale test is the owner's question), or if a process is left behind. For (d), start
  the server with an explicit `DATA_DIR` in a scratch folder and do not read or edit
  `.env.local`.

### T8 — Docs as built
- **Implements:** AC10, SD6, SD9
- **Expected output:** `docs/invariants.md:28-29`: "Enforced by" in the `AudioFeatures` and
  `Profile` rows names the `types` step (`pnpm typecheck`), `tests/meta/compat-coverage.test.ts`
  and that file's mutation tests; the "Invariant" cells are unchanged. D-02 in
  `docs/specs/defect-register.md:15` reads fixed, citing this spec and T7's evidence.
  `docs/plans/phase-b-01-live-visual-engine.md:78` and `:102` carry "superseded by B-08 SD1";
  `docs/specs/phase-b-01-live-visual-engine.md:278` carries a pointer to this spec; no
  acceptance criterion of B-01 or B-02 changes. `docs/runbooks/README.md` and `CLAUDE.md` per
  PD14. `docs/backlog.md`: B-08 built. No source file changes.
- **Verification:** `bash scripts/check.sh`, and
  `grep -n "B-08" docs/invariants.md docs/specs/defect-register.md docs/plans/phase-b-01-live-visual-engine.md docs/specs/phase-b-01-live-visual-engine.md`
  prints a line from each file
- **Depends on:** T7
- **Autonomy note:** Builder writes only what the code now does, with file references. The
  invariant rows and the B-01 documents are owner areas: the spec approved these edits and
  nothing beyond them. Stop if any sentence would state a decision not in the spec or this
  plan, or if `docs/design/` would need a change.

## Task graph

| Group | Tasks | Files they touch |
|---|---|---|
| 1 | T1 | `tests/browser/fixtures/launch.ts`, `playwright.config.ts`, `scripts/port-check.ts`, `scripts/port-check.test.ts`, `scripts/under-load.ts`, `scripts/check-under-load.ts`, `package.json`, `tests/browser/under-load.spec.ts` |
| 2 | T2 | this plan (Evidence) |
| 3 | T3 | `tests/meta/compat-check.ts`, `profile-compat.test.ts`, `features-compat.test.ts`, `compat-coverage.test.ts` |
| 3 | T4 | `tests/browser/live.spec.ts` |
| 3 | T5 | `web/src/frame-feed.ts`, `frame-feed.test.ts`, `web/src/Screen.tsx`, `engine/src/index.test.ts` |
| 3 | T6 | `scripts/check.sh`, `tests/workflow/test_gate_shape.py` |
| 4 | T7 | this plan (Evidence) |
| 5 | T8 | `docs/invariants.md`, `docs/specs/defect-register.md`, `docs/plans/phase-b-01-live-visual-engine.md`, `docs/specs/phase-b-01-live-visual-engine.md`, `docs/runbooks/README.md`, `CLAUDE.md`, `docs/backlog.md` |

No two tasks in one group write the same file. `python scripts/check_plans.py --graph <this
file>` prints the groups the `Depends on` fields actually give. Group 3: T6 reads
`scripts/port-check.ts` and `tests/browser/fixtures/launch.ts` from T1 and writes neither.

## Data changes

None. No migration, no table, no browser storage key. The harness's server writes a SQLite
file into a temporary directory that the harness removes.

## Risks and unknowns

| Risk | Mitigation |
|---|---|
| The defined load does not turn a D-02 check red in three runs. | T2 stops and reports (SD10). Nobody strengthens the load. The owner then decides whether the spec's load definition changes; that is a spec change, not a build decision. |
| The load turns other checks red. Candidates seen while reading, none proven: the 30 s limits on the lint-spawning tests (`tests/meta/config-boundary.test.ts:26`, `:30`), the 30 s limits in `server/test/boot.int.test.ts:67`, `:84`, the 15 s `waitForLine` in `server/test/spawn-server.ts:79`, the `expect` limits of 1 to 3 s in `live.spec.ts:206`, `:354`, `:366`, Playwright's 30 s test limit, and the beat-spacing test (`live.spec.ts:47`). | SD7 puts each in scope with a property fix. This plan does not guess them: T2 lists what really went red, the plan is amended, and the amendment is audited before T3 to T6. This may add tasks; it is the largest unknown in the plan. |
| The render-scale test (`live.spec.ts:395-430`) is about load and may change verdict under it. | T2 and T7 stop and ask (SD7). |
| `bash` from `pnpm` in PowerShell may resolve to WSL's `bash.exe` instead of Git Bash. | T1's autonomy note: stop and report. `pnpm check:load` is then run from Git Bash, and the runbook line says so. |
| Vitest 5.1.0 may not read timeout `0` as "no limit". | T3 proves it first and stops otherwise (PD7). |
| Playwright's loader, or plain Node, may not import the server's `boot` or use `chromium` from `@playwright/test` as a library. | T1 finds out first; PD2 names the fallback and makes it a stop. |
| The gate's `build` step empties `web/dist` (`web/vite.config.ts`, `emptyOutDir`) while the load's server serves it. | The load page has loaded everything by then and never reloads. T1's spec test and T2's first run show whether the load page survives a build; PD5's end-of-run check catches a page that died. |
| Ctrl-C during the browser step still leaves the gate's own `pnpm start` on 8123 on Windows. | Unchanged behaviour, out of scope (PD6). T6's warning names it on the next run. |
| T5 moves product code (`Screen.tsx`) in an item that is otherwise about tests. | The move is mechanical; the browser suite runs in T5's verification; H3 re-reads the latency on the screen machine afterwards. |
| The gate no longer sees a change that only makes each frame slower. | Accepted by the spec (SD2). Not reopened; noted so the audit sees that H3 is now the only check of the 50 ms. |
| T1's spec test starts a second Chromium and busy-loops inside the gate's browser step, for a few seconds. | It asserts no timing. If it makes a neighbouring test flaky, that shows in T2 and is handled as SD7. |
| The spec and the backlog edit are uncommitted, and local `main` is two merges behind `origin/main`. | H1. |

## Human steps

- **H1 — before `/audit`.** Commit the working copy (the spec, `docs/backlog.md`) and this plan
  on a branch; update the local `main` to `origin/main` (`73aeb66`). PD5 answered at the audit
  (2026-11-14).
- **H2 — after T2, only if it stopped.** Read the three outputs. If no D-02 check went red, or
  a check outside D-02 did, or the render-scale test changed verdict: decide, and have the
  plan amended and audited before the build goes on.
- **H3 — after T8: push and CI (AC9, the spec's Verification 7).** Push the branches and open
  the pull requests in order; confirm the `check` job is green with the same seven project
  steps in the same order. Pushing is the owner's (CLAUDE.md hard stops).
- **H4 — after T5 is merged, on the screen machine (SD2, the spec's Verification 8).** A
  twelve-effect profile with the owner's load: overlay p95 ≤ 50 ms over a minute. This is now
  the only check of B-01 AC10's and B-02 AC17's 50 ms. Record the figure in the review.

## Out of scope for this plan

- Everything under the spec's "Out of scope", unchanged: retries, raised limits, preconditions
  the gate cannot check, any product latency change, test-only engine instrumentation, a
  relative latency bound, the 50 ms anywhere but the screen machine, `pnpm check:load` in CI,
  killing or refusing on a held 8123, detecting another WebGL page.
- Fixes for checks that have not gone red under the load. They enter by amendment after T2.
- `vitest.config.ts`, `.github/workflows/ci.yml` and `tests/workflow/test_gate_steps.py`: not
  changed.
- `docs/design/architecture.md`: nothing in it becomes untrue.
- Building the web app from the harness (PD16).

## Evidence

Written by T2 and T7 (PD15). Empty until then.

### Before the fix (T2)

### After the fix (T7)

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

Audited by: Martijn Boot  Date: 2026-11-14
