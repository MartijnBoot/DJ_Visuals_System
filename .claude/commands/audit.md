---
description: Walk me through the human audit of a plan — the step teams skip
argument-hint: [phase id, e.g. 3 or b-07]
allowed-tools: Read, Grep, Glob, Edit, Bash(git*), Bash(python*), Bash(py*)
model: sonnet
---

Audit the plan for **$1** with me.

Read `docs/specs/phase-$1-*.md` and `docs/plans/phase-$1-*.md`.

**This step is mine, not yours.** You are here to make it fast and honest, not to approve the
plan. The way-of-working calls this the step teams skip, because a plan looks finished and
reading it carefully is boring. An agent will happily plan, build and verify the wrong thing
to a very high standard.

## Do this

1. **Run the mechanical half:** `python scripts/check_plans.py docs/plans/phase-$1-*.md`.
   Show me its output. Every finding is a required change before anything else.
2. **Show me the traceability table.** Every acceptance criterion against the tasks that
   implement it, and every task against the criteria it serves. Point at:
   - criteria with **no** task — the plan is incomplete
   - tasks with **no** criterion — this is where scope creep enters
3. **Flag each task whose expected output is not concrete enough to check.** "Implement the
   repository layer" is not checkable; "`OrderRepository.create()` writes the order and its
   lines in one transaction, proven by `test_order_atomic`" is.
4. **Flag every task over the size limit** — about 400 changed source lines (tests do not
   count) or 10 files.
5. **List every new dependency** and whether it carries an approval note.
6. **Check data changes are additive and reversible**, and that the expand → migrate →
   contract sequence is stated where anything breaking is involved.
7. **Name anything that touches secrets, production, infrastructure, or a guarded area** in
   `docs/invariants.md`.
8. **Check reuse:** for each task, is there already a module in this repo that does this? Name
   it.
9. **List the plan's Owner rows** — the user-visible choices the spec left open. Each needs my
   answer.

## Then walk me through the checklist

Ask me each line separately and wait for my answer. Do not tick anything on my behalf.

- Every AC maps to at least one task
- Every task maps to at least one AC
- Each task's expected output is what we actually need
- Existing patterns reused; nothing reinvented
- No new dependency without an approval note
- Data changes additive and reversible
- Errors, empty states and permissions are tasks, not afterthoughts
- Each task reviewable in one sitting
- Verification named per task
- Nothing touches prod, secrets or infra it should not
- Every task has a Depends on and an Autonomy note
- No two tasks in one parallel group write the same file

## Then

Edit the plan file directly with whatever I decide — that is faster than negotiating in chat
and the file is the record. Fill in `Audited by` and the date, set the plan's Status to
`Audited`, and commit the plan (and its spec, if not yet committed) when I say so.

Only after that may `/build` run.
