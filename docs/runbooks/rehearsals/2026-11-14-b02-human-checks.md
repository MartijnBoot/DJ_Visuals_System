# B-02 human checks (H2, H3, H4) -- 2026-11-14

- **Artifact / SHA:** 98c0c3f60438dd0d85bfbc8efa514a2986085947 (H2, H3: T16 + notes + builder
  layout, the layout then uncommitted); 73aeb66743220be19a11d55d5d82ef68ec63d4dd (H4, `main`)
- **Who / where:** owner, on the screen machine (Windows 11), `pnpm start` on `127.0.0.1:8000`.
- **What was done:** H2 (spec Verification 2–7) and H3 (Verification 8–9) by the owner; H4 by
  the owner (push, PRs #3 and #4, merges), CI read by the agent.
- **Timings:** latency p95 23 ms over a minute on a twelve-effect profile (target ≤ 50).
- **What broke:** CI red on `main` after PR #3 (D-01); PR #3 merged before its CI finished.
- **Follow-ups:** D-01 fixed (PR #4); D-02 open; see "Open" below.

## Results

| Step | Verification | Result | Evidence |
|---|---|---|---|
| H2 | 2–7: build, pick, edit, conflict, export/import, server stopped | PASS (owner, no detail) | "functionality as expected". No per-item observations; look of the three new effects and PD2's presets judged acceptable by the owner, not described. |
| H3-8a | 8: latency | PASS | p95 23 ms over a minute, twelve effects, owner's load |
| H3-8b | 8: render scale steps down and back | PASS (owner, no figures) | 100% unloaded; step down and back reported, values not given |
| H3-9a | 9: LAN refused | PASS | `curl` to `192.168.0.117:8000/api/profiles`: "Unable to connect to the remote server"; listener `127.0.0.1:8000` only (agent) |
| H3-9b | 9: non-JSON POST | PASS | `curl.exe -X POST -H 'Content-Type: text/plain'` → `415` |
| H4 | 10: CI green | PASS after D-01 | PR #3: red (runs 43596764741, 43596776025). PR #4: green (43599800201). `main` at 73aeb66: green (43600731489) |

## Deviations from the spec

- Verification 2–7 and the render-scale step rest on the owner's word, without observations.
- Migration 0002's rollback against a scratch database was not run (agent command denied).
- PR #3 was merged with CI still running; `main` was red for about 35 minutes.

## Open

- D-02: two timing checks fail under local load and pass on re-run.
- Smear above posterise freezes the picture (Risk from `/review b-02`): no task, no defect entry.
- The builder layout change (98c0c3f) has no spec or plan task behind it.
