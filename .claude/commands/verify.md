---
description: Run the full local gate and report the actual output as evidence
model: haiku
---

Run the checks and report evidence.

$ARGUMENTS

## Run

1. `bash scripts/check.sh` — the full local gate. This is the same script CI runs; there is
   one definition of green. If it prints the "no project checks are wired yet" warning, say so
   in the verdict: the green covers the workflow files only.
2. For every guarded area in `docs/invariants.md` that the diff (`git diff main...HEAD
   --stat`) touches: run that row's **Extra check** and report its result on its own line.
3. If the diff touches migrations: apply **and** roll back against a scratch database.
4. If the diff touches the UI: the type check, the unit tests, and the e2e journey it affects.

## Report

For each check: the **command** and its **actual output** (the tail that shows the result, and
every failure in full). Not a summary, not a claim.

Then a single verdict line: **green** or **red**. If red, quote the failure and stop — do not
attempt a fix in this command, and do not describe the work as complete.

Local green is evidence for the task. CI green on the merged commit is evidence for the merge:
after a merge, check `gh run list --branch main` — a gate that is green on one operating system
can be red on another.

## What not to do

- Do not fix the root cause by suppressing the error.
- Do not skip a check because it is slow or because you are confident.
- Do not say "should pass" about anything you did not run. If you could not run it, say which
  one and why.
