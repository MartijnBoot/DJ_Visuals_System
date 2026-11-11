---
description: Turn an approved spec into an auditable task plan (read-only)
argument-hint: [phase id, e.g. 3 or b-07]
allowed-tools: Read, Grep, Glob, Bash(git*), Bash(ls*), Bash(find*), Bash(rg*), Bash(python*), Bash(py*), Write, Edit
model: claude-fable-5-2
---

Plan **$1**.

Spec: `docs/specs/phase-$1-*.md`. If it does not exist, or is not `Status: Approved`, stop and
say so — **no implementation before an approved plan, and no plan before an approved spec.**

## Rules

**Explore read-only.** The only file you may create or edit is `docs/plans/phase-$1-*.md`
(same slug as the spec). No implementation code, no scaffolding, no "while I was here" fixes.

Read first: the spec, `docs/invariants.md`, `docs/design/`, `docs/adr/`,
`docs/specs/defect-register.md`, `CLAUDE.md`'s hard stops, and the actual code you intend to
change. Do not reopen decisions already in an ADR or the spec's `SD` list — if you disagree,
put it under Risks.

Delegate wide exploration to `phase-planner` or `codebase-analyst` agents so the reading does
not consume this session's context.

## Output

`docs/plans/phase-$1-<slug>.md`, following `docs/plans/_template.md` exactly: Approach,
Decisions this plan makes (`PD` rows, **Confirm** and **Owner** marked), Files, Tasks (each
with *Implements*, *Expected output*, *Verification*, *Depends on*, *Autonomy note*), Task
graph, Data changes, Risks and unknowns, Human steps, Out of scope, and the audit checklist.

The plan is also a **work queue**: `/build` schedules from `Depends on`, so every task needs
one, and no two tasks in the same parallel group may write the same file.

## What makes this plan good or useless

- **Every acceptance criterion maps to at least one task. Every task maps back to at least
  one criterion** (or a spec decision). Orphan tasks are where scope creep enters.
- **Each task is one vertical slice that leaves the system working** — not "the whole
  backend".
- **Reviewable in one sitting**: about ≤400 changed source lines across ≤10 files. Test
  lines do not count toward the 400. Split anything larger.
- **Verification named per task.** "Tests pass" is not a verification; `pytest
  tests/db/test_rehydrate.py` is.
- **Name the existing module to reuse.** Duplicated logic is the most likely failure mode.
- **No new dependency without an approval note**: what it does, why not the standard library,
  licence, maintenance status.
- **Existing tests the change makes untrue** are listed, each against the task that changes it.

## Finish by

1. Running `python scripts/check_plans.py docs/plans/phase-$1-<slug>.md` and fixing every
   finding — that is the mechanical half of the audit, and an auditor should not spend time
   on it.
2. Stating plainly what you are uncertain about, and every **Owner** row I must answer.

Then the plan goes to its audit: `/audit $1` with me, or `plan-auditor` in a fresh context if I
delegate it. A plan is a proposal, not an instruction — an agent will happily plan, build and
verify the wrong thing to a very high standard.
