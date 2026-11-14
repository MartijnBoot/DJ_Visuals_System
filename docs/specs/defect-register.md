# Defect register

Known defects, each with an ID that specs reference as `Fixes: D-nn`. A defect is fixed through
the loop, not on the side: the spec that claims it gives it its own acceptance criterion, and
the fix starts with a test that fails because of it.

For an existing codebase this is where `/adopt` and `/analyse` put what they find. It is the
difference between rebuilding something and porting its bugs.

Never renumber. A fixed defect keeps its row, with the spec that fixed it.

| ID | Defect | Where | Consequence | Status |
|---|---|---|---|---|
| D-01 | The gate is red on Linux CI and green on Windows: the three browser tests that read the fake camera back at dials 0/0 never match the fixture on `ubuntu-latest` (`live.spec.ts:138` AC8, `panel.spec.ts:155` AC9 since B-01; `preview.spec.ts:146` B-02 AC4 since B-02). Cause: Chromium decodes the BT.601-encoded I420 fixture with BT.709 on Linux (LEFT_RGB shows as [237,49,38], RIGHT_RGB as [15,185,223]; the browser's own 2D decode gives the same), so the tests' expected colours were one platform's. The engine passes the camera through exactly on both. | `tests/browser/live.spec.ts:206`, `tests/browser/panel.spec.ts:169`, `tests/browser/preview.spec.ts:182` | `main` has no green CI since B-01's merge (runs 43205843514, 43596776025), so CI cannot gate a merge, and the camera-passthrough criteria (AC8, AC9, AC4) are unproven on the CI platform | fixed in `fix/d-01-camera-decode`: the tests compare with the browser's own decode (`cameraColours`, `tests/browser/helpers.ts`); 91/91 browser tests on Linux (node:24-bookworm, Docker) |
| D-02 | Two timing checks fail under local load and pass when re-run: `tests/meta/profile-compat.test.ts` (a type check, about 3 s alone) hits vitest's 5 s default timeout in the parallel unit run; `live.spec.ts:274` latency p95 on twelve effects read 308.8 ms (≤ 50) while the H3 screen page was still rendering in another browser. | `tests/meta/profile-compat.test.ts:12`, `tests/browser/live.spec.ts:297` | A red gate that a re-run turns green teaches people to re-run rather than read; the gate is the one definition of green | open |
