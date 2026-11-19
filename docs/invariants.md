# Invariants — what every change keeps

The one page of project-specific rules the workflow's commands read. `/spec`, `/plan`,
`/audit`, `/build`, `/verify` and `/review` are generic and identical in every repository; what
makes them strict *here* is this file. Keep it short and true. Every line costs attention in
every session that reads it.

<!--
Fill this in during Phase 0 (a new project) or /adopt (an existing one). An invariant earns a
row when breaking it would be expensive and easy to miss. Something a linter already enforces
does not need a row; something only a person remembers does.
-->

## Cross-phase invariants

They hold from the phase that introduces them onward, and every later task's Definition of Done
re-checks them. **Enforced by** names the test, hook or check that fails when the invariant
breaks; "review only" is honest but is a debt, and the next task near it should pay it.

| Since | Invariant | Enforced by |
|---|---|---|
| 0 | The environment is read in one module (`server/src/config.ts`), validated at boot; nowhere else | ESLint `no-restricted-properties` (`eslint.config.js`); `tests/meta/config-boundary.test.ts` |
| 0 | No secret, key or personal data in code, tests, logs or fixtures | gitleaks in CI; review |
| 0 | Migrations are append-only: a migration that has a successor is never edited | `.claude/guard-paths.json` → `append_only` (`server/migrations`); `tests/workflow/test_guard_paths.py` |
| 0 | `engine/` and `audio/` are framework-free: neither `package.json` declares a dependency of any kind, and neither compiled output imports a package (`audio/` since B-01) | `tests/meta/engine-boundary.test.ts` |
| 0, B-04, B-06 | The main server listens on `127.0.0.1` only; the machine's LAN address is refused. The External control listener binds private IPv4 addresses only, only while switched on, serves HTTPS only (no plain-HTTP listener on the LAN), and answers only `GET /control`, `GET /send`, `GET /trust` (the root certificate and its page, never a key), `GET /assets/*` and the device socket (B-04 SD28, B-06 SD13, SD24, SD26) | `server/test/boot.int.test.ts`; `server/test/control-lan.int.test.ts`; `server/test/control-tls.int.test.ts`; `server/src/control/addresses.test.ts`; `tests/browser/control-e2e.spec.ts` (switch off, restart); `tests/browser/send.spec.ts` (`/send` on the LAN listener only); `tests/browser/remote-e2e.spec.ts` (every request on `CONTROL_PORT` in a whole run is one of these routes) |
| B-01, B-06 | No media reaches the server: `server/` has no endpoint for audio or video; the server relays only WebRTC setup messages, and media goes peer to peer on the LAN, with no ICE server (B-06 SD16, SD26); and a running set requests only `GET /`, `/assets/*`, `/api/health`, the screen socket (`/api/control/screen` on `127.0.0.1`), `/api/profiles` and `/api/profiles/:id` — the last two only on a user action in the panel or on a paired controller (B-02 SD6, B-04 SD28) | review (`server/` diff); `tests/browser/live.spec.ts` (AC17, B-02 AC18, B-04 AC36); `tests/browser/control-e2e.spec.ts` (B-04 AC22, AC36, with a paired controller); `server/test/control-sender.int.test.ts` (the relay); `web/src/remote/peers.test.ts`, `web/src/send/peer.test.ts` (no ICE server is configured); `tests/browser/remote-screen.spec.ts`, `tests/browser/remote-e2e.spec.ts` (B-06 AC12: no ICE server on any peer connection of a run) |
| B-01 | `audio/` and `engine/` each declare `AudioFeatures`; `web/` passes one to the other, so the type check fails when they drift | the `types` step (`pnpm typecheck` compiles `web/src/features-compat.ts` against the real shapes); `tests/meta/compat-coverage.test.ts` (`web/tsconfig.json` covers the compat file); the mutation tests in `tests/meta/features-compat.test.ts` (fail on drift) (B-08 SD6) |
| B-02 | `engine/` and `shared/` each declare `Profile` (`engine/` never imports `shared/`); `web/` passes one to the other, so the type check fails when they drift | the `types` step (`pnpm typecheck` compiles `web/src/profile-compat.ts` against the real shapes); `tests/meta/compat-coverage.test.ts` (`web/tsconfig.json` covers the compat file); the mutation tests in `tests/meta/profile-compat.test.ts` (fail on drift) (B-08 SD6) |
| B-04, B-06 | Every control message is validated against `shared/src/control.ts` on receipt; only an approved controller's socket may send a control, and a sender's socket only setup messages (B-04 SD28, B-06 SD6, SD26) | `server/src/control/channel.test.ts`; `server/test/control-screen.int.test.ts`; `server/test/control-device.int.test.ts` (AC17, AC34); `server/test/control-sender.int.test.ts` (B-06 AC9, AC11); `tests/browser/control-e2e.spec.ts` (AC34) |
| B-06 | The local CA's private keys stay in `DATA_DIR/tls/`: never served, logged or committed (B-06 SD26, AC35) | `tests/meta/tls-boundary.test.ts` (git ignores `data/tls/*.key`; only `server/src/tls/store.ts` names a key file); `server/src/tls/store.test.ts`, `server/test/control-tls.int.test.ts` (no log line holds a key); `tests/browser/remote-e2e.spec.ts` (B-06 AC34: no server or browser log line of a whole run holds a key, an SDP, a candidate, a code, a session key, the User-Agent or a device label) |
| B-03 | Profile code is GLSL only: it is never evaluated as JavaScript and reaches the browser only through `shaderSource` (B-03 SD1) | ESLint `no-eval`, `no-implied-eval`, `no-new-func` on every file (`eslint.config.js`); `tests/meta/profile-code-boundary.test.ts` (each rule fires in `web/`, `engine/`, `scripts/`; a custom effect's `code` is read only in the shader builder, the program keys and the builder's editor); the `shaderSource` test in `engine/src/index.test.ts` (B-03 T4) |
| B-12 | A hosted server (`APP_MODE=hosted`) never serves or opens External control, the local CA or a device socket: `/control`, `/send`, `/trust`, `/api/control/*` and every WebSocket upgrade answer 404, no LAN listener starts and `DATA_DIR/tls/` is never created; it still binds `127.0.0.1` only (B-12 AC4, AC27) | `server/test/hosted.int.test.ts`; `server/test/boot.int.test.ts` |
| B-12 | No token, refresh token, subject, email or authorisation code in a log line, a response body or the browser console; no profile definition in a log line or the console (B-12 AC26, PD13). Request lines log the path without its query | `server/test/secrets.int.test.ts` (a scripted connect, sync, conflict and sign-out); `tests/browser/hosted.spec.ts` (every server line, console message and response body of each test); `server/test/cloud-connect.int.test.ts`, `server/test/hosted.int.test.ts` |
| B-12 | The local install's refresh token lives only in `DATA_DIR/cloud/session.json`: never served, logged or committed; only `server/src/cloud/session-store.ts` names the file (the `tls-boundary` pattern; B-12 SD15) | `tests/meta/cloud-boundary.test.ts` (git ignores `data/cloud/session.json`; only the store names it); `server/src/cloud/session-store.test.ts` |
| B-12 | In hosted use a running set requests only `GET /`, `/assets/*`, `/api/health`, `/api/profiles` and `/api/profiles/:id` (the last two only on a user action), opens no socket, and reaches the sign-in provider's token endpoint only within a user's profile action; a local install's sync makes no request while the screen reports `started: true` (B-12 AC9, AC23, SD2) | `tests/browser/hosted.spec.ts` (AC23); `server/test/sync-schedule.int.test.ts` (AC9); `server/src/cloud/scheduler.test.ts` |
| B-12 | The environment rule above covers `.ts`, `.tsx` and `.js` files; `infra/` shell scripts and systemd units read the VM's env file by design, and `infra/deploy.ts` takes paths as arguments, never the environment | `tests/meta/config-boundary.test.ts` (scans `infra/*.ts` too); review for `infra/*.sh` |

## Guarded areas

Code whose silent change is the expensive kind: the pricing engine, the billing maths, the
permission matrix, a parser other systems depend on. A diff touching one of these paths gets the
named extra check in `/verify` and the named guardian in `/review`, and a behaviour change there
is an owner stop (CLAUDE.md).

| Paths | Extra check (`/verify`) | Guardian (`/review`) | Why |
|---|---|---|---|
| `server/src/auth/` (the bearer check, the allowed subject, the rate limit), and its wiring in `server/src/boot.ts` (`guardProfiles`) and `server/src/rate-window.ts` | `pnpm run test --project unit server/src/auth server/src/rate-window.test.ts` and `pnpm run test --project integration server/test/hosted.int.test.ts server/test/sync-api.int.test.ts` | `invariant-guardian` | The permission matrix of the only internet-facing server: a silent change lets a stranger read or overwrite the owner's profiles (B-12, accepted at the audit 2026-11-17; drafted in T19 for the owner's approval) |

## Interview probes

The questions that reliably surface something in *this* product. `/spec` asks the relevant ones
before writing a spec. Examples to replace:

- What happens if this occurs mid-operation, with users waiting?
- What happens if the process restarts while this is in flight?
- Does this touch money? What exactly happens on a retry?
- Who may do this — which role, and which may not?
- Does this change a guarded area? If so, stop: that is an ADR first, not a spec.

## Out of scope for the whole product

What nobody should spec, plan or build without an ADR changing it first.

- <...>
