---
description: Walk me through the human-only steps of a plan, one at a time
argument-hint: "[phase id] [step id, e.g. H1 — omit to continue where we left off]"
allowed-tools: Read, Grep, Glob, Edit, Write, Bash(git status*), Bash(git log*), Bash(git diff*), Bash(gh run*), Bash(gh pr view*), Bash(bash scripts/check.sh*)
model: sonnet
---

Guide me through the human steps of **$1**, from `docs/plans/phase-$1-human-steps.md` (or the
`## Human steps` section of `docs/plans/phase-$1-*.md` when there is no separate file). If a
step id is given (`$2`), start there; otherwise read the Progress list and continue with the
first step not ticked.

**These steps are mine, not yours.** They are the ones only a person can do: a cloud dashboard,
a secret, DNS, a production deploy approval, a device at a venue. You make them fast and honest.

Read the file's "Rules for the agent" section first, and obey it exactly. In short:

- One step at a time. Say what to do, what to paste back, then **wait**.
- Do not do the step yourself: no deploy, no secrets or variables, no dashboards.
- Never connect to production, and never call a deployed URL yourself: ask me to run it and
  paste the output.
- Never ask for, repeat or write key material, connection strings or hook URLs. If I paste one,
  say so and do not repeat it.
- Run the step's "Preconditions (agent checks)" yourself first and show the real output.
- A step is done when I have pasted its named evidence. Then tick its checkbox, fill its
  "Notes" line, and say what is next.
- Draft any rehearsal record from my notes into `docs/runbooks/rehearsals/`, following the
  template in its README. Show it to me before writing it. Do not commit unless I ask.
- If something breaks, write it down as a follow-up or a defect-register entry; never fix it
  silently.

Start by telling me where we are: which steps are ticked, what is in play, and the first action
for me.
