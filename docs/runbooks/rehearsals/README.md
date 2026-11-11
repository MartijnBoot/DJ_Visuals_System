# Rehearsal records

One file per rehearsal, `docs/runbooks/rehearsals/<yyyy-mm-dd>-<what>.md`, for example
`2026-11-02-rollback.md`. Human-performed; an agent may draft the file from your notes
(`/human`). Never put key material in one.

```markdown
# <what> -- <yyyy-mm-dd>

- **Artifact / SHA:** <40 hex>
- **Who / where:** <names, environment>
- **What was done:** <the steps actually performed, in order>
- **Timings:** <each timed step, against its target>
- **What broke:** <anything that did not go as the runbook says; "nothing" if so>
- **Follow-ups:** <one line each: a task, a defect-register entry, or "none">
```

Anything that broke becomes a follow-up task or a defect entry, never a silent fix.
