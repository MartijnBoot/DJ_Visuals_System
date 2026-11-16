# Spec: b-04 — Live set controls (external control)

Status: Approved · Depends on: B-01 (`docs/specs/phase-b-01-live-visual-engine.md`, built), B-02
(`docs/specs/phase-b-02-visual-profiles.md`, built), B-08 (`docs/specs/phase-b-08-load-proof-gate.md`,
built) · Fixes: — · Backlog: B-04

Line references are to `main` at `89caa19`.

## Problem

Mid-set the mood shifts, the camera needs to swing from the DJ to the crowd, and whoever is at
the controls is either the DJ with one hand free or a VJ with full attention. Today every live
control sits on the output itself, on the screen machine:

- The only control surface is the `s` panel, drawn over the canvas that is the venue output
  (`web/src/Panel.tsx:51-67`, toggled at `web/src/Screen.tsx:143-147`). Changing anything means
  reaching the screen machine's keyboard and putting a panel over the visuals the room is
  watching. B-01 called this panel scaffolding that B-04 replaces for live use
  (`docs/specs/phase-b-01-live-visual-engine.md`, SD6).
- No other device can reach the app. The server listens on `127.0.0.1` only
  (`server/src/boot.ts:15`, `server/src/boot.ts:86`), an invariant
  (`docs/invariants.md:26`) that `server/test/boot.int.test.ts:65-80` proves by refusing every
  non-internal IPv4 address. There is no pairing, no token and no second listener; the SDR gives
  the pairing design to this item (ADR 0001 §2, "Pairing token for any second device").
- There is no realtime channel. The server has no WebSocket dependency (`server/package.json`),
  and the browser check asserts that a running set opens no WebSocket at all
  (`tests/browser/live.spec.ts:531`, `tests/browser/live.spec.ts:548`). The SDR planned one
  ("the control WebSocket", ADR 0001 §2 B and question 5).
- A profile is switched only by the panel's picker (`web/src/Panel.tsx:84-100` →
  `web/src/profiles/active.ts:118-137`). The dials are only the panel's two sliders
  (`web/src/Panel.tsx:105-120`). The camera is only the panel's picker
  (`web/src/SourcePickers.tsx`, `web/src/capture/session.ts:53`).
- Colours cannot change live at all. The palette is whatever the profile stored
  (`shared/src/profile.ts:72-77`, `engine/src/profile.ts:53-60`), and a profile has no notion of
  which of its colours is the one that matters, so there is nothing a one-tap "change the colour"
  control could aim at.
- The web app has two routes and no third (`web/src/main.tsx:7`); there is no page meant for a
  phone or tablet.

Cost today: the set is locked to what was prepared beforehand, unless someone stands at the
screen machine and covers the output with a panel.

## Decisions

The owner's answers from the interview (2026-11-14), then defaults marked as such.

- **SD1 — External control from any browser device on the LAN is in this item.** The control
  surface is a page any browser can open: phone and tablet most likely, a laptop possible. It is
  called *External control* everywhere in the UI. B-04 brings the LAN listener, pairing,
  approval, the channel and the page; the plan builds and proves the channel on `127.0.0.1`
  before the LAN listener opens. Size grows from M to L.
- **SD2 — The LAN is reachable only while the operator switches External control on.** A switch
  in the screen page's `s` panel starts a second listener and generates a new code; switching it
  off, or a server restart, closes the listener and ends every pairing. The LAN listener serves
  only `GET /control`, `GET /assets/*` and the device socket (API contract); `/`, `/builder`,
  `/api/health` and every `/api/profiles` endpoint stay on `127.0.0.1:PORT` only.
- **SD3 — Pairing by QR code, with the URL and a short code as text.** The panel shows a QR code
  holding the control URL with the code, so scanning opens `/control` already carrying it; under
  it the URL and the 6-character code for a device that cannot scan. Drawing the QR code uses a
  small library: a new dependency, approved by approving this spec under the conditions in
  "Dependencies".
- **SD4 — The code alone is not enough: every new device is accepted.** A device that presents a
  valid code waits on "Waiting for approval" until it is accepted (SD18). An accepted device gets
  its own session key; a dropped connection reconnects with that key without a new approval
  until External control is switched off, a new code is issued, the device is disconnected, or
  the server restarts. The panel lists connected devices, each with Disconnect, and has a "New
  code" button that disconnects every device and issues a new code.
- **SD5 — Last change wins, and every surface mirrors the screen.** Any number of approved
  controllers and the screen's own panel act together, with no locks and no roles. Every change
  goes to the screen page, which applies it and sends the resulting state to every controller;
  a device that (re)connects receives the full state first.
- **SD6 — Profile switches stay a hard cut.** A controller's pick is the existing pick
  (`web/src/profiles/active.ts:118-137`, B-02 SD15): prepared, then swapped on a frame boundary,
  applying the profile's starting dials. Transitions of any kind are a new backlog item, B-09,
  with more types than a crossfade and their own latency check.
- **SD7 — A live colour change edits the active profile's palette slots in memory.** It is
  never saved (ADR 0001, "Live changes are never saved into profiles"). Picking a profile, the
  same one included, starts again from its stored palette. A global colour layer that survives
  switches (hue shift, tint) is a new backlog item, B-10, on top of this.
- **SD8 — The controller gets profile, colours, the two dials and the camera, plus read-only
  status.** Profile picker; palette colours (SD9, SD11); recognisability and audio reactivity;
  the camera picker, listing the screen machine's own cameras with their labels. Status: camera
  and audio state (`ok`, `lost`, `none`, `idle`), whether Start has happened, and the link state
  (SD12). Audio source, quality cap and Start stay on the screen machine only: Start and system
  audio need a user gesture there. Device labels reach paired controllers; logs still never
  carry them.
- **SD9 — One page, `/control`, with a DJ/VJ mode toggle remembered per device.** *DJ mode*:
  large touch targets — profiles as a grid of tiles (one tap switches), cameras as tiles (one
  tap), the two dials as wide sliders, and a **Primary colour** button that opens the colour
  wheel on the active profile's primary slot (SD10). *VJ mode*: all of that, plus every palette
  swatch (each opens the same wheel), the full status strip, the latency readout (SD17) and
  pending approval requests (SD18). On first open a viewport narrower than 600 CSS px starts in
  DJ mode, otherwise VJ; the toggle overrides and is remembered in that device's browser
  storage. The screen page never knows a device's mode.
- **SD10 — A profile names one palette slot as its primary colour.** `primary` is an optional
  palette index in the profile. When absent it is derived: the `colourSlot` of the first effect
  in the stack that has one, else slot 0 (the built-in derives slot 1, white). No migration;
  `formatVersion` stays 1; existing rows and files stay valid. The builder marks one swatch as
  primary, writes `primary` on save, moves the mark with its colour when slots are removed, and
  puts it on slot 0 when the primary slot itself is removed. When no effect uses the primary slot
  and the stack has no palette map, the builder shows a hint ("this colour is not used by any
  effect"). The engine ignores the field, but its `Profile` declares it so the compat check
  holds (`docs/invariants.md:29`). The primary slot is chosen in the builder only, never live.
- **SD11 — The colour wheel is drawn in `/control` and applies while dragging.** A hue and
  saturation disc with a brightness slider, touch-drag first, no dependency. While dragging, at
  most one change is sent per animation frame and the last position is always sent. "Reset"
  restores the slot's stored colour. DJ mode's Primary colour button and VJ mode's swatches open
  the same wheel.
- **SD12 — A dropped link locks the controller; nothing is queued.** The controller greys out
  every control, shows "Reconnecting…", and retries at 0.5 s doubling to at most 5 s, and at
  once when the page becomes visible or the browser reports the network back. A move made while
  disconnected is dropped, never sent later. On reconnect the state arrives first, then the
  controls unlock. When the server answers that the pairing no longer exists (server restart,
  switched off, new code, disconnected), the controller shows "Pairing ended — scan the code
  again" and stops retrying. While no screen page is connected, the controller shows "Screen not
  connected" with the controls locked.
- **SD13 — The server owns External control; a screen page reload changes nothing.** The switch,
  code, approvals and the LAN listener live in the server process. After a reload the panel
  reads them and shows "External control: on" with the device list; controllers show "Screen not
  connected" until the page is back, then receive its state, which after a reload is the active
  profile's starting values (SD5). With two screen pages open, the one that connected last is
  the target; the older one shows "External control is on another screen tab" in its panel and
  receives nothing further. The builder is never a target.
- **SD14 — The LAN listener binds private IPv4 addresses only, on `CONTROL_PORT`.** It binds each
  address of the machine in `10.0.0.0/8`, `172.16.0.0/12` and `192.168.0.0/16`, never `0.0.0.0`,
  a public address or IPv6. `CONTROL_PORT` is a new required variable in `server/src/config.ts`
  and `.env.example` (1 to 65535, different from `PORT`; no default in code). The panel lists
  the bound addresses with their adapter names; the first is preselected, the choice is
  remembered in the screen machine's browser storage, and the QR code and URL use it. With no
  private address, switching on fails and the panel says why.
- **SD15 — Plain HTTP on the LAN; the session key is bound to the approved source IP.** A sniffed
  code gets nothing without an approval (SD4); a sniffed session key replayed from another IP is
  refused. A device whose IP changes must be accepted again. Remaining, accepted risk: a sniffer
  on the same network who also spoofs an approved device's IP can send controls. HTTPS is
  decided once in B-06, which needs it for remote cameras — closed by B-06 SD13
  (`docs/specs/phase-b-06-remote-input-devices.md`).
- **SD16 — The channel is a WebSocket through `@fastify/websocket`.** Two new server
  dependencies (`@fastify/websocket` and `ws`), approved by approving this spec under the
  conditions in "Dependencies". This is the SDR's "control WebSocket" as written.
- **SD17 — Two latency numbers, like B-01 SD2.** *In the gate*: on `127.0.0.1`, a control message
  is applied by the engine in the first frame that starts after the screen page receives it — a
  structural check, never wall-clock (B-08). *On the owner's network* (a human step): a tap to
  its applied frame ≤ 100 ms p95 over Wi-Fi, read from a round-trip readout in VJ mode's status
  strip: the time from sending a change to the screen page's acknowledgement of the frame that
  applied it, last and p95 over 10 s.
- **SD18 — The screen panel or any approved controller can accept a waiting device.** Pending
  requests show in the panel and in VJ mode on every approved controller, with Accept, Reject
  and a device hint; DJ mode shows a "1 waiting" badge that opens the same prompt. A request
  expires after 60 s unanswered and the device shows "Request expired — try again". "New code"
  and Disconnect are in the screen panel only, so a controller cannot lock the others out.
- **SD19 — The code is 6 characters from an unambiguous alphabet.** Uppercase letters and digits
  without `0 O 1 I L` (31 characters, about 30 bits), from `crypto.getRandomValues`. The QR URL
  carries it in the fragment (`/control#code=XXXXXX`), so it never appears in a request line or a
  server log; the page sends it over the socket. Five wrong codes from one IP within 60 s refuse
  that IP for 60 s. The session key is 128 random bits, kept in the device's `localStorage` on
  the LAN origin. *(default, not asked)*
- **SD20 — Every message is validated against a schema in `shared/`.** A new
  `shared/src/control.ts` defines every message both ways with zod. The server validates every
  message it receives before acting or relaying; each page validates every message it receives.
  A message that fails, or exceeds 4 KB, is dropped with one `warn` naming its type (or
  "unparseable"), and the socket stays open. More than 120 messages per second on one socket:
  the excess is dropped. *(default, not asked)*
- **SD21 — Limits: 8 approved devices, 4 pending requests.** A request beyond either is refused
  at once with "Too many devices". *(default, not asked)*
- **SD22 — Controllers see the profile list through the screen page.** The screen page fetches
  `GET /api/profiles` when a controller connects and when a controller presses Refresh. A tap on
  a controller is a user action in the sense of B-02 SD6; nothing polls. A failed list shows its
  reason on the controllers as it does in the panel (`web/src/profiles/active.ts:50-59`).
  *(default, not asked)*
- **SD23 — Before Start, a controller can already switch profile, dials and colours.** The engine
  draws the idle look then. The camera tiles are disabled with "Start on the screen machine",
  because no camera is open until Start. *(default, not asked)*
- **SD24 — The `s` panel stays complete and gains an External control section.** The switch, the
  address picker, the QR code, URL and code, New code, the device list with Disconnect, and the
  pending requests. Everything else in it is unchanged, and the keys `o`, `s`, `f` keep their
  meaning. The QR code is on the output only while the panel is open, which is why SD4 exists.
  *(default, not asked)*
- **SD25 — The panel talks to the server over the screen socket, not new REST endpoints.** The
  screen page opens one WebSocket to `127.0.0.1:PORT` on load; the switch, New code, Disconnect,
  Accept and Reject travel on it. Both sockets refuse an upgrade whose `Origin` is not their own
  listener's origin (for the screen socket also the Vite dev origin `http://localhost:5173`),
  because WebSockets are not covered by CORS and any page open in the screen machine's browser
  could otherwise switch External control on and approve itself. *(default, not asked)*
- **SD26 — The device hint is "<browser> on <OS>", from the User-Agent.** A small hand-written
  mapping (Safari, Chrome, Firefox, Edge, Samsung Internet; iPhone, iPad, Android, Windows,
  macOS, Linux), else "Unknown device", always followed by a sequence label ("Device 3") so two
  identical phones can be told apart. Shown in the panel and on controllers, never logged.
  *(default, not asked)*
- **SD27 — Logging.** The server logs at `info`: External control on and off (addresses and
  port), a device requested, accepted, rejected, expired or disconnected (sequence label only),
  a new code issued (never the code), a screen page connected or superseded. Control messages at
  `debug`, type only. Never the code, a session key, a User-Agent, a device label or a colour.
  *(default, not asked)*
- **SD28 — Invariants and design docs change, and approving this spec approves the edits.** In
  `docs/invariants.md`: the `127.0.0.1` row becomes "the main server listens on `127.0.0.1`
  only; the External control listener binds private IPv4 addresses only, only while switched
  on, and answers only `GET /control`, `GET /assets/*` and the device socket"; the B-01 request
  row adds the screen socket (`/api/control/screen` on `127.0.0.1`) and "a user action on a
  paired controller" to the profile reads; a new row "every control message is validated
  against `shared/src/control.ts` on receipt, and only an approved device's socket may send a
  control". `docs/design/architecture.md` gains External control. *(default, not asked)*
- **SD29 — The gate binds the LAN listener through a test seam.** The address list the listener
  binds is injected (the same way `BootPaths` is, `server/src/boot.ts:18-23`), so the browser
  and integration checks bind `127.0.0.1` on a free `CONTROL_PORT` on any CI machine; the
  private-address rule is a pure function, unit-tested against faked `networkInterfaces()`. No
  environment variable switches it. *(default, not asked)*

## Dependencies

New third-party packages, approved by approving this spec, each on the condition that before
the first task that installs it the builder checks and records in the plan: the licence is MIT,
ISC, BSD or Apache-2.0; a release or commit within the last 24 months; the package declares no
dependency of its own (the WebSocket pair excepted, which is exactly `@fastify/websocket` → `ws`).
A candidate that fails a condition is a stop for the owner, not a swap.

| Package | Where | Why | Why not the standard library |
|---|---|---|---|
| `@fastify/websocket` (brings `ws`) | `server/` | The control channel (SD16), on the existing Fastify app and on the LAN listener | Node 24 has a WebSocket client, not a server; hand-writing framing, masking, ping and close on a LAN-facing port is security-relevant code (interview, Q16) |
| A QR encoder, candidate `qrcode-generator` | `web/` | The pairing QR code (SD3) | No browser or Node API encodes QR; the encoder (Reed-Solomon, masking, versions) is a few hundred lines to own (interview, Q3) |

## Users and permissions

| Role | Can | Cannot |
|---|---|---|
| Operator at the screen machine (`s` panel) | Everything B-01 and B-02 allow; switch External control on and off; pick the QR address; issue a new code; accept and reject requests; disconnect a device | — |
| Approved controller (any LAN browser with a session key) | Pick a profile, move the two dials, change palette colours live, pick a camera, refresh the profile list, accept and reject waiting devices | Start capture, change the audio source or quality cap, issue a new code, disconnect a device, switch External control off, open `/builder`, reach any `/api/profiles` endpoint, save anything |
| Waiting device (valid code, not yet accepted) | Wait; see "Waiting for approval", "Request rejected", "Request expired" | Send any control or receive any state |
| Any other LAN host | Load `/control` and `/assets/*` while External control is on | Anything else; nothing at all while it is off |

## In scope

- `shared/`: `control.ts` (every message schema, SD20); the optional `primary` field and its rule
  in `profile.ts` (index inside the palette); `derivePrimary(profile)`; `toProfileFile` carries
  `primary` when set.
- `engine/`: `Profile` declares `primary?: number`; nothing else changes. Still no dependency.
- `server/`: `CONTROL_PORT` in `config.ts` and `.env.example`; the External control module
  (switch, code, pending requests, approvals, session keys bound to IP, limits, wrong-code
  throttle, all in memory); the private-address filter; the LAN listener with its three routes;
  the screen socket on `127.0.0.1:PORT`; the device socket on the LAN listener; Origin checks;
  relaying and validation; logging (SD27). No table, no migration.
- `web/`: the `/control` route in `main.tsx` (DJ and VJ modes, tiles, sliders, colour wheel,
  status strip, latency readout, approval prompt, link states); the screen page's control
  client (applies changes, sends state, acks frames, fetches the list for controllers); the
  live palette in `profiles/active.ts`; the panel's External control section with the QR code;
  the builder's primary marker and hint.
- Tests: unit, integration (`server/test/`) and browser (`tests/browser/`, a second browser
  context as the controller) for every criterion below; the B-01 request allow-list test
  extended with the screen socket.
- Docs: `docs/invariants.md` and `docs/design/architecture.md` (SD28); `README.md` (how to
  pair); a runbook entry for the human latency step and for venue networks.

## Out of scope

- Transitions between profiles of any kind, crossfade included (B-09).
- A global colour layer, hue shift or tint that survives profile switches (B-10).
- Saving live changes into a profile, or "save as new profile" from the controller (ADR 0001 §7).
- Choosing the primary slot live; editing the effect stack, effect strengths or bindings live.
- Scenes, presets of live state, undo of live changes (B-07).
- Remote cameras, remote audio, any media over the network, WebRTC, HTTPS and certificates
  (B-06). No media reaches the server, unchanged.
- Changing the audio source, quality cap or Start from a controller (SD8).
- Feature meters or the camera picture on the controller.
- Roles, per-device permissions, a "take control" lock, per-control ownership (SD5).
- Persisting the code, approvals or devices across a server restart.
- Accounts, bought auth, internet access, NAT traversal, venues with client isolation (the
  runbook advises a travel router, SDR §8).
- IPv6 and public addresses.
- MIDI controllers, keyboard shortcuts on the controller, gestures beyond tap and drag.
- An installable app, offline use of `/control`, push notifications.
- Controlling the builder's preview.
- Localisation; the UI stays English.

## Acceptance criteria

### Listener and pairing

- **AC1.** When the server boots, it shall listen on `127.0.0.1:PORT` only and nothing shall
  listen on `CONTROL_PORT`, whatever the state before the restart.
- **AC2.** If `CONTROL_PORT` is missing, malformed or equal to `PORT`, then the server shall
  log one `fatal` line naming `CONTROL_PORT` (never a value) and exit 1 before opening the
  database.
- **AC3.** When the operator switches External control on, the server shall listen on
  `CONTROL_PORT` on every private IPv4 address of the machine and on no other address, generate
  a new code, and the panel shall show the QR code, URL and code for the selected address.
- **AC4.** If the machine has no private IPv4 address, then switching on shall leave nothing
  listening and the panel shall show "No local network address found".
- **AC5.** While External control is on, the LAN listener shall answer `GET /control`,
  `GET /assets/*` and the device socket, and 404 to every other path, including `/`,
  `/builder`, `/api/health` and every `/api/profiles` path.
- **AC6.** When the operator switches External control off, the server shall stop listening on
  `CONTROL_PORT`, close every device socket with "pairing ended", and discard the code, pending
  requests and session keys.
- **AC7.** When a device opens the QR URL, the server log and the request line shall not
  contain the code (it travels in the fragment and on the socket only).
- **AC8.** When a device presents a valid code, it shall show "Waiting for approval", and the
  panel and every approved controller in VJ mode shall show the request with its device hint;
  approved controllers in DJ mode shall show a "1 waiting" badge.
- **AC9.** If a device presents a wrong code, then it shall be refused with "Wrong code"; and if
  one IP presents five wrong codes within 60 s, then that IP shall be refused for 60 s, a right
  code included.
- **AC10.** When a request is accepted from the panel or from an approved controller, the device
  shall receive a session key and the full state before its controls unlock; when rejected, it
  shall show "Request rejected"; when unanswered for 60 s, it shall show "Request expired — try
  again" and the request shall leave every list.
- **AC11.** When an approved device reconnects with its session key from the IP it was approved
  on, the server shall accept it without a new approval and send the state first.
- **AC12.** If a socket presents a valid session key from another IP, then the server shall
  refuse it and the device shall need a new approval.
- **AC13.** When the operator issues a new code, every device shall be disconnected with "pairing
  ended", every session key and the old code shall be refused, and the panel shall show the new
  code.
- **AC14.** When the operator disconnects a device, that device shall show "Pairing ended — scan
  the code again", its session key shall be refused, and other devices shall stay connected.
- **AC15.** If 8 devices are approved or 4 requests are pending, then a further request shall be
  refused at once with "Too many devices".
- **AC16.** If a WebSocket upgrade carries an `Origin` other than its listener's own (and, for
  the screen socket, the Vite dev origin), then the server shall refuse it.
- **AC17.** When "New code" or Disconnect is sent from a controller's socket, the server shall
  refuse it; neither exists in the controller UI.

### Controls

- **AC18.** When a controller picks a profile, the screen page shall switch to it exactly as the
  panel's picker does (prepared, hard cut, starting dials applied, remembered), and every
  controller and the panel shall show it as active.
- **AC19.** When a controller moves a dial, the engine shall use the new value in the first frame
  that starts after the screen page receives the message, and every other surface shall show the
  new value.
- **AC20.** When a controller drags the colour wheel on a slot, the screen page shall apply each
  received colour to that palette slot of the active profile on the next frame, without a new
  shader program, and the controller shall send at most one change per animation frame and
  always its last position.
- **AC21.** When a controller presses Reset in the wheel, the slot shall return to the stored
  colour; and when any profile is picked, the same one included, every live colour edit shall be
  discarded.
- **AC22.** While a set runs with live colour edits, no request shall write a profile (no
  `POST`, `PUT` or `DELETE` to `/api/profiles*`).
- **AC23.** In DJ mode, the Primary colour button shall open the wheel on the active profile's
  primary slot (stored, or derived when absent); in VJ mode every swatch shall open it on its
  own slot.
- **AC24.** When a controller taps a camera, the screen page shall switch camera as the panel's
  picker does; and while Start has not happened, the camera tiles shall be disabled with "Start
  on the screen machine".
- **AC25.** When two controllers change the same control in quick succession, every surface shall
  end on the value the screen page applied last.
- **AC26.** When a controller connects or presses Refresh, the screen page shall fetch the
  profile list and every controller shall show it; and if the fetch fails, every controller shall
  show the same reason the panel shows. The screen page shall never fetch the list on a timer.

### Link and screen lifecycle

- **AC27.** While a controller's socket is down, its controls shall be disabled and it shall show
  "Reconnecting…", retrying at 0.5 s doubling to 5 s and at once on `visibilitychange` to
  visible and on `online`; a control moved meanwhile shall never be sent after reconnecting.
- **AC28.** When the server answers that a pairing no longer exists, the controller shall show
  "Pairing ended — scan the code again" and stop retrying; after a server restart this is the
  outcome on every controller.
- **AC29.** While no screen page is connected, every controller shall show "Screen not connected"
  with its controls disabled; when a screen page connects, controllers shall receive its state
  and unlock.
- **AC30.** When the screen page reloads, External control shall stay on with the same code and
  approvals, the panel shall show it as on with its devices, and the controllers shall receive
  the active profile's starting values.
- **AC31.** When a second screen page connects, it shall become the target; the first shall show
  "External control is on another screen tab" in its panel and receive no further control.
- **AC32.** While External control runs, the output canvas shall never carry text; requests,
  codes and devices appear only in the panel and on controllers.

### Messages, logging, privacy

- **AC33.** If a received message fails its schema or exceeds 4 KB, then it shall be dropped
  with one `warn` naming its type or "unparseable", and the socket shall stay open; messages
  beyond 120 per second on one socket shall be dropped.
- **AC34.** When a waiting device (not yet accepted) sends a control, the server shall drop it and
  the screen shall not change.
- **AC35.** The server's log lines during pairing, control and disconnect shall contain no code,
  session key, User-Agent, device label or colour value.
- **AC36.** The screen page shall make no request beyond `GET /`, `/assets/*`, `/api/health`,
  the screen socket, and `/api/profiles` and `/api/profiles/:id` on a user action in the panel or
  on a paired controller (the amended B-01 row).

### Primary colour (profile model and builder)

- **AC37.** The shared schema shall accept a profile with `primary` an integer inside its palette
  and without `primary`, and shall reject `primary` outside the palette naming the field.
- **AC38.** When `primary` is absent, `derivePrimary` shall return the `colourSlot` of the first
  effect in the stack that has one, else 0; for the built-in profile it shall return 1.
- **AC39.** When a profile with `primary` is exported and imported, `primary` shall survive; a
  version-1 file without it shall import unchanged; a stored row without it shall list and load.
- **AC40.** When the owner marks a swatch as primary in the builder and saves, the stored profile
  shall carry that index; removing a slot before it shall keep the mark on its colour; removing
  the primary slot shall move the mark to slot 0.
- **AC41.** While the primary slot is used by no effect and the stack has no palette map, the
  builder shall show "this colour is not used by any effect".

### Modes and latency

- **AC42.** When `/control` first opens on a viewport narrower than 600 CSS px, it shall start in
  DJ mode, otherwise VJ; the toggle shall switch modes and the choice shall be kept across
  reloads on that device.
- **AC43.** In VJ mode, the status strip shall show the round trip from sending a change to the
  screen page's acknowledgement of the frame that applied it, last and p95 over 10 s.

## Data

- **No table, no migration.** Everything about External control is held in server memory and
  dies with the process.
- **Profile definition:** optional `primary`, an integer `0 ≤ primary < palette.length`.
  Additive: existing `definition` rows and version-1 files stay valid; `formatVersion` stays 1.
  `engine/src/profile.ts` declares the same optional field (compat, `docs/invariants.md:29`).
- **Browser storage, screen machine:** `djv.controlAddress` (the address chosen for the QR).
- **Browser storage, controller (LAN origin):** `djv.controlMode` (`dj` | `vj`),
  `djv.controlKey` (the session key; useless after the pairing ends).

## API contract

| Listener | Method | Path | Request | Response | Errors |
|---|---|---|---|---|---|
| `127.0.0.1:PORT` | GET (upgrade) | `/api/control/screen` | WebSocket, own Origin | Screen socket: state in, control out, panel actions | 403 foreign Origin |
| LAN `CONTROL_PORT` | GET | `/control` | — | `index.html` | — |
| LAN `CONTROL_PORT` | GET | `/assets/*` | — | the built assets | 404 |
| LAN `CONTROL_PORT` | GET (upgrade) | `/api/control/device` | WebSocket, own Origin; first message `hello` with code or session key | Device socket | 403 foreign Origin; close with a reason for wrong code, throttled, too many devices, pairing ended, key from another IP |
| LAN `CONTROL_PORT` | any | anything else | — | — | 404 |

Message types (exact shapes in `shared/src/control.ts`, the plan's to write):

- Controller → server: `hello { code } | { key }`, `pick { id }`, `dials { recognisability?,
  reactivity? }`, `colour { slot, value }`, `resetColour { slot }`, `camera { deviceId }`,
  `refresh`, `accept { deviceId }`, `reject { deviceId }`. Each control carries a sequence number.
- Server → controller: `waiting`, `approved { key }`, `refused { reason }`, `ended`,
  `screen { connected }`, `pending [ { deviceId, hint } ]`, and the screen's `state` and `applied
  { seq }` relayed.
- Screen page → server: `state { profiles, activeId, palette, primary, dials, cameras, cameraId,
  camera, audio, started, reason }`, `applied { deviceId, seq }`, and panel actions `enable`,
  `disable`, `newCode`, `disconnect { deviceId }`, `accept`, `reject`.
- Server → screen page: controls from approved devices (with `deviceId`), `control { on,
  addresses, code, devices, pending }`, `superseded`.

## UI

- **Panel (`s`), External control section.** Off: the switch and one line "Lets a phone, tablet
  or laptop on this network control the visuals". On: address picker (adapter name and address),
  the QR code, the URL, the code in large type, New code, the device list (hint, sequence label,
  Disconnect), pending requests with Accept and Reject. Errors: "No local network address
  found", "Port <CONTROL_PORT> is in use", "External control unavailable: server unreachable".
- **`/control`, link states** (one full-width line above the controls): "Waiting for approval",
  "Request rejected", "Request expired — try again", "Wrong code", "Too many devices",
  "Reconnecting…", "Screen not connected", "Pairing ended — scan the code again". Opened
  without a code or key: "Scan the code on the screen machine" and a code field.
- **`/control`, DJ mode:** profile tiles (active one marked), camera tiles, two wide sliders, the
  Primary colour button showing the current primary colour, the waiting badge. Every target at
  least 48×48 CSS px.
- **`/control`, VJ mode:** DJ mode plus palette swatches, the status strip (camera, audio, Start,
  link, round trip last and p95), and pending requests.
- **Colour wheel:** modal over the controller, disc and brightness slider, current and stored
  colour side by side, Reset and Done. Keyboard: arrow keys move hue and saturation, a slider for
  brightness, so a laptop controller works without a mouse.
- **Builder:** a "Primary" radio per palette swatch; the hint (AC41) under the palette.
- Portrait and landscape on a phone; no horizontal scrolling at 320 CSS px wide.

## Non-functional

- **Render budget unchanged.** The screen page applies received controls at the start of a
  frame and sends at most one `state` per frame, coalesced. B-01's p95 ≤ 50 ms audio-to-frame
  (SD2) still holds with two controllers dragging; the gate proves it structurally (AC19), the
  owner's screen machine by H-step.
- **Control latency:** tap to applied frame ≤ 100 ms p95 over the owner's Wi-Fi (SD17), a human
  step.
- **Limits:** 4 KB per message, 120 messages/s per socket, 8 approved devices, 4 pending, 60 s
  request expiry, five wrong codes per IP per 60 s.
- **Security:** SD15, SD19, SD25; no CORS headers on either listener; the LAN listener serves no
  API but the device socket.
- **Accessibility:** native controls where they exist, labelled; the wheel keyboard-operable;
  contrast at least 4.5:1 for text on the controller.
- **Logging:** SD27.

## Edge cases and failure modes

- **Mid-set, users waiting (probe):** a dropped controller never changes the output (SD12); a
  screen page reload keeps every pairing (SD13); a controller can never blank the screen,
  because every change goes through the same paths that already keep the current look on
  failure (`web/src/profiles/active.ts:97-116`).
- **Process restart (probe):** External control is off after boot (AC1), every controller ends on
  "Pairing ended" (AC28); the operator switches on and re-pairs. The live state resets to the
  profile's starting values, as any restart does today.
- **`CONTROL_PORT` taken when switching on:** the switch stays off and the panel says "Port … is in
  use"; the main server is unaffected.
- **An address disappears while on** (Wi-Fi drops on the screen machine): that address's listener
  closes; the others stay; the panel's address list updates when the operator opens it. Devices
  on the lost network see "Reconnecting…".
- **A picked profile is deleted elsewhere** while controllers show it: unchanged from B-02 SD9;
  the tile stays until a Refresh.
- **The primary slot edited live, then the builder saves the same profile elsewhere:** the live
  edit stays until the next pick, which loads the saved palette (SD7, B-02 SD9).
- **Two quick picks from two controllers:** the later pick wins, as two quick picks in the panel
  already do (`web/src/profiles/active.ts:118-125`, the token).
- **Phone screen locks during approval:** the request may expire (60 s); the device asks again.
- **Money, roles (probes):** nothing touches money. Roles are the table above; there is one
  trust level for approved devices by design (SD5).
- **Guarded areas (probe):** none exist (`docs/invariants.md:38-41`); two cross-phase invariant
  rows change, approved with this spec (SD28).

## Verification

1. `bash scripts/check.sh` green, with the new unit, integration and browser checks: in the
   browser check, a second browser context opens `/control` on the test-bound LAN listener
   (SD29), presents the code, is accepted from the panel, picks the twelve-effect profile, moves
   both dials, drags the wheel and taps a camera; the screen's pixels, the engine's profile and
   dials, and every surface's state are asserted after each step; the context then goes
   offline, is shown "Reconnecting…", comes back and receives the state; the server restarts and
   the context shows "Pairing ended".
2. On the owner's screen machine and network (human steps, the plan's H-list): `pnpm start`,
   open `/`, Start, switch External control on, scan the QR code with a phone — accept it on the
   screen. Pair a tablet and accept it from the phone. In DJ mode on the phone: switch profiles
   by tile, move both dials, change the primary colour on the wheel, tap the other camera. In VJ
   mode on the tablet: edit two swatches, read the round trip — p95 ≤ 100 ms. Lock the phone
   for a minute and unlock: it reconnects without approval. Reload the screen page: both devices
   recover with the profile's starting values. Issue a new code: both devices show "Pairing
   ended". Confirm the overlay's audio p95 stays ≤ 50 ms throughout.
3. From a third device on the same network while External control is on, request
   `http://<address>:<PORT>/api/profiles` and `http://<address>:<CONTROL_PORT>/api/profiles`:
   both fail (refused and 404). Switch External control off: `/control` is refused.

## Exit condition

From a phone or tablet on the same network, accepted once, the owner switches profiles, moves
both dials, changes colours and switches the camera on the venue screen within 100 ms p95, and
nothing about it survives a restart or reaches any address but a private one.

## Open questions

None from the interview. The dependency checks in "Dependencies" are conditions for the build,
not open questions.
