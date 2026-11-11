# Plan: <id> — <name>

Spec: [docs/specs/phase-<id>-<slug>.md](../specs/phase-<id>-<slug>.md) (`Status: Approved`) ·
Status: Draft | Audited

ADRs honoured: <which, and how>. New dependencies: <none | listed under Decisions with an
approval note>.

Line references are to `main` at `<short sha>`.

<!--
How this file is made: `/plan <id>` explores read-only and writes it; `/audit <id>` (you) or
`plan-auditor` (agent, when you delegate) signs it. `/build` refuses to start before that. The
plan is also /build's work queue: it schedules from `Depends on`. `bash scripts/check.sh` checks
the structure (scripts/check_plans.py); the audit judges the content.
File name: docs/plans/phase-<id>-<slug>.md, the same <id> and <slug> as its spec.
-->

## Approach

Two paragraphs. Why this way, and what was rejected (a "Rejected:" list is welcome).

## Decisions this plan makes

Readings of the spec the planner had to choose. **Confirm** rows are for the audit to confirm or
overrule; **Owner** rows are user-visible choices the spec left open, and each one is a stop
(CLAUDE.md hard stops).

| # | Question | Decision | Reason |
|---|---|---|---|
| PD1 | <...> | <...> | <...> |

## Files

| Path | Create/Modify | Purpose |
|---|---|---|

## Tasks

Each task is one vertical slice that leaves the system working, reviewable in one sitting:
about ≤400 changed source lines (tests do not count) across ≤10 files.

### T1 — <name>
- **Implements:** AC1, AC2
- **Expected output:** <concretely, what exists after this task — `Thing.do()` does X, proven by
  `test_x`>
- **Verification:** <the command: `pytest tests/test_x.py`, not "tests pass">
- **Depends on:** —
- **Autonomy note:** <what the builder may settle alone (names, layout, test structure); what it
  must stop and ask about>

### T2 — <name>
- **Implements:** AC3
- **Expected output:** <...>
- **Verification:** <...>
- **Depends on:** T1
- **Autonomy note:** <...>

## Task graph

| Group | Tasks | Files they touch |
|---|---|---|
| 1 | T1 | <...> |
| 2 | T2 | <...> |

No two tasks in one group write the same file. `python scripts/check_plans.py --graph <this
file>` prints the groups the `Depends on` fields actually give.

## Data changes

Migration name, columns, backfill, expand/contract sequence. "None" is an answer.

## Risks and unknowns

| Risk | Mitigation |
|---|---|

## Human steps

Steps only a person can do (a dashboard, a secret, a push). Any AC verified only here is named
here. If there are many, they get their own `phase-<id>-human-steps.md`, run with `/human`.

## Out of scope for this plan

- <anything the spec allows that this plan does not do, and why; an AC named here is accounted
  for without a task>

## Audit (PASS required before implementation starts)

- [ ] Every AC maps to at least one task
- [ ] Every task maps to at least one AC (no orphans)
- [ ] Each task's expected output is concrete enough to check, and is what we actually need
- [ ] Existing patterns reused; nothing reinvented
- [ ] No new dependency without an approval note
- [ ] Data changes additive and reversible
- [ ] Errors, empty states and permissions are tasks, not afterthoughts
- [ ] Each task reviewable in one sitting
- [ ] Verification named per task
- [ ] Nothing touches prod, secrets or infra it should not
- [ ] Every task has a Depends on and an Autonomy note
- [ ] No two tasks in one parallel group write the same file

Audited by: ______  Date: ______
