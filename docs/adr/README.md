# Architecture Decision Records

A decision with consequences gets an ADR: one page — context, decision, alternatives,
consequences (way-of-working 4.2, step 9). Copy [0000-template.md](0000-template.md), take the
next number, never reuse one.

- **0001 is the Setup Decision Record** (way-of-working 3.1, Appendix A): database, hosting,
  auth, what else, environments, cost. The default answer to every "do we need X" is no.
- **A departure from the way-of-working is an ADR** that names the section it departs from and
  why the arithmetic is different here. Quietly not following a rule is not a departure; it is
  drift.
- **An ADR is never edited to say something else.** It is superseded by a new one, and its
  Status says so.
- Plans and reviews treat accepted ADRs as settled. Reopening one is an owner stop (CLAUDE.md).

| # | Title | Status |
|---|---|---|
| [0001](0001-setup-decision-record.md) | Setup Decision Record | Approved |
