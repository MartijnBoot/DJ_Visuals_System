## What and why

Spec: `docs/specs/phase-___.md` · Plan: `docs/plans/phase-___.md` · Fixes: D-__ / none

## Section

Which slice of the plan is this? (T_ of the plan; one task per PR, or a stack in order.)

## How it was verified

<paste the command and its output — not "tests pass">

- [ ] `bash scripts/check.sh` green (output above)
- [ ] Guarded-area checks run, if the diff touches one (`docs/invariants.md`)
- [ ] Exercised by hand locally
- [ ] Fresh-context review (`/review`) run in a session that did not write the code; findings addressed
- [ ] A human has read the whole diff

## Data changes

- [ ] None
- [ ] Migration: <name> — additive? reversible? backfill? applied and rolled back on a scratch DB?

## Rollback

How do we undo this? (revert / flag / previous artifact / corrective migration)

## New dependencies

None / <name — what it does, why not the standard library, licence, maintenance status>

## Checklist

- [ ] Only files in the task's scope changed
- [ ] No secrets, keys or personal data in code, tests or logs
- [ ] Docs / `.env.example` / API contract / ADR updated where behaviour changed
- [ ] Feature flag added if user-visible and not yet signed off
