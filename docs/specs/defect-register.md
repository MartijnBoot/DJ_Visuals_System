# Defect register

Known defects, each with an ID that specs reference as `Fixes: D-nn`. A defect is fixed through
the loop, not on the side: the spec that claims it gives it its own acceptance criterion, and
the fix starts with a test that fails because of it.

For an existing codebase this is where `/adopt` and `/analyse` put what they find. It is the
difference between rebuilding something and porting its bugs.

Never renumber. A fixed defect keeps its row, with the spec that fixed it.

| ID | Defect | Where | Consequence | Status |
|---|---|---|---|---|
| D-01 | <what is wrong, in one line> | `<file:line>` | <what it costs a user, concretely> | open → `<spec>` / fixed in `<spec>` |
