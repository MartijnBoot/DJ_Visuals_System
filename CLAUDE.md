# CLAUDE.md

Guidance for Claude Code in this repo. Fuller context: [README.md](README.md),
[docs/way-of-working.md](docs/way-of-working.md), [docs/invariants.md](docs/invariants.md).

<!--
Keep this under a page (way-of-working 4.4). For every line ask: would removing it cause a
mistake? If not, cut it. A rule ignored twice becomes a hook or a test, not a louder line.
Replace every <...>; delete what does not apply.
-->

## Project

<Name> — <one sentence: what it is, for whom>. <Stack in one line: e.g. FastAPI (`app/`) +
React (`web/`), Postgres (`db/`)>.

## Commands

- `bash scripts/setup.sh` — clone to running stack. Idempotent.
- `bash scripts/check.sh` — the gate: <format, lint, types, unit, integration>, stopping at the
  first failure. CI runs this same script. Run it before calling any task done.
- `python scripts/check_plans.py --graph docs/plans/<plan>.md` — a plan's build order.
- `<the command to run the app>`
- `<the command to create / apply a migration>`
- `<any command an agent cannot guess>`

## Workflow

- New work: `/backlog` → `/spec` → `/plan` → `/audit` → `/build` → `/verify` → `/review`, one
  fresh session per step ([.claude/README.md](.claude/README.md)). Existing code first gets
  `/adopt` once.
- Work from an audited plan in `docs/plans/phase-<id>-*.md`. No task without a signed audit —
  not yours to waive.
- One task per branch (`feature/phase-<id>-t<n>-<slug>`), conventional commits
  (`feat(phase-<id>): T<n> — ...`).
- Bug fixes start with a failing test; a feature's acceptance criteria become its test cases.
- Run `bash scripts/check.sh` and paste the actual output before saying a task is done —
  "tests pass" is not evidence.
- If a requirement is genuinely ambiguous, stop and ask; do not guess.

## Conventions

- <Where configuration is read — one module, validated at boot; nowhere else reads the env.>
- <Folder meanings that are not obvious. Define `lib/`, `core/`, `utils/` here or do not use them.>
- Types at the boundary: every external input is validated before use.
- A new dependency needs justification (what, why not the standard library, licence,
  maintenance) — ask first.
- <Environment quirks and gotchas that cost someone an afternoon.>

## Never

- Never edit a migration that already has a successor — add a new one
  (`.claude/guard-paths.json` blocks Write/Edit; it does not see Bash, so no `sed -i` either).
- Never commit `.env*` (except `.env.example`), real secrets or credentials.
- Never use production credentials, or connect to production, from a dev or agent session.
- <Files nobody hand-edits: generated code, golden fixtures, vendored copies.>

## Hard stops — the owner's, never an agent's

Everything with a consequence a `git revert` cannot undo stays with the owner. Stop, state the
question, the evidence and your recommended answer, and wait:

- A spec ambiguity with two readings that produce different user-visible behaviour.
- A guarded area in `docs/invariants.md` changes behaviour, or its guardian reports a change.
- A new third-party dependency is needed.
- A decision that reverses or contradicts an accepted ADR, or changes anything in `docs/design/`.
- A credential, secret or external account is needed — anything you would have to be given
  rather than compute.
- A cross-phase invariant is broken and cannot be restored inside the task that broke it.
- Pushing, merging, opening a PR, deleting a remote branch, any history rewrite or force-push.
- Anything that touches production.
