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
