---
description: Implement a task — or a whole plan, task by task — from an audited plan, test-first, with evidence
argument-hint: "[phase id] [task id, e.g. T3 — omit to build every task in the plan]"
model: opus
---

Phase **$1**, task **$2**, from `docs/plans/phase-$1-*.md`.

**If no task id is given, build the whole plan:** every task, one at a time, in the order of
its task graph (`python scripts/check_plans.py --graph <plan>` prints it). Each task follows the
single-task rules below — its own branch, its own failing test first, its own commit — before
the next one starts. Batching does not loosen any rule; it only saves me typing the next
command.

## Preconditions — check these and stop if any fails

- The plan exists and its audit is signed: `Audited by` filled in with a name and date — mine,
  or `plan-auditor`'s PASS. **No implementation before an audited plan.**
- Every **Owner** row in the plan has an answer.
- Task $2 exists in that plan (single-task mode).
- The working tree is clean, and you are on a feature branch — not `main`.

## Scope

**Only the current task. Only the files that task names.** If you find something else that
wants fixing, write it down and tell me; do not fix it. A 40-file diff is not a favour.

If a requirement turns out to be ambiguous, **stop and ask** rather than guessing. A confident
guess that solves the adjacent problem is the most likely failure mode.

If the task turns out to be bigger than the plan assumed — past about 400 changed source lines;
tests do not count — stop and say so. Do not silently expand it.

## How

1. **Write the failing test first, and run it to see it fail.** For a bug fix, the regression
   test comes before the fix, always. For a feature, the acceptance criteria become the test
   cases.
2. Implement the simplest thing that satisfies the criteria. **No new abstraction unless two
   callers exist today.**
3. Follow the existing pattern — the plan names the module to imitate. Use only libraries
   already in the project; a new dependency needs my approval first.
4. Run the task's named verification. In single-task mode, also `bash scripts/check.sh`.
   Iterate until green.
5. If the diff touches a guarded area in `docs/invariants.md`, run its extra check and its
   guardian agent before calling the task done.

## Whole-plan mode

- **Branches stack.** Task N's branch, `feature/phase-$1-tN-<slug>`, is cut from the previous
  task's branch, so later tasks build on earlier ones before I have merged anything. Commit
  each task on its own branch (`feat(phase-$1): TN — ...`).
- **Per task: its named verification and the tests it adds or touches.** Then commit and go
  straight on to the next task — do not stop to report or ask after a green task.
- **The full gate runs once, on the tip of the stack**, after the last task. Because the
  branches stack, the tip contains every task. Say plainly in the report that the intermediate
  commits were not gated one by one. If the tip is red, find the task responsible, fix it on
  that task's branch as a new commit (never amend), and rebase the later branches onto it.
- **Stop the whole run — do not skip to the next task — on:** a red check you cannot make
  green within the task's scope; anything the task's autonomy note says to stop or ask on; a
  guardian reporting a behaviour change; an ambiguity; a task that has grown beyond the plan;
  any hard stop in `CLAUDE.md`. Report where you stopped and what is still unbuilt.
- **Steps that need me** (a human step, "green in CI before merge") are not yours to wait for:
  note them against the task and carry on, unless a later task's correctness depends on the
  result.
- **Subagents run on sonnet.** Whenever you dispatch one, pass `model: "sonnet"` explicitly.
- **Never push, merge or open a PR.** I do that, in order.
- Keep a running ledger for the final report: per task, branch, commit, the check command and
  its result.

## Invariants you must not break

Every row of `docs/invariants.md` → "Cross-phase invariants". Read them before the first task.
A task that would break one, and cannot restore it inside its own scope, is a hard stop.

## Finish with evidence, not assertions

Show the actual command and its actual output, for every task. "Tests pass" is not acceptable;
the test output is. If something is still failing, say so plainly and show it — do not report
partial work as complete.

Then tell me to run `/review $1` in a **fresh session** — per task, in order. You must not be
the only reviewer of your own code.
