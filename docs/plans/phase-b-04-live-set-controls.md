# Plan: b-04 — Live set controls (external control)

Spec: [docs/specs/phase-b-04-live-set-controls.md](../specs/phase-b-04-live-set-controls.md) (`Status: Approved`) ·
Status: Audited

ADRs honoured: [0001 Setup Decision Record](../adr/0001-setup-decision-record.md) — rendering
stays in the screen machine's browser and no media reaches the server (decision A); the control
channel is a WebSocket held by the single Node process, no broker (question 5); the pairing token
shown on the screen as a QR code, not stored (constraints, "Pairing token for any second
device"); live changes are never saved into profiles (constraints); no auth beyond pairing and
no hosting (questions 2, 3). New dependencies: `ws` with `@types/ws` (PD1, the owner's answer at
audit, because `@fastify/websocket` fails the spec's condition) and `qrcode-generator`, all under
"Dependency checks" below. The spec's edits to `docs/invariants.md` (SD28) are approved by the
spec and made in the task that changes the behaviour each row describes (T5, T6, T9), so no row
is ever untrue on the branch; `docs/design/architecture.md` is updated in T17.

Line references are to `main` at `89caa19`. The spec and `docs/backlog.md` are read from the
uncommitted working copy on `docs/phase-b-04-spec` of 2026-11-14.

## Approach

The server is built first and proven without a browser, then the screen page, then the phone.
`shared/` gets the two pure definitions both sides validate against: the profile's optional
`primary` (T1) and every control message (T3). The server gets `CONTROL_PORT` (T2), the pairing
rules as one in-memory module with an injected clock and random source, unit-tested without a
socket (T4), the screen socket on `127.0.0.1:PORT` with the shared validation, size and rate
limits (T5), the LAN listener's lifecycle and its three routes behind the address seam (T6), and
the device socket with pairing and relaying (T7). Every server task is proven by integration
tests that bind the "LAN" listener on `127.0.0.1` through the seam (SD29), so the channel is
proven on loopback before any real address is bound (SD1). The screen page then gains the live
palette and last-wins camera in the modules that already own a pick and a camera (T8), the
screen control client that applies a received control at the start of the next frame and sends
state at most once per frame (T9), and the panel's External control section with the QR code
(T10). The phone gets its link state machine (T11), the `/control` page in DJ mode (T12) and VJ
mode with the colour wheel and round-trip readout (T13). The builder's primary marker (T14) runs
in parallel with all of that. T15 and T16 are the end-to-end browser proofs, T17 the docs.

The screen page stays the single source of truth (SD5, SD13): the server holds the pairing and
the last `state` it was sent, never the visual state itself, and relays. A control is applied by
calling the engine directly from a callback registered before the engine's own frame callback
(the ordering `web/src/frame-feed.ts` already relies on), never through a React state update,
because `Screen.tsx:111` applies dials in a passive effect whose timing relative to the next
frame is not guaranteed (AC19). A live colour is a `setProfile` with an unchanged effect list,
which the engine applies on the next frame without linking (`engine/src/index.ts:374-376`, test
`engine/src/index.test.ts:225-238`), so `engine/` changes only its `Profile` type (spec, In
scope).

Rejected:

- **The server owning the live state** (dials, palette) and pushing it to the screen. SD5 and
  SD13 make the screen page the authority; a server copy would be a second truth that a reload
  resets anyway.
- **A new engine hook** ("frame applied" event, frame counter). The spec keeps `engine/`
  unchanged but for `primary`; the registration-order callback gives the same guarantee.
- **One Fastify app listening on several addresses.** Fastify's `listen` binds one address; the
  LAN listener is one small Fastify instance per bound address sharing one pairing module (PD8).
- **A router for `/control`.** Third branch on `location.pathname` in `web/src/main.tsx:7`.
- **A colour-picker or gesture package.** SD11: the wheel is drawn by hand.
- **Using the Playwright `webServer` for External control checks.** It runs `pnpm start` with the
  real `networkInterfaces()` and cannot be restarted; the control specs boot their own server in
  the test process with the address seam, as `tests/browser/under-load.spec.ts` already does
  through `scripts/under-load.ts:74-82` (PD13).

## Dependency checks

The spec approves two packages on conditions (spec, "Dependencies"): MIT/ISC/BSD/Apache-2.0, a
release within 24 months, no dependency of its own (the WebSocket pair excepted, which must be
exactly `@fastify/websocket` → `ws`). Checked with `pnpm view` on 2026-11-14:

| Package | Version | Licence | Last release | Own dependencies | Verdict |
|---|---|---|---|---|---|
| `qrcode-generator` | 2.0.4 | MIT | 2025-08-07 | none; ships `dist/qrcode.d.ts` | **passes** |
| `ws` | 8.23.0 | MIT | 2026-11-12 | none (`bufferutil`, `utf-8-validate` are optional peers, not installed) | **passes** on its own |
| `@fastify/websocket` | 11.3.7 | MIT | 2026-11-04 | `ws`, **`duplexify` 4.1.3**, `fastify-plugin` 6.0.1 | **fails**: not "exactly → `ws`"; `duplexify` brings `end-of-stream`, `inherits`, `readable-stream` 3 (→ `string_decoder`, `util-deprecate`), `stream-shift`; `duplexify`'s last release is 2024-03-06, 32 months ago |
| `@types/ws` (dev, `server/`) | 8.18.2 | MIT | 2026-10-04 | `@types/node` only, already a root dev dependency | **passes**; needed because `ws` ships no types (`pnpm view ws types` is empty) — found at audit |

The spec says a failed condition "is a stop for the owner, not a swap": PD1. **Owner, 2026-11-14:**
`ws` and `@types/ws` approved; `@fastify/websocket` is not used.

**Re-checked at T5, 2026-11-15** (`pnpm view`): `ws` 8.23.0, MIT, last modified 2026-11-12, no
`dependencies` (`bufferutil`, `utf-8-validate` optional peers, not installed); `@types/ws` 8.18.2,
MIT, last modified 2026-10-04, `dependencies` `@types/node` only. Both pass; installed exactly
those versions in `server/` (`ws` a dependency, `@types/ws` a dev dependency).

**Re-checked at T10, 2026-11-15** (`pnpm view`): `qrcode-generator` 2.0.4, MIT, released
2025-08-07 (15 months), no `dependencies`, ships `dist/qrcode.d.ts`. Passes; installed exactly
that version in `web/`.

## Decisions this plan makes

Readings of the spec the planner had to choose. **Confirm** rows are for the audit to confirm or
overrule; **Owner** rows are user-visible choices the spec left open, and each one is a stop
(CLAUDE.md hard stops).

| # | Question | Decision | Reason |
|---|---|---|---|
| PD1 · Owner | `@fastify/websocket` fails the spec's dependency condition (table above). Which WebSocket server? | **Owner, 2026-11-14: `ws` alone plus `@types/ws` (dev), in `server/` only.** Both listeners create `new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 })` and route Fastify's `app.server.on("upgrade")` by path and `Origin` in `server/src/control/upgrade.ts` (about 50 lines: path match, Origin check → 403, `handleUpgrade`). Everything after the handshake — framing, masking, ping, close — stays in `ws`, which is what the spec's "why not the standard library" was about. No test-side copy at the root: `server/test/` uses `ws` from `server/`; a device client in `tests/browser/` is a Playwright page opened on the LAN listener's origin that opens the socket with the browser's own `WebSocket` (the right `Origin` for free). If a browser-side client cannot do what a check needs, stop and ask — never add `ws` to the root. | `ws` meets every condition; the hand-written part is routing, not protocol. SD16's "`@fastify/websocket`" reads "`ws`" for this build, by this answer. |
| PD2 · Owner | AC16/SD25: the screen socket accepts "its own listener's origin". The page can be opened as `http://127.0.0.1:PORT` or `http://localhost:PORT` — both reach this listener. Refuse `localhost`? | **Owner, 2026-11-14: as recommended.** Accept exactly `http://127.0.0.1:PORT`, `http://localhost:PORT` and `http://localhost:5173`; refuse everything else, a missing `Origin` included. | Opening the screen as `localhost:8000` and finding External control silently dead would be a set-time surprise; both names are this listener, and neither can be claimed by a foreign page (DNS rebinding arrives with a foreign `Origin`). |
| PD3 · Owner | SD20/AC33's 4 KB and 120 messages/s per socket also hit the screen socket: a `state` with the profile list exceeds 4 KB at about 50 profiles, and two controllers dragging at 60 Hz make 120 acknowledgements plus 60 `state` per second. Applied literally, a large library or two VJs silently stop the controllers. | **Owner, 2026-11-14: as recommended.** The limits apply as written to every **device** socket. The screen socket (same-origin, `127.0.0.1` only) gets 256 KB per message and no rate limit; the screen page itself sends at most one `state` per frame and acknowledgements batched per frame (`applied [{ deviceId, seq }]`, one message per frame). | The limits exist against an untrusted LAN device (SD20 sits beside SD15, SD19); the screen socket is already restricted to the operator's own page by Origin (SD25). |
| PD4 · Owner | AC28/SD12: "after a server restart [Pairing ended] is the outcome on every controller". After a restart External control is off (AC1), so nothing listens on `CONTROL_PORT` and no server can answer; a browser cannot tell a refused connection from a Wi-Fi drop. | **Owner, 2026-11-14: as recommended.** The controller keeps "Reconnecting…" (retrying every 5 s) until the server answers, and shows "Pairing ended — scan the code again" as soon as the operator switches External control on again and its stored key is refused. The browser proof (T16) restarts the server, switches on, and asserts "Pairing ended". *Alternative:* give up after N failed attempts and show "Pairing ended" — which then also fires on a long Wi-Fi drop that SD12 says must reconnect without approval. | The only reading a browser can implement without lying during a Wi-Fi drop. |
| PD5 · Confirm | Where a control is applied, and what "the frame that applied it" is (AC19, SD17). | `web/src/control/apply.ts` queues received controls; `startFrameFeed` (`web/src/frame-feed.ts`) gains an optional `beforeFrame` callback, run in its rAF callback that is registered before `engine.start()`; it drains the queue — dials via `engine.setDials` directly (and the React state for the panel), colours via the live palette (PD6), cameras via `session.setCamera`, picks via `active.pick` — then queues one `applied` batch for that frame. A pick is acknowledged when `active.pick` resolves (the swap frame). | Same registration-order guarantee the feature feed already uses; the engine reads dials and the profile in its `draw` of that same rAF turn (`engine/src/index.ts:244-271`). |
| PD6 · Confirm | Live palette and a pick still linking (SD7). `setProfile` supersedes a pending link (`engine/src/index.ts:373`), and `active.ts:104` reports a rejected pick as "could not be prepared". | `active.ts` keeps the active profile object (it keeps only id and name today, `active.ts:68-73`) and a live copy of its palette. `setColour(slot, value)` and `resetColour(slot)` call `deps.setProfile({ ...active, palette: live })`. **While a pick is pending (token ahead of the active profile), a colour change is dropped** — that pick would discard it on swap anyway (SD7). | Without the guard a colour drag during a pick cancels the pick and shows a false failure. |
| PD7 · Confirm | AC25 for cameras: `session.setCamera` drops a request while one is in flight (`web/src/capture/session.ts:283`), so the second of two quick taps is lost. | `setCamera` keeps the latest request made while one is in flight and runs it when that one settles (latest wins, at most one queued). The panel's picker benefits identically. | "Every surface ends on the value the screen page applied last" needs the last tap applied. |
| PD8 · Confirm | The LAN listener (SD2, SD14). | One Fastify instance per bound address, created on `enable`, closed on `disable`, sharing the pairing module and the screen relay. Routes: `GET /control` → `index.html`, `GET /assets/*` from `web/dist/assets`, the device socket at `/api/control/device`; everything else 404 by Fastify's default. No body parser hook, no CORS header. If any address fails to bind (`EADDRINUSE`), every one already bound is closed and the switch stays off with "Port <n> is in use". Under `--api-only` (`pnpm dev`, integration tests without a static folder) `/control` and `/assets/*` are 404 and only the device socket answers. | Matches the API contract; the all-or-nothing bind keeps "on" meaning one thing. Dev has no built page for a phone to load; External control is a `pnpm start` feature. |
| PD9 · Confirm | `CONTROL_PORT` rules in `config.ts` (SD14, AC2). | Same integer rule as `PORT`; then, only when both parse, an object-level check reports `CONTROL_PORT` "must differ from PORT". The fatal line names `CONTROL_PORT`, never a value. `pnpm migrate` also requires it (it calls `loadConfigFromProcess`). | Keeps `boot.int.test.ts:120-127`'s problem list exact when `PORT` itself is bad. One config, one rule set. |
| PD10 · Confirm | The test seam (SD29). | `boot(config, paths)`'s second argument gains `controlAddresses?: () => ControlAddress[]` (`{ address, name }`); absent means `privateAddresses(networkInterfaces())` from `server/src/control/addresses.ts`. Tests pass `() => [{ address: "127.0.0.1", name: "loopback (test)" }]` or `() => []`. | SD29 names this shape; no environment variable. |
| PD11 · Confirm | Message shapes (spec, API contract: "the plan's to write"). | `shared/src/control.ts` exports `deviceMessageSchema` (controller → server: `hello`, `pick`, `dials`, `colour`, `resetColour`, `camera`, `refresh`, `accept`, `reject`; every control carries `seq`, a non-negative integer), `toDeviceSchema` (`waiting`, `approved`, `refused { reason: "wrong_code" \| "throttled" \| "too_many" \| "ended" \| "expired" \| "rejected" }`, `ended`, `screen`, `pending`, `state`, `applied { seq }`), `screenMessageSchema` (`state`, `applied [ … ]` per PD3, `enable`, `disable`, `newCode`, `disconnect`, `accept`, `reject`) and `toScreenSchema` (`control { deviceId, … }`, `status { on, addresses, code, devices, pending, error? }`, `superseded`). Colours `#rrggbb` as in the profile; `slot` an integer `0 ≤ slot < LIMITS.paletteMax` (imported from `shared/src/profile.ts:32`, never a literal). `newCode`/`disconnect` are absent from the device union, so from a controller they fail validation and are dropped with a `warn` (AC17). | One file both sides parse with; "refused" reasons map one-to-one to the spec's link-state texts. |
| PD12 · Confirm | How a controller connecting triggers the profile fetch (SD22), and what a (re)connecting device receives first (SD5). | The server keeps the last `state` the target screen sent and sends it to a device right after `approved` or a key `hello`, before anything else; a device with no screen gets `screen { connected: false }`. The server tells the screen through the `status` device list; the screen page calls `active.open()` (the same call as opening the panel, including the one-time remembered pick) when a device id appears that it has not seen, and on `refresh`. | No new endpoint, no poll; "the full state first" holds even before the screen answers. |
| PD13 · Confirm | Browser proofs of External control (spec, Verification 1). | `tests/browser/control-server.ts` boots an in-process server with `boot()` on two free ports, `staticDir` `web/dist` (built by the gate's `build` step and by the `webServer`), a fresh `DATA_DIR`, and `controlAddresses: () => [127.0.0.1]`; it can `close()` and boot again on the same ports. The controller is a second `browser.newContext()` with a 390×844 viewport. `live.spec.ts` and every other existing spec keep the `webServer`. | Only way to restart the server and to keep real LAN addresses out of CI (SD29). |
| PD14 · Confirm | Controller send rate (SD11, AC20) against the device rate limit (120/s): a 120 Hz phone sends one colour per frame = 120/s, at the limit, and the last position could be the dropped one. | The controller sends at most one change per animation frame **and** at least 16 ms apart, and always the last position on release. | Stays inside "at most one per animation frame" and well under the limit. |
| PD15 · Confirm | The device hint and the `primary` derivation location. | The hint is computed on the server from the upgrade's `User-Agent` (`server/src/control/hint.ts`), sent to the panel and controllers, never logged. `derivePrimary` lives in `shared/src/profile.ts`; the screen page sends `primary` (stored ?? derived) in `state`. | The server is the only party that sees the device's request headers; the derivation is profile semantics. |
| PD16 · Confirm | A one-sided `primary` is invisible to the compat check (`web/src/profile-compat.ts` assigns both ways; an optional field missing on one side still type-checks). | `web/src/profile-compat.ts` adds a key-equality assertion (`Exclude<keyof Shared, keyof Engine>` and the reverse must be `never`), and `tests/meta/profile-compat.test.ts` gains a mutation that deletes `primary?: number;` from `engine/src/profile.ts` and expects the type check to fail. The `palette: string[];` line stays verbatim (the existing mutation anchors on it). | The invariant row (B-02) promises drift fails the type check; an optional field is the first case it would miss. |
| PD17 · Confirm | Screen page with no server answer (`pnpm dev` before the API is up, or a stopped server). | The screen socket reconnects quietly with the same backoff helper as the controller (`web/src/control/backoff.ts`, T11: 0.5 s doubling to 5 s — one helper, not two copies); the panel's section shows "External control unavailable: server unreachable" while it is down (spec UI). Nothing else on the screen page changes. | The set must never depend on the socket. |

## Files

| Path | Create/Modify | Purpose |
|---|---|---|
| `shared/src/profile.ts` | Modify | `primary` in `profileFields`, its rule in `checkProfileRules`, `derivePrimary`, `toProfileFile` carries `primary` (T1) |
| `shared/src/control.ts` | Create | Every control message schema (T3) |
| `shared/src/index.ts` | Modify | Export `control.ts` (T3) |
| `engine/src/profile.ts` | Modify | `primary?: number` on `Profile` (T1) |
| `web/src/profile-compat.ts` | Modify | Key-equality assertion (T1, PD16) |
| `server/src/profiles/store.ts` | Modify | `definitionOf` stores `primary` when set (T1) |
| `web/src/builder/Builder.tsx` | Modify | `definitionOf` carries `primary` (duplicate, rename, export) (T1) |
| `server/src/config.ts` | Modify | `CONTROL_PORT` (T2) |
| `.env.example` | Modify | `CONTROL_PORT=8001` and the header's count (T2) |
| `server/test/spawn-server.ts` | Modify | `baseEnv` gains `CONTROL_PORT` (T2) |
| `playwright.config.ts` | Modify | `webServer.env` gains `CONTROL_PORT` (T2) |
| `scripts/under-load.ts` | Modify | `loadConfig` gains `CONTROL_PORT` (T2) |
| `server/src/control/pairing.ts` | Create | Switch, code, pending, approvals, keys bound to IP, limits, throttle, expiry; clock and random injected (T4) |
| `server/src/control/hint.ts` | Create | User-Agent → "<browser> on <OS>" (T4) |
| `server/src/control/addresses.ts` | Create | `privateAddresses(interfaces)`, `defaultControlAddresses()` (T4) |
| `server/package.json` | Modify | `ws`, `@types/ws` (dev) (T5, PD1) |
| `docs/invariants.md` | Modify | New validation row (T5), the `127.0.0.1` row (T6), the B-01 request row (T9) — each in the task that changes the behaviour; T17 completes the Enforced-by column |
| `server/src/control/upgrade.ts` | Create | Upgrade routing and Origin check (T5, PD1) |
| `server/src/control/channel.ts` | Create | Receive: size, rate, schema, one `warn`; send helper (T5) |
| `server/src/control/hub.ts` | Create | Screen target and supersede, cached state, relay (T5, T7) |
| `server/src/boot.ts` | Modify | Seam (PD10), hub, screen socket, LAN close on shutdown (T5, T6) |
| `server/src/control/lan.ts` | Create | LAN listener lifecycle and routes (T6) |
| `server/src/control/device.ts` | Create | Device socket: hello, approval, relay (T7) |
| `web/src/profiles/active.ts` | Modify | Active profile object, live palette, `primary`, pending-pick guard (T8) |
| `web/src/capture/session.ts` | Modify | Latest-wins `setCamera` (T8) |
| `web/src/frame-feed.ts` | Modify | Optional `beforeFrame` (T9) |
| `web/src/control/apply.ts` | Create | Start-of-frame queue, acknowledgements (T9) |
| `web/src/control/screen-link.ts` | Create | Screen socket, reconnect, state coalescing (T9) |
| `web/src/Screen.tsx` | Modify | Wire the control client; pass control status to the panel (T9, T10) |
| `scripts/dev.ts` | Modify | Proxy `/api` with `ws: true` (T9) |
| `web/package.json` | Modify | `qrcode-generator` (T10) |
| `web/src/control/ExternalControl.tsx` | Create | Panel section (T10) |
| `web/src/control/qr.ts` | Create | QR as an SVG path string, wrapping the package (T10) |
| `web/src/control/remembered.ts` | Create | `djv.controlAddress`, `djv.controlMode`, `djv.controlKey` (T10, T11, T12) |
| `web/src/Panel.tsx` | Modify | Render the section; scrollable when taller than the viewport (T10) |
| `web/src/control/device-link.ts` | Create | Controller link state machine and backoff (T11) |
| `web/src/control/round-trip.ts` | Create | Send-to-ack timing over `createLatencyWindow` (T11) |
| `web/src/control/backoff.ts` | Create | 0.5 s doubling to 5 s, shared by `device-link.ts` and `screen-link.ts` (T11) |
| `web/src/main.tsx` | Modify | `/control` route (T12) |
| `web/src/control/Controller.tsx` | Create | Page shell, link line, code field, mode toggle, DJ layout (T12) |
| `web/src/control/Approvals.tsx` | Create | Pending prompt and DJ badge (T12) |
| `web/src/control/Wheel.tsx` | Create | Colour wheel (T13) |
| `web/src/control/wheel-math.ts` | Create | HSV ↔ `#rrggbb`, pointer → hue/saturation, send throttle (T13) |
| `web/src/control/VjPanel.tsx` | Create | Swatches, status strip, round trip (T13) |
| `web/src/builder/editor.ts` | Modify | `primarySet`, `paletteRemove` moves the mark (T14) |
| `web/src/builder/Editor.tsx` | Modify | Primary radio, unused hint (T14) |
| `tests/browser/control-server.ts` | Create | In-process server with the seam (T10, PD13) |
| `tests/browser/live.spec.ts` | Modify | Allow-list admits the screen socket (T9) |
| `docs/invariants.md` (Enforced-by only), `docs/design/architecture.md`, `README.md`, `docs/runbooks/README.md`, `CLAUDE.md` | Modify | Enforcing tests that landed later, architecture, pairing how-to, runbook entry, the fifth variable (T17) |

New test files: `shared/src/control.test.ts`, `server/src/control/{pairing,hint,addresses,channel}.test.ts`,
`server/test/control-screen.int.test.ts`, `server/test/control-lan.int.test.ts`,
`server/test/control-device.int.test.ts`, `web/src/control/{apply,screen-link,device-link,round-trip,backoff,wheel-math,remembered,qr}.test.ts`,
`tests/browser/control-panel.spec.ts`, `tests/browser/control.spec.ts`,
`tests/browser/control-modes.spec.ts`, `tests/browser/control-e2e.spec.ts`.

Existing tests and texts this change makes untrue:

- `server/src/config.test.ts:4` (`valid` has four keys), `:19-26` (exact four-key object),
  `:28` (`it.each` over four names), `:58-76` (exact four-variable list): every case needs
  `CONTROL_PORT`. Changed in T2.
- `server/test/boot.int.test.ts:181` (`envKeys` list) gains `CONTROL_PORT`; `:120-127` stays
  true only if `baseEnv` supplies a valid `CONTROL_PORT` and PD9's cross-check is skipped when
  `PORT` is bad. Changed in T2.
- `tests/browser/live.spec.ts:543-549` — the allow-list and "a WebSocket was opened" `toEqual([])`:
  the screen page now opens exactly one WebSocket on load. Becomes "exactly one,
  `ws://127.0.0.1:<PORT>/api/control/screen`", and the title at `:519`. Changed in T9.
- `docs/invariants.md:26-27` (the `127.0.0.1` row, the B-01 request row): rewritten per SD28 in
  the commit that changes the behaviour — the `127.0.0.1` row in T6, the B-01 request row in T9.
  No row is untrue on the branch at any task boundary.
- `README.md:22,25`, `CLAUDE.md:47-48`, `docs/design/architecture.md:219-228` ("four
  variables"). Changed in T17.
- Not untrue, watch: `web/src/profiles/active.test.ts:91,116,156` count `setProfile` calls per
  pick — a pick still makes exactly one (T8 adds calls only for colour edits);
  `web/src/profiles/builtin.test.ts:11` (the built-in gains no `primary`);
  `web/src/builder/editor.test.ts:212` (`toEqual` ignores an `undefined` `primary`);
  `tests/meta/profile-compat.test.ts:27` (anchors on `palette: string[];`, kept verbatim);
  `tests/browser/builder.spec.ts:185-200,325-345` (Tab chains: a radio group is one tab stop);
  `server/test/static.int.test.ts:67-79` (`/control` stays 404 on the main listener — T6 adds
  that assertion).

## Tasks

Each task is one vertical slice that leaves the system working, reviewable in one sitting:
about ≤400 changed source lines (tests do not count) across ≤10 files.

### T1 — `shared/`, `engine/`, store and builder: the optional `primary` round-trips
- **Implements:** AC37, AC38, AC39, SD10
- **Expected output:** `profileFields.primary` is `z.number().int().nonnegative().optional()`;
  `checkProfileRules` adds an issue at `["primary"]` ("primary slot N is outside a palette of
  M") when `primary >= palette.length`. `derivePrimary(profile)` returns `primary` when set,
  else the first effect's `colourSlot` in stack order, else 0 (built-in → 1).
  `toProfileFile` copies `primary` only when defined. `engine/src/profile.ts` `Profile` declares
  `primary?: number` (nothing reads it). `server/src/profiles/store.ts:43-44` stores `primary`
  when set; a row without it lists and loads unchanged. `Builder.tsx:23` `definitionOf` carries
  it, so rename (`:167`) and duplicate no longer drop it. PD16: key-equality assertion in
  `web/src/profile-compat.ts` and a deleting mutation in `tests/meta/profile-compat.test.ts`.
  About 60 source lines, 6 files.
- **Verification:** `pnpm run test --project unit shared/src/profile.test.ts web/src/profiles/file.test.ts server/src/profiles/store.test.ts tests/meta/profile-compat.test.ts`;
  `pnpm run test --project integration server/test/profiles.int.test.ts` (new: create with
  `primary`, get, list, export-import keeps it; a version-1 file without it imports; a row
  written without it lists); `pnpm typecheck`.
- **Depends on:** —
- **Autonomy note:** test names and the issue message wording are the builder's. Stop if any
  existing stored row or fixture fails to parse after the change, or if the compat assertion
  cannot be written without changing the `palette: string[];` line.

### T2 — `CONTROL_PORT` in the configuration and every launcher
- **Implements:** AC2, SD14
- **Expected output:** `CONTROL_PORT` required in `server/src/config.ts` per PD9; `.env.example`
  documents it (`8001`, "the External control listener's port; nothing listens on it until
  switched on") and says five variables. `baseEnv` in `server/test/spawn-server.ts`,
  `playwright.config.ts:51` (`8125`) and `scripts/under-load.ts:74-79` pass one, distinct from
  `PORT`. A missing, malformed or equal value is one `fatal` line naming `CONTROL_PORT` and exit 1
  before the database opens. About 25 source lines, 5 files.
- **Verification:** `pnpm run test --project unit server/src/config.test.ts` (missing, `0`,
  `65536`, `abc`, equal to `PORT`; equal with a bad `PORT` reports `PORT` only);
  `pnpm run test --project integration server/test/boot.int.test.ts` (new: each of the three
  cases exits 1 with one fatal line, `problems[0].variable === "CONTROL_PORT"`, no line contains
  the value, `DATA_DIR` not created); `bash scripts/check.sh` with `.env.local` lacking
  `CONTROL_PORT` — the browser step must still pass (proves CI does not depend on `.env.local`).
- **Depends on:** —
- **Autonomy note:** the port numbers chosen for tests are the builder's (the gate warning in
  `scripts/check.sh` must keep naming only `8123`, `tests/workflow/test_gate_shape.py:111-115`).
  The owner's own `.env.local` is H1, never edited by an agent.

### T3 — `shared/src/control.ts`: every message, both ways
- **Implements:** SD20, AC33, AC17
- **Expected output:** the four unions of PD11 as zod `strictObject`s in a `discriminatedUnion`
  on `type`; `MAX_DEVICE_MESSAGE = 4096`, `MAX_SCREEN_MESSAGE = 262144`,
  `DEVICE_RATE_PER_SECOND = 120`, `CODE_ALPHABET` (31 characters, no `0 O 1 I L`),
  `CODE_LENGTH = 6`, the limits of SD21; a helper `typeOf(raw)` returning the `type` string or
  `"unparseable"` for the `warn`. Exported from `shared/src/index.ts`. About 170 source lines, 2
  files.
- **Verification:** `pnpm run test --project unit shared/src/control.test.ts` — every message
  type parses a valid example and rejects an extra key; `newCode` and `disconnect` fail the
  device union; a `colour` outside `#rrggbb` or `slot` 6 fails; `typeOf` on non-JSON returns
  `"unparseable"`.
- **Depends on:** T1
- **Autonomy note:** field names inside each message are the builder's within PD11. Stop if a
  message the spec lists cannot be expressed without a field the spec does not imply.

### T4 — `server/`: pairing rules, device hint, private addresses (no sockets)
- **Implements:** AC9, AC10, AC12, AC13, AC14, AC15, SD19, SD21, SD26, SD14
- **Expected output:** `createPairing({ now, random })` with `enable()`, `disable()`,
  `newCode()`, `request(ip, code, hint)` → `waiting | refused(wrong_code | throttled |
  too_many)`, `accept(deviceId)` → key, `reject`, `expire()` (60 s), `resume(ip, key)` →
  device or `refused(ended)` (wrong IP or unknown key), `disconnect(deviceId)`, `devices()`,
  `pending()`. Code from `random` over `CODE_ALPHABET` with rejection sampling; key 128 bits as
  base64url; five wrong codes from one IP within 60 s refuse that IP for 60 s, a right code
  included; 8 approved / 4 pending. Sequence labels "Device n" per process. `hint(userAgent)`
  maps the spec's five browsers and six systems, else "Unknown device".
  `privateAddresses(interfaces)` keeps IPv4, non-internal, in the three ranges, with the adapter
  name, in the order given; `defaultControlAddresses()` is `privateAddresses(networkInterfaces())`,
  what `boot` uses when no seam is passed. About 260 source lines, 3 files.
- **Verification:** `pnpm run test --project unit server/src/control/pairing.test.ts server/src/control/hint.test.ts server/src/control/addresses.test.ts`
  (fake clock: expiry at 60 000 ms and not before; throttle window; the ninth device and fifth
  request refused; `newCode` invalidates keys and old code; key from another IP refused and its
  approval gone; addresses: `172.15.x`, `172.32.x`, `169.254.x`, `100.64.x`, public and IPv6
  excluded, `172.16.0.1` and `192.168.1.5` kept; `defaultControlAddresses()` with `node:os`
  mocked by `vi.mock` returns exactly the private ones — the gate never binds a real LAN address).
- **Depends on:** T3
- **Autonomy note:** internal structure is the builder's. Stop if the throttle or expiry rule
  needs a reading of SD19/SD18 other than the one tested (e.g. whether a right code resets the
  wrong-code count — keep the spec's wording: it does not).

### T5 — `server/`: the WebSocket dependency and the screen socket on `127.0.0.1`
- **Implements:** AC16, AC31, AC33, SD16, SD25, SD27
- **Expected output:** `ws` and `@types/ws` (dev) in `server/` (PD1), recorded under "Dependency
  checks" with the versions installed. In the same commit, `docs/invariants.md` gains SD28's new
  row ("every control message is validated against `shared/src/control.ts` on receipt, and only an
  approved device's socket may send a control"), enforced by `channel.test.ts` and
  `control-screen.int.test.ts` (before T7 no device socket exists, so the second half holds
  trivially; T17 adds `control-device.int.test.ts`). `GET /api/control/screen` upgrades on the main app for PD2's origins, 403 for any
  other `Origin` or none. `channel.ts` drops a message over the socket's size limit or failing
  its schema with one `warn` (`{ type }` or `"unparseable"`), keeps the socket open, and drops a
  device socket's messages beyond 120 in a sliding second (PD3). `hub.ts`: the last screen to
  connect is the target; the previous one gets `superseded` and nothing further; log lines per
  SD27 (`screen connected`, `screen superseded`). The screen receives `status { on: false }` on
  connect. `enable` without a LAN listener yet answers `status { on: false, error:
  "unavailable" }` (T6 replaces this). `boot.ts` closes every socket on shutdown. About 220
  source lines, 6 files and `docs/invariants.md`.
- **Verification:** `pnpm run test --project unit server/src/control/channel.test.ts`;
  `pnpm run test --project integration server/test/control-screen.int.test.ts` (a `ws` client:
  own origin, `localhost`, Vite origin accepted; `http://evil.example` and no `Origin` → 403;
  a 5 KB device-shaped message on the screen socket is accepted, a 300 KB one dropped with one
  `warn` and the socket still open; garbage → one `warn` "unparseable"; second screen →
  first receives `superseded`); `server/test/boot.int.test.ts` still green.
- **Depends on:** T2, T3
- **Autonomy note:** PD1 is answered (`ws` + `@types/ws`, owner, 2026-11-14). Before installing,
  re-run the checks in "Dependency checks" and record the result in this plan; a failed condition
  is a stop. Message routing internals are the builder's.

### T6 — `server/`: the LAN listener lifecycle and its three routes
- **Implements:** AC1, AC3, AC4, AC5, AC6, SD2, SD14, SD29
- **Expected output:** `boot` accepts `controlAddresses` (PD10). `enable` from the screen binds
  one Fastify instance per address on `CONTROL_PORT` (PD8), creates a code, and broadcasts
  `status { on, addresses: [{ address, name }], code, devices: [], pending: [] }`; `disable`
  closes every instance and device socket with `ended` and discards code, pending and keys. No
  address → `status { on: false, error: "no_address" }`, nothing bound. `EADDRINUSE` →
  everything closed, `error: "port_in_use"`. Routes per PD8. Boot never enables (AC1). Logs:
  `external control on` (addresses, port), `external control off`, `new code issued` — never the
  code. In the same commit, `docs/invariants.md`'s `127.0.0.1` row is rewritten per SD28 ("the
  main server listens on `127.0.0.1` only; the External control listener binds private IPv4
  addresses only, only while switched on, and answers only `GET /control`, `GET /assets/*` and the
  device socket"), enforced by `boot.int.test.ts` and `control-lan.int.test.ts`. About 170 source
  lines, 3 files and `docs/invariants.md`.
- **Verification:** `pnpm run test --project integration server/test/control-lan.int.test.ts`
  (in-process `boot()` with the seam, as `server/test/fixtures/static-entry.ts` does for static:
  after boot `CONTROL_PORT` refused on `127.0.0.1` and on every non-internal address; after
  `enable`, `GET /control` 200 html, `/assets/<file>` 200, `/`, `/builder`, `/api/health`,
  `/api/profiles`, `/api/profiles/x` 404; `disable` → refused again; empty seam →
  `no_address`, nothing listening; port held by a test socket → `port_in_use`, main listener
  unaffected; every test passes the seam — the gate never binds a real LAN address (SD29), the
  default wiring is T4's `defaultControlAddresses` unit test, real addresses are H4's);
  `server/test/static.int.test.ts` gains "`/control` is 404 on the main listener";
  `server/test/boot.int.test.ts` (`:65-80` still refuses `PORT` on LAN addresses).
- **Depends on:** T4, T5
- **Autonomy note:** whether the instances are Fastify or bare `http` servers with Fastify's
  routing is the builder's, within PD8. Stop if `@fastify/static` cannot serve `assets/` without
  also exposing other files of `web/dist`.

### T7 — `server/`: the device socket — pairing, approval, relay
- **Implements:** AC6, AC7, AC8, AC9, AC10, AC11, AC12, AC13, AC14, AC15, AC16, AC17, AC34, AC35, SD4, SD5, SD18, SD27
- **Expected output:** `/api/control/device` on each LAN instance, Origin must equal
  `http://<that instance's address>:<CONTROL_PORT>`. First message `hello { code }` → `pairing.request`
  with the socket's remote IP and `hint(User-Agent)`; `waiting`, then `approved { key }` +
  cached `state` (or `screen { connected: false }`), or `refused { reason }` and close.
  `hello { key }` → `resume`. Before approval any other message is dropped (AC34). Approved
  devices' controls go to the target screen as `control { deviceId, … }`; `accept`/`reject`
  from an approved device act like the panel's; the screen's `state` is cached and broadcast to
  approved devices; `applied` entries go to their own device only. `pending` broadcast to the
  screen (`status`) and to approved devices on every change; the 60 s expiry sends `refused
  { expired }`. `newCode` and `disconnect` from the screen close the affected sockets with
  `ended`. Logs per SD27: sequence label only. About 230 source lines, 4 files.
- **Verification:** `pnpm run test --project integration server/test/control-device.int.test.ts`
  — one test per AC above with `ws` clients and a fake screen client; the log assertions
  (AC7, AC35) collect every stdout line of the run and assert none contains the code, a key, the
  User-Agent string, the hint, the label text or `#` followed by six hex digits; an `X-Forwarded-For`
  header does not change the IP the key is bound to (AC12).
- **Depends on:** T6
- **Autonomy note:** close codes and internal names are the builder's. AC12 cannot be proven with
  two real source IPs in CI: the test binds the key to `127.0.0.1` through the seam and resumes
  from a second loopback source address (`localAddress: "127.0.0.2"` on Windows and Linux both
  route `127.0.0.0/8`); stop and ask if that does not work on CI rather than weakening the check.

### T8 — `web/`: live palette in `active.ts`, latest-wins camera in `session.ts`
- **Implements:** AC20, AC21, AC25, SD7
- **Expected output:** `active.ts` keeps the active `Profile` and a live palette;
  `ActiveProfile` gains `setColour(slot, value)`, `resetColour(slot)`, and `ActiveState` gains
  `palette`, `storedPalette`, `primary` (stored ?? `derivePrimary`). A pick (the same id
  included) replaces the live palette with the stored one. A colour change while a pick is
  pending is dropped (PD6). `session.setCamera` per PD7. About 90 source lines, 2 files.
- **Verification:** `pnpm run test --project unit web/src/profiles/active.test.ts web/src/capture/session.test.ts`
  (new: `setColour` calls `setProfile` once with the same effects and the new palette;
  `resetColour` restores the stored value; a re-pick discards edits; a colour during a pending
  pick neither calls `setProfile` nor sets `reason`; the existing call counts at `:91,116,156`
  unchanged; two `setCamera` calls while the first is opening end on the second device, a third
  replaces the second).
- **Depends on:** T1
- **Autonomy note:** the builder may restructure `active.ts` internals. Stop if keeping the
  existing tests' `setProfile` counts needs changing them.

### T9 — `web/`: the screen page's control client
- **Implements:** AC18, AC19, AC20, AC22, AC24, AC25, AC26, AC29, AC30, AC36, SD13, SD17, SD22, SD23
- **Expected output:** `screen-link.ts` opens `/api/control/screen` on load (same origin),
  reconnects per PD17 through T11's `backoff.ts`, parses every message with `toScreenSchema` (invalid → ignored), and sends
  at most one `state` per frame (dirty flag, flushed from `beforeFrame`) with the profile list
  entries `{ id, name }`, active id, live palette, primary, dials, cameras with labels, camera id,
  camera and audio state, started, reason. `apply.ts` per PD5: dials, colour, reset, camera (a
  no-op before Start; the camera tiles say why), pick, refresh (`active.open()`); one `applied`
  batch per frame. `frame-feed.ts` gains `beforeFrame`. `Screen.tsx` wires both and calls
  `active.open()` per PD12. `scripts/dev.ts` proxies `/api` with `ws: true`. `live.spec.ts`
  allow-list per "untrue tests". In the same commit, `docs/invariants.md`'s B-01 request row
  gains the screen socket (`/api/control/screen` on `127.0.0.1`) and "a user action on a paired
  controller" (SD28), enforced by `live.spec.ts`. About 300 source lines, 6 files and
  `docs/invariants.md`.
- **Verification:** `pnpm run test --project unit web/src/control/apply.test.ts web/src/control/screen-link.test.ts web/src/frame-feed.test.ts`
  — with a fake rAF that runs callbacks in registration order: a control received between frames
  is applied in the next frame's `beforeFrame`, before the engine's callback, and never later
  (AC19 structurally, SD17); two dials messages in one frame apply the last; one `state` per
  frame however many changes; no `fetch` without a `refresh`/new device; a failed list puts the
  panel's exact reason (`REASONS`, `web/src/profiles/active.ts:50-59`) in `state.reason` (AC26);
  `pnpm test:browser tests/browser/live.spec.ts` (amended allow-list: one WebSocket, no
  `/api/profiles` before a user action, no `POST`/`PUT`/`DELETE`).
- **Depends on:** T5, T6, T8, T11
- **Autonomy note:** T6 is a dependency only so the two never edit `docs/invariants.md` in one
  parallel group; T11 for `backoff.ts`. The split between `apply.ts` and `screen-link.ts` is the
  builder's. Stop if
  applying dials outside React makes the panel slider and the engine disagree in any test, or if
  `live.spec.ts`'s allow-list cannot stay exact.

### T10 — `web/`: the panel's External control section with the QR code
- **Implements:** AC3, AC4, AC8, AC10, AC13, AC14, AC31, AC32, SD3, SD24
- **Expected output:** `qrcode-generator` installed after re-checking its row in "Dependency
  checks". `ExternalControl.tsx` in the panel per the spec's UI: off line, switch, address picker
  (adapter name and address; first preselected; `djv.controlAddress`), QR as inline SVG of
  `http://<address>:<CONTROL_PORT>/control#code=<code>`, URL, code in large type, New code,
  devices with Disconnect, pending with Accept/Reject and hint; the three error texts; "External
  control is on another screen tab" after `superseded`. The panel gets `maxHeight: calc(100vh -
  16px)` and `overflowY: auto`. Nothing is drawn on the canvas. `tests/browser/control-server.ts`
  per PD13. About 260 source lines, 7 files.
- **Verification:** `pnpm run test --project unit web/src/control/qr.test.ts web/src/control/remembered.test.ts`
  (the SVG path is non-empty and square, and the package is called with exactly the URL passed;
  the remembered address falls back to the first when the stored one is no longer listed);
  `pnpm test:browser tests/browser/control-panel.spec.ts`
  (own server: switch on shows QR, URL with the code in the fragment, code; the empty seam shows
  "No local network address found"; a device client (a page on the LAN origin opening the
  socket with the browser's `WebSocket`, PD1) presenting the code appears with its
  hint, Accept sends it `approved`; New code changes the code and the device gets `ended`;
  Disconnect; a second screen page makes the first show the other-tab text; the canvas's
  `pixels()` are the same with the panel's QR open and closed at a point outside the panel);
  `pnpm test:browser tests/browser/panel.spec.ts` unchanged and green.
- **Depends on:** T7, T9
- **Autonomy note:** visual layout is the builder's within the spec's UI list. Stop if the QR
  package fails a condition on re-check (owner stop, not a swap), or if the panel must cover more
  than it does today when External control is off.

### T11 — `web/`: the controller's link state machine and round-trip timing
- **Implements:** AC11, AC27, AC28, AC43, SD12, SD17
- **Expected output:** `device-link.ts` with an injected socket factory, timers, storage and
  page events: reads `#code=` (then clears the fragment with `history.replaceState`) or
  `djv.controlKey`; `hello`; link states exactly the spec's texts; on `approved` stores the key;
  locks until the first `state`; on close → "Reconnecting…", retries 500, 1000, 2000, 4000, 5000,
  5000 ms, and at once on `visibilitychange` (visible) and `online`; sends nothing while not
  unlocked (a control is dropped, not queued); `refused { ended }` / `ended` → "Pairing ended —
  scan the code again", key removed, no further retries; `refused { expired }`, `rejected`,
  `wrong_code`, `too_many` → their texts. `round-trip.ts` records send time per `seq` and, on
  `applied { seq }`, feeds `createLatencyWindow` (`engine/src/latency.ts`) → last and p95 over
  10 s. `backoff.ts`: the delay sequence 500, 1000, 2000, 4000, 5000, 5000 ms, reset on a
  successful connect, used by `device-link.ts` here and by `screen-link.ts` in T9 (one helper).
  About 230 source lines, 4 files.
- **Verification:** `pnpm run test --project unit web/src/control/device-link.test.ts web/src/control/round-trip.test.ts web/src/control/backoff.test.ts`
  (fake timers: the backoff sequence; immediate retry on `online`; a control sent while
  reconnecting is never on the wire after reconnect; `ended` stops retries; a key from storage
  sends `hello { key }`; p95 of a known sample set).
- **Depends on:** T3
- **Autonomy note:** never name an object key `retry` or `retries` in a test file
  (`tests/workflow/test_gate_shape.py:166-172`). Internal shape is the builder's.

### T12 — `web/`: the `/control` page and DJ mode
- **Implements:** AC8, AC10, AC18, AC19, AC24, AC26, AC29, AC42, SD9, SD8, SD22
- **Expected output:** `main.tsx` routes `/control` to `Controller`. The page: link line (one
  full-width line), "Scan the code on the screen machine" with a 6-character code field when
  opened without code or key, mode toggle (DJ under 600 CSS px on first open, else VJ;
  `djv.controlMode`), and DJ mode: profile tiles (active marked, one tap = `pick`), camera tiles
  (disabled before Start with "Start on the screen machine"), two wide sliders sending `dials`,
  the Primary colour button showing the colour (opens the wheel in T13; until then disabled),
  the waiting badge ("1 waiting") opening `Approvals` with Accept/Reject, a Refresh button
  sending `refresh`, and `state.reason` shown with the panel's exact text (`REASONS`,
  `web/src/profiles/active.ts:50-59`) when the list failed (AC26). Every control disabled
  while locked. Targets ≥ 48×48 CSS px; no horizontal scroll at 320 px. About 300 source lines, 4
  files.
- **Verification:** `pnpm test:browser tests/browser/control.spec.ts` (own server, a 390×844
  controller context: code from the QR URL, "Waiting for approval", accept from the panel, the
  state arrives before the tiles enable; tile pick → screen overlay shows the profile and the
  panel picker agrees; slider → panel slider value and pixels change; camera tiles disabled
  before Start then switch the screen's camera after; a second device's request shows the badge;
  with the screen page's `GET /api/profiles` failed by `page.route`, the controller shows the
  same reason text as the panel, and Refresh refetches once (no fetch on a timer);
  no screen page → "Screen not connected", locked; mode starts DJ at 390 px, VJ at 1024 px, kept
  after reload; at 320 px `scrollWidth <= clientWidth`; every button's box ≥ 48×48).
- **Depends on:** T10, T11
- **Autonomy note:** styling is the builder's. Stop if `/control` cannot avoid starting the
  engine or audio code (it must not ask for camera or microphone).

### T13 — `web/`: VJ mode, the colour wheel and the round-trip readout
- **Implements:** AC8, AC20, AC21, AC23, AC43, SD11, SD18, SD9
- **Expected output:** `Wheel.tsx`: modal, hue/saturation disc on a canvas with pointer
  capture, brightness `<input type="range">`, current and stored colour side by side, Reset
  (`resetColour`) and Done; arrow keys move hue and saturation. Sends per PD14 from
  `wheel-math.ts`'s throttle. DJ's Primary colour button opens it on `state.primary`; VJ's
  swatches on their slot. `VjPanel.tsx`: swatches, status strip (camera, audio, Start, link,
  round trip last and p95), pending requests inline. About 300 source lines, 4 files.
- **Verification:** `pnpm run test --project unit web/src/control/wheel-math.test.ts` (round
  trips of HSV ↔ hex; throttle sends ≤ 1 per frame, ≥ 16 ms apart, and the final value on
  release); `pnpm test:browser tests/browser/control-modes.spec.ts` (drag on the wheel → screen
  pixels move toward the colour, the swatch on every surface shows it, no new program
  (`overlay` profile unchanged, no pick ack); Reset → stored colour; re-pick → stored palette;
  DJ Primary opens on slot 1 for the built-in and on the stored `primary` for a profile with
  one; keyboard arrows change the colour; the status strip shows a round trip after a change;
  a second device's request shows inline in VJ mode with its hint, and Accept from this
  controller approves it).
- **Depends on:** T12
- **Autonomy note:** the wheel's drawing is the builder's. Stop if contrast below 4.5:1 is
  unavoidable on any text.

### T14 — `web/`: the builder's primary marker and the unused-colour hint
- **Implements:** AC40, AC41, SD10
- **Expected output:** `editor.ts` gains `primarySet`; `paletteRemove(i)` moves `primary` with
  its colour (`i < primary` → `primary - 1`; `i === primary` → 0); `fieldsOf` carries it, Save
  sends it. `Editor.tsx`: a "Primary" radio per swatch (one group), the hint "this colour is not
  used by any effect" under the palette while the effective primary is in no effect's
  `colourSlot` and the stack has no `paletteMap`. About 60 source lines, 2 files.
- **Verification:** `pnpm run test --project unit web/src/builder/editor.test.ts` (each removal
  case; dirty after `primarySet`; revert clears it); `pnpm test:browser tests/browser/builder.spec.ts`
  (new: mark slot 2, save, reload — the stored profile has `primary: 2`; remove slot 0 — mark on
  the same colour; remove the marked slot — mark on slot 0; the hint appears and goes when an
  effect uses the slot; the existing Tab-chain tests still green).
- **Depends on:** T1
- **Autonomy note:** placement within the palette fieldset is the builder's
  (`Editor.tsx:170-199`). Stop if the effects' own slot handling (`editor.ts:45-51`, unchanged
  by B-04) has to change.

### T15 — Browser proof: limits, lifecycle and privacy end to end
- **Implements:** AC7, AC9, AC12, AC15, AC22, AC25, AC27, AC30, AC31, AC32, AC34, AC35, AC36
- **Expected output:** `tests/browser/control-e2e.spec.ts` part 1 with the own server: two
  controller contexts change the same dial in quick succession and every surface ends on the
  screen's last applied value; screen reload keeps External control on with the same code and
  devices, controllers show "Screen not connected" then receive the starting values; the
  controller context goes offline (`context.setOffline(true)`), shows "Reconnecting…", a slider
  moved meanwhile is not applied after `setOffline(false)`, the state arrives; five wrong codes
  → refused for the right code; a waiting device's control changes nothing; nine devices → "Too
  many devices"; the screen's requests during the run match the AC36 allow-list and include no
  write; the server's captured log, after a controller loaded `/control#code=…`, has no code
  (request line included), key, User-Agent, label or colour. No source
  change.
- **Verification:** `pnpm test:browser tests/browser/control-e2e.spec.ts`; then
  `bash scripts/check.sh` green, output pasted into the task's evidence.
- **Depends on:** T13, T14
- **Autonomy note:** test structure is the builder's. A failure here is a defect in the task
  that built the behaviour: fix it there with a failing test first, never by loosening the
  assertion.

### T16 — Browser proof: the spec's scenario, restart included
- **Implements:** AC1, AC6, AC11, AC13, AC14, AC28, SD1
- **Expected output:** `control-e2e.spec.ts` part 2, the spec's Verification 1 in order: open
  `/control` from the QR URL, present the code, accept from the panel, pick the twelve-effect
  profile (`twelveEffects()`, `tests/browser/fixtures/profiles.ts`), move both dials, drag the
  wheel, tap a camera — asserting screen pixels, the overlay's profile, the panel sliders and
  every surface's state after each step; offline/online recovery; Disconnect of one of two
  devices; New code; switch off; server `close()` and boot again on the same ports (nothing on
  `CONTROL_PORT`), switch on, controller ends on "Pairing ended — scan the code again" (PD4). No
  source change.
- **Verification:** `pnpm test:browser tests/browser/control-e2e.spec.ts`;
  `bash scripts/check.sh` green; `pnpm check:load` once, output recorded (not a gate, B-08).
- **Depends on:** T15
- **Autonomy note:** as T15. If the restart cannot rebind the same ports on Windows within the
  test (TIME_WAIT), stop and report; do not switch to new ports, which would hide PD4's case.

### T17 — Docs as built
- **Implements:** SD28
- **Expected output:** `docs/invariants.md`: the row texts were rewritten in T5, T6 and T9; T17
  only adds the enforcing tests that landed later to their Enforced-by column
  (`control-device.int.test.ts`, `control-e2e.spec.ts`); `docs/design/architecture.md` gains
  External control (listeners, sockets, message flow, the seam) and five variables; `README.md`
  "Pair a phone"; `docs/runbooks/README.md` gains "External control: latency check and venue
  networks" (H3's procedure, client isolation → travel router, port in use, Windows Defender
  Firewall: allow Node.js on private networks at the first switch-on and keep the Wi-Fi profile
  Private, else the listener binds but no device reaches it); `CLAUDE.md` names `CONTROL_PORT`
  beside the four. An `## Evidence` section added to this plan with T15's and T16's gate output
  and the `pnpm check:load` result. About 0 source lines, 5 doc files.
- **Verification:** `python scripts/check_plans.py`; `bash scripts/check.sh` (format step covers
  the Markdown).
- **Depends on:** T16
- **Autonomy note:** wording is the builder's; any rule that changes meaning beyond SD28's text
  is a stop.

### T18 — The settings panel never scrolls sideways (D-05)
*Added by the owner on 2026-11-15 during H3, after the audit; not audited. It goes to the B-04
review session with the rest.*
- **Implements:** D-05; SD24 (the panel's External control section)
- **Expected output:** `tests/browser/control-panel.spec.ts` gains a check that, with External
  control on, the owner's long adapter names in the address picker
  (`vEthernet (WSL (Hyper-V firewall))`, …) and a waiting device, the panel's `scrollWidth` is
  at most its `clientWidth` and the panel is at least 400 px wide. Red first: content 599 px in a
  340 px panel. Then `web/src/Panel.tsx`: 400 px, at most `100vw - 16px`, one shrinkable column;
  `web/src/SourcePickers.tsx`: `Row`'s second column shrinkable and a shared `FIT` cap on every
  select (also the builder preview's pickers); `web/src/control/ExternalControl.tsx`: the
  section's column shrinkable, the address select capped, device text wraps.
- **Verification:** `pnpm test:browser tests/browser/control-panel.spec.ts`; `bash scripts/check.sh`.
- **Depends on:** T17
- **Autonomy note:** owner-directed outside the audit; layout only, no behaviour change.

## Task graph

| Group | Tasks | Files they touch |
|---|---|---|
| 1 | T1, T2 | T1: `shared/src/profile.ts`, `engine/src/profile.ts`, `server/src/profiles/store.ts`, `web/src/builder/Builder.tsx`, `web/src/profile-compat.ts`, `tests/meta/profile-compat.test.ts`; T2: `server/src/config.ts`, `.env.example`, `server/test/spawn-server.ts`, `playwright.config.ts`, `scripts/under-load.ts` |
| 2 | T3, T8, T14 | T3: `shared/src/control.ts`, `shared/src/index.ts`; T8: `web/src/profiles/active.ts`, `web/src/capture/session.ts`; T14: `web/src/builder/editor.ts`, `web/src/builder/Editor.tsx`, `tests/browser/builder.spec.ts` |
| 3 | T4, T5, T11 | T4: `server/src/control/{pairing,hint,addresses}.ts`; T5: `server/package.json`, `pnpm-lock.yaml` (pnpm writes it), `server/src/control/{upgrade,channel,hub}.ts`, `server/src/boot.ts`, `docs/invariants.md`; T11: `web/src/control/{device-link,round-trip,backoff}.ts`, `web/src/control/remembered.ts` |
| 4 | T6 | `server/src/control/lan.ts`, `server/src/boot.ts`, `server/src/control/hub.ts`, `docs/invariants.md` |
| 5 | T7, T9 | T7: `server/src/control/device.ts`, `server/src/control/{hub,lan}.ts`, `server/src/control/pairing.ts`; T9: `web/src/control/{apply,screen-link}.ts`, `web/src/frame-feed.ts`, `web/src/Screen.tsx`, `scripts/dev.ts`, `tests/browser/live.spec.ts`, `docs/invariants.md` |
| 6 | T10 | `web/package.json`, `pnpm-lock.yaml`, `web/src/control/{ExternalControl.tsx,qr.ts,remembered.ts}`, `web/src/Panel.tsx`, `web/src/Screen.tsx`, `tests/browser/control-server.ts` |
| 7 | T12 | `web/src/main.tsx`, `web/src/control/{Controller,Approvals}.tsx`, `web/src/control/remembered.ts` |
| 8 | T13 | `web/src/control/{Wheel,VjPanel}.tsx`, `web/src/control/wheel-math.ts`, `web/src/control/Controller.tsx` |
| 9 | T15 | `tests/browser/control-e2e.spec.ts` |
| 10 | T16 | `tests/browser/control-e2e.spec.ts` |
| 11 | T17 | docs, `CLAUDE.md` |
| 12 | T18 | `web/src/{Panel,SourcePickers}.tsx`, `web/src/control/ExternalControl.tsx`, `tests/browser/control-panel.spec.ts` |

No two tasks in one group write the same file. `python scripts/check_plans.py --graph <this
file>` prints the groups the `Depends on` fields actually give; this table matches its output.
Only one task of group 3 may install a package at a time (`pnpm-lock.yaml`): T5 is the only one
there that does.

## Data changes

None in the database: no table, no migration (spec, Data). The profile `definition` JSON gains
an optional `primary` key, written only when set (T1); existing rows and version-1 files stay
valid and `formatVersion` stays 1. Reverting T1 leaves rows with `primary` that the old strict
schema would reject as "unusable" — so T1 is reverted only together with a one-off owner
decision (Risks). Browser storage: `djv.controlAddress` (screen machine), `djv.controlMode`,
`djv.controlKey` (controller's LAN origin).

## Risks and unknowns

| Risk | Mitigation |
|---|---|
| PD1–PD4 are owner stops; T5 cannot start before PD1, T16's restart assertion depends on PD4 | Answered at `/audit`, 2026-11-14 (H2) |
| Rolling back T1 after profiles were saved with `primary` makes them "unusable" under the old strict schema | Rollback note in T1's commit; the builder can remove the mark before a revert. No automatic backfill |
| AC12 needs a second source IP; CI has one machine | T7 resumes from `127.0.0.2` (loopback /8). If a CI runner refuses it, stop (T7 note) |
| A cross-phase invariant row untrue between tasks (CLAUDE.md hard stop) | Each row is rewritten in the commit that changes its behaviour (T5, T6, T9), citing SD28 as the approval; T9 depends on T6 so no parallel group edits `docs/invariants.md` twice. `boot.int.test.ts:65-80` stays true throughout |
| Windows Defender Firewall prompts the first time Node listens on a LAN address; denied or dismissed, or a Public Wi-Fi profile, and the listener binds but no device reaches it | The gate never binds a LAN address (T4, T6); H3 includes the prompt; runbook entry (T17) |
| React passive effects and the engine both touch dials (T9) | Engine set directly and the state updated for display; the effect re-applies the same value. A browser check asserts panel slider and engine agree |
| Panel height at 640×360 (Playwright viewport) pushes existing controls below the fold | Panel becomes scrollable (T10); Playwright scrolls into view; `panel.spec.ts` run in T10 |
| The `/control` page loads the whole bundle, engine and audio worklet included, on a phone | Acceptable for B-04 (spec has no size budget); T12 stops if it would request media. Code splitting is a later improvement |
| `pnpm dev` and the screen socket | `scripts/dev.ts` proxies `ws: true` (T9); External control's page is `pnpm start` only (PD8) |
| Existing `.env.local` files lack `CONTROL_PORT`, so `pnpm start`, `dev` and `migrate` fail after T2 | H1; README and the fatal line say which variable |
| `scripts/check.sh:15-16` claims "CI sets" the environment; `ci.yml` sets none | T2's verification runs the gate without `CONTROL_PORT` in `.env.local`; the comment itself is outside B-04 (noted, not fixed) |
| Wi-Fi latency (≤ 100 ms p95) is unproven until H3 | Readout in VJ mode (T13); runbook (T17) |

## Human steps

- **H1 — after T2, on the owner's machine:** add `CONTROL_PORT=8001` (or any free port other
  than `PORT`) to `.env.local`. `scripts/setup.sh:34` does not refresh an existing file.
  **Done 2026-11-15:** `pnpm migrate` loaded the config (which rejects a missing `CONTROL_PORT`
  or one equal to `PORT`) and reported `schemaVersion 2`, "migrations up to date".
- **H2 — at `/audit`:** answer PD1, PD2, PD3, PD4. **Done 2026-11-14:** PD1 `ws` + `@types/ws`;
  PD2, PD3, PD4 as recommended.
- **H3 — after T16, on the screen machine and the owner's network:** at the first switch-on,
  allow Node.js on private networks in the Windows Defender Firewall prompt (and check the Wi-Fi
  profile is Private); then the spec's Verification 2 in full: pair a phone by QR and accept on the screen, pair a tablet and accept from the phone,
  DJ mode on the phone (tiles, dials, primary colour, camera), VJ mode on the tablet (two
  swatches, round trip p95 ≤ 100 ms), lock the phone a minute and unlock (reconnects without
  approval), reload the screen page (both recover), New code (both "Pairing ended"), overlay
  audio p95 ≤ 50 ms throughout. Proves the Wi-Fi latency (SD17) and the non-functional render
  budget with two controllers; the gate proves AC19 and AC43 structurally only.
  **In progress 2026-11-15:** screen machine on Ethernet (profile Private), phone an iPhone on
  the same router's Wi-Fi. Phone paired by QR and accepted on the screen; device `colour`
  messages answered `applied` + `state` in the server log. Getting there needed an owner-made
  inbound port rule (TCP `CONTROL_PORT`, Private profile): every existing Node.js program rule
  was Public-only, and the server ran from fnm's per-shell path
  (`%LOCALAPPDATA%\fnm_multishells\<id>\node.exe`), which no program rule matches. Until then
  the phone showed a black page (Safari waiting) and no request reached the server.
  Follow-ups (not fixed): (1) the runbook's "tick Private at the prompt" fails when Node already
  has a Public-only rule or runs via fnm — recommend a port rule; (2) the panel's address
  picker offers Hyper-V/WSL virtual adapters (`vEthernet`) no device can reach.
  Tablet (iPad) paired and accepted from the phone. DJ mode on phone and tablet: tiles, both
  dials, primary colour and camera all followed on the screen. Audio p95 20–25 ms (≤ 50) while
  both dragged. **Round trip failed:** VJ swatch drags p95 130 and 105 ms (> 100), still over
  with the tablet near the router — registered as D-04 (`docs/specs/defect-register.md`).
  Profile switches 41 / 41 ms. Lifecycle passed: phone locked a minute and unlocked reconnected
  without approval; screen reload — both devices recovered with the profile's starting values;
  New code — both showed "Pairing ended". Audio p95 never above 28 ms throughout.
  The screen's settings panel scrolled sideways (D-05): fixed in T18 at the owner's direction.
- **H4 — after H3, from a third device:** the spec's Verification 3 — `http://<address>:<PORT>/api/profiles`
  refused, `http://<address>:<CONTROL_PORT>/api/profiles` 404; switch off, `/control` refused.
  Real private addresses are proven here; the gate binds loopback (SD29).
- **H5 — push, CI, PR, merge:** the owner's.

## Out of scope for this plan

- Code splitting `/control` away from the engine and audio bundle (not required by the spec).
- Fixing `scripts/check.sh:15-16`'s comment and `docs/runbooks/README.md:9-12`'s list of
  runbooks that do not exist (found during exploration; neither is B-04's).
- Everything in the spec's Out of scope list.

## Audit (PASS required before implementation starts)

- [x] Every AC maps to at least one task
- [x] Every task maps to at least one AC (no orphans) — T17 serves SD28 only, a docs task
- [x] Each task's expected output is concrete enough to check, and is what we actually need
- [x] Existing patterns reused; nothing reinvented — one shared `backoff.ts` (T11)
- [x] No new dependency without an approval note — `ws`, `@types/ws`, `qrcode-generator`
- [x] Data changes additive and reversible — `primary` additive; a T1 revert after saves needs the owner (Data changes)
- [x] Errors, empty states and permissions are tasks, not afterthoughts
- [x] Each task reviewable in one sitting — T9, T12, T13 nearest the limit
- [x] Verification named per task
- [x] Nothing touches prod, secrets or infra it should not — invariant rows moved into T5, T6, T9
- [x] Every task has a Depends on and an Autonomy note
- [x] No two tasks in one parallel group write the same file

Audit findings applied 2026-11-14: `@types/ws` added (PD1); invariant rows moved from T17 into
T5, T6, T9 (T9 now depends on T6, T11); T6 no longer binds real LAN addresses in the gate
(`defaultControlAddresses` unit test in T4); shared `backoff.ts` (T11, used by T9); AC26
controller side in T12; AC8 VJ side in T13; AC7 in T15; Windows Firewall in H3 and the runbook;
PD11 slot bound from `LIMITS.paletteMax`; T17's evidence section defined.

Audited by: Martijn Boot  Date: 2026-11-14

## Evidence

Built 2026-11-15 in whole-plan mode, one stacked branch per task (`feature/phase-b-04-t<n>-*`).
Each task ran its named verification; the gate ran on the tip of the stack only, so the
intermediate commits were not gated one by one.

**Gate on the tip, `74119ba`** (`bash scripts/check.sh`, Windows 11, Node 24): all 9 steps passed
— plans, workflow tests, format, lint, types, build; unit 53 files / 556 tests; integration 8
files / 110 tests; browser 133 passed (4.9 min). `scripts/check.sh: all 9 step(s) passed`.

**`pnpm check:load` on `74119ba`** (not the gate, B-08): exit 0, all 9 steps passed under load;
browser 133 passed (20.7 min).

**What the gate found on the way to that tip, each fixed on the responsible task's branch as a
new commit and the later branches rebased:**

- The first tip, `58f580f`, was green in the gate, but `pnpm check:load` failed T16's scenario at
  "the screen turns greener": `expect.poll`'s five seconds ran out while the loaded screen drew a
  few frames a second. The colour had reached the screen; the canvas reads were slow. Fixed on
  T16 (`496ad58` after rebase): that wait gets a minute, the threshold unchanged.
- The gate on the next tip, `b77e705`, failed T15's reload test: it moved a dial before the pick
  it had just made landed, and the pick's starting dials overwrote it. Fixed on T15 (`349b5df`):
  the tests that pick and then move a dial wait for the pick first. No source change in either.

T15 and T16's own `bash scripts/check.sh` is this tip gate. H1, H3, H4 and H5 remain the owner's.
