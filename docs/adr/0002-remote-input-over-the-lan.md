# ADR 0002: Remote input may cross the LAN, opt-in and peer to peer

Date: 2026-11-16 · Status: Accepted (by the approval of the B-06 spec, 2026-11-16) ·
Rests on: [0001](0001-setup-decision-record.md)

## Context

ADR 0001 question 2 chose to host everything on the screen machine, partly so that "audio never
crosses a network". The set's reality has moved past that reason:

- The DJ mixes on a laptop that already carries heavy DJ software. The cleanest audio is the mix
  on that laptop, and its webcam is a useful shot; other shots come from phones in the crowd or a
  device next to another screen.
- Today the screen page reads only what is plugged into the screen machine: one local camera and
  one local audio source (an input or "System audio"), with no second source to fall back to.
- The LAN is reachable only through B-04's External control listener, on plain HTTP. A remote
  browser on plain HTTP is not a secure context, so it cannot capture a camera or an input at
  all; B-04 SD15 left HTTPS to B-06, to decide once for both.

Cost today: the set's audio is a room microphone or a second cable run from the mixer, and the
only shots are where a USB cable reaches.

## Decision

- **The screen machine's own input stays the default and the zero-network path.** Nothing about
  B-01's local capture changes; a set that pairs no device sends nothing over the network.
- **A network source is opt-in** (B-06 SD2); how a device opts in is B-06's pairing (SD6).
- **Media goes peer to peer on the LAN, with no ICE server.** The peer connections are made with
  no STUN and no TURN server, so only host candidates are exchanged, nothing needs internet, and
  no media passes the server (B-06 SD10).
- **A network source has its own latency budget, measured apart from B-01's.** B-01's in-app
  latency (p95 ≤ 50 ms) still starts where audio enters the screen machine's `AudioContext`. The
  network leg — round trip / 2 plus the receiver's jitter-buffer delay per emitted sample — is
  held to p95 ≤ 30 ms over 10 s with the laptop wired, and shown as its own overlay line; end to
  end, speaker to lit pixel, stays ≤ 100 ms (B-06 SD3). A remote camera sends 1280×720 at 30 fps
  and trails a wired webcam by ≤ 100 ms, shown as its own `video ms` line (B-06 SD11). Wi-Fi is
  supported and its number is shown, but not held to the bound.

## Alternatives

- **Do nothing.** Audio stays a room microphone or a second cable from the mixer, and cameras
  stay where a USB cable reaches. Lost on the problem above: the owner's own mix and shots are
  out of reach.
- **Media through the server** (the server receives and forwards audio and video). Adds a hop
  and a decode or a forwarding unit to the one Node process, puts media in `server/` against
  B-01's "no media reaches the server", and makes the server a component to load-test. Peer to
  peer on the LAN does the same job with no new component.
- **A certificate from a public CA** for the LAN's HTTPS. Needs a domain name, internet at the
  venue to renew or validate, and DNS pointing at a private address. A local root that each
  device trusts once needs none of it (B-06 SD4, SD24).

## Consequences

- **Easier:** the laptop's mix becomes the main audio and phones become cameras with no cable,
  and the screen machine falls back to its own input and camera when they drop (B-06 SD7, SD9).
- **Harder:** every LAN device trusts a local root once; the LAN listener moves to HTTPS only; a
  second latency number exists and is checked on the owner's network, not in the gate (B-06
  SD27).
- **To keep true, and what enforces it:**
  - No media reaches the server; the server relays only WebRTC setup messages —
    `docs/invariants.md` (the B-01 media row), the integration tests of the relay and the
    browser test that records every request on the LAN port.
  - No ICE server on any peer connection — the unit tests of the peer modules (the factory gets
    none) and the end-to-end browser test.
  - The local input stays the default: a remote choice is never written to the remembered local
    sources (B-06 AC27), unit- and browser-tested.
  - The local CA's private keys stay in `DATA_DIR/tls/` — `docs/invariants.md`,
    `tests/meta/tls-boundary.test.ts` and the TLS integration test.
