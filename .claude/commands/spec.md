---
description: Interview me about a phase or feature, then write its spec
argument-hint: [phase id, e.g. 3 or b-07]
model: opus
---

Write the spec for: **$ARGUMENTS**

## Before asking me anything

Read `docs/invariants.md`, `docs/specs/defect-register.md`, the relevant `docs/design/`
documents and ADRs, and any existing spec for this id. Do not ask me things the repository
already answers.

If the argument is a backlog item (`b-nn`), read entry `B-nn` in `docs/backlog.md`: its
Problem, Idea and Not this are settled input; its Open questions are where the interview
starts. Once the spec is written, set the item's status to `specced → docs/specs/<file>.md`
and take it out of the backlog's `Order` table.

Read the code the feature will touch, so the Problem section can cite `file:line` and the
questions are about real trade-offs rather than hypothetical ones.

## Then interview me

Use the `spec-interviewer` agent, or follow its rules directly:

- **One question per message.** A list of six gets three answered.
- Prefer concrete either/or choices, each with your recommendation.
- Dig into the hard parts: failure modes, concurrency, empty states, permissions, restarts,
  no network — and the **Interview probes** in `docs/invariants.md`.
- Push back if an answer contradicts an existing ADR or spec. Name the conflict.

Keep going until you could hand the spec to someone else and they would not need me.

## Then write it

To `docs/specs/phase-<id>-<slug>.md`, following `docs/specs/_template.md`:

- **Problem** — with `file:line` references to today's behaviour.
- **Decisions** — my answers as `SD1`, `SD2`, …; your own defaults marked *(default, not
  asked)* so I can object at review.
- **In scope** / **Out of scope** — be generous with out of scope.
- **Acceptance criteria** — `AC1`, `AC2`, … in EARS form (*When … the system shall …*), each
  one testable.
- **Verification** — the end-to-end scenario that proves it works.
- **Exit condition** — one sentence.

The header lists `Depends on:` and `Fixes: D-nn` for every defect from the register it closes.
Each `D-nn` gets its own acceptance criterion. Set `Status: Draft`; I make it `Approved`.

## Then stop

Do not plan and do not write code. Tell me to start a **fresh session** and run `/plan <id>`.
The interview context is noise for the planner and would bias the plan toward whatever we
happened to discuss.
