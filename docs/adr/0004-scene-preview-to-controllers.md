# ADR 0004: A staged look's preview may flow from the screen machine to one controller

Date: 2026-11-26 · Status: Accepted (by the approval of the B-07 spec, 2026-11-26) ·
Rests on: [0001](0001-setup-decision-record.md), [0002](0002-remote-input-over-the-lan.md)

## Context

B-07 adds a staged look: the look a VJ builds off to the side while the room sees the live one
(B-07 SD2). The venue output never shows it, so the VJ needs to see it somewhere else, and the
only screen the VJ holds is the controller on their phone or tablet.

- ADR 0002 lets media cross the LAN in one direction only: from a paired device (a sender) to the
  screen machine. Nothing flows from the screen machine to a device; a controller receives only the
  screen's state.
- Rendering stays on the screen machine (ADR 0001): the renderer, the camera picture and the audio
  analysis all live on the screen page. A controller has none of them.
- The screen page is the only place that can draw the staged look over the live camera and the
  live audio features, which is what the VJ needs to judge it (B-07 SD12).

Cost without a preview: staging is blind, and the first time the VJ sees the next look is when the
room does.

## Decision

- **One preview stream, from the screen machine to one approved controller.** The screen page
  draws the staged look in a second engine instance and sends that canvas to the one controller
  that most recently asked for it; a newer ask takes the stream over (B-07 SD13).
- **LAN only, peer to peer, no ICE server.** The peer connection is made with no STUN and no TURN
  server, as ADR 0002's are; the server relays only the setup messages (offer, answer, candidate)
  between the screen and that controller, and no media passes it.
- **Opt-in.** No preview is drawn, encoded or sent until a controller in VJ mode asks for it; with
  nobody watching, the second engine does not exist (B-07 SD14, AC32).
- **Bounded.** Video only, no audio; at most 320×180 and 10 frames a second.
- **The output comes first.** The second engine pauses on its last picture while the live
  engine's frame time is over budget or a transition runs, and resumes after 2 s back under budget
  (B-07 SD14). The output's per-frame draw count never changes.
- **Nothing else moves.** The output canvas never carries the preview or text; a preview that
  cannot connect never blocks staging or Go (B-07 SD15).

## Alternatives

- **No preview.** The VJ stages blind and sees the look first on the room's screen. Lost on the
  problem above: building the next look unseen is the point of staging.
- **A preview through the server** (the screen page uploads frames or a stream, the server
  forwards them). Puts media in `server/` against ADR 0001 and 0002's "no media reaches the
  server", and makes the one Node process a media component. Peer to peer does the same job with
  the setup relay that already exists.
- **A preview rendered on the controller.** Would put the renderer, the camera picture and the
  audio analysis on the phone: a second camera feed and an audio stream across the LAN, and a
  phone GPU that cannot be relied on. Against ADR 0001's "rendering stays on the screen machine".

## Consequences

- **Easier:** the VJ sees the staged look over the live camera and the live audio before the room
  does, on the device they already hold.
- **Harder:** the screen page runs a second engine and a sending peer while the preview is on; its
  cost on the output is a human check on the owner's machine (B-07 AC41), not a gate number.
- **To keep true, and what enforces it:**
  - No media reaches the server; the server relays only the preview's setup messages, and only
    between the screen and the controller holding the stream — `server/test/control-preview.int.test.ts`
    and the media row of `docs/invariants.md`.
  - A sender may never send or receive a preview or scene message; a controller may send only the
    preview's setup messages, never a sender's — `server/test/control-preview.int.test.ts`.
  - No ICE server on the preview's peers — `web/src/scenes/preview.test.ts`,
    `web/src/control/preview-peer.test.ts` and `tests/browser/scenes-e2e.spec.ts`.
  - At most 320×180 and 10 fps, a second engine only while someone watches, freed when nobody does,
    paused while the output is busy — `web/src/scenes/preview.test.ts` and
    `web/src/scenes/pause.test.ts`.
  - The output never shows the preview or text — `tests/browser/scenes-e2e.spec.ts`.
