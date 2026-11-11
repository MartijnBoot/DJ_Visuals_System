---
description: Bring an existing codebase under the workflow — inventory what is really there, then draft the docs the loop reads
argument-hint: [optional: the area that matters most, e.g. "billing" or "src/engine/"]
model: opus
---

Adopt the workflow in this existing repository. Focus, if given: **$ARGUMENTS**

The workflow files are installed (`.claude/`, `scripts/check.sh`, `docs/` skeleton). What is
missing is the part only this codebase can supply: what it is, how it is checked, what must
never silently change, and what is already wrong with it. You find that out and draft it. You
do not change the application.

## Preconditions — stop if any fails

- The working tree is clean and you are on a branch (suggest `chore/adopt-workflow`), not
  `main`.
- `bash scripts/check.sh` runs (its two workflow steps are green, project steps not yet wired).

## 1. Read what is already written down

README, existing docs, ADRs or decision notes, CONTRIBUTING, the CI configuration, the package
manifests and lockfiles, lint/format/type configs, the test folders, docker/compose files.
Note every command a developer runs today and where it is defined.

## 2. Analyse, in parallel

Launch three `codebase-analyst` agents in one message, each with its own slice:

1. **The toolchain.** Every check that exists — format, lint, types, unit, integration, e2e,
   build — the exact command, whether it passes **today** (run it), how long it takes, and what
   CI actually runs. Anything CI restates that a script should own.
2. **The architecture as it is.** Entry points, modules and their boundaries, data stores,
   external calls, where configuration and the environment are read (every place), auth.
   `file:line` for every claim. Dead code under the live configuration.
3. **The risk.** The code whose silent change would hurt most (money, permissions, data,
   anything other systems parse) and how well tests pin it today. Defects found on the way,
   each with its consequence.

Spot-check any surprising claim yourself before you repeat it.

## 3. Draft — do not commit

- **`CLAUDE.md`** — fill the template from what is true: the commands an agent cannot guess,
  conventions that differ from defaults, folder meanings, gotchas. Under a page.
- **`docs/design/architecture.md`** — the system as it is today, with `file:line`; "as found",
  not "as it should be".
- **`docs/specs/defect-register.md`** — every defect found, as `D-01`, `D-02`, … with where,
  consequence and a suggested phase. Do not fix any.
- **`docs/invariants.md`** — proposed invariants and guarded areas, each with its
  **Enforced by**: an existing test, or "not yet — proposed for Phase 0". Proposed interview
  probes for this product.
- **`docs/adr/0001-setup-decision-record.md`** — the decisions already taken (stack, hosting,
  database, auth), with reason "inherited" where nobody knows why. An existing ADR log stays
  where it is; link it instead.
- **`scripts/check.sh`** — `project_step` lines for the checks that exist today, in order,
  fast first. **A check that fails today stays in and stays red** — do not drop it, comment it
  out or weaken it to get green. Say which ones are red.
- **`.claude/guard-paths.json`** — the migrations folder as `append_only` (if names sort in
  order; say so if they do not), and generated or golden files as `protected`.
- **`.claude/settings.json`** — allow entries for the project's own tool commands.

## 4. Then stop and report

- What is green today and what is red, with the output.
- The guarded area you would pin first, and how: characterisation (golden) tests that capture
  today's behaviour before anyone changes it.
- A proposed **Phase 0 — foundations** as a backlog item or spec input: make the gate honest
  and green, CI runs `bash scripts/check.sh`, pin the first guarded area, turn the first
  invariant into a test.
- Every question only I can answer.

Tell me to review and commit the drafts (`chore: adopt the workflow`), then start a **fresh
session** for `/spec 0`.

## Never, in this command

- Never change application code, fix a defect, or reformat the codebase. A formatter rollout is
  its own task with its own commit (and a `.git-blame-ignore-revs` entry).
- Never delete or rewrite existing docs; link and supersede.
- Never guess a convention. "Unknown — ask the owner" is a valid entry.
