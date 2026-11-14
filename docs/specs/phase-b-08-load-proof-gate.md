# Spec: b-08 — A gate that load cannot turn red

Status: Approved · Depends on: B-01 (`docs/specs/phase-b-01-live-visual-engine.md`, built), B-02
(`docs/specs/phase-b-02-visual-profiles.md`, built) · Fixes: D-02 · Backlog: B-08

Line references are to `main` at `73aeb66`.

## Problem

`bash scripts/check.sh` is the one definition of green (`scripts/check.sh:4-6`). On 2026-11-14,
two of four runs on the Windows dev machine went red on a timing check, a different one each
time, and each passed when re-run alone (D-02;
`docs/runbooks/rehearsals/2026-11-14-b02-human-checks.md:31`):

- **The compat type check timed out.** `tests/meta/profile-compat.test.ts:12` type-checks
  `web/src/profile-compat.ts` with the compiler API (`tests/meta/compat-check.ts:52-57`). This
  takes about 3 s alone. In the parallel unit run it went over vitest's default 5 s limit:
  `vitest.config.ts` sets no timeout. `tests/meta/features-compat.test.ts:12` uses the same
  helper and carries the same risk. Each file compiles three times: once unmutated
  (`:12-14`) and twice mutated. The unmutated case is also proven by the `types` step:
  `package.json:13` runs `tsc -p tsconfig.json` in every workspace, and `web/tsconfig.json`
  includes `src`, which holds both compat files.
- **The twelve-effect latency check read p95 308.8 ms.** `tests/browser/live.spec.ts:274-298`
  waits 20 s, reads the overlay's p95 and asserts it is at most 50 ms (`:297`). Another screen
  page was rendering at the same time. The sample is frame-submit time minus audio-capture time
  (`engine/src/latency.ts:46-50`, recorded at `engine/src/index.ts:256`). Under load, the
  worklet's message reaches the main thread late and the frame callback runs late, so a busy
  machine inflates the number without any change to the product. The 50 ms in the gate is a
  plan decision (B-01 plan PD13, `docs/plans/phase-b-01-live-visual-engine.md:78`). It is not
  a spec criterion: B-01 AC10 and B-02 AC17 both place the budget "on the owner's screen
  machine", where H3-8a measured 23 ms. PD13 already wrote down a fallback: assert three
  finite numbers and move the 50 ms to H3.

A red gate that a re-run turns green teaches people to re-run instead of reading the failure.
That habit will hide the first real regression.

## Decisions

The owner delegated every open question to the interviewer's recommendation (2026-11-14). SD1
to SD6 record those recommendations. The rest are defaults.

- **SD1 — The gate's latency check proves structure, not milliseconds.** On both looks
  (built-in and twelve effects, so B-02 AC17's "the CI latency check shall run against that
  profile" still holds), the browser test asserts:
  - the set is running on that look;
  - latency samples are being recorded;
  - last, p95 and worst are finite, with 0 ≤ last ≤ worst and 0 ≤ p95 ≤ worst.

  Unit tests prove that no frame draws with older audio than the newest window in hand:
  - the audio source hands out the newest window (`audio/src/source.test.ts:97`, exists);
  - the engine draws with the features set before the frame (`engine/src/index.test.ts:134`,
    planner confirms);
  - the screen reads the features in the same frame, before the engine draws
    (`web/src/Screen.tsx:97-102`, today only a comment).

  Load makes frames rarer but cannot make any of these false. This replaces B-01 plan PD13. It
  is PD13's own written fallback plus the structural checks.
- **SD2 — The 50 ms budget is checked only on the owner's screen machine.** H3's latency step
  is the only check of B-01 AC10 and B-02 AC17's p95 ≤ 50 ms. The gate does not catch a change
  that only makes each frame's own work slower, for example 40 ms of synchronous work per
  frame; H3 catches it. This gap is accepted, and it is written under Edge cases.
- **SD3 — The compat tests stop doing the types step's job and stop timing the compiler.** The
  two "type-checks against the real shapes" tests are removed: the `types` step proves that
  case. A fast meta test proves that `web/tsconfig.json` still covers both compat files, so
  removing those tests loses no coverage. The four mutation tests stay as they are and run with
  no per-test time limit. Their duration is not what they assert.

  This is not "raising a timeout": no threshold is left for the machine to beat. A hung
  compiler is caught by the CI job's own limit.
- **SD4 — The induced load is defined and reproducible.** `pnpm check:load` runs
  `scripts/check.sh` unchanged while two loads run beside it, for the whole run:
  - CPU busy-loops on half the logical cores, rounded up (`os.availableParallelism()`). These
    are worker threads at normal priority.
  - A second headless Chromium with the gate's WebGL and fake-device flags
    (`playwright.config.ts`), rendering a started set on the built app. Its server is its own,
    on port 8124 with a temporary `DATA_DIR`, so the gate's 8123 and its data are untouched.

  When the gate finishes, the script stops both loads and exits with the gate's exit code. This
  matches what happened on 2026-11-14 (a second screen page rendering, plus a busy unit step),
  with some margin. It uses no new dependency: Node `worker_threads` and the Playwright that
  is already installed.
- **SD5 — `check.sh` warns, never refuses, when port 8123 is held.** Before the browser step,
  the gate checks whether 127.0.0.1:8123 can be bound. If it cannot, it prints a warning that:
  - names the likely cause: an orphaned `node` left by a stopped `pnpm start` or a crashed
    Playwright run;
  - says how to find the process;

  and then it carries on. Playwright still fails on the held port (`reuseExistingServer:
  false`); the warning just says why first. Port 8000 does not affect the gate and is not
  checked. "Another WebGL page is running" cannot be detected reliably from a shell, so SD4's
  reproduction proves the fix for that case instead.
- **SD6 — The invariants rows are reworded, not weakened.** In the B-01 `AudioFeatures` row
  and the B-02 `Profile` row of `docs/invariants.md`, "Enforced by" becomes: the `types` step
  (`pnpm typecheck`, which compiles the compat file against the real shapes), the meta test
  that `web/tsconfig.json` covers the compat file, and the mutation tests (fail on drift). The
  invariant itself is unchanged and still fails on drift. The guarded-areas table is empty, so
  this is not a guarded-area change.
- **SD7 — The scope is whatever the reproduction turns red.** *(default, not asked — object at
  review)* D-02 names two checks. D-02's criterion is about the whole gate, so any other check
  that `pnpm check:load` turns red on a green tree is also in scope. It gets the same kind of
  fix: assert a property load cannot break. Never a retry, and never a raised limit on a check
  whose duration is the assertion. The plan lists every such check with its reproduction
  evidence. The render-scale test (`tests/browser/live.spec.ts:395-430`) is about load by
  design. If load changes its verdict, the planner stops and asks; it does not redesign it.
- **SD8 — `pnpm check:load` is not part of the gate or CI.** *(default, not asked — object at
  review)* It roughly doubles a gate run and saturates the machine. It runs for this item's
  verification, and again whenever a timing flake is suspected. The gate stays
  `scripts/check.sh`.
- **SD9 — The earlier documents get pointers, not rewrites.** *(default, not asked — object at
  review)* Two notes are added:
  - B-01 plan PD13 (`docs/plans/phase-b-01-live-visual-engine.md:78`, `:102`): "superseded by
    B-08 SD1".
  - B-01 spec's "GPU cannot keep up" edge case
    (`docs/specs/phase-b-01-live-visual-engine.md:278`): a pointer to this spec.

  No acceptance criterion of B-01 or B-02 changes wording, because neither puts the 50 ms in
  the gate.
- **SD10 — The bug-fix rule applies, and the failing test is the reproduction.** *(default,
  not asked — object at review)* Before any fix, `pnpm check:load` is run three times on the
  current tree on the Windows dev machine, and the outputs go into the plan's evidence. At
  least one run must be red on a D-02 check. If none is, the load is too weak: the builder
  stops and reports rather than tuning the load until the result looks right.

## Users and permissions

| Role | Can | Cannot |
|---|---|---|
| Owner, agent (local) | Run `bash scripts/check.sh` and `pnpm check:load` | Make the gate green by re-running, retrying or raising a threshold |
| CI | Run `bash scripts/check.sh` | Run `pnpm check:load` (SD8) |

## In scope

- `tests/meta/profile-compat.test.ts`, `tests/meta/features-compat.test.ts`,
  `tests/meta/compat-check.ts`: SD3. A new meta test that `web/tsconfig.json` covers both
  compat files.
- `tests/browser/live.spec.ts:273-299`: the latency check per SD1.
- A unit test that the screen reads features before the engine draws in the same frame
  (`web/src/Screen.tsx:97-102`). It may need that wiring moved into a function that can be
  tested; the behaviour is unchanged.
- `scripts/check-under-load.ts` (or a similar name) and the `check:load` script in the root
  `package.json`: SD4.
- `scripts/check.sh`: the port warning, SD5.
- Any other check that the reproduction turns red: SD7.
- `docs/invariants.md`: the two compat rows (SD6). `docs/specs/defect-register.md`: D-02 marked
  fixed, with this spec. The pointers in SD9. `docs/runbooks/`: a line on what `pnpm
  check:load` is for.

## Out of scope

- Retries of any kind, in vitest, Playwright or `check.sh`.
- Raising a timeout or a threshold as the fix for a check whose duration is what it asserts.
- A precondition the gate cannot check, such as "close other browsers first".
- Any change to the product's latency, the engine, the audio analysis or the render-scale
  controller. Nothing here makes the product faster.
- A new engine counter or instrumentation that exists only for the test (option B in the
  interview was rejected).
- A relative latency bound (twelve effects against built-in in the same run). It was rejected
  because it is still two wall-clock readings.
- Measuring the 50 ms budget anywhere other than the owner's screen machine (H3).
- Running `pnpm check:load` in CI, or a CI runner with a GPU.
- Killing an orphaned process on 8123, or refusing to run when the port is held.
- Detecting another WebGL page from the shell.
- The smear-above-posterise freeze, the builder layout, and the D-01 camera-decode tests.
- Any change to what the compat invariants protect.

## Acceptance criteria

- **AC1 (D-02).** When `pnpm check:load` runs on the Windows dev machine against a tree whose
  `bash scripts/check.sh` is green, the system shall finish green on three consecutive runs.
  Before the fix, at least one of three such runs was red on a D-02 check (SD10).
- **AC2.** When `pnpm check:load` runs, the system shall keep CPU busy-loops on
  ⌈availableParallelism / 2⌉ worker threads and a second headless Chromium rendering a started
  set (port 8124, own temporary `DATA_DIR`) for the whole gate run. When the gate ends, either
  way, the system shall stop both and exit with the gate's exit code. No busy-loop thread,
  Chromium or server process shall be left running.
- **AC3.** While the browser latency check runs on the built-in look and on the twelve-effect
  look, the system shall assert that:
  - the overlay names that look;
  - latency samples are recorded (the line is not `–`);
  - last, p95 and worst are finite, with 0 ≤ last ≤ worst and 0 ≤ p95 ≤ worst.

  It shall assert no millisecond bound.
- **AC4.** When the screen runs a frame, the system shall read the audio features in that frame
  before the engine draws. A unit test with a controlled frame clock fails if the read moves
  after the draw or to a later frame.
- **AC5.** When the engine draws a frame, it shall use the features most recently set before
  that frame. When the audio source is read, it shall return the newest window received. Unit
  tests prove both, existing or new.
- **AC6.** When either compat file's real source shape drifts, the system shall fail the gate
  in two places: in the `types` step, and in that file's mutation tests. The mutation tests run
  with no per-test time limit.
- **AC7.** If `web/tsconfig.json` stops covering `web/src/profile-compat.ts` or
  `web/src/features-compat.ts`, then a meta test shall fail. It reads the parsed config's file
  list and does not compile anything.
- **AC8.** If 127.0.0.1:8123 cannot be bound when `check.sh` reaches the browser step, then the
  system shall print a warning that names the port, the likely orphaned-`node` cause and how to
  find the process, and then run the browser step anyway.
- **AC9.** When `bash scripts/check.sh` runs in CI after this change, the system shall pass with
  the same steps in the same order as before, with no retry configured anywhere: vitest
  `retry` and Playwright `retries` are both unset or 0.
- **AC10.** When this item is done, `docs/invariants.md`'s two compat rows shall name the
  enforcement in SD6, and D-02 in `docs/specs/defect-register.md` shall read fixed, citing this
  spec.

## Non-functional

- `pnpm check:load` may take up to about twice as long as a gate run. That is acceptable
  because it is not in the gate.
- The unit step gets faster: two fewer compiler runs.
- No new dependency (SD4).
- `scripts/check-under-load.ts` reads no environment variable directly. It passes the server's
  environment explicitly, as `playwright.config.ts` does (`config.ts` boundary, CLAUDE.md).

## Edge cases and failure modes

- **A real per-frame slowdown (SD2).** Suppose a change adds 40 ms of work to every frame. The
  gate stays green and H3's latency step catches it on the owner's screen machine. That is
  accepted: the gate cannot tell this apart from a busy machine without a wall-clock number.
- **A real structural regression.** Suppose a queue, or a one-frame lag between the features
  being read and the draw. AC4 and AC5 fail on any machine.
- **The load is too weak to reproduce D-02 (SD10).** The builder stops and reports. It does not
  strengthen the load until a run goes red.
- **The load turns a different check red (SD7).** That check is in scope and gets a property
  fix. If it is the render-scale test, the builder stops and asks.
- **`pnpm check:load` is interrupted (Ctrl-C).** The loads stop, with no orphaned Chromium,
  server or worker (AC2). Port 8124 is free afterwards.
- **8124 is held.** The load script fails before starting the gate and names the port. A
  silently weaker load would make AC1 meaningless.
- **The compiler hangs in a mutation test.** There is no per-test limit, so the CI job's own
  limit ends the run red. Locally the run hangs visibly. That is preferable to a limit that
  load can trip.
- **Port 8123 is held by a live `pnpm start` the user wants.** The warning still prints and
  the browser step fails as it does today. The gate never kills anything.

## Verification

1. On the current tree, before any change, run `pnpm check:load` three times on the Windows
   dev machine. Keep the outputs: at least one is red on a D-02 check (SD10, AC1's "before").
2. Build the item.
3. Run `bash scripts/check.sh`. It is green. Paste the output.
4. Run `pnpm check:load` three times in a row. All three are green, and after each one no
   `node` is listening on 8123 or 8124 and no headless Chromium is left (AC1, AC2).
5. Temporarily rename `amount` in `engine/src/profile.ts`. The `types` step and
   `profile-compat`'s mutation tests both fail. Revert. Do the same with `level` in
   `audio/src/features.ts` (AC6).
6. Start `pnpm start` on `PORT=8123` in another terminal and run `bash scripts/check.sh`. The
   warning names 8123 and the orphaned-`node` cause before the browser step (AC8). Stop the
   server.
7. Push the branch. CI runs `bash scripts/check.sh` and is green (AC9).
8. On the owner's screen machine, H3's latency step (twelve effects, owner's load) still reads
   p95 ≤ 50 ms (SD2). This is the owner's step.

## Exit condition

On the Windows dev machine, `pnpm check:load` is green three times in a row on a green tree,
and the 50 ms budget is checked only where it means something: on the owner's screen machine.

## Open questions

None.
