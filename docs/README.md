# Documentation

Intent lives here, versioned in git, not in chat history (way-of-working 2).

| Path | Contents | Written by |
|---|---|---|
| [way-of-working.md](way-of-working.md) | The operating manual. Everything here follows it; a departure is an ADR. | — |
| [invariants.md](invariants.md) | What every change keeps; the guarded areas; the interview probes. | you, at Phase 0 / `/adopt` |
| [backlog.md](backlog.md) | Ideas, ordered, before they become specs. | `/backlog` |
| [specs/](specs/) | One spec per unit of work; acceptance criteria live here. Plus the defect register. | `/spec` |
| [plans/](plans/) | One audited plan per spec — also `/build`'s work queue. Human-steps files. | `/plan`, `/audit` |
| [adr/](adr/) | Decisions with consequences. One page each. 0001 is the Setup Decision Record. | you, at step 9 (Log) |
| [design/](design/) | The architecture, as it is (and as it is going). | you; `/adopt` drafts it |
| [runbooks/](runbooks/) | Deploy, rollback, restore, incident. Rehearsal records. | you |

## Start here

1. [invariants.md](invariants.md) — what must not break.
2. [adr/0001-setup-decision-record.md](adr/0001-setup-decision-record.md) — the decisions and what they cost.
3. [design/architecture.md](design/architecture.md) — the system.

## How a piece of work moves through these folders

```
backlog.md  B-07 idea ─► ready ─► specced
                                     │
specs/phase-b-07-x.md   Draft ─► Approved (you)
                                     │
plans/phase-b-07-x.md   Draft ─► Audited (you, or plan-auditor PASS)
                                     │
branches feature/phase-b-07-t1-…, t2-…  ─► /verify ─► /review ─► you merge
                                     │
adr/  a decision with consequences   ·   invariants.md  a new rule, with its test
```

File names: `phase-<id>-<slug>.md`, `<id>` a phase number or a backlog id (`b-07`). The `_template.md`
files in specs/ and plans/ are the formats; `scripts/check_plans.py` enforces the plan format in the
gate.
