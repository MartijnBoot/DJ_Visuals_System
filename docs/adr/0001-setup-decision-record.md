# SDR: <Product name>

Date: YYYY-MM-DD · Tech owner: <name> · Product owner: <name> · Status: Draft | Approved

The Setup Decision Record (way-of-working 3.1, Appendix A). Nothing is provisioned and no
feature code is written until it is approved. **The default answer to every question is "no" —
the burden of proof is on adding a component.** For an existing product (`/adopt`), record what
is already decided, with "inherited" as the reason where nobody knows why.

## 1. What we are building

<Three sentences. The problem, the users, the first release scope.>

## 2. Decisions

| # | Question | Decision | Reason | Est. cost/mo | Owner |
|---|---|---|---|---|---|
| 1 | Database? | | | | |
| 2 | Hosting? | | | | |
| 3 | Auth? | Buy, do not build | | | |
| 4 | File storage? | | | | |
| 5 | Cache / queue / search? | **No** | No measured need; revisit with evidence | — | |
| 6 | Background jobs? | | | | |
| 7 | Email? | | | | |
| 8 | Observability? | | Mandatory before go-live | | |
| 9 | Feature flags? | | | | |
| 10 | WAF / CDN? | | | | |

## 3. Environments

local / dev / prod. <Justify any additional environment.>

## 4. Regions and residency

Primary: <region>. Reason: <latency / residency>.

## 5. Naming and tags

<Convention, or way-of-working Appendix I.>

## 6. Total estimate

dev <x>/mo · prod <y>/mo · Budget alerts at 50/80/100%.

## 7. Explicitly deferred

<Things we consciously are not doing, and the trigger that would change that.>

## 8. Open risks

| Risk | Impact | Mitigation | Owner |
|---|---|---|---|
