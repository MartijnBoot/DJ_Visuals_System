# Plan: b-06 — Remote input devices

Spec: [docs/specs/phase-b-06-remote-input-devices.md](../specs/phase-b-06-remote-input-devices.md) (`Status: Approved`) ·
Status: Audited

ADRs honoured: [0001 Setup Decision Record](../adr/0001-setup-decision-record.md) — rendering and
analysis stay in the screen machine's browser, no media reaches the server, one Node process, no
broker; its question 2 ("audio never crosses a network") is partly superseded by ADR 0002, which
the spec carries and approves (SD2) and T1 writes. New dependencies: none (SD5: certificates are
hand-written DER on `node:crypto`; TLS is Fastify's own `https` option on `node:https`; WebRTC is
the browser's). The spec's edits to `docs/invariants.md`, `docs/design/architecture.md` and the
B-04 spec (SD26) are approved by the spec; each invariant row is rewritten in the task that
changes the behaviour it describes (T5, T8), so no row is untrue on the branch.

Line references are to `main` at `7b948a7`. The spec is read from the uncommitted working copy on
`docs/phase-b-03-human-checks` of 2026-11-16.

## Approach

The order is: what both sides parse, then the server, then the screen page, then the sending
page, then the proofs. `shared/src/control.ts` gets every new message and field in one task (T4),
with trivial defaults where the server and the screen page build a status or a state, so nothing
is half-typed afterwards. The certificate work is three small steps that never touch a socket: a
DER encoder and the two certificate shapes checked against Node's own `X509Certificate` (T2), the
store under `DATA_DIR/tls/` (T3), and only then the LAN listener's switch to HTTPS together with
every existing External control test (T5), because that switch makes 26 test lines in 9 files
untrue at once and must land in one commit. Pairing gains roles and the sender limits in the
module that already owns the rules (T7), and the hub gains role enforcement and the relay of
setup messages (T8). On the screen page the two fallback rules are pure state machines with an
injected clock (T11 audio, T12 picture), the peer connections are one module behind an injected
factory (T10), and one composition module joins them to the capture session, which stays the
owner of the local camera and the local input (T13). The sending page reuses the controller's
pairing and reconnect logic, extracted first with the controller's own tests unchanged as the
proof (T9), and the capture constraints of `web/src/capture/devices.ts` (T17, T18). T19 is the
end-to-end browser proof with no source change, T20 the docs.

The capture session is not rewritten. It keeps exactly one local camera and one local input, as
today; a remote source never enters it. Above it, `web/src/remote/sources.ts` answers the two
questions the frame asks — which features, which video element — from the session, the peers and
the two state machines. That is what makes the fallback instant: the local input's feature
source and the local camera's video element are already running when a remote one drops (SD7,
SD19), and "the same frame" (AC18) is a read of a flag at the start of the frame, the mechanism
B-04's controls already use (`web/src/frame-feed.ts`, `web/src/control/apply.ts`).

Rejected:

- **Teaching the session about remote sources.** `web/src/capture/session.ts` is 400 lines of
  loss and retry rules for devices the browser owns; a peer connection has other failure modes
  and no retry of its own (the sender offers again). One module per kind of source.
- **A second link state machine for `/send`, copied from `device-link.ts`.** Hello, key storage,
  backoff, refusals and "Pairing ended" are the same rules (SD15); a copy is where they drift.
- **`@fastify/websocket`, `node-forge`, `selfsigned`, `mkcert`, `simple-peer`.** SD5 and B-04 PD1.
- **A media element per sender kept decoding.** SD12: only the sender on screen streams.
- **Serving `/trust` from the React app.** The one page a device opens under a certificate
  warning should depend on nothing but its own response (PD1).
- **Trusting the per-run root in the gate's Chromium through the OS or NSS store.** It differs
  per platform and leaves state on the machine (PD9).

## Decisions this plan makes

Readings of the spec the planner had to choose. **Confirm** rows are for the audit to confirm or
overrule; **Owner** rows are user-visible choices the spec left open, and each one is a stop
(CLAUDE.md hard stops).

| # | Question | Decision | Reason |
|---|---|---|---|
| PD1 · Owner | What `GET /trust` answers. The API contract and AC6 say "the root certificate, `application/x-x509-ca-cert`"; SD24 and the UI say `/trust` is a page with a download button, the fingerprint and per-OS steps; AC5 allows no further path. One response cannot be both. | **Owner, 2026-11-16: as recommended.** `GET /trust` answers a small HTML page written by the server (no script, no asset): the fingerprint, the per-OS steps, and a button linking to `GET /trust?download`, which answers the root as `application/x-x509-ca-cert`. Same path, so AC5's list holds; AC6 is read as "the certificate `/trust` hands out". *Alternative A:* `/trust` is the certificate itself and the steps and fingerprint live only in the panel and the runbook (no page; iOS shows the install sheet straight from the QR code). *Alternative B:* a second path `/trust/root.crt`, which changes AC5 and the invariant row. | The QR code is scanned by a phone whose owner has never seen the steps; the page is where they are. A `data:` or Blob download does not start iOS's profile install, so the bytes need a real response. |
| PD2 · Owner | SD7 and AC21: when the local choice is System audio and the remote audio becomes main, the standby "is the default input". What happens to the System audio share that is running? | **Owner, 2026-11-16: as recommended.** The share is stopped and the default input is opened in its place, without touching `djv.sources` (which keeps System audio for the next Start). "Main audio: local" then plays the default input; System audio is chosen again in the panel, with its click. *Alternative:* keep the share running beside the standby, and let "local" return to it while it lives — three open sources and a second rule for which local one plays. | The session keeps one local source, as today. An operator who shares System audio on the screen machine and also pairs a laptop for audio has picked the laptop. |
| PD3 · Owner | SD12 and AC32 give `/send` "On screen" and "Standing by". What does a device that sends only audio show after Start? Neither phrase fits. | **Owner, 2026-11-16: as recommended.** Per thing sent, one line each: video "On screen" or "Standing by"; audio "Sending audio" while its stream is active (from Start on, PD7), "Standing by" before. A device sending both shows both lines. | A DJ glancing at the laptop needs to see that the mix is going out. New text the spec does not list, hence the stop. |
| PD4 · Confirm | Message and field names (spec, API contract: "field names are the plan's"). | `hello` gains optional `sends: ("video" \| "audio")[]` (1 or 2, unique), allowed only with `code`; with `key` the role is the pairing's. `approved` gains `sends` so a page holding the other role's key ends instead of misbehaving. Device → server: `offer { sdp }`, `candidate { candidate, sdpMid, sdpMLineIndex }`. Server → sender: `answer { sdp }`, `candidate`, `stream { active }`. Screen ↔ server: the same four with `deviceId`. `mainAudio { seq, source }` joins the controls. `deviceEntrySchema` gains `sends` (empty for a controller). `statusSchema` gains `senders` (entry plus `online`), `fingerprint` (16 hex characters or null) and the error `cert_store`. `screenStateSchema`: each camera gains `remote: boolean`; `mainAudio: { choice, playing, label } \| null` (null while no audio sender is approved). `REFUSAL_REASONS` gains `audio_taken`. `MAX_SETUP_MESSAGE = 16384`; `PAIRING_LIMITS` gains `videoSenders: 4`, `audioSenders: 1`. An `sdp` is a string of at most 16 000 characters, a `candidate` at most 1 000. | One file both sides parse with (B-04 PD11). |
| PD5 · Confirm | "Connection state" of a sender in the panel (spec UI: connecting / connected / on screen / lost / could not reach). The server sees a socket; only the screen page sees the peer connection. | The server's `status.senders` carries `online` (the sender's socket is open). The panel, which runs in the screen page, joins it with its own peer state: no peer `connected` within 10 s of the first offer → "could not reach" (AC13); `connected` and picked → "on screen"; feed lost → "lost"; else "connecting" / "connected". Nothing about a peer is sent to the server. | The server relays setup and nothing else (SD16); the screen page is the authority, as in B-04 SD5. |
| PD6 · Confirm | SD7 "keeps its local input open but does not analyse it", against AC18 "in the same frame the loss is detected". A worklet created at the moment of loss is not ready in that frame. | Both feature sources run: the local one in the session as today, the remote one from `createFeatureSource(context, remoteStream)`. "Not analysed" means its features are not what the frame uses. `sources.read(now)` picks per frame. | The only way AC18 can hold; the cost is one more worklet node. |
| PD7 · Confirm | When an audio sender's stream is active. | Paused before Start (SD17); active from Start on, whatever the main-audio choice, so "back and steady for 3 s" (AC19) is observable and a switch to remote needs no resume. A video sender is active only while it is the picked camera or a lost picked camera waiting to return (SD12). | SD12's pause exists to save decode; one Opus stream costs none worth a second rule. |
| PD8 · Confirm | SD9 "after 1 s lost (same rule as SD7)" for the camera, against SD7's audio, which falls back at once on `ended` or `disconnected`. | Audio: lost at once on track `ended` or peer `disconnected` / `failed`, after 1 s on mute (`MUTE_LOSS_MS`, `web/src/capture/session.ts:13`). Camera: the same three conditions, but the picture falls back when one has held for 1 s. Both return after 3 s without any of them. | AC18 says "same frame" for audio and AC22 says "lost for 1 s" for the camera; a picture frozen for a second is better than a flicker on a short Wi-Fi stall. |
| PD9 · Confirm | SD27: "the gate's browser contexts on the LAN side trust the test root". Chromium under Playwright has no per-context trust store. | LAN-side contexts are created with `ignoreHTTPSErrors: true`. The chain itself is proven in the same gate by Node: `tls.connect` and `ws` with `ca` set to the root and nothing else (T5, AC1), and `X509Certificate` (T2, AC2). T5 proves first that a page and a `wss:` socket load in such a context; if not, stop. | A broken chain still fails the gate (in the integration step); only the browser step does not re-check it. Real trust on real devices is H1. |
| PD10 · Confirm | Two headless Chromium contexts on one machine must reach each other with host candidates only (SD10). Chromium leaves loopback out of its candidates, and hides addresses behind mDNS names without a capture permission. | `tests/browser/fixtures/launch.ts` adds `--allow-loopback-in-peer-connection` to the gate's Chromium (test only). The gate's fake-media flags already grant the capture permission. If the two contexts do not connect on the builder's machine and on CI, stop — do not add an ICE server to a test. | SD29 of B-04 keeps real LAN addresses out of the gate; loopback candidates keep that true for media. |
| PD11 · Confirm | SD20: stereo Opus at 128 kb/s, no DTX. Browsers negotiate mono unless the receiver's description says otherwise. | One pure function `opusMusic(sdp)` in `web/src/remote/sdp.ts` adds `stereo=1;sprop-stereo=1;maxaveragebitrate=128000;usedtx=0` to the Opus `fmtp` line; the sender applies it to its offer and the screen to its answer before `setLocalDescription`. Unit-tested on Chromium's, Safari's and Firefox's SDP shapes as fixtures. | The answer's `fmtp` is what tells the sender it may encode stereo. No SDP is parsed beyond that one line. |
| PD12 · Confirm | A remote audio track reaches Web Audio silent in Chromium unless the stream is also attached to a media element. | `sources.ts` attaches each remote audio stream to a muted `<audio>` element it keeps (never played to the speakers), then calls `createFeatureSource`. The browser test asserts the features move (AC17), which fails without it. | Known Chromium behaviour; `audio/` stays unchanged. |
| PD13 · Confirm | SD23's certificate shapes, the parts it leaves open. | Serial: 16 random bytes, top bit cleared. `notBefore` is one day before creation (a phone whose clock runs behind must not see "not yet valid"); `notAfter` is `notBefore` + 397 days, or + 10 years for the root, so AC2's periods are exact. Both certificates carry a subject key identifier and the server certificate an authority key identifier (SHA-256 of the public key, first 20 bytes). Keys are PKCS#8 PEM, mode `0o600`. An unreadable server certificate or key with a good root is issued again; only the root (certificate or key) failing is AC4. | Key identifiers are what stricter chain builders expect and cost ten lines; the rest is what SD23 says. |
| PD14 · Confirm | AC16 for a switch between two local cameras: the session stops the old stream when the new one opens (`web/src/capture/session.ts:161`), and the engine draws the no-camera look for a video without a frame (`engine/src/index.ts:365`). | The session's `openCamera` waits for the new element's first frame (an injected `videoReady`, at most 2 s) before it releases the old stream and publishes the new element. `web/src/remote/picture.ts` applies the same rule to every other switch: `engine.setSource` gets the new element only once it has a frame. | "From one camera to another" is not limited to remote ones. `engine/` is unchanged. |
| PD15 · Confirm | `network ms` and `video ms` sampling (SD3, SD11). | While the overlay is shown, the screen page reads `getStats()` every 250 ms: the selected candidate pair's `currentRoundTripTime` / 2 plus the change in `jitterBufferDelay` over the change in `jitterBufferEmittedCount` of the audio (or video) `inbound-rtp`, into `createLatencyWindow` (`engine/src/latency.ts`, as `web/src/control/round-trip.ts` does). A poll with no emitted sample adds nothing. | The overlay is mounted only while shown (`web/src/Overlay.tsx:3`); 40 samples in 10 s. |
| PD16 · Confirm | The `/send` URL and code. | The panel's `/send` QR code is `https://<address>:CONTROL_PORT/send#code=<code>`: the same code as `/control` (SD6), read and cleared from the fragment by the shared link (T9). | B-04 SD19's handling, once. |
| PD17 · Confirm | A picked remote camera whose pairing ends (Disconnect, New code). | It is lost like any other (PD8) and leaves the camera list; it cannot return, and the picture stays on the fallback. | SD9's rule with nothing to come back. |

**Audit, 2026-11-16:** PD1–PD3 answered by the owner as recommended. PD4–PD17 confirmed as
written, including the three that read the spec's text differently: PD9 (`ignoreHTTPSErrors` in
the browser step instead of trusting the test root, SD27), PD14 (AC16 extended to a switch
between two local cameras, with the session waiting up to 2 s for the new camera's first frame)
and H8's wording (Risks).

**PD8, amended by the owner, 2026-11-16 (during T13):** in headless Chromium a sender stopping its
track gives the receiver no `ended`, no `mute`, and the peer stays `connected` (probed for 8 s,
audio and video), so the three conditions never see a stopped share or a frozen sender. A fourth
condition is added: a feed whose inbound `packetsReceived` has not moved for 1 s (`MUTE_LOSS_MS`),
counted only while the screen has asked that sender to stream (`setActive(true)`), is lost; it is
back once the count moves. The screen reads the statistics every 250 ms. It lands in
`web/src/remote/peers.ts` (T10's file) as a commit on T13's branch.

## Files

| Path | Create/Modify | Purpose |
|---|---|---|
| `docs/adr/0002-remote-input-over-the-lan.md` | Create | ADR 0002 (T1) |
| `docs/adr/0001-setup-decision-record.md`, `docs/adr/README.md` | Modify | The "partly superseded" note; the index row (T1) |
| `docs/specs/phase-b-04-live-set-controls.md` | Modify | SD15's pointer to this spec's SD13 (T1) |
| `server/src/tls/der.ts` | Create | DER encoder: the primitives two certificates need (T2) |
| `server/src/tls/certificate.ts` | Create | `rootCertificate`, `serverCertificate`, `fingerprint` (T2) |
| `server/src/tls/store.ts` | Create | `DATA_DIR/tls/`: create, load, reissue (T3) |
| `tests/meta/tls-boundary.test.ts` | Create | Keys ignored by git; no key read outside the store (T3) |
| `shared/src/control.ts` | Modify | Every new message, field and limit (T4, PD4) |
| `server/src/control/hub.ts` | Modify | Status defaults (T4); fingerprint, `cert_store` (T5); roles (T7); enforcement and relay (T8) |
| `web/src/control/screen-link.ts` | Modify | State defaults (T4); setup messages and remote state (T13) |
| `server/src/control/lan.ts` | Modify | HTTPS (T5); `/trust` (T6); `/send` (T18) |
| `server/src/boot.ts` | Modify | The store, the `https://` origin (T5) |
| `server/src/control/upgrade.ts` | Modify | Accepts an HTTPS server (T5) |
| `web/src/control/ExternalControl.tsx` | Modify | `https://` URL, the `cert_store` text (T5); trust block (T6); `/send` QR, senders, roles (T15) |
| `docs/invariants.md` | Modify | The `127.0.0.1` row and the new CA row (T5); the media and control rows (T8); Enforced-by (T20) |
| `server/test/control-client.ts`, `tests/browser/control-server.ts` | Modify | TLS with the root as the only CA; `https:` / `wss:` origins (T5) |
| `server/src/control/trust.ts` | Create | The trust page and the certificate response (T6) |
| `server/src/control/pairing.ts` | Modify | Roles, sender limits, `audio_taken` (T7) |
| `server/src/control/device.ts` | Modify | `sends` in hello (T7); what each role may send (T8) |
| `server/src/control/channel.ts` | Modify | A size limit per message type (T8) |
| `web/src/control/pair-link.ts` | Create | Hello, key, backoff, refusals, "Pairing ended": out of `device-link.ts` (T9) |
| `web/src/control/device-link.ts` | Modify | Built on `pair-link.ts` (T9) |
| `web/src/remote/sdp.ts` | Create | `opusMusic` (T10, PD11) |
| `web/src/remote/peers.ts` | Create | The screen's peer connections, feeds, loss, `setActive` (T10) |
| `web/src/remote/stats.ts` | Create | `getStats()` → network and video ms (T10, PD15) |
| `web/src/remote/main-audio.ts` | Create | Choice, playing source, fallback and return (T11) |
| `web/src/capture/session.ts` | Modify | `context()`, an unremembered standby (T11); first-frame camera swap (T12) |
| `web/src/remote/picture.ts` | Create | Picked camera, fallback, return, first-frame swap (T12) |
| `web/src/capture/video.ts` | Modify | `videoReady` (T12) |
| `web/src/remote/sources.ts` | Create | Session + peers + the two machines: `read`, `video`, state (T13) |
| `web/src/Screen.tsx` | Modify | Wires `sources.ts` (T13); overlay props (T14); panel props (T15) |
| `web/src/control/apply.ts` | Modify | `mainAudio`; a `remote:` camera (T13) |
| `tests/browser/fixtures/launch.ts` | Modify | `--allow-loopback-in-peer-connection` (T13, PD10) |
| `tests/browser/sender-client.ts` | Create | A scripted sender on the LAN origin, as `deviceClient` is for controllers (T13) |
| `web/src/Overlay.tsx` | Modify | `network ms`, `video ms`, the `audio:` and `camera:` lines (T14) |
| `web/src/Panel.tsx`, `web/src/SourcePickers.tsx` | Modify | Remote cameras in the picker; "Main audio" row (T15) |
| `web/src/control/Controller.tsx`, `web/src/control/Approvals.tsx`, `web/src/control/VjPanel.tsx` | Modify | Remote mark, main-audio switch, the role in the prompt (T16) |
| `web/src/send/send-link.ts` | Create | The sender's link on `pair-link.ts` (T17) |
| `web/src/send/peer.ts` | Create | The sender's peer connection: offer, pause, 10 s (T17) |
| `web/src/control/remembered.ts` | Modify | `djv.sendKey`, `djv.sendChoice` (T17) |
| `web/src/send/capture.ts` | Create | What a sender opens, from `capture/devices.ts` (T18) |
| `web/src/send/Send.tsx` | Create | The `/send` page (T18) |
| `web/src/main.tsx` | Modify | The `/send` route (T18) |
| `docs/design/architecture.md`, `docs/runbooks/README.md`, `README.md`, `CLAUDE.md` | Modify | Remote input, trust, isolation, `DATA_DIR/tls/`, the fourth route (T20) |

New test files: `server/src/tls/{der,certificate,store}.test.ts`, `server/test/control-tls.int.test.ts`,
`server/test/control-sender.int.test.ts`, `web/src/control/pair-link.test.ts`,
`web/src/remote/{sdp,peers,stats,main-audio,picture,sources}.test.ts`,
`web/src/send/{send-link,peer,capture}.test.ts`, `tests/browser/remote-screen.spec.ts`,
`tests/browser/remote-panel.spec.ts`, `tests/browser/remote-control.spec.ts`,
`tests/browser/send.spec.ts`, `tests/browser/remote-e2e.spec.ts`.

Existing tests and texts this change makes untrue:

- `server/test/control-lan.int.test.ts:125-132`, `:199-206` (exact status objects) gain `senders`
  and `fingerprint`; `server/src/control/hub.test.ts`, `shared/src/control.test.ts` and
  `web/src/control/screen-link.test.ts` (exact state objects) gain `remote` and `mainAudio`.
  Changed in T4.
- `server/test/control-lan.int.test.ts:97` (`http://` fetch) and its route list at `:151-162`;
  `server/test/control-device.int.test.ts` (2 lines: `ws://`, `http://` origin);
  `server/test/boot.int.test.ts` (1 line); `tests/browser/control-server.ts:101,147`;
  `tests/browser/control-e2e.spec.ts` (6), `control-panel.spec.ts` (4), `control.spec.ts` (4),
  `control-modes.spec.ts` (1), `custom-guard.spec.ts` (1): every `http://` or `ws://` on
  `CONTROL_PORT` becomes `https://` or `wss://`, and every LAN-side context gains PD9's option.
  Changed in T5, all in one commit.
- `server/src/control/pairing.test.ts`: `request` takes what the device sends. Changed in T7.
- `docs/invariants.md:26` (T5), `:27` and `:30` (T8), rewritten per SD26 in the commit that
  changes the behaviour.
- `docs/design/architecture.md:3` ("as built at the end of B-04"), `:253-267` (plain-HTTP
  listener, `http://` origin); `CLAUDE.md` ("three routes in one page"); `web/src/main.tsx:7`
  (the comment). Changed in T20, the comment in T18.
- Not untrue, watch: `web/src/control/device-link.test.ts` (399 lines) must pass **unchanged**
  after T9 — it is the proof of the extraction; `web/src/capture/session.test.ts` (camera opening
  order: `videoReady` defaults to resolved, so no case changes in T12);
  `tests/browser/live.spec.ts:543-549` (the screen page's request allow-list: a peer connection
  is not an HTTP request and the screen page opens no new socket); `tests/browser/preview.spec.ts`
  and the builder (`SourcePickers` gains only optional props; no remote feed in the preview);
  `tests/workflow/test_gate_shape.py` (the gate's steps are unchanged).

## Tasks

Each task is one vertical slice that leaves the system working, reviewable in one sitting:
about ≤400 changed source lines (tests do not count) across ≤10 files.

### T1 — ADR 0002, the note in ADR 0001, the pointer in B-04's spec
- **Implements:** SD2, SD26
- **Expected output:** `docs/adr/0002-remote-input-over-the-lan.md` after `0000-template.md`,
  Status Accepted (by the spec's approval, 2026-11-16), Rests on 0001: context (the spec's
  Problem), decision (the screen machine's own input stays the default and the zero-network
  path; a network source is opt-in, peer to peer on the LAN, no ICE server, its own latency
  budget of SD3 and SD11 measured apart from B-01's), alternatives (do nothing; media through the
  server; a public CA), consequences with what enforces each. ADR 0001 gains one line under
  question 2: "partly superseded by 0002 (question 2: audio may cross the LAN, opt-in)".
  `docs/adr/README.md` lists 0002. B-04's spec SD15 gains "closed by B-06 SD13". No code.
- **Verification:** `python scripts/check_plans.py` (still clean); `bash scripts/check.sh`
  (format step covers the Markdown); the ADR's Decision section names nothing the spec's SD2,
  SD3, SD10, SD11 do not say — checked line by line at review.
- **Depends on:** —
- **Autonomy note:** wording is the builder's within the spec's decisions. Stop if writing the
  ADR needs a decision the spec does not contain.

### T2 — `server/src/tls/`: a DER encoder and the two certificate shapes
- **Implements:** AC2, SD5, SD23
- **Expected output:** `der.ts`: `sequence`, `set`, `integer`, `oid`, `utf8`, `bitString`,
  `octetString`, `boolean`, `time` (UTCTime before 2050, GeneralizedTime from it), `explicit`,
  `implicit`, with definite lengths of any size. `certificate.ts`:
  `rootCertificate({ key, createdAt, serial })` and `serverCertificate({ key, root, rootKey,
  addresses, createdAt, serial })` return DER; subject, validity, extensions and key identifiers
  per SD23 and PD13; signatures from `crypto.sign("sha256", tbs, key)`; `toPem`,
  `fingerprint(der)` (SHA-256, first 16 hex characters). Keys come in as `KeyObject`s; nothing
  here touches a file or a clock. About 260 source lines, 2 files.
- **Verification:** `pnpm run test --project unit server/src/tls/der.test.ts server/src/tls/certificate.test.ts`
  — lengths 127, 128, 255, 256 and 65 536 encode correctly; an integer with its top bit set gets
  a leading zero; `new X509Certificate(root)` reads `ca: true`, subject "DJ Visuals System local
  root <date>", `validTo` − `validFrom` exactly 10 years; the server certificate `verify`s with
  the root's public key and not with another key, `checkIP` matches each address given and not
  `10.9.9.9`, `validTo` − `validFrom` exactly 397 days, `keyUsage` holds `serverAuth`'s OID,
  `checkIssued(root)` is true; a date in 2050 parses.
- **Depends on:** —
- **Autonomy note:** the encoder's internals are the builder's. Stop if `X509Certificate` rejects
  a shape SD23 requires, or if a required field needs an ASN.1 type not listed here in a way
  that grows the encoder past two certificate shapes.

### T3 — `server/src/tls/store.ts`: the certificate store under `DATA_DIR/tls/`
- **Implements:** AC3, AC4, AC35, SD4, SD23
- **Expected output:** `createCertificateStore({ dir, now, random, log })` with
  `forAddresses(addresses)` → `{ key, cert, fingerprint }` or `{ error: "cert_store" }`. No
  folder: it creates `root.key`, `root.crt`, `server.key`, `server.crt` (PEM, keys `0o600`) and
  logs `root created` and `certificate issued` (addresses, expiry date). A stored server
  certificate is reused when its names are exactly the addresses and 30 days or more remain;
  otherwise issued again under the same root. A root certificate or key that is missing its
  pair, unreadable or unparseable gives the error and writes nothing. `fingerprint()` reads the
  root's. `tests/meta/tls-boundary.test.ts`: `git check-ignore data/tls/root.key` succeeds, and
  `server/src` reads a `.key` file only in `tls/store.ts`. About 130 source lines, 1 file.
- **Verification:** `pnpm run test --project unit server/src/tls/store.test.ts tests/meta/tls-boundary.test.ts`
  (a temporary folder, a fake clock: first call creates four files; a second call with the same
  addresses returns the same certificate bytes; another address, and the clock moved to 29 days
  before expiry, each give a new server certificate and the same root; a truncated `root.crt`,
  a missing `root.key` and a root key that does not match its certificate each give
  `cert_store` and leave the folder as it was; a truncated `server.crt` is issued again; no log
  line contains "PRIVATE KEY").
- **Depends on:** T2
- **Autonomy note:** file layout inside `tls/` is fixed by the spec's Data section; the rest is
  the builder's. Stop if owner-only file modes cannot be set on Windows in a way a test can
  observe — record it and ask (SD23 says "where the OS allows"). **Asked and answered,
  2026-11-16:** on Windows a `0o600` write reads back `0o666`. Owner accepted the
  recommendation: keys are written `0o600` everywhere and the mode is asserted on POSIX only
  (`it.skipIf(win32)`); on Windows the folder's own permissions protect them.

### T4 — `shared/src/control.ts`: roles, setup messages, remote state
- **Implements:** AC11, SD6, SD16, SD21, SD22
- **Expected output:** everything in PD4, as `strictObject`s in the existing unions; `typeOf`
  knows the new types. So that the tree still compiles and behaves as before:
  `hub.ts`'s `status()` adds `senders: []` and `fingerprint: null`, and `toScreenState` adds
  `remote: false` per camera and `mainAudio: null`. No behaviour changes. About 130 source
  lines, 3 files.
- **Verification:** `pnpm run test --project unit shared/src/control.test.ts server/src/control/hub.test.ts web/src/control/screen-link.test.ts`
  — each new message parses a valid example and rejects an extra key; `hello` with `key` and
  `sends` fails, with `code` and `sends: ["audio", "audio"]` fails, with `sends: []` fails; an
  `sdp` of 16 001 characters fails; `mainAudio` with `source: "laptop"` fails; a camera id
  `remote:d123` parses in `camera` and in the state; `pnpm typecheck`;
  `pnpm run test --project integration server/test/control-lan.int.test.ts server/test/control-device.int.test.ts`
  (amended status objects, otherwise unchanged).
- **Depends on:** —
- **Autonomy note:** names inside PD4 are fixed; schema helper structure is the builder's. Stop
  if a message the spec lists cannot be expressed without a field PD4 does not name.

### T5 — The LAN listener serves HTTPS only
- **Implements:** AC1, AC3, AC4, AC5, AC7, SD4, SD13
- **Expected output:** `createLan` takes `certificates(addresses)` (T3's store, made in `boot.ts`
  with `join(DATA_DIR, "tls")`) and creates each instance with Fastify's `https: { key, cert }`;
  a `cert_store` result binds nothing and `enable` answers `status { on: false, error:
  "cert_store" }`, shown in the panel as "Certificate store unreadable — see the runbook". The
  device socket's accepted origin is `https://<address>:CONTROL_PORT` (`server/src/boot.ts:144`);
  `routeUpgrades` accepts the HTTPS server. `status.fingerprint` is the root's while on. The
  panel's URL and QR code read `https://`. No plain-HTTP listener exists. `docs/invariants.md`:
  line 26 rewritten per SD26 (HTTPS only; `/send` and `/trust` named as T6 and T18 add them), and
  the new row "the local CA's private keys stay in `DATA_DIR/tls/`: never served, logged or
  committed", enforced by `tests/meta/tls-boundary.test.ts` and `control-tls.int.test.ts`. Every
  test in the "untrue" list for T5 is amended in this commit; `control-client.ts`'s `connect`
  and a new `lanGet` helper take the root as their only CA; `control-server.ts` exposes the
  root and `lanOrigin` as `https://`. Every test's root is created in that test's temporary
  `DATA_DIR`, never inside the repository. About 130 source lines, 6 source files and the
  harness.
- **Verification:** `pnpm run test --project integration server/test/control-tls.int.test.ts server/test/control-lan.int.test.ts server/test/control-device.int.test.ts server/test/boot.int.test.ts`
  — new: after the first `enable` with an empty `DATA_DIR`, `tls.connect` with `ca: [root]`
  completes a handshake on every bound address and fails with an unrelated CA; the peer
  certificate's names are exactly the bound addresses; `enable`, `disable`, `enable` with the
  same seam reuses the certificate, with another address issues a new one under the same root;
  a truncated `root.crt` → `error: "cert_store"`, `CONTROL_PORT` refused, `/api/health` still
  200; a raw TCP `GET /control HTTP/1.1` gets no HTTP response; an upgrade with `Origin:
  http://127.0.0.1:<CONTROL_PORT>` or a foreign one is 403. Then
  `pnpm test:browser tests/browser/control-e2e.spec.ts tests/browser/control.spec.ts tests/browser/control-panel.spec.ts tests/browser/control-modes.spec.ts tests/browser/custom-guard.spec.ts`
  green with PD9's contexts; `control-panel.spec.ts` (new, AC4): a truncated `root.crt` in the
  test's `DATA_DIR` → switching on shows "Certificate store unreadable — see the runbook" in the
  panel and the switch reads off.
- **Depends on:** T3, T4
- **Autonomy note:** helper names and how the harness passes the root are the builder's. **Do
  first:** prove PD9 — one page and one `wss:` socket in an `ignoreHTTPSErrors` context — before
  amending the nine files; if it does not hold, stop with the evidence. Stop also if Fastify's
  `https` option changes anything `lan.ts` promises today (all-or-nothing bind, `preClose`).

### T6 — The trust step: `/trust` and the panel's trust block
- **Implements:** AC5, AC6, AC35, SD24
- **Expected output:** per PD1's answer. As recommended: `server/src/control/trust.ts` renders
  the page (fingerprint, "Install once per device", steps for iOS, Android, Windows, macOS, a
  download button) and answers `GET /trust?download` with the root's DER as
  `application/x-x509-ca-cert`; it is handed the certificate, never the store or a key. The
  panel's External control section shows, first, the trust QR code, its URL
  (`https://<address>:CONTROL_PORT/trust`), "Install once per device" and the fingerprint from
  the status, reusing `qrPath` (`web/src/control/qr.ts`). Works under `--api-only`. About 150
  source lines, 3 files.
- **Verification:** `pnpm run test --project integration server/test/control-tls.int.test.ts`
  (new: `/trust?download` has the content type, parses as the root with `X509Certificate`,
  contains no "PRIVATE KEY"; the page contains the same 16 characters as `status.fingerprint`;
  no path under `/trust/` and no other path answers a file from `DATA_DIR/tls/`: `/tls/root.key`,
  `/assets/../tls/root.key`, `/trust/root.key` are 404);
  `pnpm test:browser tests/browser/control-panel.spec.ts` (new: the trust block is first in the
  section, its fingerprint equals the page's, the panel still never scrolls sideways).
- **Depends on:** T5
- **Autonomy note:** PD1 answered by the owner (2026-11-16, as recommended). The steps'
  wording per OS is the builder's draft, corrected by H1. Stop if the answer needs a path AC5
  does not list.

### T7 — Pairing: roles and the sender limits
- **Implements:** AC8, AC10, SD6, SD15
- **Expected output:** `pairing.request(ip, code, hint, sends)` stores the role on the entry
  (`sends`, empty for a controller). Limits by role at request and again at accept: 8
  controllers, 4 video senders, 1 audio sender (a device sending both counts in both), 4 pending
  shared; a second audio sender is `refused(audio_taken)`, a fifth video sender or ninth
  controller `refused(too_many)`. `devices()` lists controllers, `senders()` senders;
  `sendsOf(deviceId)`. `resume` returns the role. `device.ts` passes `hello.sends`; `hub.ts`
  puts senders (with `online`) in the status, sends `approved` with `sends`, and logs `sender
  requested / accepted / rejected / expired` with the sequence label and role only. Pending
  entries carry `sends`, so the prompt can name the role. About 110 source lines, 3 files.
- **Verification:** `pnpm run test --project unit server/src/control/pairing.test.ts server/src/control/hub.test.ts`
  (one audio sender approved → a second request and a second pending accept are `audio_taken`;
  four video senders → the fifth `too_many`; eight controllers and four video senders coexist;
  a video+audio device counts in both; a disconnected audio sender frees the place; `newCode`
  ends senders too); `pnpm run test --project integration server/test/control-sender.int.test.ts`
  (new: a `hello` with `sends` reaches the screen's status as pending with its role; accept →
  `approved` with `sends`; the key reconnects as a sender from the same IP only).
- **Depends on:** T5
- **Autonomy note:** internal structure is the builder's. Stop if the shared pending limit
  and the role limits give two possible refusal reasons for one request and the spec does not
  say which wins (use `audio_taken` before `too_many` and say so in the test name — if that
  reads wrong against AC10, ask).

### T8 — The hub: what a sender may send, and the relay of setup messages
- **Implements:** AC9, AC11, AC12, AC34, SD6, SD16, SD25
- **Expected output:** `channel.ts`'s `maxBytes` may depend on the message type: 16 KB for
  `offer`, `answer`, `candidate`, 4 KB for the rest on a device socket; over its limit or
  failing the schema → one `warn` naming the type, socket open. On the screen socket (AC11's "any
  socket") `answer`, `candidate` and `stream` are held to the same 16 KB, the rest keeps
  `MAX_SCREEN_MESSAGE`; over it → one `warn` naming the type, nothing relayed, socket open.
  `device.ts`: an approved sender's
  socket may send `hello`, `offer`, `candidate`; anything else valid is dropped with one `warn`
  naming its type; a controller's `offer` or `candidate` likewise. `hub.ts`: a sender's `offer`
  and `candidate` go to the target screen with its `deviceId`; the screen's `answer`,
  `candidate` and `stream` go to that approved sender only; a sender receives `screen {
  connected }` (true when a target attaches, false when it goes or is superseded) and never
  `state` or `pending`; `toApproved` for those two reaches controllers only. Setup messages are
  logged at `debug`, type only. `docs/invariants.md`: line 27 gains "the server relays only
  WebRTC setup messages; media goes peer to peer on the LAN, with no ICE server", line 30 becomes
  "only an approved controller's socket may send a control, and a sender's socket only setup
  messages". About 190 source lines, 3 files and `docs/invariants.md`.
- **Verification:** `pnpm run test --project unit server/src/control/channel.test.ts`;
  `pnpm run test --project integration server/test/control-sender.int.test.ts` — a sender's
  `dials`, `pick`, `camera`, `mainAudio`, `accept`, `reject` each give one `warn` with that type
  and nothing on the screen socket; a 10 KB `offer` is relayed with the sender's `deviceId`, a
  17 KB one dropped with one `warn` "offer" and the socket still open; a 17 KB `answer` from the
  screen dropped with one `warn` "answer", the screen socket still open and the sender receiving
  nothing; a 5 KB `dials` from a
  controller is dropped; the screen's `answer` reaches only the named sender, and one naming a
  controller or an unknown id reaches nobody; a sender gets `screen { connected: true }` after
  approval and after a second screen attaches (`false`, then `true`), and no `state`; with
  `LOG_LEVEL=debug` no line contains "v=0", "candidate:", the key, the code or the User-Agent.
  `server/test/control-device.int.test.ts` stays green.
- **Depends on:** T7
- **Autonomy note:** routing internals are the builder's. Stop if relaying needs the server to
  read inside an SDP or a candidate.

### T9 — `pair-link.ts`: the pairing link out of `device-link.ts`
- **Implements:** SD15
- **Expected output:** `web/src/control/pair-link.ts` holds what a controller and a sender share:
  the code from the fragment or the field, the stored key, `hello` (with optional `sends`), the
  backoff and the visible/online retry, refusals, "Pairing ended" clearing the key, `SocketLike`
  and `openSocket`. `device-link.ts` keeps the controller's part (state, lock, `seq`, round
  trip) on top of it with its exported API unchanged. No behaviour change. About 150 source
  lines moved, 60 new, 2 files.
- **Verification:** `pnpm run test --project unit web/src/control/device-link.test.ts` with the
  file **unchanged** (`git diff --stat` shows no line of it); `web/src/control/pair-link.test.ts`
  (new: a hello with `sends`; a refusal `audio_taken` halts like `too_many`; `ended` clears the
  key); `pnpm test:browser tests/browser/control.spec.ts`.
- **Depends on:** T4
- **Autonomy note:** the seam between the two files is the builder's. Stop if any case of
  `device-link.test.ts` has to change to stay green — that is a behaviour change, not an
  extraction.

### T10 — `web/src/remote/`: the screen's peer connections, the Opus line, the statistics
- **Implements:** AC12, AC28, AC29, SD3, SD10, SD11, SD12, SD20
- **Expected output:** `peers.ts`: `createPeers({ createPeer, send, now, log })` where
  `createPeer` defaults to `new RTCPeerConnection({ iceServers: [] })`. `offer(deviceId, sdp)`
  replaces any connection for that device, answers `recvonly` with `opusMusic` applied (PD11),
  sets `jitterBufferTarget = 0` on each receiver that has the property; `candidate`, `drop`,
  `setActive(deviceId, active)` (sends `stream`, once per change); `feeds()` → per device and
  kind `{ track, stream, lost }` with loss per PD8's three conditions (mute timed with
  `MUTE_LOSS_MS` from the session, imported not copied); `connection(deviceId)`;
  `stats(deviceId, kind)`. `stats.ts`: a pure `legMs(previous, report)` per PD15. `sdp.ts`:
  `opusMusic`. Logs carry the sequence label, never an SDP or a candidate. Not wired yet. About
  280 source lines, 3 files.
- **Verification:** `pnpm run test --project unit web/src/remote/peers.test.ts web/src/remote/sdp.test.ts web/src/remote/stats.test.ts`
  (a fake peer: the factory is called with no ICE server; a second offer closes the first
  connection; `ended`, `disconnected`, `failed` mark lost at once, a mute after 1 000 ms and not
  at 999; unmute clears it; `setActive` twice sends one message; `legMs` of a report with RTT
  0.02 s and 4.8 s of delay over 480 samples is 20; no emitted sample → null; `opusMusic` on
  three recorded SDP shapes adds the four parameters once and leaves every other line alone, and
  returns its input when there is no Opus line).
- **Depends on:** T4
- **Autonomy note:** the feed and event shapes are the builder's. Stop if the loss rule needs a
  fourth condition, or if Chromium's statistics lack a field PD15 names (say which, with a
  recorded report).

### T11 — Main audio: the choice, the playing source, fallback and return
- **Implements:** AC18, AC19, AC20, AC21, AC27, SD7, SD22
- **Expected output:** `web/src/remote/main-audio.ts`, pure, clock injected:
  `arrived(label)` sets the choice to remote; `lost()`, `back()`, `gone()`, `choose(source)`;
  `playing(now)` answers `remote` only while the choice is remote, the remote audio is not lost
  and it has been back for 3 000 ms (a loss inside them starts them over); `view(now)` →
  `{ choice, playing, label, line }` with the lines `audio: remote (Device 2) ok`, `audio: local
  (fallback: remote lost)`, `audio: local`. The session gains `context()` and
  `setAudio(choice, { remember: false })`, which opens without `saveRemembered`; per PD2's
  answer the composition (T13) uses it to make the standby the default input when the local
  choice is System audio. About 140 source lines, 2 files.
- **Verification:** `pnpm run test --project unit web/src/remote/main-audio.test.ts web/src/capture/session.test.ts`
  (fake clock: lost → `playing` is local in the same call; back at t, lost at t+2 900, back at
  t+3 000 → remote only at t+6 000; `choose("local")` holds through any number of `back()`;
  `choose("remote")` while lost plays local with the fallback line; `gone()` → view null;
  session: `setAudio` with `remember: false` leaves `djv.sources` byte for byte, and the default
  call still saves).
- **Depends on:** —
- **Autonomy note:** the machine's method names are the builder's; the three lines' wording is
  the spec's (SD22). PD2 answered by the owner (2026-11-16, as recommended): the share is
  stopped and the default input becomes the standby; T13 wires it.

### T12 — The picture: picked camera, fallback, return, first-frame swap
- **Implements:** AC16, AC22, AC23, AC27, SD9, SD19
- **Expected output:** `web/src/remote/picture.ts`, pure, clock injected: `pick(id)` (local or
  `remote:<deviceId>`), `lost(id)`, `back(id)`, `gone(id)`, `tick(now)`; `wanted(now)` is the
  picked remote camera, or the local one once the remote has been lost for 1 000 ms (PD8), and
  the remote again after 3 000 ms back unless `pick` was called in between; `shown(now, ready)`
  moves to `wanted` only when `ready(wanted)` is true, so the previous element stays until the
  new one has a frame; `active()` lists the senders that must stream (PD7). A `remote:` id is
  never handed to the session. Session: `openCamera` awaits `deps.videoReady(video)` (default:
  resolved) before releasing the old stream (PD14); `video.ts` exports `videoReady` (first of
  `loadeddata` with a width, or 2 s). About 170 source lines, 3 files.
- **Verification:** `pnpm run test --project unit web/src/remote/picture.test.ts web/src/capture/session.test.ts`
  (lost for 999 ms → still remote, 1 000 → local; back for 3 000 → remote; a pick during the
  wait → stays on the pick when the remote returns; local absent → `wanted` is null, the
  no-camera look; `shown` never returns an element `ready` calls false while another is shown;
  remote A → remote B: `active()` holds both until B is shown, then B alone; session: with a
  `videoReady` that resolves later, the old track is not stopped and `state().video` is the old
  element until it resolves; every existing case passes unchanged).
- **Depends on:** T11
- **Autonomy note:** internals are the builder's. Stop if AC16 for two local cameras cannot hold
  without changing `engine/` — the spec keeps it unchanged.

### T13 — The screen page draws and analyses remote sources
- **Implements:** AC12, AC14, AC15, AC16, AC17, AC18, AC20, AC21, AC22, AC24, AC27, SD7, SD8,
  SD17, SD21
- **Expected output:** `web/src/remote/sources.ts` composes the session, `peers`, `main-audio`
  and `picture`: `read(now)` (the playing source's features; the remote feature source is made
  with the session's context once Start has happened and the track is there, PD6, PD12),
  `video()` (what `engine.setSource` gets, by `shown`), `setCamera(id)`, `setMainAudio(source)`,
  `state()` (cameras with remote entries "<hint> — Device n" for approved, connected video
  senders; `cameraId`; `mainAudio`), and per-frame `setActive` per PD7. `screen-link.ts` hands
  `offer` and `candidate` to it, carries `answer`, `candidate` and `stream` out, closes a peer
  whose sender left the status, and `toScreenState` takes the remote facts. `apply.ts`: `camera`
  goes to `sources.setCamera`, `mainAudio` to `setMainAudio`, both acknowledged. `Screen.tsx`
  reads features and video from `sources`. Before Start every sender is paused and no remote
  feature source exists; at Start a connected audio sender becomes main. When the remembered
  local choice is System audio and an audio sender becomes main, the share is stopped and the
  default input opened as the standby with `setAudio(default, { remember: false })` (PD2, AC21).
  Capture logs `remote audio lost`, `fallback local`, `restored remote` with the sequence label.
  `tests/browser/sender-client.ts`: a page on the LAN origin that pairs and sends media it makes
  itself — a canvas `captureStream` of a solid colour absent from the y4m fixture and an
  oscillator tone unlike the wav fixture — with the browser's own `RTCPeerConnection`. Every
  context of the gate's browser shares the launch fixtures (`tests/browser/fixtures/launch.ts`),
  so a sender using `getUserMedia` would be indistinguishable from the screen's local source. About 330 source lines, 4 source files, 2 harness
  files.
- **Verification:** `pnpm run test --project unit web/src/remote/sources.test.ts web/src/control/apply.test.ts web/src/control/screen-link.test.ts`
  (including AC21: a fake session whose remembered audio is System audio, an audio sender
  becomes main → the share is stopped, `setAudio` is called with the default input and
  `remember: false`, `djv.sources` byte for byte unchanged; with a remembered input instead, the
  session is not touched);
  `pnpm test:browser tests/browser/remote-screen.spec.ts` (new, with `sender-client.ts`): a
  video sender approved → the screen's state lists `remote:<id>` with `remote: true` and the
  picture's pixels do not change; a `camera` control for it → the canvas shows the sender's
  fixture colours, with no sampled frame of the no-camera look across the switch, and a second
  video sender has received `stream { active: false }` only; an audio sender after Start → the
  panel's meters follow the sender's fixture, state `mainAudio` is `{ choice: "remote",
  playing: "remote" }`, the local track is live; the sender's track stopped → `playing: "local"`
  and the meters follow the local fixture; before Start both senders are connected and paused,
  and Start makes the audio sender main; `localStorage["djv.sources"]` never contains "remote";
  both peer connections report no ICE server. `pnpm test:browser tests/browser/live.spec.ts`
  unchanged green.
- **Depends on:** T8, T10, T12
- **Autonomy note:** the composition's internals are the builder's; if it passes 400 source
  lines, split the audio and the picture halves into two commits of this task and say so. **Do
  first:** two contexts connecting with host candidates only (PD10) — if they do not, on this
  machine or in CI, stop with the evidence. Stop also if PD12's muted element is not enough for
  the features to move.

### T14 — Overlay: `network ms`, `video ms`, and the source lines
- **Implements:** AC28, AC29, AC30, SD3, SD11, SD22
- **Expected output:** `Overlay.tsx` takes `network` and `video` readers (PD15) and shows
  `network ms <last> / p95 <p95> / worst <worst>` only while the remote audio is the analysed
  source, `video ms …` only while a remote camera is on screen; `audio:` shows T11's line and
  `camera:` the remote label or the local state. `latency ms` is untouched: still from the
  features' `capturedAt` on the screen machine's `AudioContext`. About 90 source lines, 2 files.
- **Verification:** `pnpm test:browser tests/browser/overlay.spec.ts tests/browser/remote-screen.spec.ts`
  (new cases: with a remote audio sender analysed the network line appears and its three numbers
  are finite and ≥ 0; with main audio local it is absent; the same for `video ms` with a remote
  camera picked and unpicked; `latency ms` reads finite, ≥ 0 values with a remote source, by the
  same assertion as B-08's; `audio:` reads `audio: remote (Device 1) ok`, then `audio: local
  (fallback: remote lost)` after the sender's track stops).
- **Depends on:** T13
- **Autonomy note:** test ids are the builder's (`overlay-network`, `overlay-video` suggested).
  No bound on a millisecond value may enter a gate test (SD27). Stop if a statistic stays absent
  in headless Chromium for more than a few seconds — that decides whether the line can be
  asserted at all.

### T15 — Panel: the `/send` code, senders, pending roles, main audio, remote cameras
- **Implements:** AC8, AC13, AC14, AC20, SD8, SD15
- **Expected output:** `ExternalControl.tsx`, in the spec's order: trust block (T6), `/control`
  QR and code, the `/send` QR (PD16), controllers, senders — "<hint> — Device n · video / audio /
  video and audio · <state>" with Disconnect, the state per PD5 including "Could not reach the
  screen machine — the network may block devices from talking to each other" — and pending
  requests reading "<hint> — Device n wants to send video" (or "audio", "video and audio").
  `SourcePickers` lists remote cameras after the local ones with a remote mark; `Panel` shows
  "Main audio: remote / local" while an audio sender is approved. The local input and System
  audio pickers are unchanged. About 200 source lines, 4 files.
- **Verification:** `pnpm test:browser tests/browser/remote-panel.spec.ts tests/browser/control-panel.spec.ts`
  (new: the prompt names each of the three roles; an approved video sender appears in the
  picker with its mark and picking it there draws it; the main-audio row appears with an audio
  sender, and "local" pins the local input through a remote loss and return; a sender whose
  offers are never answered by a reachable peer — its candidates filtered out by the test —
  shows the "Could not reach" line within 10 s on its panel row and the canvas shows no text;
  the panel never scrolls sideways).
- **Depends on:** T6, T14
- **Autonomy note:** layout and test ids are the builder's within the spec's order. Stop if the
  section no longer fits the 400 px panel without sideways scroll (D-05).

### T16 — Controller: remote camera tiles, the main-audio switch, the role in the prompt
- **Implements:** AC8, AC14, AC20, AC24, SD8
- **Expected output:** `/control` marks a camera tile whose entry has `remote: true`; shows
  "Main audio: laptop / screen machine" in DJ and VJ mode while `state.mainAudio` is not null,
  sending `mainAudio`; `ApprovalList` (and the VJ panel's inline list) names the role as the
  panel does. Before Start, remote tiles are disabled with "Start on the screen machine" (the
  existing note). No input or System audio control. About 90 source lines, 3 files.
- **Verification:** `pnpm test:browser tests/browser/remote-control.spec.ts tests/browser/control.spec.ts tests/browser/control-modes.spec.ts`
  (new: a remote tile with its mark; tapping it draws the sender on the screen and is
  acknowledged; the switch to "screen machine" sets `mainAudio.choice` to local on the screen
  and shows it on a second controller; the prompt text for a video sender; before Start the
  remote tile is disabled with the note; the switch is absent with no audio sender).
- **Depends on:** T13
- **Autonomy note:** the mark's look and test ids are the builder's. Stop if the switch needs a
  gesture on the screen machine after all (SD8 says none).

### T17 — The sender's link and its peer connection
- **Implements:** AC13, AC25, AC26, SD10, SD12, SD15, SD18, SD20
- **Expected output:** `web/src/send/send-link.ts` on `pair-link.ts`: statuses and texts
  "Waiting for approval", "Screen reconnecting…", "Pairing ended — scan the code again",
  "Request expired — try again", "Another device is sending audio", "Too many devices",
  "Reconnecting…"; the key in `djv.sendKey`; an `approved` whose `sends` is not what was asked
  ends the pairing locally. `web/src/send/peer.ts`: on `screen { connected: true }` after
  approval a new `RTCPeerConnection({ iceServers: [] })`, `sendonly` transceivers for the given
  tracks, `contentHint = "motion"` on video, `opusMusic` on the offer, 128 kb/s on the audio
  encoding; `stream { active }` sets every encoding's `active`; 10 s without `connected` → the
  AC13 state; `screen { connected: false }` closes the connection and keeps the tracks; `ended`
  or a refused key stops the tracks. `remembered.ts`: `sendKeyStore`, `sendChoiceStore`. About
  260 source lines, 3 files.
- **Verification:** `pnpm run test --project unit web/src/send/send-link.test.ts web/src/send/peer.test.ts web/src/control/remembered.test.ts`
  (fake socket and peer: approval then `screen true` → one offer; `screen false` then `true` →
  the first connection closed, a second offer, the tracks never stopped; 10 000 ms without
  `connected` → the message, 9 999 not; `stream false` → `active: false` on every encoding;
  `ended` → tracks stopped, key cleared, the "Pairing ended" text; a socket drop → reconnect
  with the key and a new offer; the peer factory gets no ICE server).
- **Depends on:** T9, T10
- **Autonomy note:** internals are the builder's. Stop if a status the page must show has no
  text in the spec's UI section or PD3.

### T18 — The `/send` page
- **Implements:** AC5, AC13, AC15, AC25, AC26, AC31, AC32, AC33, SD1, SD14
- **Expected output:** `Send.tsx` at `/send` (`main.tsx`'s fourth branch; `lan.ts` answers `GET
  /send` with `index.html`): Camera and Audio checkboxes (Send disabled with neither), a camera
  picker with Front / Back where both exist, the audio picker with "System audio" where
  `supportsSystemAudio` says so, remembered in `djv.sendChoice`; Send opens the capture inside
  the click, then requests. `capture.ts` builds the constraints from `capture/devices.ts`
  (`audioConstraints`, `systemAudioConstraints`: processing off) and asks 1280×720 at 30 fps.
  After that: the link line, the role, PD3's status lines, "Keep this page open", a small muted
  preview, a wake lock from `createWakeLock` while sending, and the B-01 reasons for a denied
  permission or a share cancelled or without audio. Styles from `control/styles.ts`. About 280
  source lines, 4 files.
- **Verification:** `pnpm run test --project unit web/src/send/capture.test.ts` (the audio
  constraints carry the three `false`s for an input and for System audio; video asks 1280, 720,
  30 and the facing mode chosen); `pnpm test:browser tests/browser/send.spec.ts` (new: Send is
  disabled until one box is ticked; the request reaches the panel with its role; after Accept
  the page reads "Standing by", then "On screen" once picked, and another sender "Standing by";
  the sent audio track's `getSettings()` reads the three `false`s; the wake lock is held; a
  screen reload → "Screen reconnecting…", then connected again with no click and the same
  track object; External control off → "Pairing ended — scan the code again" and the track is
  `ended`; `GET /send` is 200 on the LAN listener and `/send` is not served on the main one;
  error states, with `getUserMedia` / `getDisplayMedia` mocked in the page: camera or microphone
  permission denied, a System audio share cancelled, and a share without audio each show B-01's
  reason and send no request).
- **Depends on:** T6, T13, T17
- **Autonomy note:** layout and test ids are the builder's. PD3 answered by the owner
  (2026-11-16, as recommended): one status line per thing sent. Stop if Chromium's fake devices cannot stand in
  for front/back — assert the picker's presence by a mocked device list instead and say so.

### T19 — End to end in the browser, and the privacy checks
- **Implements:** AC12, AC19, AC23, AC25, AC26, AC34, SD18, SD25, SD27
- **Expected output:** `tests/browser/remote-e2e.spec.ts`, no source change: the screen, one
  controller, one `/send` page sending video and audio, one sending video, in the spec's order —
  trust page reachable, pair, approve from the controller, Start, audio main, pick the remote
  camera from the controller, stop the sender's audio (fallback), restore it (remote again after
  the 3 s, and not before), lose the camera, pick another in between and see it stay, reload the
  screen, New code, restart the server. Throughout: every server log line (debug) and every
  console line of every page is collected and none contains "v=0", "candidate:", "PRIVATE KEY",
  a session key, the code, the User-Agent string or a device label; no request on
  `CONTROL_PORT` other than AC5's routes; no ICE server on any peer connection.
- **Verification:** `pnpm test:browser tests/browser/remote-e2e.spec.ts`, then
  `bash scripts/check.sh` whole, and `pnpm check:load` once (the fallback and return waits are
  state changes recorded in the page, as `watchLink` does for D-10, not polled timings).
- **Depends on:** T15, T16, T18
- **Autonomy note:** the scenario's helper structure is the builder's. A failure here is fixed
  in a task of its own against the criterion it breaks, test first — never by loosening this
  spec's assertions. Stop if a check passes only with a fixed sleep.

### T20 — Docs: architecture, runbook, invariants' enforcing tests
- **Implements:** SD26
- **Expected output:** `docs/design/architecture.md` gains "Remote input" (the roles, the relay,
  the peer connections, `web/src/remote/`, `/send`, the certificate store, the test seam) and
  its External control section says HTTPS; `docs/runbooks/README.md` gains trust per OS (as H1
  found it), client isolation and the "Could not reach" message, the Windows firewall and UDP,
  deleting `DATA_DIR/tls/` to start over, "Certificate store unreadable", and the human checks;
  `docs/invariants.md`'s Enforced-by column names the tests T5 to T19 added; `README.md` and
  `CLAUDE.md` name the fourth route, `server/src/tls/` and `web/src/remote/`.
- **Verification:** `bash scripts/check.sh`; every file and test path the four documents name
  exists (`git ls-files` for each); `python scripts/check_plans.py`.
- **Depends on:** T19
- **Autonomy note:** wording is the builder's. Stop if a document would have to describe
  behaviour the code does not have.

## Task graph

| Group | Tasks | Files they touch |
|---|---|---|
| 1 | T1, T2, T4, T11 | T1: `docs/adr/*`, B-04's spec · T2: `server/src/tls/der.ts`, `certificate.ts` · T4: `shared/src/control.ts`, `hub.ts`, `screen-link.ts` · T11: `web/src/remote/main-audio.ts`, `web/src/capture/session.ts` |
| 2 | T3, T9, T10, T12 | T3: `server/src/tls/store.ts`, `tests/meta/tls-boundary.test.ts` · T9: `pair-link.ts`, `device-link.ts` · T10: `web/src/remote/peers.ts`, `sdp.ts`, `stats.ts` · T12: `web/src/remote/picture.ts`, `session.ts`, `video.ts` |
| 3 | T5, T17 | T5: `lan.ts`, `boot.ts`, `upgrade.ts`, `hub.ts`, `ExternalControl.tsx`, `docs/invariants.md`, the test harness and the nine amended test files · T17: `web/src/send/send-link.ts`, `peer.ts`, `web/src/control/remembered.ts` |
| 4 | T6, T7 | T6: `server/src/control/trust.ts`, `lan.ts`, `ExternalControl.tsx` · T7: `pairing.ts`, `hub.ts`, `device.ts` |
| 5 | T8 | `hub.ts`, `device.ts`, `channel.ts`, `docs/invariants.md` |
| 6 | T13 | `web/src/remote/sources.ts`, `screen-link.ts`, `apply.ts`, `Screen.tsx`, `tests/browser/fixtures/launch.ts`, `tests/browser/sender-client.ts` |
| 7 | T14, T16, T18 | T14: `Overlay.tsx`, `Screen.tsx` · T16: `Controller.tsx`, `Approvals.tsx`, `VjPanel.tsx` · T18: `web/src/send/Send.tsx`, `capture.ts`, `main.tsx`, `lan.ts` |
| 8 | T15 | `ExternalControl.tsx`, `Panel.tsx`, `SourcePickers.tsx`, `Screen.tsx` |
| 9 | T19 | `tests/browser/remote-e2e.spec.ts` |
| 10 | T20 | the four documents, `docs/invariants.md` |

No two tasks in one group write the same file. `python scripts/check_plans.py --graph <this
file>` prints the groups the `Depends on` fields actually give. Test files new in one task and
extended in a later one (`control-tls.int.test.ts`: T5, T6; `control-sender.int.test.ts`: T7, T8;
`remote-screen.spec.ts`: T13, T14; `control-panel.spec.ts`: T6, T15) are never touched by two
tasks of the same group.

## Data changes

None in the database: no table, no migration (spec, Data). New files, created on the first
switch-on by T3 and wired in T5: `DATA_DIR/tls/root.key`, `root.crt`, `server.key`, `server.crt`
(PEM). Restore plan: delete the folder; every device then trusts the new root again (H1).
Browser storage on the LAN origin: `djv.sendKey`, `djv.sendChoice` (T17, T18). `djv.sources` is
unchanged and local only (AC27).

The LAN origin moves from `http://` to `https://` (T5), so a controller's `djv.controlKey`,
`djv.controlMode` and `djv.controlAddress` on the old origin are not carried over. Pairings live
in memory and end on a restart already; a device pairs again once, after the trust step. No
expand → migrate → contract is needed: nothing persistent changes shape.

## Risks and unknowns

| Risk | Mitigation |
|---|---|
| **A hand-written certificate that Node accepts and iOS, Android or Windows does not.** `X509Certificate` and a Node handshake are the gate's whole proof (SD5); Apple's rules for a user-installed root are stricter in ways no test here sees. | PD13 adds key identifiers and the backdated start. H1 runs as soon as T6 is merged, before the media tasks, so a refusal costs one task, not the phase. If a device refuses the chain, that is a defect against AC1 with the device's error text, not a workaround. |
| **PD9: `ignoreHTTPSErrors` may not cover `wss:` or may change what a context allows.** Not verified; exploration was read-only. | T5 proves it first and stops otherwise. |
| **PD10: two headless contexts may not connect with host candidates only**, on a machine with no network adapter or on CI. | T13 proves it first. The fallback is the owner's to choose (it would be a test-only flag or a reading of SD10 for tests), never an ICE server added quietly. |
| **mDNS candidates before Start.** A browser without a capture permission hides its addresses behind `.local` names. The screen page has none before Start, and a sender that shares only System audio never has one, so that pair connects only where mDNS resolves between the two machines; any sender with a camera or an input exposes its address and is fine. | H2 tries System audio with and without Start having happened and records it. If it fails, the runbook says "press Start first, or tick Camera too"; anything more is a spec change. |
| **H8 may not be reachable as written.** On a network with full client isolation the phone cannot load `/send` at all (the server is on the screen machine), so AC13's message never shows; it shows only where TCP to the server passes and UDP between the browsers does not. I disagree with H8's wording, not with AC13. | AC13 is proven in the gate by filtering candidates (T15, T17). H8 is recorded as what the owner actually sees on a guest network; "the page does not load" is the runbook's existing entry. |
| **The Windows firewall on the screen machine** may pass Node's TCP port and still drop inbound UDP to the browser. | ICE checks go out from both sides, which opens a stateful firewall; H1/H2 are the proof, the runbook gets the entry (T20). |
| **A remote audio track through Web Audio** (PD12) and **`jitterBufferTarget`** are Chromium behaviours. The screen page is Chromium (B-01); a sender may be any browser. | The gate asserts the features move. `jitterBufferTarget` is set only where the property exists. |
| **SDP larger than 16 KB** (a browser offering many codecs with audio and video) would be dropped, and the sender would see only the 10 s message. | T8 warns with the type; T19's run records the largest offer seen; H1 covers Safari. If Safari's offer is near the limit, that is the owner's (SD16 fixes 16 KB). |
| **Stereo, 128 kb/s, no DTX depend on one munged SDP line** (PD11). | Unit-tested on three browsers' shapes; H2 listens with the overlay's meters; `chrome://webrtc-internals` on the screen machine shows the channel count. |
| **The same root name on the same day.** Deleting `DATA_DIR/tls/` and switching on again the same day gives a second root with the same subject and another key; a device still holding the first one may refuse the new chain until the old profile is removed. | The runbook says to remove the old profile (T20). The authority key identifier (PD13) lets a verifier tell them apart. |
| **Flaky timing tests** (the D-02 habit): the 1 s, 3 s and 10 s rules. | Each rule is unit-tested with an injected clock (T10 to T12, T17); browser tests assert order recorded in the page, never a duration, and T19 runs `pnpm check:load`. |
| **T5 is wide**: one behaviour change, nine test files. | The source change is about 130 lines; the test edits are a scheme and one context option. It cannot be split without a commit where the gate is red. |
| **The spec's reference `docs/adr/0001-setup-decision-record.md:450`** does not exist (the file has 118 lines; the sentence is in the question 2 row, line 37). | T1 puts the note at the real place. No decision depends on it. |
| **SD27 says "trust the test root"; PD9 does not do that in the browser step.** | A Confirm row; the audit may overrule it, at the cost of a per-platform trust store set up in the gate. |

## Human steps

The spec's H1 to H8, on the owner's network, each recorded in this plan when done. No acceptance
criterion is verified only here; the millisecond bounds of SD3 and SD11 are.

- **H1 — Trust** (after T6; again after T18 for `/send`). iPhone, iPad and the laptop: scan the
  trust QR code, install and trust the root; `/control` and `/send` open with no warning.
- **H2 — The laptop's audio path** (after T18). With the DJ software playing, send audio once by
  an input and once by System audio; record which works, and for System audio whether it
  connects before Start (the mDNS risk above).
- **H3 — Network leg.** Laptop wired: `network ms` p95 ≤ 30 over 10 s of music and `latency ms`
  p95 ≤ 50. The Wi-Fi number, without a bound.
- **H4 — End to end.** Slow-motion film of speaker and screen with the laptop as main audio:
  ≤ 100 ms.
- **H5 — Remote video.** An iPhone and a wired webcam film one stopwatch: remote trails by
  ≤ 100 ms on Wi-Fi.
- **H6 — Fallback.** Pull the laptop's cable mid-track and plug it back; lock and unlock the
  crowd phone.
- **H7 — Four phones.** Four video senders, switched from a controller: no black frame, the
  render scale as without them.
- **H8 — Isolation.** On a guest network: record what a sender shows (see Risks).
- **Pushing, the PR and the merge** are the owner's (CLAUDE.md).

## Out of scope for this plan

- Everything under the spec's "Out of scope".
- Trusting the per-run root inside the gate's Chromium (PD9): the chain is proven by Node.
- Any change to `engine/` or `audio/`: the picture arrives through `setSource`, the features
  through `createFeatureSource`, both as they are.
- A fix for D-04 or D-09, both open and unrelated.
- A `/trust` path beyond PD1's answer.

## Audit (PASS required before implementation starts)

- [x] Every AC maps to at least one task (AC21 added to T13; AC11's screen socket added to T8)
- [x] Every task maps to at least one AC (no orphans) — T1, T9, T20 accepted without one: the
      ADR and docs SD2/SD26 require, and the extraction T17 builds on (SD15)
- [x] Each task's expected output is concrete enough to check, and is what we actually need
      (T13's sender makes its own media; T18's error states tested)
- [x] Existing patterns reused; nothing reinvented
- [x] No new dependency without an approval note
- [x] Data changes additive and reversible (the origin change stated under Data changes)
- [x] Errors, empty states and permissions are tasks, not afterthoughts (AC4's panel text in T5)
- [x] Each task reviewable in one sitting (T5 over 10 files counting tests: accepted, cannot be
      split without a red commit; T13 may split into two commits)
- [x] Verification named per task
- [x] Nothing touches prod, secrets or infra it should not (test roots in temporary `DATA_DIR`s)
- [x] Every task has a Depends on and an Autonomy note
- [x] No two tasks in one parallel group write the same file

Audited by: Martijn Boot  Date: 2026-11-16
