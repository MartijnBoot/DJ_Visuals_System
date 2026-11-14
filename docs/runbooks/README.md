# Runbooks

How to operate the product, written before they are needed (way-of-working 10.1: deploy,
rollback, restore, incident, common failures). Each one is a numbered list someone can follow
at 23:00 without the author present.

| Runbook | Covers | Last rehearsed |
|---|---|---|
| `deploy.md` | Shipping a tagged artifact to each environment | — |
| `rollback.md` | Back to the previous artifact, and the target time | — |
| `restore.md` | A backup into a scratch database, end to end | — |
| `incident.md` | Detect, declare, mitigate, communicate, resolve, post-mortem | — |

A rollback that has not been rehearsed does not exist (non-negotiable 13). Every rehearsal leaves
a record in [rehearsals/](rehearsals/).

## The gate under load

`pnpm check:load` runs `bash scripts/check.sh` while the machine is busy: busy-loop worker
threads on half the cores and a second headless Chromium rendering a started set from its own
server on `127.0.0.1:8124` (`scripts/under-load.ts`). It exits with the gate's code, or 1 with
`load died: this run proves nothing` when the load stopped during a green run. Run it when a
check is suspected of being a timing flake: a check it turns red on a tree whose gate is green
is a defect to fix, never to re-run. It is not the gate and CI does not run it (B-08 SD8); it
takes roughly twice as long as `bash scripts/check.sh`.
