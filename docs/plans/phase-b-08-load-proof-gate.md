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
  SD3 lifts it from the four mutation tests only (PD7). Amendment 1 keeps this for the unit
  project and lifts the limit from the integration project only, where the reproduction showed
  every test is exposed (PD18).

**Amendment 1 (2026-11-14).** T2's reproduction, and the later steps run under the same load
(Evidence), turned checks outside D-02 red. PD17 to PD19 and T9 to T12 fix them; T7 now
depends on all four. Audited separately (Audit section, amendment 1).

**Amendment 2 (2026-11-14).** T7's first attempt went red (Evidence, After the fix). PD20,
PD21, T13 and T14 answer it; T7 now also depends on T13 and T14 and starts again from (a).
Audited separately (Audit section, amendment 2).
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
| PD17 · Owner (amendment 1, answered 2026-11-14) | The reproduction turned checks outside D-02 red (Evidence, T2 and its H2 evidence). How is each fixed (SD7)? | **Owner chose the recommendations of 2026-11-14:** (a) `engine/src/latency.test.ts:28` loses its per-test limit (T9); (b) the integration project loses vitest's per-test limit (T10); (c) the browser tests lose Playwright's per-test limit, every assertion inside them kept, the render-scale tests included (T11); (d) AC6 is measured on the audio clock (T12, PD19). If a render-scale assertion itself then fails under load, that is the owner's question again (T7). `.github/workflows/` stays unchanged: the job keeps GitHub's default limit. | Each of (a) to (c) asserts behaviour, not its own duration; every failure was a limit, never an assertion. (d) was an assertion, so it gets a property fix, not a limit. |
| PD18 · Confirm (amendment 1) | Where do the integration and browser limits go? | `vitest.config.ts`: `testTimeout: 0` on the `integration` project only; the `unit` project keeps vitest's default and `{ timeout: 0 }` stays per describe there (PD7, T3, T9). `playwright.config.ts`: `timeout: 0` for the whole run. Every integration test spawns the real server and every browser test drives a real Chromium; none asserts its own total duration; the waits that are assertions (`expect(...)` with a `timeout`, the measured spacings) are inside the tests and untouched. | Per-test lists would be whack-a-mole: the H2 run showed which tests crossed 30 s *that* time (`:74` took 37.4 s and passed). The cost, accepted by the owner: a hang, including a locator waiting on an element that never appears, runs until the CI job's limit instead of failing at 30 s. PD7's rejection of a global limit stands for the unit project. |
| PD19 · Confirm (amendment 1) | How is AC6 made load-proof without changing what it asserts? | `tests/browser/live.spec.ts:47`: an init script (test code, in the style of `record()` in `tests/browser/helpers.ts`) wraps `AudioWorkletNode` and adds a `message` listener on each node's port beside the product's `onmessage`, keeping `{ contextTime, beat }` of every window the worklet posts. The test reads 3 s of those after the first second and asserts, with `t = contextTime × 1000`: at least 5 rises (beat ≥ 0.5 after < 0.5); every gap within ±100 ms of 500 ms; beat ≤ 0.1 over the last 200 ms of each gap, measured back from the next rise and stopping short of it. The 120 ms decay, ±100 ms, 0.1 and 200 ms are unchanged (B-01 plan PD7, owner 2026-11-12). | The failure was the display's clock, not the audio: 0.118 is exp(−256/120), the pulse's tail 256 ms after a click, pulled into the window because displayed rises jittered (a gap read 405 ms). `contextTime` is when the audio was processed; load can delay a message, not change it. No product code changes (spec, Out of scope: no test-only instrumentation in the product). The meter's display path stays covered by `panel.spec.ts:33` ("the meters move"). |
| PD20 · Owner (amendment 2, answered 2026-11-14) | T7 went red (Evidence, After the fix): the render-scale step up on a quiet machine, and under load AC12's "keeps rendering", AC13's reattach and B-02 AC4's preview. How is each fixed (SD7)? | **Owner chose the recommendations of 2026-11-14 (R1 to R4):** R1, the render-scale step up (`live.spec.ts:466`) is awaited with no limit of its own and still asserted, its time recorded with `note` (T13). R2, after a loss the loss test waits, with no limit, until two canvas reads differ, instead of requiring it within 500 ms (T13). R3, the reattach wait (`:406`) has no limit for the camera and keeps 2500 ms for audio (T13). R4, the preview luma 0 is investigated before any fix: the investigation is in the Evidence (not reproduced); the test now attaches its darkest samples so a recurrence says what it saw (T14). | R1 to R3 each wait for a behaviour the spec names without a time (AC15's step up is "after 10 s with headroom", a minimum, not a deadline; AC12/AC13 "keep rendering"; AC13's reattach has no time). AC12's reattach "within 2 s of its return" is a spec time and keeps its limit. R4 has no proven cause, so nothing is fixed blind. |
| PD21 · Confirm (amendment 2) | Is `expectCanvasChanging` (`tests/browser/helpers.ts:218`) changed for R2? | No. Its "two reads 500 ms apart differ" is Phase 0 AC11's own wording (`docs/specs/phase-0-walking-skeleton.md:199-200`) and `screen.spec.ts:43` asserts exactly that. R2 adds a local wait in `live.spec.ts` for the loss test only; `:419` (a denied camera, not red) keeps the helper. | A spec criterion's wording is not this item's to relax; the loss test's claim is "keeps rendering", not a rate. |
| PD16 · Confirm | Does the harness build the web app first? | No. It needs `web/dist/index.html`; without it `boot()` already fails with "run pnpm build" (`server/src/boot.ts:73-75`), and the harness lets that message through and exits before starting the gate. | AC1 runs on a tree whose gate is green, so the build exists. No second way to build. |

## Files

| Path | Create/Modify | Purpose |
|---|---|---|
| `tests/browser/fixtures/launch.ts` | Create | The gate's port, the load's port, the viewport and the Chromium flags, in one place (PD3) |
| `playwright.config.ts` | Modify | T1: import the above, behaviour unchanged. T11: `timeout: 0` (PD18) |
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
| `engine/src/latency.test.ts` | Modify | No per-test limit on the bounded-window test (T9, amendment 1) |
| `vitest.config.ts` | Modify | `testTimeout: 0` on the integration project (T10, PD18) |
| `tests/browser/live.spec.ts` | Modify | AC6 on the audio clock (T12, PD19), after T4; R1 to R3 (T13, PD20), after T12 |
| `tests/browser/preview.spec.ts` | Modify | The camera-denied test attaches its darkest samples (T14, PD20 R4) |

Not changed: `.github/workflows/`, `tests/workflow/test_gate_steps.py`, anything in
`engine/src/` or `audio/src/` except the two test files (`index.test.ts`, `latency.test.ts`),
`docs/design/`. `vitest.config.ts` changes only in the integration project (PD18).

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
- **Depends on:** T3, T4, T5, T6, T9, T10, T11, T12, T13, T14
- **Autonomy note:** Builder changes no source file; the renames are temporary and reverted.
  The three runs are consecutive: a red run is not re-run to get three greens. Stop and report
  with the output if any run is red (SD7: a new check gets a plan amendment and an audit; the
  render-scale test is the owner's question, PD17), or if a process is left behind. For (d), start
  the server with an explicit `DATA_DIR` in a scratch folder and do not read or edit
  `.env.local`.

### T8 — Docs as built
- **Implements:** AC10, SD6, SD9
- **Expected output:** `docs/invariants.md:28-29`: "Enforced by" in the `AudioFeatures` and
  `Profile` rows names the `types` step (`pnpm typecheck`), `tests/meta/compat-coverage.test.ts`
  and that file's mutation tests; the "Invariant" cells are unchanged. D-02 in
  `docs/specs/defect-register.md:15` reads fixed, citing this spec and T7's evidence.
  `docs/plans/phase-b-01-live-visual-engine.md:78` and `:102` carry "superseded by B-08 SD1";
  its AC6 notes (`:100-101`, `:108-113`) carry "measured on the audio clock since B-08 PD19",
  the thresholds unchanged;
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

### T9 — The latency-window test stops racing the clock (amendment 1)
- **Implements:** AC1, SD7
- **Expected output:** `engine/src/latency.test.ts:28` ("stays bounded to the window however
  long nobody reads it") runs with `{ timeout: 0 }`, on that test only; its loop and its
  `size() ≤ 1251` assertion are unchanged. A one-line comment says why: it asserts a size, and
  load made it exceed vitest's 5 s in 3 of 3 runs (Evidence, T2).
- **Verification:** `pnpm run test --project unit engine/src/latency.test.ts`
- **Depends on:** T2
- **Autonomy note:** Builder settles the comment's words. No other test in the file changes; no
  change to `engine/src/latency.ts`.

### T10 — The integration tests have no per-test time limit (amendment 1)
- **Implements:** AC1, AC9, SD7
- **Expected output:** `vitest.config.ts`: the `integration` project has `testTimeout: 0` with a
  comment naming B-08 PD18; the `unit` project and the shared `ignored` list are unchanged; no
  `retry` anywhere. Every assertion and every wait inside `server/test/` is unchanged (the 15 s
  `waitForLine` default and the 30 s limits in `boot.int.test.ts` held under load in the H2
  run).
- **Verification:** `pnpm run test --project integration`, then
  `pnpm run test --project unit tests/meta`
- **Depends on:** T2
- **Autonomy note:** Builder settles the comment. Stop if anything under `server/test/` would
  need to change.

### T11 — The browser tests have no per-test time limit (amendment 1)
- **Implements:** AC1, AC9, SD7
- **Expected output:** `playwright.config.ts` sets `timeout: 0` with a comment naming B-08 PD18
  and the cost (a hang runs to the CI job's limit). `retries` stays unset, `workers: 1`,
  `fullyParallel: false`, `webServer` and the launch module are unchanged. No spec file changes
  in this task; every `expect(..., { timeout })` inside the tests, the render-scale tests' 4, 8
  and 12 s included, stays as it is (PD17).
- **Verification:** `pnpm exec playwright test tests/browser/screen.spec.ts tests/browser/under-load.spec.ts`.
  This shows the config still runs; it cannot show the limit is gone (`under-load.spec.ts`
  already sets its own `timeout: 0`, and nothing here runs past 30 s on a quiet machine). The
  proof for T9, T10 and T11 is T7's three load runs, where those tests ran past their limits
  before (Evidence).
- **Depends on:** T2
- **Autonomy note:** Builder settles the comment. Do not touch `expect.timeout`, `actionTimeout`
  or `navigationTimeout`, and do not add `globalTimeout`: each is a new wall-clock limit the
  owner did not choose.

### T12 — AC6 is measured on the audio clock (amendment 1)
- **Implements:** AC1, SD7
- **Expected output:** `tests/browser/live.spec.ts:47-72` per PD19: an init script records
  `{ contextTime, beat }` from every `AudioWorkletNode` port message; the test asserts at least
  5 rises, every gap within ±100 ms of 500 ms and beat ≤ 0.1 over each gap's last 200 ms, all
  on `contextTime × 1000`. The 1 s warm-up and the 3 s span are both measured in `contextTime`
  from the first recorded window, never on the page's clock. The rises, the gaps and the worst gap-end value are still attached
  with `note`. The title still names AC6; the comment at `:55-58` says the clock is the audio's
  since B-08 PD19 and why. `sampleMeter` is removed if nothing else uses it.
- **Verification:** `pnpm exec playwright test tests/browser/live.spec.ts -g "AC6"`, then the
  same check made to fail once by hand (the 0.1 changed to 0.0001 locally, failing output in
  the task report, reverted) so the new reading is shown not to be vacuous
- **Depends on:** T4
- **Autonomy note:** Builder settles the init script's shape. No product file changes. Stop if
  the port's messages cannot be observed from the page without changing `audio/` or `web/`,
  or if the audio-clock gaps break ±100 ms on a quiet machine (that is a product question,
  not a tolerance). That load cannot move `contextTime` is proven for the worklet, not for
  Chromium's fake capture device feeding it: T7's three load runs are the proof, and an
  audio-clock gap outside ±100 ms there is a stop for the owner, never a tolerance change.

### T13 — Render scale, loss and reattach wait for behaviour, not a deadline (amendment 2)
- **Implements:** AC1, SD7
- **Expected output:** In `tests/browser/live.spec.ts`, per PD20 and PD21:
  (R1) the render-scale tests (`:424`, both looks): after the slow frames stop, the test waits
  for `scale 75%` with `{ timeout: 0 }`, measures the wait on the page's clock from the moment
  the wrap is removed, attaches it with `note` ("AC15 step up after (ms)", a measurement), and
  still asserts every reading is 100, 75 or 50%. The `recovered` flag and the "within 12 s"
  message are gone. The step-down waits (4 s, 8 s) and the 3 s hold at 50% are unchanged (not
  red).
  (R2) the loss test (the `:374` loop, `:402`): instead of `expectCanvasChanging`, a local
  function takes one canvas read and then reads again every 250 ms, with no limit, until one
  differs; the number of reads is attached with `note`. `helpers.ts` is unchanged, and so is
  `:419`.
  (R3) the reattach wait (`:406`): `{ timeout: 2500 }` for audio (AC12's "within 2 s of its
  return"), `{ timeout: 0 }` for the camera (AC13 sets no time), with a comment saying so.
  The file header names B-08 PD20 once. Nothing else in the file changes.
- **Verification:** `pnpm exec playwright test tests/browser/live.spec.ts -g "lost|slow frames"`;
  then once by hand, reverted, output in the report: with the slow-frame wrap never removed, the
  step-up wait does not resolve within 60 s (the run is stopped by hand), so the wait is not
  vacuous. This check is for R1 only: R2 cannot pass without a differing read, and R3's audio
  limit is unchanged. The 10 s rule itself stays unit-tested on a fake clock
  (`engine/src/scale.test.ts:101`, the doubling wait at `:126-150`), which is why the
  real-clock test can drop the deadline.
- **Depends on:** T12
- **Autonomy note:** Builder settles the local function's name and the note labels. Stop if
  any other assertion in the file would need to change, or if the audio reattach fails within
  2500 ms on a quiet machine, or in any T7 run (that is AC12's own time: an owner question).

### T14 — The preview's camera-denied test says what it saw (amendment 2)
- **Implements:** AC1, SD7
- **Expected output:** `tests/browser/preview.spec.ts:185-200`: before the luma assertion at
  `:196`, the test attaches with `test.info().annotations` (the style of `note` in
  `live.spec.ts`) the series length, the minimum, and the five darkest samples with their
  time from the series' start. The assertion `≥ 2` and everything else are unchanged.
- **Verification:** `pnpm exec playwright test tests/browser/preview.spec.ts -g "camera denied"`
- **Depends on:** T2
- **Autonomy note:** No assertion, threshold or wait changes. If T7 sees it red again, that is
  a stop with the attached samples: a black preview frame under load would be a product defect
  for the defect register (the engine has no WebGL context-loss handling), outside this item.

## Task graph

| Group | Tasks | Files they touch |
|---|---|---|
| 1 | T1 | `tests/browser/fixtures/launch.ts`, `playwright.config.ts`, `scripts/port-check.ts`, `scripts/port-check.test.ts`, `scripts/under-load.ts`, `scripts/check-under-load.ts`, `package.json`, `tests/browser/under-load.spec.ts` |
| 2 | T2 | this plan (Evidence) |
| 3 | T3 | `tests/meta/compat-check.ts`, `profile-compat.test.ts`, `features-compat.test.ts`, `compat-coverage.test.ts` |
| 3 | T4 | `tests/browser/live.spec.ts` |
| 3 | T5 | `web/src/frame-feed.ts`, `frame-feed.test.ts`, `web/src/Screen.tsx`, `engine/src/index.test.ts` |
| 3 | T6 | `scripts/check.sh`, `tests/workflow/test_gate_shape.py` |
| 3 | T9 | `engine/src/latency.test.ts` |
| 3 | T10 | `vitest.config.ts` |
| 3 | T11 | `playwright.config.ts` |
| 3 | T14 | `tests/browser/preview.spec.ts` |
| 4 | T12 | `tests/browser/live.spec.ts` |
| 5 | T13 | `tests/browser/live.spec.ts` |
| 6 | T7 | this plan (Evidence) |
| 7 | T8 | `docs/invariants.md`, `docs/specs/defect-register.md`, `docs/plans/phase-b-01-live-visual-engine.md`, `docs/specs/phase-b-01-live-visual-engine.md`, `docs/runbooks/README.md`, `CLAUDE.md`, `docs/backlog.md` |

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
| With no per-test limit (PD18), a browser regression that leaves an element missing hangs the gate instead of failing it at 30 s; in CI it runs to GitHub's default job limit. | Accepted by the owner (PD17). Locally the hang is visible; the next owner decision may add a job `timeout-minutes`, which is a `.github/workflows/` change outside this plan. |
| Measured on the audio clock (PD19), AC6 no longer exercises the meter's display path. | `panel.spec.ts:33` still proves the meters move after Start. |
| A render-scale assertion that still has a time (the step down within 4 s and 8 s, the 3 s hold at 50%, the cap test) may fail under load. | T7 stops and asks (PD17, PD20). |
| With no limit on the step-up, loss and camera-reattach waits (PD20), a product regression there hangs instead of failing. | The same accepted cost as PD18. T13's verification shows the step-up wait does not pass vacuously. |
| The preview's luma 0 (B-02 AC4) was not reproduced and has no proven cause (PD20 R4). | T14 records what a recurrence saw; a recurrence in T7 is a stop, and a proven black frame is a defect-register entry, not a test change. |
| `testTimeout: 0` does not lift vitest's 10 s `hookTimeout`; the integration files stop a server in `afterEach`. The H2 run passed 51/51, so there is no evidence of a problem yet. | A hook timeout in T7 is a new red check (SD7: amendment and audit), not a flake. |

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
- Fixes for checks that have not gone red under the load. Those that did are amendment 1
  (PD17, T9 to T12) and amendment 2 (PD20, T13, T14); one that goes red later, in T7, enters by
  a further audited amendment.
- `.github/workflows/ci.yml` and `tests/workflow/test_gate_steps.py`: not changed.
  `vitest.config.ts`: not changed except the integration project's `testTimeout` (PD18, T10).
- `docs/design/architecture.md`: nothing in it becomes untrue.
- Building the web app from the harness (PD16).

## Evidence

Written by T2 and T7 (PD15). Empty until then.

### Before the fix (T2)

Windows dev machine, `availableParallelism()` 16, so 8 busy-loop workers and the second
Chromium on 8124 (the harness's line in every run: `under load: 8 busy-loop worker thread(s) and
a second Chromium rendering a started set from 127.0.0.1:8124`). Tree: commit `39aa4e8` (T1), on
which `bash scripts/check.sh` passed first (`all 9 step(s) passed`, 96 browser tests). Nothing
changed between runs. After each run: no listener on 8123 or 8124
(`netstat -ano | grep -E ':(8123|8124) ' | grep LISTEN` empty); after run 3, no
`chrome-headless-shell.exe` or `chrome.exe` process.

| Run | Started (UTC) | Commit | Exit | Failing step | Failing tests (all `Error: Test timed out in 5000ms.`) |
|---|---|---|---|---|---|
| 1 | 2026-11-14 14:41:55 | `39aa4e8` | 1 | 7 (unit) | `engine/src/latency.test.ts:28` (6930 ms); `tests/meta/features-compat.test.ts:12` (18624 ms), `:16` (8705 ms), `:24` (5831 ms); `tests/meta/profile-compat.test.ts:12` (21534 ms), `:16` (10396 ms), `:24` (7484 ms) — 7 failed, 332 passed |
| 2 | 2026-11-14 14:45:39 | `39aa4e8` | 1 | 7 (unit) | `engine/src/latency.test.ts:28` (5761 ms); `features-compat.test.ts:12` (13118 ms), `:16` (6273 ms); `profile-compat.test.ts:12` (18018 ms), `:16` (6607 ms) — 5 failed, 334 passed |
| 3 | 2026-11-14 14:48:43 | `39aa4e8` | 1 | 7 (unit) | `engine/src/latency.test.ts:28` (5658 ms); `features-compat.test.ts:12` (13070 ms), `:16` (8316 ms); `profile-compat.test.ts:12` (19230 ms), `:16` (8504 ms), `:24` (9234 ms) — 6 failed, 333 passed |

Every check that went red in any run:

- `tests/meta/profile-compat.test.ts` — `:12` (unmutated) and `:16` in 3/3 runs, `:24` in runs
  1 and 3: **D-02**.
- `tests/meta/features-compat.test.ts` — `:12` (unmutated) and `:16` in 3/3 runs, `:24` in run
  1: **D-02**.
- `engine/src/latency.test.ts:28`, "stays bounded to the window however long nobody reads it"
  (records 100 000 samples, asserts `size() ≤ 1251`), 3/3 runs: **other**. It asserts a size,
  not a duration; it ran past vitest's default 5 s limit.

Not reached: every run stopped at step 7, so the integration and browser steps (with
`tests/browser/live.spec.ts:274` and the render-scale test `:395-430`) never ran under load.
Their verdict under load is unknown, not green.

**T2 stopped here** (autonomy note: a check outside D-02 went red). H2: the plan needs an
amendment for `engine/src/latency.test.ts:28`, audited, before T3 to T6 start.

#### The later steps under the same load (H2 evidence, 2026-11-14)

Because every run stopped at the unit step, the gate's later steps were run on their own under
`runUnderLoad` (same load, port 8124, commit `a7a3206`, no repository file changed), with a
throwaway driver in place of `bash scripts/check.sh`. Two runs:

- **Integration, default limits** (14:54 UTC): 32 of 51 failed, every one
  `Error: Test timed out in 5000ms.`, in all five files (`health`, `static`, `migrate`, `boot`,
  `profiles`). Each test spawns the real server; none asserts a duration. **Other.**
- **Integration with `--testTimeout=0`, then the browser step** (started 14:58 UTC): integration
  51 of 51 passed. Browser: 90 passed, 6 failed (15.8 min), exit 1:
  - `live.spec.ts:47` beat spacing (AC6): `expect(worstEnd).toBeLessThanOrEqual(0.1)` received
    `0.118`; rise spacing `[405,489,524,490,490,549]`. An assertion on a value. **Other.**
  - `live.spec.ts:138` recognisability (AC8), `:338` camera lost (AC13): Playwright's 30 s test
    limit (48.3 s, 34.6 s); no assertion failed. **Other.**
  - `live.spec.ts:384` render scale on both looks, `:440` cap at 75% (AC15): the 30 s test limit
    (51.4 s, 54.8 s, 46.7 s). **The render-scale test: changed verdict under load.**
  - `live.spec.ts:274` latency (D-02) passed on both looks: p95 21.9 ms built-in, 23.8 ms
    twelve effects (scale 50%).

  No listener on 8123 or 8124 afterwards.

`{ timeout: 0 }` on a `describe` and `--testTimeout=0` were both shown to mean "no limit" in
vitest 5.1.0 by a throwaway test that slept 6.5 s (passed; the same sleep under the default
limit failed at 5007 ms). Not committed.

**Stopped again for the owner:** the render-scale verdict changed (SD7, T2 autonomy note), and
the AC6 failure is an assertion on a value the owner set (2026-11-11), not a time limit.

### After the fix (T7)

Tree: the stack tip `319315a` (T1 to T6, T9 to T12), Windows dev machine.

**(a) `bash scripts/check.sh`, quiet machine (15:40 UTC): red**, exit 1 at step 9 (browser):
steps 1 to 8 green (54 workflow, 342 unit, 51 integration tests); browser 95 passed, 1 failed:
`live.spec.ts:424` "slow frames step the render scale down … on twelve effects (AC15, B-02
AC17)", `no step up within 12 s of headroom` (Expected true, Received false); the scale reached
50% and did not return to 75% within the test's 12 s. Re-run alone on the same tip with
`--repeat-each=5`: 5 passed. AC15 asks for a step up "after 10 s of headroom"; the test's 12 s
leaves about 1 s once the one-second mean has settled. No B-08 task touches `engine/src/scale.ts`
or this test. **The render-scale test: the owner's question (SD7, PD17).**

Because (a) is red, the three runs below are **diagnostic, not AC1**: AC1 needs a tree whose
gate is green.

| Run | Started (UTC) | Exit | Unit | Integration | Browser |
|---|---|---|---|---|---|
| 1 | 15:48:29 | 1 | 342/342 | 51/51 | 95 passed, 1 failed (14.8 min) |
| 2 | 16:07:20 | 0 | 342/342 | 51/51 | 96 passed (13.8 min); `all 9 step(s) passed` |
| 3 | 16:25:04 | 1 | 342/342 | 51/51 | 94 passed, 2 failed (12.4 min) |

After each run: no listener on 8123 or 8124, no `chrome-headless-shell.exe`.

Under load, fixed and holding in all three runs: both compat files and the latency-window test
(T3, T9), all 51 integration tests (T10), the latency structure check on both looks (T4; the
overlay read p95 347 to 582 ms, which the old 50 ms bound would have failed every run), AC6 on
the audio clock (T12; spacing within ±8 ms of 500, worst gap end 0.079 to 0.085), the
render-scale tests (T11; no time-limit failure).

Red under load, new (**other**, SD7):

- Run 1: `live.spec.ts:378` audio lost (AC12), at `:402` `expectCanvasChanging`: "the canvas
  did not change in 500 ms" (two screenshots 500 ms apart identical, after the loss).
- Run 3: `live.spec.ts:378` camera lost (AC13), at `:406`: `overlay-camera` still read
  `camera: lost` after the device returned, within the test's 2500 ms. B-01 AC13 sets no time
  for the camera; AC12 sets "within 2 s" for audio, and the same line serves both.
- Run 3: `preview.spec.ts:185` camera denied, preview stays generative (B-02 AC4), at `:196`:
  the darkest preview sample over 1.5 s read luma 0 (Expected ≥ 2). A value, not a limit: a
  black or not-yet-drawn preview sample under load.

**T7 stopped here** for the owner: the render-scale verdict changed on a quiet machine, and
three more checks went red under load, one of them on a spec time (AC12's 2 s) and one on a
value (B-02 AC4).

**R4 investigation (2026-11-14, owner's R4: investigate before any fix).** A throwaway copy of
`preview.spec.ts:185` (untracked, deleted afterwards) logged every luma sample and counted
`blitFramebuffer` calls between samples, and ran 25 times under `runUnderLoad` on `319315a`:
25 of 25 passed, minimum luma 85.5 to 86.9, exactly one blit per sample, no dark sample. The
failing run 3 printed no browser log for this test. Not reproduced, with two limits: it was
the single test under load, not the full 12-minute browser sequence, and the counting copy
may have changed its timing. Candidate causes, neither
proven: a WebGL context loss under two software-GL Chromiums (the engine registers no
`webglcontextlost` handler, so a lost context reads black), or the test reading a frame the
engine had not drawn. No fix is made without a cause (PD20 R4); T14 makes a recurrence report
its darkest samples. Separately, the H2 run's browser logs show
`glBlitFramebuffer: Blit feedback loop` errors on the screen page under load; not linked to a
failure, recorded here only.

**Amendment 2** (PD20, PD21, T13, T14) answers the above; T7 is then run again from (a).

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

## Audit — plan-auditor (agent), 2026-11-14 — amendment 1

Scope: `git diff 70e3942 52f6706` (PD17 to PD19, T9 to T12, the Files rows, the Task graph rows,
the T7 and T8 edits, the three Risk rows), and what in the original plan it makes untrue.

Mechanical check: `python scripts/check_plans.py docs/plans/phase-b-08-load-proof-gate.md`
printed `12 task(s), ok`. `--graph`: group 1 T1; group 2 T2; group 3 T3, T4, T5, T6, T9, T10,
T11; group 4 T12; group 5 T7; group 6 T8. This matches the plan's own table.

### Traceability
| AC | Tasks implementing it |
|---|---|
| AC1 (D-02, green under load) | T1, T2, T7, T9, T10, T11, T12 |
| AC9 (no retry, same steps) | T6, T10, T11 |
| SD7 (scope is what load turns red) | T2, T9, T10, T11, T12 |
| AC2 to AC8, AC10 | unchanged by the amendment (T1, T3 to T6, T8) |

| Task | ACs served |
|---|---|
| T9 | AC1, SD7 |
| T10 | AC1, AC9, SD7 |
| T11 | AC1, AC9, SD7 |
| T12 | AC1, SD7 |

Unmapped criteria: none
Orphan tasks: none (T9 to T12 each answer a red check in the Evidence section, which SD7 admits)

### Findings
| # | Severity | Task | Finding | Required change |
|---|---|---|---|---|
| 1 | **Required** | T10, "Out of scope of the plan" | The bullet "`vitest.config.ts`, `.github/workflows/ci.yml` and `tests/workflow/test_gate_steps.py`: not changed" still stands, and so does "Fixes for checks that have not gone red under the load. They enter by amendment after T2." T10 changes `vitest.config.ts`. A builder reading top-down meets a contradiction and, under T10's own autonomy note, may stop. The Files "Not changed" line was fixed; this one was not. | Strike `vitest.config.ts` from that bullet (or add "except the integration project, PD18"), and drop or reword the "enter by amendment after T2" bullet now that amendment 1 has entered. |
| 2 | Recommended | Files | `playwright.config.ts` now has two rows (T1 and T11). Not a conflict (group 1 and group 3). | Merge into one row naming both tasks. |
| 3 | Recommended | T12 | The expected output does not say how "after the first second" is taken on the audio clock. `waitForTimeout(1000)` is wall time; the warm-up and the 3 s span should be measured in `contextTime` from the first recorded window, else a slow start changes how much history the adaptive threshold had. | Add one sentence saying so. |
| 4 | Recommended | T12 | PD19's "load can delay a message, not change it" holds for the worklet's `contextTime`. It is not proven for Chromium's fake capture device feeding the graph: if load starves it, the click track could shift in context time. The autonomy note stops only for a quiet-machine failure. | State that T7's three load runs are the proof for T12, and that an audio-clock gap outside ±100 ms under load is also a stop (a product question), not a tolerance change. |
| 5 | Recommended | T9, T11 | T11's verification runs `screen.spec.ts` and `under-load.spec.ts`; `under-load.spec.ts:14` already has `test.describe.configure({ timeout: 0 })`, so it does not show the config-level `timeout: 0` took effect. T9's verification passes without the change too. | Say that T7 is the proof of T9 to T11 and that these verifications show only that nothing regressed, or run one live-spec test that exceeds 30 s under load (the H2 evidence names `:138`). |
| 6 | Recommended | T10, Risks | `testTimeout: 0` leaves `hookTimeout` (10 s default) alone, and each integration file kills a spawned server in `afterEach`. The H2 run with `--testTimeout=0` passed 51/51, so there is no evidence of a problem, and raising it would be a new limit. | Add a Risk line so a hook timeout in T7 is read as a new red check (SD7), not a flake. |

### Reading of the specific questions
- **SD7 and Out of scope.** T9, T10 and T11 remove a limit from tests that assert a size, a
  response or a rendered result, never their own duration; every such failure in the Evidence is
  `Test timed out` with no assertion failed. No retry (T10 and T11 name it, and the PD13
  workflow test guards it). No raised threshold, no product file, no test-only instrumentation
  in `audio/` or `web/`. The render-scale tests keep their 4, 8 and 12 s `expect` timeouts,
  which are the assertion; PD17 and T7's autonomy note send a changed verdict back to the owner
  as SD7 requires. T11 rightly forbids `expect.timeout`, `actionTimeout`, `navigationTimeout`
  and `globalTimeout`.
- **PD18 against SD3 and PD7.** Consistent. SD3 lifts the limit from four tests because they
  assert nothing about duration; SD7 extends the same reasoning, on evidence, to the integration
  project and the browser run. PD7's rejection of a global unit limit stands (the unit project is
  untouched; T9 is one test). The accepted cost (a hang runs to the CI job's limit) is the
  spec's own compiler edge case, is a Risk row, and the owner accepted it.
- **PD19 and T12 keep what B-01 AC6 asserts.** B-01 AC6 says the beat pulse fires on the
  low-band onsets of a click track and not between them. The test keeps at least 5 rises, the
  ±100 ms spacing, 0.1 over the last 200 ms of each gap measured back from the next rise, and
  the 120 ms decay (B-01 plan PD7 and the 2026-11-12 note), on the signal that carries the
  property. It is feasible with no product change: `audio/src/processor.ts` posts
  `{ frame, contextTime }` with `frame.beat`; `audio/src/source.ts` sets `node.port.onmessage`,
  which starts the port, so a test-side `addEventListener("message")` on a subclass of
  `AudioWorkletNode` (filtered on `djv-features`) sees every message; `record()` in
  `tests/browser/helpers.ts` already wraps `AudioContext` the same way; `sampleMeter` is used
  only at `live.spec.ts:52`. Windows are about 8 ms (3 quanta), finer than the per-frame meter.
  What is lost, the meter's display path under AC6, is a Risk row and is covered by
  `panel.spec.ts` ("meters move"); the owner chose it (PD17 d). Findings 3 and 4 tighten this;
  neither blocks.
- **Group conflicts.** None. T9, T10 and T11 write distinct files; T12 shares `live.spec.ts`
  with T4 and is in a later group (T12 depends on T4); T5 writes `engine/src/index.test.ts`, T9
  `engine/src/latency.test.ts`. T1's `playwright.config.ts` edit is in group 1.
- **Concreteness.** T9 to T12 each name the file, the line, the change and a verification;
  T12's mutation check (0.1 to 0.0001, then revert) shows the new reading is not vacuous.
  Autonomy notes name their stops. Sizes are a few lines to about 60 lines of one or two files.
- **Dependencies, secrets, infra.** No new dependency. No secrets, production or infra;
  `.github/workflows/` untouched.
- **Owner rows, for the human.** PD17 records the owner's "implement recommendation" of
  2026-11-14; I cannot verify the recommendation text beyond what PD17 and the Evidence record.
  The accepted cost (a hang runs to the CI limit) and the render-scale question at T7 are the
  owner's. PD18 and PD19 are Confirm rows the owner may overrule.

### Checklist
- [x] Every AC maps to at least one task
- [x] Every task maps to at least one AC (no orphans)
- [x] Each task's expected output is concrete enough to check, and is what we need
- [x] Existing patterns reused; nothing reinvented
- [x] No new dependency without an approval note
- [x] Data changes additive and reversible
- [x] Errors, empty states and permissions are tasks, not afterthoughts
- [x] Each task reviewable in one sitting
- [x] Verification named per task
- [x] Nothing touches prod, secrets or infra it should not
- [x] Every task has a Depends on and an Autonomy note
- [x] No two tasks in one parallel group write the same file
- [x] The plan is consistent with itself after the amendment (finding 1 fixed, re-checked below)

### Task graph as audited
| Task | Depends on | Parallel group |
|---|---|---|
| T1 | none | 1 |
| T2 | T1 | 2 |
| T3 | T2 | 3 |
| T4 | T2 | 3 |
| T5 | T2 | 3 |
| T6 | T2 | 3 |
| T9 | T2 | 3 |
| T10 | T2 | 3 |
| T11 | T2 | 3 |
| T12 | T4 | 4 |
| T7 | T3, T4, T5, T6, T9, T10, T11, T12 | 5 |
| T8 | T7 | 6 |

Re-check, 2026-11-14: findings 1 to 6 are all applied in the working copy (Out-of-scope bullets
reworded, Files rows merged, T12 contextTime warm-up and stop note, T11 verification wording,
hookTimeout Risk row). `check_plans.py` again `12 task(s), ok`; groups unchanged.

Verdict: **PASS**
Audited by: plan-auditor (agent), 2026-11-14 (re-checked 2026-11-14)

## Audit — plan-auditor (agent), 2026-11-14 — amendment 2

Scope: `git diff a96ea2d 331835d` on this plan (PD20, PD21, T13, T14, the Files rows, the Task
graph rows, T7's Depends on, the R4 investigation, the Amendment 2 paragraph, the Out-of-scope
bullet, two Risk rows).

Mechanical check: `python scripts/check_plans.py docs/plans/phase-b-08-load-proof-gate.md`
printed `14 task(s), ok`. `--graph`: group 1 T1; group 2 T2; group 3 T3, T4, T5, T6, T9, T10,
T11, T14; group 4 T12; group 5 T13; group 6 T7; group 7 T8. This matches the plan's own table.
T12 and T13 both write `tests/browser/live.spec.ts`, but T13 depends on T12 directly, so they
sit in groups 4 and 5 and never run together. T14 is alone on `preview.spec.ts`.

### Traceability
| AC | Tasks implementing it |
|---|---|
| AC1 (D-02, green under load) | T1, T2, T7, T9 to T14 |
| SD7 (scope is what load turns red) | T2, T9 to T14 |
| AC2 to AC10 | unchanged by the amendment |

| Task | ACs served |
|---|---|
| T13 | AC1, SD7 |
| T14 | AC1, SD7 (diagnostic only; see finding 4) |

Unmapped criteria: none
Orphan tasks: none (T13 answers three red checks and T14 one, all in the Evidence section)

### Findings
| # | Severity | Task | Finding | Required change |
|---|---|---|---|---|
| 1 | Recommended | T13 R1, PD20 | Removing the 12 s deadline is consistent with AC15 and does not drop a part the gate must keep, but the plan does not say why. B-01 AC15's "after 10 s with headroom" is proven on a fake clock by `engine/src/scale.test.ts:101` (9 s: no step; 2 s later: step up; 10 s again for the next), and `:126-150` show the wait doubles to 20 s after a step up that fails. So 10 s is a minimum, not a stable deadline, and the real-clock test can only assert that the step up happens. What is lost: the browser test no longer catches a step up that comes late but does come. That is the owner's chosen trade (PD20, answered), and the `note` of the elapsed time keeps it visible. SD7's "never a raised limit on a check whose duration is the assertion" is met by removing the limit, not raising it, and the property (step up happens) stays asserted. | Add one sentence to PD20 or T13 citing `scale.test.ts:101` and `:126-150` as where the 10 s rule is proven. |
| 2 | Recommended | T13 R1 verification | The non-vacuity check is sound for "the wait does not pass by itself": with the wrap never removed the frames stay at about 15 fps, so no step up is possible, and a wait that does not resolve in 60 s shows the wait depends on the behaviour. It is weaker than it reads: 60 s is below the 80 s cap of the doubling wait, and it shows nothing about R2 and R3, which have no equivalent. R2 cannot pass without a read that differs, and R3's audio limit is unchanged, so neither is vacuous by construction. | State that the check is for R1 only and that R2 and R3 are non-vacuous by construction. No test needed. |
| 3 | Recommended | T13 R3 | The reading is correct. AC12 says "within 2 s of its return" for audio and keeps 2500 ms (the 500 ms is existing slack, not new). AC13 sets no time for the camera, so `timeout: 0` for `kind === "camera"` does not relax a spec time. The autonomy note stops only for an audio failure "on a quiet machine"; an audio reattach beyond 2500 ms under load, in T7, is a failure on a spec time. | Say in the note that a red audio reattach in any T7 run is also a stop for the owner, never a limit change. |
| 4 | Recommended | T14, R4 | Not fixing is justified: 25 of 25 passes with no dark sample and no cause found, SD7 forbids a retry or a lowered threshold, and a product change (a `webglcontextlost` handler) is out of scope. T14 changes no assertion, so it satisfies SD7 and the hard stops. Two limits of the evidence: the 25 runs were one test under load, not that test after a 12-minute sequence of browser tests, and the throwaway copy counted blits, which can perturb timing. T14 also fixes nothing, so T7 can go red again on the same check; T14's autonomy note and the Risk row already make that a stop and a defect-register entry, which is the right outcome. T14's claim to serve AC1 is by courtesy only. | Add "the reproduction was a single test under load, not the full sequence" to the R4 paragraph, so nobody reads 25 of 25 as exclusion of the cause. |
| 5 | Recommended | PD21, T13 R2 | Consistent. Phase 0 AC11 (`phase-0-walking-skeleton.md:199-200`) keeps its 500 ms wording in `helpers.ts:218`, asserted by `screen.spec.ts:43` and used at `live.spec.ts:419`. B-01 AC12 and AC13 say "keep rendering" with no time, so a wait until two reads differ asserts that and no rate. The other times in the loss test (lost within 1000 ms, meters zero within 1000 ms) are spec times, were not red and are untouched. A frozen canvas now hangs, the cost already accepted in PD18 and listed in the new Risk row. | None. |
| 6 | Recommended | Amendment 2 paragraph | The paragraph sits between the "Rejected" list and its last bullet ("Keeping the 20 s sleep"), which now reads as part of the amendment text. Amendment 1 already did this; amendment 2 repeats it. | Move the two Amendment paragraphs below the Rejected list. |
| 7 | Recommended | Risks | The row "A render-scale assertion (`live.spec.ts:384`, `:440`) may fail under load" no longer fits: T13 removes the step-up deadline, and the line numbers moved. | Reword it to the remaining assertions (step down in 4 s and 8 s, the 3 s hold) or drop the line numbers. |

No Required findings. T13 and T14 are concrete and checkable (named file, test, label, wait
value and the assertions that stay), each is small (one file, well under 400 lines), neither adds a
dependency or touches product code, secrets, infrastructure or a guarded area, both name Depends
on and an Autonomy note, and no retry or raised threshold appears. The render-scale verdict was
the owner's under spec Out of scope and PD20 records the owner's answer. Owner rows for the human:
PD20 (R1 to R4) is already answered; PD21 is a Confirm.

### Checklist
- [x] Every AC maps to at least one task
- [x] Every task maps to at least one AC (no orphans)
- [x] Each task's expected output is concrete enough to check, and is what we need
- [x] Existing patterns reused; nothing reinvented
- [x] No new dependency without an approval note
- [x] Data changes additive and reversible
- [x] Errors, empty states and permissions are tasks, not afterthoughts
- [x] Each task reviewable in one sitting
- [x] Verification named per task
- [x] Nothing touches prod, secrets or infra it should not
- [x] Every task has a Depends on and an Autonomy note
- [x] No two tasks in one parallel group write the same file

### Task graph as audited
| Task | Depends on | Parallel group |
|---|---|---|
| T1 | none | 1 |
| T2 | T1 | 2 |
| T3, T4, T5, T6, T9, T10, T11, T14 | T2 | 3 |
| T12 | T4 | 4 |
| T13 | T12 | 5 |
| T7 | T3, T4, T5, T6, T9, T10, T11, T12, T13, T14 | 6 |
| T8 | T7 | 7 |

Verdict: **PASS**
Audited by: plan-auditor (agent), 2026-11-14
