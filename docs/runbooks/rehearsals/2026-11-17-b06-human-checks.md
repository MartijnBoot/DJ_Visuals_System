# B-06 human checks (H1–H8) -- 2026-11-17

- **Artifact / SHA:** ffda2c9d24cfe58de2d9d94986546a88dfa83d7b (`main`, PR #12 merged; CI run
  43929559934 green)
- **Who / where:** owner, on the owner's home network; screen machine (Windows 11) with
  `pnpm start`; iPhone, iPad and laptop as senders and controllers. Run 2026-11-16 to 2026-11-17.
- **What was done:** H1 to H7 as in the plan's Human steps, in order, by the owner. H8 not run.
- **Timings:** H3 (network ≤ 30 ms, latency ≤ 50 ms p95), H4 (end to end ≤ 100 ms) and H5
  (remote video ≤ 100 ms) passed by the owner's verdict only; no figures recorded.
- **What broke:** nothing against the spec. Observed: on the iPad, `/send` stops its camera and
  microphone when another app comes to the front (SD9 as specified, an iPadOS limit).
- **Follow-ups:** B-15 (iPad as an audio source, backlog idea); H8 to run on a guest network when
  one is available; H3–H5 figures to record if measured later.

## Results

| Step | Result | Evidence |
|---|---|---|
| H1 — Trust | PASS | iPhone, iPad, laptop: `/control` and `/send` open with no warning (owner). OS/browser versions not given. |
| H2 — Laptop's audio path | PASS | Meters moved for an input and for System audio; System audio works before Start (owner: "it works"). Input name, OS, browser not given. |
| H3 — Network leg | PASS (owner's verdict, not measured) | p95 values not recorded |
| H4 — End to end | PASS (owner's verdict, not measured) | fps and delays not recorded |
| H5 — Remote video | PASS (owner's verdict, not measured) | stopwatch difference and `video ms` not recorded |
| H6 — Fallback | PASS | cable pull and phone lock behaved as described (owner) |
| H7 — Four phones | PASS | no black frame, render scale unchanged (owner); value not given |
| H8 — Isolation | NOT RUN, ticked as pass on the owner's instruction | no isolated network available |

## Deviations from the spec

- The latency bounds of SD3 and SD11, which the plan proves only here, rest on the owner's
  verdict without a recorded figure.
- H8 was not run: what a sender shows on a network with client isolation is unobserved. AC13 is
  covered in the gate by candidate filtering only (T15, T17).
- Device OS and browser versions were not recorded.

## Open

- B-15: the iPad cannot keep sending in the background or send its system audio from a web page.
