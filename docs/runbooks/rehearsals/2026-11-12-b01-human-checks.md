# B-01 human checks (H2, H3) -- 2026-11-12

- **Artifact / SHA:** 65991cd (branch `fix/phase-b-01-review`; the gate `bash scripts/check.sh` passed 9/9 steps, 37 browser tests, at this commit)
- **Who / where:** the owner, on the screen machine (Windows 11 laptop, AMD GPU, built-in webcam broken, audio interface attached). Chrome and Edge; a phone as a virtual webcam. Server: `pnpm start` on `127.0.0.1:8000` with a scratch `DATA_DIR`.
- **What was done:** the steps below, in order. Every result is owner-reported unless marked "agent". Numbers were requested at each step and mostly not given.
- **Timings:** none recorded (see the table and the open items).
- **What broke:** F1 below; nothing else.
- **Follow-ups:** F1 defect-register entry; the open questions; the unrecorded numbers.

## Results

| Step | AC | Result | Evidence |
|---|---|---|---|
| H2-1 Idle | AC1 | PASS | owner-reported, no detail |
| H2-2 Start, meters | AC2, AC6 | PASS (note) | level, low, mid, high moved. The beat meter was flat on the audio-interface input and moved on system audio. All permissions were asked. |
| H2-3 Pick the interface, reload | AC5 | PASS | owner-reported: meters follow the interface (the `exact` device-id fix on real hardware); preselected after reload. Webcam picker not tested with two cameras. |
| H2-4 Keys with a focused picker | review fix 65991cd | PASS | owner-reported |
| H2-5 Dials | AC7, AC9, the changed look | PASS | owner-reported, on a phone camera. Not reported: the look at 0.8 / 0.9 / 1.0, `f` at recognisability 1, drift over minutes. |
| H2-6 System audio | AC4 | PASS | owner-reported: works, cancelled dialog keeps the previous source, stop from the sharing bar. The no-retry rule: no answer (open question 1). |
| H3-7 Latency, scale, fullscreen | AC10, AC16 | PASS (note) | owner-reported, in Edge, **no numbers**. p95 not recorded. First-10-seconds worst: UNSURE, not recorded. |
| H3-8 Unplug and replug | AC12, AC13 | PASS (note) | owner-reported, in Chrome. What the picker does with a choice made while the interface is unplugged: not reported. |
| H3-9 Render scale under load | AC15 | PASS (owner, not exercised) | side by side with a 4K video the frame rate held at 60 at 100% scale, so no step down was seen on the real machine. After returning from another tab, fps read about 10 for an instant and went back to 60; whether the scale changed then: not reported. |
| H3-10 Filmed latency | AC11 | PASS (owner, no numbers) | no frame counts recorded |
| H3-11 LAN refused | AC17 | PASS | owner-reported, no `curl` output pasted. Agent: no port forward, listener only `127.0.0.1:8000`; the server log (806 lines) shows only `127.0.0.1` clients and no media, device label or id. |
| H3-12 Soak | none | PASS | owner-reported, run length and observations not given |

## Deviations from the spec

None found in code. Two things are weaker than the spec asks for:

- AC10, AC11: the spec wants a measured p95 and a measured frame count; the owner reported a pass without numbers.
- AC15: not exercised by a real load; it rests on the automated T9 test.

## F1 -- Edge GPU corruption on the AMD screen machine (environment)

- Blocks and stripes over the canvas and overlay while the visuals run in Edge. It also corrupts other Edge tabs, needs no source switch, persists with the camera disconnected, recovers about a second after the window is foregrounded. Chrome shows none.
- `edge://gpu` lists AMD workarounds (dynamic textures, software overlays, D3D device reset). Not a spec violation; no acceptance criterion covers it. Whether it flashes fast (spec, accessibility line) was not reported.
- Not a fix on `fix/phase-b-01-review`. Steps 2 to 7 were done in Edge; step 7 (and step 5) should be repeated in Chrome for trustworthy numbers.

## Open questions for the owner

1. **System-audio no-retry rule** (`web/src/capture/session.ts`, `retryable`): a lost system-audio share is not re-asked automatically; the panel says "system audio stopped: choose it again in the panel". It is in neither the spec nor the plan. Keep it, or change it? No answer given.
2. **Venue browser:** Chrome (Edge is affected by F1). Is that to be written into the docs?
3. **Step 7 in Chrome:** repeat for real p95, scale and worst-in-first-10-s, or accept the Edge result as flagged?
4. **Dropped choice during a retry:** `attempt` returns without doing anything when a request of the same kind is in flight, so a picker choice made then is dropped silently. Behaviour on hardware not observed. Is that acceptable?
5. **Start-up clock window** (`audio/src/source.ts`, before the first valid `getOutputTimestamp`): not measured.

## Diff pass B

Pointers given: `engine/src/look.ts` `main()` (posterise before smear, the undo of brightness and flash on the previous frame, `uTime` and the float32 hash over a long set); `web/src/capture/session.ts` (`getMedia` fallback, `attempt` dropping a concurrent request, `retryable`); `audio/src/source.ts` (clock map before the first timestamp and after a resume); the three tests that were green for the wrong reason. The owner's reading and verdict: not recorded here.

## Not done here

H4 beyond the pull request: confirming the `check` job in CI is green.
