# Invariants — what every change keeps

The one page of project-specific rules the workflow's commands read. `/spec`, `/plan`,
`/audit`, `/build`, `/verify` and `/review` are generic and identical in every repository; what
makes them strict *here* is this file. Keep it short and true. Every line costs attention in
every session that reads it.

<!--
Fill this in during Phase 0 (a new project) or /adopt (an existing one). An invariant earns a
row when breaking it would be expensive and easy to miss. Something a linter already enforces
does not need a row; something only a person remembers does.
-->

## Cross-phase invariants

They hold from the phase that introduces them onward, and every later task's Definition of Done
re-checks them. **Enforced by** names the test, hook or check that fails when the invariant
breaks; "review only" is honest but is a debt, and the next task near it should pay it.

| Since | Invariant | Enforced by |
|---|---|---|
| 0 | The environment is read in one module (`<path/to/config>`), validated at boot; nowhere else | `<tests/meta/test_config_boundary.py>` |
| 0 | No secret, key or personal data in code, tests, logs or fixtures | gitleaks in CI; review |
| 0 | Migrations are append-only: a migration that has a successor is never edited | `.claude/guard-paths.json` → `append_only` |
| <n> | <...> | <...> |

## Guarded areas

Code whose silent change is the expensive kind: the pricing engine, the billing maths, the
permission matrix, a parser other systems depend on. A diff touching one of these paths gets the
named extra check in `/verify` and the named guardian in `/review`, and a behaviour change there
is an owner stop (CLAUDE.md).

| Paths | Extra check (`/verify`) | Guardian (`/review`) | Why |
|---|---|---|---|
| `<src/engine/**>` | `<pytest tests/engine>` (golden fixtures) | `invariant-guardian` | <what breaks, and why nobody would notice> |

Delete the table's example row if nothing qualifies yet — and delete
`.claude/agents/invariant-guardian.md` with it, or leave it for the day something does.

## Interview probes

The questions that reliably surface something in *this* product. `/spec` asks the relevant ones
before writing a spec. Examples to replace:

- What happens if this occurs mid-operation, with users waiting?
- What happens if the process restarts while this is in flight?
- Does this touch money? What exactly happens on a retry?
- Who may do this — which role, and which may not?
- Does this change a guarded area? If so, stop: that is an ADR first, not a spec.

## Out of scope for the whole product

What nobody should spec, plan or build without an ADR changing it first.

- <...>
