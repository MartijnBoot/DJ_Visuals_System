# Spec: b-06 — Remote input devices

Status: Approved · Depends on: B-01 (`docs/specs/phase-b-01-live-visual-engine.md`, built), B-04
(`docs/specs/phase-b-04-live-set-controls.md`, built), B-08
(`docs/specs/phase-b-08-load-proof-gate.md`, built) · Fixes: — · Backlog: B-06 (supersedes B-05)

Line references are to `main` at `7b948a7`.

## Problem

The DJ mixes on a laptop that already carries heavy DJ software. The cleanest audio is the mix
on that laptop, and its webcam is a useful shot; other shots come from phones in the crowd or a
device next to another screen. Today the screen page reads only what is plugged into the screen
machine:

- The capture session opens one local camera through `getUserMedia` and one local audio source,
  an input or "System audio" through `getDisplayMedia` (`web/src/capture/session.ts:219-233`,
  `:235-282`, `:245-246`). Nothing else can become a source; B-01 SD1 deferred any remote camera
  (`docs/specs/phase-b-01-live-visual-engine.md:34-39`).
- A lost local source shows the no-camera look or decays the features to zero and retries every
  2 s (`web/src/capture/session.ts:174-188`, `:316-322`); there is no second source to fall
  back to.
- The LAN is reachable only through B-04's External control listener, on plain HTTP
  (`server/src/control/lan.ts:76`, the device socket's origin `http://<address>:CONTROL_PORT` at
  `server/src/boot.ts:144`). A remote browser on plain HTTP is not a secure context, so it cannot
  call `getUserMedia` at all; B-04 SD15 left HTTPS to this item, to decide once for both.
- Every approved device is a controller (`docs/invariants.md:30`); there is no role that may only
  send media.
- ADR 0001 question 2 chose same-machine hosting so that "audio never crosses a network"
  (`docs/adr/0001-setup-decision-record.md:450`); the laptop path contradicts its reasoning.

Cost today: the set's audio is a room microphone or a second cable run from the mixer, and the
only shots are where a USB cable reaches.

## Decisions

The owner's answers from the interview (2026-11-16), then defaults marked as such.

- **SD1 — The laptop page offers an input-device picker and "System audio".** The same two kinds
  as the screen machine's picker: an input (a controller's or interface's record/booth out, or a
  loopback driver the owner installs) through `getUserMedia`, or "System audio" through
  `getDisplayMedia`, which needs a click on the laptop each time it starts. Which of the two is
  the proven path on the owner's laptop is a human check (H2), not a decision of this spec.
  *(The proven-path part is a default, not asked — object at review.)*
- **SD2 — The spec carries ADR 0002, and approving this spec approves it.**
  `docs/adr/0002-remote-input-over-the-lan.md`: the screen machine's own input stays the default
  and the zero-network path; a network source is opt-in, peer to peer on the LAN, and has its own
  latency budget (SD3, SD11), measured apart from B-01's. ADR 0001 is not rewritten; it gains a
  one-line "partly superseded by 0002 (question 2: audio may cross the LAN, opt-in)" note.
- **SD3 — Audio latency: the same total, the network leg fits inside it.** In-app (B-01 SD2,
  SD15) stays p95 ≤ 50 ms and still starts where audio enters the screen machine's
  `AudioContext`. A new **network leg** — round trip / 2 plus the receiver's jitter-buffer delay
  per emitted sample, from `RTCPeerConnection.getStats()` — has a bound of p95 ≤ 30 ms over 10 s
  and is shown as its own overlay line (`network ms last / p95 / worst`) while the remote audio
  is the one analysed. End to end, speaker to lit pixel, stays ≤ 100 ms on film. The receiver
  asks for the smallest jitter buffer (`jitterBufferTarget = 0`). The bounds are held with the
  laptop **wired** (Ethernet to the same router or switch as the screen machine); Wi-Fi is
  supported and the overlay shows its number, but it is not held to the bound (D-04 shows the
  owner's Wi-Fi round trips spiking past 100 ms).
- **SD4 — HTTPS through a local certificate authority.** The server creates a root once and keeps
  it in `DATA_DIR`; it issues a server certificate for the bound private addresses and issues it
  again when they change. Each LAN device trusts the root once (SD24). No warnings and working
  `wss:` on every device after that, iOS Safari included.
- **SD5 — Certificates are hand-written DER on `node:crypto`; no new dependency.** Keys from
  `generateKeyPairSync("ec", { namedCurve: "P-256" })`, signatures from `crypto.sign`, and a small
  DER encoder for exactly two certificate shapes (the root, the server certificate). The gate
  checks the output against Node's own parser, `X509Certificate` (`verify`, `checkIP`, validity,
  `ca`), and a real TLS handshake with the root as the only trusted CA.
- **SD6 — Two roles, chosen when pairing.** A new page, `/send`, has its own QR code in the panel
  and uses the same code and approval as B-04 (SD3, SD4, SD18 there). The request names what the
  device wants to send, and the approval prompt shows it ("Safari on iPhone — Device 4 wants to
  send video"). A sender's key permits only sending: the server accepts from a sender's socket
  only `hello` and the WebRTC setup messages, and drops controls, `accept`, `reject` and anything
  else, with one `warn` naming the type. A sender receives no screen state. A laptop that also
  controls opens `/control` and pairs a second time.
- **SD7 — The remote audio falls back to the local input and returns on its own.** While the
  remote audio is the main audio, the screen machine keeps its local input open but does not
  analyse it. The remote audio is lost when its track ends, is muted for more than 1 s (the rule of
  `web/src/capture/session.ts:13`), or the peer connection's state becomes `disconnected` or
  `failed`; the screen then analyses the local input at once. When the remote audio is back and
  has stayed steady (not lost) for 3 s, the screen analyses it again. The local standby is always
  an input device: when the remembered local choice is "System audio", the standby is the default
  input, because a new share needs a click (`web/src/capture/session.ts:299-301`).
- **SD8 — Audio switches itself; video waits for an operator.** One audio sender at a time; a
  second device asking to send audio is refused with "Another device is sending audio" until the
  first disconnects. The approved audio sender becomes the main audio as soon as its stream
  arrives. Remote cameras appear in the camera picker of the panel and of every controller,
  marked remote, next to the local cameras; they never take the picture by themselves. Controllers
  gain one audio switch, "Main audio: laptop / screen machine" (no gesture is needed for either);
  "System audio" and the choice of local input stay in the panel only (B-04 SD8).
- **SD9 — A lost remote camera falls back to the local camera and returns on its own.** After 1 s
  lost (same rule as SD7), the picture switches to the local camera that was on screen before the
  remote one, else the remembered local camera, else the no-camera look (B-01 SD10). When the
  remote camera is back and steady for 3 s, the picture returns to it, unless someone picked
  another camera in between, in which case that pick stands. `/send` holds a screen wake lock
  while sending and says "Keep this page open"; iOS stops the camera when the page is hidden or
  the phone locks.
- **SD10 — LAN only: no STUN, no TURN.** The peer connections have no ICE servers, so only host
  candidates are exchanged, nothing needs internet, and no media passes the server. A connection
  not reached within 10 s shows "Could not reach the screen machine — the network may block
  devices from talking to each other" on `/send` and the sender's line in the panel; the runbook
  names the owner's own router or hotspot as the answer. The output never shows it (B-01 SD7).
- **SD11 — Remote cameras send 1280×720 at 30 fps, ≤ 100 ms behind a wired webcam.** The sender
  asks for 720p30 and sets `contentHint = "motion"`; the receiver asks for the smallest jitter
  buffer. The overlay gains `video ms last / p95 / worst` (round trip / 2 plus the video
  jitter-buffer delay) while a remote camera is on screen. On the owner's network, on Wi-Fi, the
  remote picture trails a wired webcam filming the same clock by ≤ 100 ms (H5).
- **SD12 — Up to 4 video senders; only the one on screen streams.** The others stay connected
  with their encoder paused (`encodings[0].active = false`, set by the sender on the screen's
  request), so they cost the screen machine no decode. Switching to one resumes it; the current
  picture stays until its first decoded frame, then swaps, with no black frame between. A fifth
  video sender is refused with "Too many devices". `/send` shows "On screen" or "Standing by".
- **SD13 — One HTTPS listener for `/control` and `/send`.** B-04's LAN listener on
  `CONTROL_PORT` serves HTTPS only; `/control`, `/send`, `/trust`, `/assets/*` and the device
  socket share one origin per address (`https://<address>:CONTROL_PORT`). No plain-HTTP listener
  remains on the LAN. Every LAN device, controllers included, trusts the root once. B-04 SD15's
  accepted risk (a sniffed session key) is closed; the key stays bound to the source IP.
- **SD14 — `/send` asks what to send before it requests.** Checkboxes "Camera" and "Audio" (at
  least one), a camera picker with front/back on phones, and for audio the picker of SD1. One
  device may send both (the laptop's webcam and its mix); it counts in both limits (SD8, SD12).
  The choice is part of the request and cannot change after approval: another choice is a new
  pairing. *(default, not asked — object at review)*
- **SD15 — Pairing rules are B-04's, with separate sender limits.** Same code, same approval
  surfaces (the panel and any approved controller, B-04 SD18), same 60 s expiry, wrong-code
  throttle and IP-bound session key. Limits: 8 controllers (unchanged), 4 video senders, 1 audio
  sender; the 4 pending requests are shared. Disconnect stays in the panel only, and the panel
  lists senders apart from controllers, each with role and connection state. A `/send` page
  keeps its key in `localStorage` on the LAN origin (`djv.sendKey`) and reconnects with it like a
  controller (B-04 SD12 timings). *(default, not asked — object at review)*
- **SD16 — The server relays WebRTC setup and nothing else.** Offer, answer and ICE candidates
  travel sender ↔ server ↔ target screen page over the existing sockets, each validated against
  `shared/src/control.ts` on receipt (B-04 SD20); a setup message may be up to 16 KB (an SDP does
  not fit B-04's 4 KB), the device rate limit stays 120 a second. The sender makes the offer
  (`sendonly`), after approval and whenever the target screen (re)connects; the screen page
  answers (`recvonly`). Only the target screen page holds peer connections; the builder never
  does. *(default, not asked — object at review)*
- **SD17 — Before Start, senders connect but stay paused.** A sender can pair and its peer
  connection can be set up before Start; the screen keeps every sender paused (SD12) until Start,
  because no `AudioContext` exists before it. At Start a connected audio sender becomes main
  (SD8). Before Start, remote camera tiles on controllers are disabled with "Start on the screen
  machine", as local ones are (B-04 SD23). *(default, not asked — object at review)*
- **SD18 — A screen reload or a takeover keeps the senders' capture.** When the target screen
  page goes (reload, close, superseded by another tab), its peer connections close, senders show
  "Screen reconnecting…" and keep their capture running (so "System audio" needs no new click),
  and offer again to the next target screen. After a reload the page needs Start again
  (B-01); the senders stay paused until then (SD17). Switching External control off, New code,
  Disconnect or a server restart end the pairing: the sender stops its capture and shows "Pairing
  ended — scan the code again". *(default, not asked — object at review)*
- **SD19 — The local camera stays open while a remote one is on screen.** So the fallback of SD9
  is instant, the previous local camera keeps running unrendered, as the local input does for
  audio (SD7). *(default, not asked — object at review)*
- **SD20 — Remote audio is captured raw and sent as stereo Opus.** On the sender, echo
  cancellation, noise suppression and auto gain control are off (B-01 SD9); Opus at 48 kHz,
  stereo, 128 kb/s, no DTX. The screen feeds the received track into the same analysis
  (`createFeatureSource`) as a local one. *(default, not asked — object at review)*
- **SD21 — Naming and identity of remote feeds.** A remote feed is shown as "<hint> — Device n"
  with a remote mark, the hint and sequence label from B-04 SD26. Its id in the screen state and
  the `camera` control is `remote:<deviceId>`, so it never collides with a local device id. A
  remote choice is never written to `djv.sources`: that key keeps local choices only, and after a
  reload or a restart the remembered local sources are what opens at Start. Naming feeds by role
  ("crowd") is B-07's. *(default, not asked — object at review)*
- **SD22 — Main audio is a choice and a playing source.** The choice is "remote" or "local".
  An arriving audio sender sets it to remote (SD8); the controllers' switch or the panel sets it
  either way; the local choice pins the local input until someone chooses remote again. While the
  choice is remote, SD7's fallback decides which source plays. The overlay, the panel and the
  controllers show both, e.g. `audio: remote (Device 2) ok` or `audio: local (fallback: remote
  lost)`. *(default, not asked — object at review)*
- **SD23 — Certificates in detail.** Files under `DATA_DIR/tls/`: the root (EC P-256, valid 10
  years, CA, key usage `keyCertSign` and `cRLSign`, subject "DJ Visuals System local root
  <creation date>") and the server certificate (EC P-256, valid 397 days, subject alternative
  names exactly the bound private addresses, extended key usage `serverAuth`, signed by the root).
  At each switch-on the server certificate is issued again when the bound addresses differ from
  its names or fewer than 30 days remain. The key files are written owner-only where the OS
  allows. A root that does not load or parse fails switching on with "Certificate store
  unreadable — see the runbook", never boot. Starting over is deleting `DATA_DIR/tls/` (the
  runbook); devices must then trust the new root. *(default, not asked — object at review)*
- **SD24 — The trust step.** The panel's External control section shows, first, a QR code and URL
  for `https://<address>:CONTROL_PORT/trust` with "Install once per device", and the root's
  SHA-256 fingerprint (first 16 hex characters). `/trust` is the one page a device opens before it
  trusts the root (it taps through the browser's warning once); it serves the root as
  `application/x-x509-ca-cert`, shows the same fingerprint to compare, and the per-OS steps (iOS:
  install the profile, then Settings → General → About → Certificate Trust Settings). The root's
  key never leaves `DATA_DIR`. *(default, not asked — object at review)*
- **SD25 — Logging.** The server logs at `info`: a sender requested, accepted, rejected, expired,
  connected, disconnected (sequence label and role only), a certificate issued (addresses and
  expiry date, never a key), the root created. The screen page logs `capture` state changes for
  remote sources (`remote audio lost`, `fallback local`, `restored remote`) with the sequence
  label, never a device label. Never an SDP, an ICE candidate, a key, a code or a User-Agent.
  Setup messages at `debug`, type only. *(default, not asked — object at review)*
- **SD26 — Invariants and design docs change; approving this spec approves the edits.** In
  `docs/invariants.md`: the `127.0.0.1` row (line 26) — the External control listener serves
  HTTPS only, and answers only `GET /control`, `GET /send`, `GET /trust`, `GET /assets/*` and the
  device socket; the B-01 media row (line 27) keeps "no media reaches the server" and adds "the
  server relays only WebRTC setup messages; media goes peer to peer on the LAN, with no ICE
  server"; the control row (line 30) — only an approved *controller's* socket may send a control,
  and a sender's socket only setup messages; a new row — "the local CA's private keys stay in
  `DATA_DIR/tls/`: never served, logged or committed". `docs/design/architecture.md` gains Remote
  input. ADR 0002 (SD2). B-04 spec SD15 gets a pointer to SD13. *(default, not asked — object at
  review)*
- **SD27 — The gate proves structure; milliseconds are human checks.** As B-08 SD1: in the gate,
  a sender and a screen page in two browser contexts on `127.0.0.1` with fake media connect, the
  remote picture and features reach the engine, fallback and return happen in the right order,
  and the `network ms` and `video ms` lines exist and read finite, non-negative values. SD3's
  30 ms and 100 ms and SD11's 100 ms are checked on the owner's network (Verification). The
  gate's browser contexts on the LAN side trust the test root (generated per run, never
  committed). *(default, not asked — object at review)*

## Users and permissions

| Role | Can | Cannot |
|---|---|---|
| Operator at the screen machine (panel) | Everything B-04 allows; see senders with role and state; accept, reject and disconnect senders; set main audio local/remote; choose the local input and System audio; pick remote cameras | — |
| Approved controller (`/control`) | Everything B-04 allows; accept or reject a waiting sender; pick a remote camera; switch main audio laptop / screen machine | Disconnect anyone; issue a new code; choose the local input or System audio |
| Approved sender (`/send`) | Send what it was approved for (camera, audio or both); see "On screen" / "Standing by" and its link state | Send any control; accept or reject; receive the screen state; change what it sends without pairing again |
| Waiting device | Wait | Anything else |

## In scope

- ADR 0002 and the ADR 0001 note (SD2).
- `server/src/control/`: the LAN listener on HTTPS (`lan.ts`), `/send` and `/trust` routes, the
  device socket's `https://` origin (`server/src/boot.ts:144`), sender roles and limits in
  `pairing.ts`, setup-message relay in `hub.ts`; a new certificate module (CA, issue, DER encode)
  under `server/src/control/` or `server/src/tls/`, with its tests.
- `shared/src/control.ts`: the role in `hello`, the setup messages both ways, the sender's
  pause/resume and status messages, the screen state's remote cameras and main-audio fields, the
  `mainAudio` control, the 16 KB setup-message limit.
- `web/`: the `/send` page (`web/src/main.tsx` gains the route), the screen page's remote sources
  (peer connections, pause/resume, fallback and return of SD7, SD9, SD22), the camera picker and
  overlay lines, the panel's sender list and trust QR, the controller's remote camera tiles and
  main-audio switch.
- The overlay's `network ms` and `video ms` lines (SD3, SD11).
- `docs/invariants.md`, `docs/design/architecture.md`, `docs/runbooks/README.md` (trust, client
  isolation, deleting `DATA_DIR/tls/`, the human checks), B-04 spec pointer (SD26).
- Browser tests with two contexts; integration tests for TLS, roles and relay; unit tests for the
  certificate encoder, pairing roles and the fallback state machine.

## Out of scope

- Rendering or analysis on a sending device; mixing audio feeds; more than one main audio.
- STUN, TURN, any ICE server, any relay of media through the server, internet at the venue.
- A certificate from a public CA, a domain name, mDNS names for the screen machine, IPv6.
- An app or extension on any device; installing a loopback driver for the owner (H2 documents
  which path works).
- Remote audio from Safari's or Firefox's system audio; the laptop page is supported on Chromium
  (Chrome, Edge) for System audio, any modern browser for an input or a camera.
- Remote feeds in the builder's preview.
- Remembering a remote choice across reloads or restarts; naming feeds by role; scenes (B-07).
- Transitions between feeds beyond "keep the picture until the first frame" (B-09).
- Recording, snapshots or any storage of remote media.
- Controlling sender settings remotely (resolution, torch, zoom, exposure) beyond pause/resume.
- Screen-machine-to-sender audio or video (talkback, preview on the phone of the output).
- Fixing D-04 (Wi-Fi control latency); SD3 only reports the Wi-Fi number.
- Rotating or revoking the root from the UI; a second root.
- A plain-HTTP fallback for `/control`.

## Acceptance criteria

Pairing, roles and HTTPS

- **AC1.** When External control is switched on for the first time with no `DATA_DIR/tls/`, the
  system shall create the root and a server certificate whose subject alternative names are
  exactly the bound addresses, and a TLS client trusting only that root shall complete a
  handshake with every bound address.
- **AC2.** When the certificate encoder issues a root and a server certificate, Node's
  `X509Certificate` shall parse both, the server certificate shall `verify` against the root's
  public key, `checkIP` shall match each bound address and no other, the root shall read
  `ca: true`, and the validity periods shall be 10 years and 397 days.
- **AC3.** When External control is switched on and the bound addresses differ from the server
  certificate's names, or fewer than 30 days remain, the system shall issue a new server
  certificate signed by the same root; otherwise it shall reuse the stored one.
- **AC4.** If `DATA_DIR/tls/` holds a root that cannot be read or parsed, then switching on shall
  fail with "Certificate store unreadable — see the runbook" in the panel, nothing shall listen
  on `CONTROL_PORT`, and the server shall keep running.
- **AC5.** While External control is on, the LAN listener shall answer only over TLS, and only
  `GET /control`, `GET /send`, `GET /trust`, `GET /assets/*` and the device socket; a plain-HTTP
  request to `CONTROL_PORT` shall not be answered with any page.
- **AC6.** When `/trust` is requested, the system shall send the root certificate (never a key)
  as `application/x-x509-ca-cert`, and the panel and `/trust` shall show the same fingerprint.
- **AC7.** If a device socket upgrade carries an `Origin` other than
  `https://<that address>:CONTROL_PORT`, then the system shall refuse it with 403 before the
  handshake.
- **AC8.** When a device requests to send with a valid code, the approval prompt in the panel and
  on approved controllers shall name its hint, sequence label and role ("wants to send video",
  "audio", "video and audio").
- **AC9.** If an approved sender's socket sends a control, `accept`, `reject` or any message
  that is not `hello` or a setup message, then the system shall drop it with one `warn` naming its
  type, and the screen page shall receive nothing from it.
- **AC10.** When a second device asks to send audio while one audio sender is approved, the system
  shall refuse it with "Another device is sending audio"; when a fifth video sender asks, the
  system shall refuse it with "Too many devices".
- **AC11.** When a setup message larger than 16 KB, or one failing the schema, arrives on any
  socket, the system shall drop it with one `warn` naming its type and keep the socket open.

Media path

- **AC12.** When an approved sender and the target screen page set up a connection, the peer
  connections shall have no ICE servers, and the server shall relay only offer, answer and
  candidate messages between them; no media endpoint exists on the server.
- **AC13.** If a sender's connection is not established within 10 s, then `/send` and the
  sender's line in the panel shall show "Could not reach the screen machine — the network may
  block devices from talking to each other", and the output shall show no text.
- **AC14.** When a video sender is approved and connected, its camera shall appear in the camera
  picker of the panel and of every controller as "<hint> — Device n" with a remote mark and the id
  `remote:<deviceId>`, and the picture shall not change.
- **AC15.** When a remote camera is picked, the engine shall draw that sender's frames, and every
  other video sender shall be paused (`/send` reads "Standing by"; the picked one "On screen").
- **AC16.** When the picture switches from one camera to another, the system shall keep drawing
  the previous camera until the new one's first decoded frame, with no frame of the no-camera
  look between.
- **AC17.** When an audio sender is approved and its track arrives after Start, the screen shall
  analyse that track, main audio shall read "remote", and the local input shall stay open but
  not analysed.
- **AC18.** When the remote audio is lost (track ended, muted over 1 s, or the peer connection
  `disconnected` or `failed`), the screen shall analyse the local standby input in the same frame
  the loss is detected, and show `audio: local (fallback: remote lost)`.
- **AC19.** While the main-audio choice is remote and the remote audio has been back and not lost
  for 3 s, the screen shall analyse it again; if it is lost again within those 3 s, the 3 s shall
  start over.
- **AC20.** When the main-audio choice is set to local, from the panel or a controller, the
  screen shall analyse the local input and shall not return to the remote audio until the choice
  is set to remote.
- **AC21.** While the remembered local choice is System audio and the remote audio is main, the
  standby shall be the default input device.
- **AC22.** When the remote camera on screen is lost for 1 s, the picture shall switch to the
  previous local camera, else the remembered local camera, else the no-camera look; when it has
  been back for 3 s and no camera was picked in between, the picture shall return to it.
- **AC23.** If a camera is picked while a lost remote camera is waiting to return, then the
  picture shall stay on the picked camera when the remote one comes back.
- **AC24.** Before Start, senders shall pair and connect but stay paused, and remote camera tiles
  on controllers shall be disabled with "Start on the screen machine"; at Start a connected
  audio sender shall become main.
- **AC25.** When the target screen page reloads, senders shall show "Screen reconnecting…",
  keep their capture running, and connect to the reloaded page without a new approval or a click
  on the sender.
- **AC26.** When External control is switched off, New code is pressed, the sender is
  disconnected, or the server restarts, the sender shall stop its capture and show "Pairing
  ended — scan the code again".
- **AC27.** A `remote:` camera id or a remote main-audio choice shall never be written to
  `djv.sources`.

Overlay and measures

- **AC28.** While the remote audio is the analysed source, the overlay shall show
  `network ms last / p95 / worst` from the receiver's statistics, with finite, non-negative
  values; while it is not, the line shall be absent.
- **AC29.** While a remote camera is on screen, the overlay shall show `video ms last / p95 /
  worst`, with finite, non-negative values; while it is not, the line shall be absent.
- **AC30.** While a remote source is analysed or drawn, B-01's in-app latency (`latency ms`)
  shall still be measured from the screen machine's `AudioContext` as before.

Sender page

- **AC31.** When `/send` is opened, it shall offer Camera and Audio (at least one required), a
  camera picker with front/back where the device has both, and for audio the input picker plus
  "System audio" where `getDisplayMedia` with audio exists.
- **AC32.** While sending, `/send` shall hold a screen wake lock, show "Keep this page open", and
  show its role and "On screen", "Standing by", "Waiting for approval", "Screen reconnecting…" or
  the AC13 / AC26 messages.
- **AC33.** A remote audio track shall be captured with echo cancellation, noise suppression and
  auto gain control off.

Logs and boundaries

- **AC34.** No log line on the server or in the browser shall contain an SDP, an ICE candidate, a
  private key, a session key, a code, a User-Agent or a device label.
- **AC35.** The CA's private keys shall exist only under `DATA_DIR/tls/`: no route serves them,
  and `git check-ignore` covers the folder's default location.

## Data

- No table and no migration: pairings and roles stay in memory (B-04).
- New files: `DATA_DIR/tls/root.key`, `root.crt`, `server.key`, `server.crt` (PEM). Created on the
  first switch-on, server certificate reissued per SD23. Restore plan: delete the folder.
- Browser storage on the LAN origin: `djv.sendKey` (a sender's session key), `djv.sendChoice`
  (what it sends and which camera, for the next pairing). `djv.sources` unchanged and local only.

## API contract

LAN listener, `https://<address>:CONTROL_PORT`, only while switched on:

| Method | Path | Request | Response | Errors |
|---|---|---|---|---|
| GET | `/control` | — | `index.html` (B-04) | — |
| GET | `/send` | — | `index.html` | — |
| GET | `/trust` | — | the root certificate, `application/x-x509-ca-cert` | — |
| GET | `/assets/*` | — | built assets (B-04) | 404 |
| WS | `/api/control/device` | `hello { code \| key, role? }` then messages by role | B-04's, plus setup relay | 403 foreign Origin, 404 path |

Messages (`shared/src/control.ts`; field names are the plan's):

- Sender → server: `hello` with `code` and `sends: ("video" | "audio")[]`, or `key`;
  `offer { sdp }`, `candidate { candidate }`.
- Server → sender: B-04's `waiting`, `approved`, `refused` (adds `audio_taken`), `ended`,
  `screen { connected }`; `answer { sdp }`, `candidate`; `stream { active: boolean }` (pause or
  resume).
- Screen ↔ server: `offer`, `answer`, `candidate` and `stream` each with the sender's `deviceId`;
  the status gains `senders` (hint, label, role, connection state) and `fingerprint`.
- Controls gain `mainAudio { seq, source: "remote" | "local" }`; `camera.deviceId` may be
  `remote:<deviceId>`.
- The screen state gains remote entries in `cameras` (with `remote: true`), `mainAudio` (choice,
  playing, sender label), unchanged otherwise.

## UI

- **Panel** (External control section, top to bottom): the trust QR, URL and fingerprint with
  "Install once per device"; the `/control` QR and code (B-04); the `/send` QR; controllers;
  senders, each "<hint> — Device n · video/audio · connecting / connected / on screen / lost /
  could not reach" with Disconnect; pending requests with role. Audio row gains "Main audio:
  remote / local" when an audio sender is approved. The camera picker lists remote cameras.
- **Controller** (`/control`): remote camera tiles with a remote mark; "Main audio: laptop /
  screen machine" in DJ and VJ mode when an audio sender is approved; the approval prompt names
  the role.
- **Sender** (`/send`): choose (Camera, Audio, pickers) → Send → "Waiting for approval" →
  "Standing by" / "On screen" with a small local preview of what it sends; error states of AC13,
  AC26, "Request expired — try again", "Another device is sending audio", "Too many devices",
  camera or microphone permission denied, System audio cancelled or without audio (B-01 reasons).
- **Trust page** (`/trust`): download button, fingerprint, per-OS steps (iOS, Android, Windows,
  macOS).
- **Overlay**: `network ms` and `video ms` lines (AC28, AC29); `audio:` shows remote/local and
  fallback; `camera:` shows the remote label.

## Non-functional

- **Latency** (SD3, SD11): in-app ≤ 50 ms p95 (unchanged); network leg ≤ 30 ms p95, wired; end
  to end ≤ 100 ms on film with the laptop as source; remote video ≤ 100 ms behind a wired webcam,
  on Wi-Fi. The gate checks structure only (SD27).
- **Load:** at most one remote video decoded at a time (SD12); the render scale (B-01 SD8) is
  unchanged and still the answer to a heavy frame.
- **Security:** TLS on every LAN request; root key never leaves `DATA_DIR/tls/`; senders cannot
  control; every message validated on receipt; Origin checked on upgrade; the session key bound to
  the IP (B-04 SD15).
- **Limits:** 8 controllers, 4 video senders, 1 audio sender, 4 pending; 16 KB per setup message;
  120 messages a second per device socket.

## Edge cases and failure modes

- **Laptop cable pulled mid-set:** AC18 falls back in the frame the loss is seen; the room never
  sees a dead look. Plugged back: 3 s steady, then remote (AC19).
- **Shaky Wi-Fi flapping the audio:** each loss restarts the 3 s (AC19), so at most one switch
  back per 3 s.
- **Crowd phone locks:** the camera falls back after 1 s, returns 3 s after the page is shown
  again (AC22); the VJ's own pick in between wins (AC23).
- **Screen page reload / second tab:** SD18, AC25; peers live only on the target.
- **Server restart:** pairings end (AC26); the root and server certificate persist, so devices
  keep trusting.
- **Screen machine's address changes (another router):** the server certificate is reissued at
  switch-on (AC3); devices keep trusting the same root; IP-bound keys end, so devices pair again
  (B-04).
- **Venue client isolation:** AC13; the runbook's own router.
- **Before Start:** AC24.
- **Laptop sends System audio, then the share is stopped from the browser bar:** the remote
  track ends → AC18; returning needs a click on the laptop (SD1).
- **Two audio senders:** AC10.
- **A sender that is also an old controller key holder:** different roles are different pairings
  (SD6); each key permits its own role.
- **Unknown or broken certificate store:** AC4, never a boot failure.

## Verification

In the gate (`bash scripts/check.sh`): AC1–AC35 as unit, integration and browser tests, the
browser ones with a sender context and a screen context on `127.0.0.1`, fake media, and the
per-run test root.

On the owner's network (human steps, the plan's `H` list, recorded in the plan):

1. **H1 — Trust.** On the iPhone, iPad and the laptop, scan the trust QR, install and trust the
   root; open `/control` and `/send` with no warning on each.
2. **H2 — The laptop's audio path.** On the DJ laptop with the DJ software playing, send audio
   once by an input and once by System audio; record which works and which is the proven path.
3. **H3 — Network leg.** Laptop wired; overlay `network ms` p95 ≤ 30 over 10 s of music, and
   `latency ms` p95 ≤ 50. Record the Wi-Fi number too, without a bound.
4. **H4 — End to end.** Slow-motion film of speaker and screen with the laptop as main audio:
   ≤ 100 ms.
5. **H5 — Remote video.** An iPhone and a wired webcam film the same running stopwatch on the
   screen machine; remote trails by ≤ 100 ms on Wi-Fi.
6. **H6 — Fallback.** Pull the laptop's cable mid-track: the look keeps reacting from the screen
   machine's input; plug it back: remote again after about 3 s. Lock the crowd phone: the local
   camera takes over; unlock: the phone returns.
7. **H7 — Four phones.** Four video senders connected, switch between them from a controller:
   no black frame, the render scale behaves as without them.
8. **H8 — Isolation.** On a guest network with client isolation, a sender shows the AC13
   message within 10 s.

## Exit condition

A DJ laptop sends the main audio and phones send camera shots over the owner's LAN over trusted
HTTPS, the screen machine falls back to its own input and camera when they drop, the gate is
green and H1–H8 have passed.

## Open questions

None from the interview. Defaults SD14–SD27 are for the owner to object to at review.
