# Agent configuration

Committed on purpose (way-of-working 5.1), so the workflow is part of the repo rather than
folklore. The commands and agents here are generic: what makes them strict for *this* project
is [../docs/invariants.md](../docs/invariants.md) and the hard stops in [../CLAUDE.md](../CLAUDE.md).

## Commands — the loop, one step at a time

New work runs one fresh session per step; clear whatever you happened to discuss.

```
  /adopt               existing code only, once: inventory → draft CLAUDE.md, invariants, gate
  /backlog <idea>      brainstorm → docs/backlog.md; promote the next item to /spec
  /analyse <thing>     understand what is really there                (read-only)
  /spec <id>           interview → docs/specs/phase-<id>-*.md         → you approve
  /plan <id>           read-only → docs/plans/phase-<id>-*.md
  /audit <id>          you sign the plan (or delegate to plan-auditor)  ← the step teams skip
  /build <id> [T]      ONE task (or the whole plan, task by task), test-first
  /verify              run the gate, produce evidence
  /review <id> [T]     fresh context reviews the diff                 ← never the author
  /human <id>          walk the steps only a person can do
```

`<id>` is a phase number (`0`, `1`, …) for planned build-out, or a backlog item (`b-07`) for
everything after. Files follow it: `docs/specs/phase-b-07-<slug>.md`,
`docs/plans/phase-b-07-<slug>.md`, branches `feature/phase-b-07-t3-<slug>`.

| Command | Purpose | Model |
|---|---|---|
| `/adopt` | Bring an existing repo under the workflow: analyse, draft the docs, wire the gate | opus |
| `/backlog` | Brainstorm an idea into `docs/backlog.md`; order it; promote it to `/spec` | opus |
| `/analyse` | Fan out `codebase-analyst` agents over a slice of the code | sonnet |
| `/spec` | Interview, then write a spec | opus |
| `/plan` | Read-only exploration → an auditable, schedulable task plan | opus |
| `/audit` | `check_plans.py`, the traceability table and the checklist, walked with you | sonnet |
| `/build` | Implement one task, or a whole plan, from an audited plan | opus |
| `/verify` | Run the gate and the guarded-area checks, report actual output | haiku |
| `/review` | Fresh-context review against spec, plan and invariants | opus |
| `/human` | Guide you through a plan's human-only steps | sonnet |

Model tiers follow way-of-working 4.1: specs, planning and review get the most capable model,
because errors there propagate into everything downstream. Running a check and reporting its
output does not. Re-check the mapping when models change.

## Agents

| Agent | Use when |
|---|---|
| `spec-interviewer` | Starting a unit of work; finds the holes in your thinking |
| `phase-planner` | Turning an approved spec into a schedulable task graph |
| `plan-auditor` | Adversarial plan audit, when you delegate it instead of running `/audit` |
| `fresh-eyes-reviewer` | Before every merge |
| `codebase-analyst` | You need an exhaustive, quotable inventory before designing |
| `invariant-guardian` | A diff touches a guarded area in `docs/invariants.md` (template — fill in or delete) |

No agent is ever the only judge of its own output, which is the one property the whole
arrangement rests on.

## Permissions and the guard

[settings.json](settings.json) is committed: an allowlist broad enough that an agent is not
asking about the test runner for the hundredth time, and a denylist covering real `.env` files,
force-push, history rewrite, `gh secret`/`gh api`/`gh repo`, and `rm -rf`. Approving the tenth
prompt in a row is not review, it is muscle memory — so the interesting refusals are configured
rather than clicked. Add the project's own tool commands to `allow` (`uv`, `pnpm`, `dotnet`, …).

Use `Read(...)` and `Edit(...)` in deny rules; `Edit` covers every file-writing tool.

The `PreToolUse` hook runs [../scripts/hooks/guard.sh](../scripts/hooks/guard.sh) on every
Write/Edit. It blocks paths in [guard-paths.json](guard-paths.json): `protected` globs, and
`append_only` folders (migrations) where only the newest entry may change. It looks for a
Python that actually runs before calling it, and **blocks** if it finds none — a guard that
silently does not run is worse than none. `tests/workflow/` proves it is wired, through `bash`,
the way Claude Code calls it. It does not see Bash: a `sed -i` is not stopped by anything.

In Claude Code's auto mode an agent cannot edit `.claude/**`, nor commit while a `.claude/` path
is staged. Changes to this folder are yours to make by hand.

## The rules these files encode

- No code before a spec. No implementation before an audited plan.
- One vertical slice at a time; a section is only in when it can be left in `main` unattended.
- A runnable check per task. Evidence, not assertions.
- The context that wrote the code never reviews it.
- Agents never hold production credentials.
- Everything with a consequence a `git revert` cannot undo stays with the human — the hard-stop
  list in [../CLAUDE.md](../CLAUDE.md).
