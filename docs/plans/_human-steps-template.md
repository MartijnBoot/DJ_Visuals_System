# Plan: <id> — the human steps (H1–Hn)

Spec: [docs/specs/phase-<id>-<slug>.md](../specs/phase-<id>-<slug>.md) · Parent plan:
`phase-<id>-<slug>.md` · Status: **Not started** · Run it with `/human <id>` (an agent walks
you through it; you do the steps)

These are the steps only a person can do: a cloud dashboard, a secret, DNS, a production
approval, a device on a network. The agent's job is to make them fast and honest: check what it
can, tell you the next step, collect the evidence, and draft the record. It does not do the
steps.

**Exit:** <the spec's exit condition, as far as these steps carry it>. Evidence: <the records
under `docs/runbooks/rehearsals/`>.

## Rules for the agent

1. **One step at a time.** Say what to do, what to paste back, and wait.
2. **You do not do the human steps.** No deploys, no secrets or variables, no dashboards.
3. **Never connect to production.** Ask the human to run the check and paste the output.
   Reading CI (`gh run list`, `gh run view`) is fine: it is not production.
4. **No key material, ever.** Do not ask for a key, a connection string or a hook URL, and do
   not write one into a file. If the human pastes one, say so and do not repeat it.
5. **What the agent may do:** read-only checks; draft a record from the human's notes; tick
   this file's checkboxes and fill the "Notes" lines when the human confirms a step. Commit
   only when asked.
6. **Evidence over assurance.** A step is done when the human has pasted the output named under
   "Evidence", not when they say it went fine.
7. **Anything that broke** becomes a follow-up task or a defect-register entry, never a silent
   fix.

## Order

Suggested: <H1, H2, …>. Dependencies: <`H2←T4`, …>.

## Progress

- [ ] **H1** <name>: `<yyyy-mm-dd>-<what>.md`

---

## H1 — <name> (<the AC it proves>)

**Why now:** <one sentence>

**Preconditions (agent checks):**
- <a command the agent runs and shows, e.g. `gh run list --branch main --limit 1`>

**Do:**
1. <the human's action>

**Evidence:** <exactly what the human pastes back>

**Notes:** <filled in when done>
