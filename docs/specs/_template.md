# Spec: <id> — <name>

Status: Draft | Approved · Depends on: <specs or phases this builds on, or —> ·
Fixes: <D-nn from defect-register.md, or —> · Backlog: <B-nn, or —>

Line references are to `main` at `<short sha>`.

<!--
How this file is made: `/spec <id>` interviews you (one question per message, the hard parts
first), then writes it. You approve it by setting Status: Approved. Nothing is planned before
that. File name: docs/specs/phase-<id>-<slug>.md, where <id> is a phase number (0, 1, 2 ...)
or a backlog item (b-07). Delete the sections that do not apply; keep the order of the rest.
A good spec is self-contained: someone else could implement it without asking you anything.
-->

## Problem

Who runs into what, and what it costs them today. Today's behaviour, with `file:line`
references, so the reader can check the claim rather than trust it.

## Decisions

The interview's answers, numbered so the plan and the code can cite them. The planner must not
reopen any of them; a planner who disagrees says so under Risks.

- **SD1 — <decision>.** <What was decided, in one or two sentences, and the reason.>
- **SD2 — <decision>.** <...> *(default, not asked — object at review)*

## Users and permissions

| Role | Can | Cannot |
|---|---|---|

## In scope

- <the files, modules and interfaces involved>

## Out of scope

Be generous: everything a reader might assume is included and is not.

- <...>

## Acceptance criteria

Each one testable, each one becomes at least one test. EARS form. Every `Fixes: D-nn` in the
header gets its own criterion.

- **AC1.** When <trigger>, the system shall <response>.
- **AC2.** While <state>, the system shall <response>.
- **AC3.** If <error condition>, then the system shall <response>.

## Data

New or changed tables, fields, indexes, constraints. Additive or reversible; the expand →
migrate → contract sequence for anything breaking.

## API contract

| Method | Path | Request | Response | Errors |
|---|---|---|---|---|

## UI

Screens and their states: loading, empty, error, partial, success. Key interactions.

## Non-functional

Performance target · authorisation rules · accessibility · what must be logged or measured ·
limits (rate, size, pagination).

## Edge cases and failure modes

What happens mid-operation with users waiting, on restart, with no network, on a retry, with
two at once. The questions in `docs/invariants.md` → "Interview probes" go here.

## Verification

The end-to-end scenario that proves it works, start to finish, as steps someone can run.

## Exit condition

One sentence.

## Open questions

None, when Status is Approved.
