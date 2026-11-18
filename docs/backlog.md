# Feature backlog

Ideas gathered and ordered before any of them becomes a spec. An item here is a thought worth
keeping, not a commitment: nothing in this file is scheduled until it goes through `/spec`.

    /backlog <idea>      brainstorm an idea, then add it here
    /backlog             show the order and pick what to do
    /backlog order       re-order the list
    /backlog spec B-nn   mark an item ready and hand it to /spec

## Order

Top is next. Every item that is not `specced` or `dropped` appears here exactly once.

Every item assumes Phase 0 is done first: the Setup Decision Record
(`docs/adr/0001-setup-decision-record.md`) picks the stack, database, hosting and config, and
its exit criteria produce the app shell the items are built into. Phase 0 is not a backlog item.

| # | ID | Feature | Size | Status |
|---|---|---|---|---|
| 1 | B-16 | Primary colour wheel always on the controller | S | idea |
| 2 | B-17 | Echo as a built-in effect | S | idea |
| 3 | B-18 | Effect strength sliders on the controller | M | idea |
| 4 | B-14 | Image assets in profiles | M | idea |
| 5 | B-07 | Scenes | M | idea |
| 6 | B-09 | Transitions | M | idea |
| 7 | B-10 | Global colour layer | S | idea |
| 8 | B-11 | "No camera" as a feed option | S | idea |
| 9 | B-13 | Selling it | L | idea |
| 10 | B-15 | iPad as an audio source | L | idea |

## Items

<!--
Template — copy it below the last item, take the next free B-nn, never reuse a number.

### B-nn — <short title>

- **Status:** idea | ready | specced → `docs/specs/<file>.md` | built → `docs/plans/<file>.md` | dropped (<why>)
- **Added:** YYYY-MM-DD
- **Size:** S (a day or less) | M (a few tasks) | L (a phase of its own)

**Problem.** Who runs into what, and when — a real moment, not a wish.

**Idea.** What would change, in their terms. Not how it is built.

**Why it matters.** What gets better, for whom, and what it costs us not to have it.

**Not this.** What it explicitly is not, or what would make it a failure even if it works.

**Open questions.** What `/spec` will have to settle. Fine to have many.

**Touches.** Areas likely involved and any `D-nn` or ADR it brushes against. A guess is fine;
mark it as one.
-->

### B-01 — Live visual engine

- **Status:** built → `docs/specs/phase-b-01-live-visual-engine.md`,
  `docs/plans/phase-b-01-live-visual-engine.md` (H2 to H4 on the screen machine are the
  owner's)
- **Added:** 2026-11-11
- **Size:** L

**Problem.** During a set, people dance in front of a screen that shows nothing, or canned
loops that have no relation to the music playing right now.

**Idea.** The app takes the live audio (captured from the device itself or through a
microphone) and a live camera (a webcam or a phone, pointed at the DJ, the crowd or both) and
renders a video feed on the wired screen that visually represents the audio. A camera
recognisability setting dials the feed from clearly visible to fully abstracted.

**Why it matters.** This is the product. Without it nothing else has a purpose.

**Not this.** Visuals that visibly lag behind the beat. A pre-rendered or scripted show. A
fixed camera role.

**Open questions.**

- The acceptable latency budget from audio to pixels, in milliseconds.
- How a phone becomes a camera source: a browser page on the phone, or a streaming app.
- How device audio is captured on each OS, and what the fallback is when it cannot be.
- Whether rendering runs in the browser on the screen machine or on a server.
- What "visually represents the audio" means at first: which audio features drive which
  visual parameters.

**Touches.** New code: rendering, audio analysis, media capture. Requires Phase 0 (stack,
config, app shell). Guess: a client-side rendering module and an audio-analysis module.

### B-02 — Visual profiles with an in-app builder

- **Status:** built → `docs/plans/phase-b-02-visual-profiles.md`
- **Added:** 2026-11-11
- **Size:** L

**Problem.** Before a set you want a look prepared, and you want it to survive a redeploy or
the move from self-hosted to a hosted version.

**Idea.** A profile is a "visual transformer": the recipe that turns camera plus audio into the
output feed. Profiles are stored in the database. Inside the app, a simple builder makes one
from basic colours or a colour palette plus the built-in transformer tools.

**Why it matters.** Profiles are what make one night look different from another. Every
profile looking the same is a failure.

**Not this.** A colour picker alone. Profiles that live only in browser storage.

**Open questions.**

- Which built-in transformer tools exist at first.
- The profile data model, and whether a profile holds code or only configuration.
- How a profile is previewed in the builder without a live set.
- Import and export, so profiles can move between a self-hosted and a deployed instance.

**Touches.** Database and migrations, profile model, builder UI. Depends on B-01. Guess: the
first real table in the schema.

### B-03 — Claude Code-authored profiles

- **Status:** specced → `docs/specs/phase-b-03-claude-code-authored-profiles.md`
- **Added:** 2026-11-11
- **Size:** M

**Problem.** The richest looks, based on a painting, a set of images or an idea, need more
than the in-app builder offers.

**Idea.** In a Claude Code session you gather inspiration (images, paintings, ideas) and the
agent turns it into a pre-made profile that the app loads and stores like any other.

**Why it matters.** It is the path to profiles that look nothing alike, without putting that
complexity into the app.

**Not this.** An AI chat inside the web app. Profiles the app cannot store or edit afterwards.

**Open questions.**

- The file format and the import path into the database.
- Whether such a profile may contain code, and if so how it is sandboxed.
- A skill or template under `.claude/` for authoring one.
- How inspiration images are referenced: copied into the repo, uploaded, or only described.

**Touches.** Profile format from B-02, repo tooling under `.claude/`. Depends on B-02.

**Note from B-02.** The format is built: `{ formatVersion: 1, profiles: [...] }`, validated by
`profileFileSchema` in `shared/` and imported through `POST /api/profiles/import` (all or
nothing, names made unique). A profile is configuration only (B-02 SD1); if B-03 wants code in a
profile, it would arrive as one more effect type, with its own sandboxing question, not as a
change to this model.

### B-04 — Live set controls

- **Status:** specced → `docs/specs/phase-b-04-live-set-controls.md`
- **Added:** 2026-11-11
- **Size:** L (grew from M at its spec interview: LAN listener, pairing and approval are in)

**Problem.** Mid-set the mood shifts, the camera needs to swing from DJ to crowd, and whoever
is at the controls may be the DJ with one hand free or a VJ (Visual Jockey) with full
attention.

**Idea.** A control surface, separate from the output screen, to switch profiles, change base
colours live with a colour picker, raise or lower camera recognisability and audio reactivity
(the two dials B-01 defines, spec SD5), and switch camera source. One or two taps for the DJ,
more detail for the VJ.

**Why it matters.** Without it the set is locked to whatever was prepared beforehand.

**Not this.** Controls only on the output screen. Anything that needs a mouse and a menu while
mixing.

**Open questions.**

- Whether the control surface runs on a phone, and how it pairs with the screen machine.
- Whether live colour changes can be saved back into a profile.
- Transition behaviour when switching profiles: hard cut or crossfade.
- Whether a DJ layout and a VJ layout are two views or one view with a toggle.

**Touches.** B-01 settings, B-02 profiles, a second client view. Guess: a realtime channel
between the control surface and the renderer. Its pairing-token and bind-address design is
reused by B-05.

### B-05 — Phone as camera source

- **Status:** dropped (superseded by B-06, which widens it to any remote device and adds remote
  main audio; its open questions moved there)
- **Added:** 2026-11-11
- **Size:** M

**Problem.** A wired webcam sits where its cable reaches. The DJ wants a camera that someone
can carry into the crowd, or point at the booth from the floor.

**Idea.** A phone opens a page on the screen machine's server, its camera streams to the screen
page, and the renderer takes it as just another camera source.

**Why it matters.** The crowd camera is the shot that makes the room see itself. B-01 cannot
give it without a cable.

**Not this.** A streaming app the phone has to install. A camera that lags visibly behind the
wired one.

**Open questions.**

- The server must accept connections from the LAN, which breaks the `127.0.0.1`-only invariant
  (`docs/invariants.md`) and needs B-04's pairing token and bind-address design first.
- HTTPS on a LAN address: a locally trusted certificate, and how the phone trusts it.
- WebRTC signalling through the server; whether a travel router or hotspot is required at
  venues with client isolation (SDR §8).

**Touches.** Server bind address and TLS, B-04 pairing, WebRTC signalling, the B-01 camera
source seam (spec SD1). Depends on B-01 and B-04. Split out of B-01 at its spec interview.

### B-06 — Remote input devices

- **Status:** specced → `docs/specs/phase-b-06-remote-input-devices.md`
- **Added:** 2026-11-12
- **Size:** L

**Problem.** The DJ mixes on a laptop that already carries heavy DJ software. The cleanest audio
is on that laptop, and its webcam is a useful shot. Other shots come from a device next to
another screen or from phones. B-01 only reads a microphone and cameras plugged into the screen
machine.

**Idea.** Other devices on the network send streams to the screen machine, which still renders
and analyses everything. The sending devices only capture and send. The laptop can supply the
main audio and a webcam. Other devices supply video. There is exactly one main audio feed at a
time. Without a laptop, a microphone on the screen machine is the main audio. The VJ can switch
between the video feeds live.

**Why it matters.** The audio signal is the best available, and the DJ laptop's load does not go
up. It also gives crowd and booth shots without cables, which was B-05's purpose.

**Not this.** Rendering or analysis on the sending devices. A screen-machine microphone that
stops working once a laptop is connected. More than one main audio at a time. Mixing audio
feeds. An app the sending devices must install.

**Open questions.**

- The latency budget for audio arriving over the network, as a separate number from B-01's
  p95 ≤ 50 ms.
- Whether the laptop path needs an ADR, since SDR question 2 chose same-machine audio so that
  audio never crosses a network.
- What happens to the main audio when the laptop drops: fall back to the microphone, or hold
  silence.
- How a device announces itself and is accepted: pairing token, naming, and what the VJ sees.
- What carries system audio on each OS from a browser page on the laptop.
- The B-05 questions: LAN bind versus the `127.0.0.1` invariant, HTTPS on a LAN address, WebRTC
  signalling, and venue client isolation (SDR §8).

**Touches.** Server bind address and TLS, pairing (from B-04's design), WebRTC signalling, the
B-01 capture seam (spec SD1), `docs/invariants.md` rows for `127.0.0.1` and "no media reaches
the server", SDR questions 2 and 3. A guess. Depends on B-01 and B-04. Supersedes B-05.

**Note from B-04.** B-04 builds the LAN side this item reuses
(`docs/specs/phase-b-04-live-set-controls.md`): a listener on private IPv4 addresses only, on
`CONTROL_PORT`, opened by the operator at runtime (SD2, SD14); a 6-character code by QR plus an
approval per device, with a session key bound to the source IP (SD3, SD4, SD15, SD18); and the
control WebSocket (SD16). B-04 stays on plain HTTP and leaves HTTPS to this item, which needs a
secure context for `getUserMedia` on remote devices: decide it once here, for both (B-04 SD15).

### B-07 — Scenes

- **Status:** idea
- **Added:** 2026-11-12
- **Size:** M

**Problem.** A set has moments: a crowd shot with warm colours, a booth shot abstracted and
fast. Switching between them today means changing a feed, a profile and the dials one by one.

**Idea.** A scene is a saved combination of a video feed, a visual profile and the dial
settings, which you can recall in one action. A VJ can also build a scene live by switching
sources, changing colours and changing patterns, then save it as a scene.

**Why it matters.** It makes changing the mood of the room a single move instead of three. It
also lets a set be prepared beforehand.

**Not this.** A timeline or auto-playing show. Scenes that only exist in browser storage. Scenes
that lose their video source when the device disconnects, with no fallback.

**Open questions.**

- Transition between scenes: hard cut or crossfade.
- What a scene does when its feed's device is offline.
- Whether a scene stores the feed by device identity or by a role such as "crowd".
- How scenes are stored and ordered, and whether they move with profile import and export.
- Whether saving a live-built scene overwrites or creates a new one.

**Note from B-02.** A scene would reference a profile by id. Ids are stable across saves
(a rename keeps the id), but an import gives every profile a new id and the built-in's id is the
reserved `builtin`, so scenes that must survive an export and import need to reference profiles
by name or carry the profile with them. That is this item's question to settle.

**Touches.** Scene storage (a table, migration), B-04 controls, B-02 profiles, B-06 feeds. A
guess. Depends on B-02 and B-06. Overlaps B-04's profile switching and live colour changes.

### B-08 — A gate that load cannot turn red (D-02)

- **Status:** built → `docs/plans/phase-b-08-load-proof-gate.md`
- **Added:** 2026-11-14
- **Size:** M (two checks, a load reproduction, one gate change)

**Problem.** On 2026-11-14 two of four `bash scripts/check.sh` runs on the Windows dev machine
went red on a timing check, a different one each time, and each passed when re-run alone:
`tests/meta/profile-compat.test.ts:12` hit vitest's default 5 s timeout (about 3 s alone), and
the twelve-effect latency check (`tests/browser/live.spec.ts:274`, assert at `:297`) read p95
308.8 ms while another screen page was still rendering. Neither failure was the product's
(`docs/specs/defect-register.md`, D-02; `docs/runbooks/rehearsals/2026-11-14-b02-human-checks.md`).

**Idea.** Every gate check proves something about the product that a busy machine cannot
falsify:

- The compat tests stop timing the compiler. The unmutated case is already proven by the
  `types` step (`web/tsconfig.json` includes `src`, so `web/src/profile-compat.ts` and
  `web/src/features-compat.ts` are type-checked there); the mutation tests keep their teeth.
  `tests/meta/features-compat.test.ts` shares the helper (`tests/meta/compat-check.ts`) and the
  same risk.
- The real-time budget (p95 ≤ 50 ms, B-01 AC10, B-02 AC17) stays a check on the owner's screen
  machine, as H3 already does (H3-8a: 23 ms). The gate's latency check proves a property load
  cannot break, rather than a wall-clock number on whatever machine runs it (agreed
  2026-11-14).
- D-02 gets its own acceptance criterion: the gate's verdict does not change under a defined
  induced load.

**Why it matters.** A red gate that a re-run turns green teaches people to re-run instead of
reading the failure, and the gate stops being the one definition of green. Today the honest
response to red on the dev machine is "try again"; that habit will hide the first real
regression.

**Not this.**

- Retries, in vitest or Playwright. A retry turns "green" into "green once in N"; it hides an
  intermittent fault that is the product's (a real latency spike), and it automates the very
  re-run habit D-02 is about.
- Raising timeouts and calling it fixed: that only moves the threshold the machine has to beat.
- A quiet-machine precondition the gate cannot check. "Close other browsers first" is a ritual,
  not a check.
- Weakening the guarded compat checks: their `docs/invariants.md` rows must still fail on drift.
- The smear-above-posterise freeze, and the builder layout.

**Open questions.**

- What the gate's latency check measures instead: a bound relative to the same run's baseline,
  an absolute bound with a stated margin for software WebGL, or a structural property (one
  analysis block per submitted frame, say). It must still satisfy B-02 AC17's "the CI latency
  check shall run against that profile", and may need a spec note on B-01 SD2/AC10 (the
  edge-case note at `docs/specs/phase-b-01-live-visual-engine.md:278` already calls the gate's
  check a CPU-side proxy).
- The induced load, for the reproduction and for D-02's criterion. Proposal: CPU busy-loops
  beside the unit step; a second headless Chromium rendering `/` beside the browser step. It
  must turn today's gate red before the fix and leave it green after.
- Whether `check.sh` warns up front when port 8123 is held. Proposal: warn and name the
  orphan-node cause, never refuse; Playwright already fails on a held port
  (`reuseExistingServer: false`), only less clearly. Port 8000 does not affect the gate.
  "Another WebGL page is running" cannot be detected reliably from a shell, so the reproduction
  proves the fix instead.
- Whether dropping the duplicated "type-checks against the real shapes" tests needs a
  `docs/invariants.md` update (B-01 and B-02 compat rows; a guarded change).

**Touches.** `tests/meta/compat-check.ts`, `tests/meta/profile-compat.test.ts`,
`tests/meta/features-compat.test.ts`, `tests/browser/live.spec.ts`, `scripts/check.sh`,
`docs/specs/defect-register.md` (D-02), `docs/invariants.md` (B-01 and B-02 compat rows),
B-01 SD2/AC10, B-02 AC17. Bug-fix rules apply: it starts with a failing test (the induced-load
reproduction).

### B-09 — Transitions

- **Status:** idea
- **Added:** 2026-11-14
- **Size:** M (a guess)

**Problem.** A profile switch is a hard cut (B-02 SD15, B-04 SD6). Mid-set a cut is sometimes
right and often too abrupt: a mood change wants to arrive, not jump.

**Idea.** A family of transitions between profiles, chosen live from the controller: hard cut,
crossfade, and more types (for example a wipe, a dissolve through noise, a cut on the next beat,
a flash to the primary colour). Each with a duration where it has one.

**Why it matters.** It lets a VJ shape the change of mood as part of the show rather than only
choosing its end state. Split out of B-04 at its spec interview: the owner wants more options
than cut and crossfade.

**Not this.** A transition that drops frames or pushes the audio-to-frame p95 over B-01's 50 ms
on the owner's machine. A pre-scripted sequence (that is a timeline, which B-07 also rules out).

**Open questions.**

- Which transition types come first, and which take a duration.
- What a pick during a running transition does: restart from the current mix, queue, or cut.
- The GPU cost of rendering two profiles at once (two programs, the old look's smear feedback),
  and how render scaling (B-01 SD8) treats a transition.
- Whether "cut on the next beat" belongs here, since it uses the audio features.
- The controller UI: a default transition plus a per-pick override, or one current choice.
- Whether B-07 scenes reuse these transitions.

**Touches.** `engine/` (two looks in one frame, a mix pass), B-04's controller and messages,
B-01's latency and render-scale checks, B-07. Depends on B-04.

### B-10 — Global colour layer

- **Status:** idea
- **Added:** 2026-11-14
- **Size:** S (a guess)

**Problem.** B-04's live colour changes edit the active profile's palette and are gone at the
next profile switch (B-04 SD7). A VJ who wants the whole night warmer, or tinted to the venue's
lighting, has to redo it after every switch.

**Idea.** A colour layer applied after every profile: a hue shift and a tint colour with an
amount, set live from the controller, kept across profile switches until changed or the set
ends. Added on top of B-04's palette edits, not instead of them (owner, B-04 interview).

**Why it matters.** One move recolours everything, whatever profile comes next.

**Not this.** Saved into a profile (ADR 0001: live changes are never saved). A replacement for
the palette edit.

**Open questions.**

- Hue shift, tint, or both; whether it also affects the camera picture or only the palette
  colours.
- Whether it survives a screen page reload (B-04 resets live state on reload, SD13).
- Where it sits in the shader (after the last effect, or on the palette only) and its cost.
- Whether B-07 scenes store it.

**Touches.** `engine/` (one stage and uniforms), B-04's controller and messages. Depends on B-04.

### B-11 — "No camera" as a feed option

- **Status:** idea
- **Added:** 2026-11-15
- **Size:** S (a guess: one more entry in the existing pickers; the look already exists)

**Problem.** The operator wants the visuals without the camera picture. The camera list offers
only real cameras, so today the only ways to get the camera-free look are to unplug the camera or
deny the browser permission.

**Idea.** A "No camera" entry in the camera feed list. Picking it switches the screen to the
no-camera look B-01 already renders: the active profile over a slow noise field, driven by audio
only (B-01 SD10, AC13). Picking a camera again switches back. Offered wherever a feed is picked:
the panel's camera picker and the `/control` camera tiles (a proposal, not asked).

**Why it matters.** Turning the camera off becomes a deliberate one-move choice mid-set, not
something that only happens when a camera fails. It also gives B-07 Scenes a "no camera" feed to
store.

**Not this.** A new visualiser or a new look; it reuses the existing one. A screen that reattaches
a camera on its own while "No camera" is chosen (today a lost camera reattaches without a click,
AC13).

**Open questions.**

- Whether choosing it releases the camera device, so the webcam light goes off.
- Whether the choice is remembered across a reload or restart, as the chosen camera is (B-01
  PD12).
- How the panel, overlay and controller tell "off" (chosen) apart from `none` and `lost`
  (failures).
- Whether it can be picked before Start, when the camera controls are disabled (B-04 AC24).

**Touches.** A guess: `web/src/SourcePickers.tsx`, the capture session
(`web/src/capture/session.ts`) and the remembered choice, the `camera` control message in
`shared/src/control.ts`, the `/control` camera tiles. Builds on B-01 SD10/AC13 and B-04 AC24.
Depends on B-04.

### B-12 — Hosted home on Oracle Cloud (free tier trial)

- **Status:** built → `docs/plans/phase-b-12-hosted-home-oracle.md` (2026-11-17; T1–T19 on
  stacked branches, awaiting review and the owner's human steps H0–H12)
- **Added:** 2026-11-15
- **Size:** L

**Problem.** The app and its profiles live on one machine. Playing at another location, or on a
different screen machine, means carrying that machine or moving profiles by export and import;
if the machine fails, the profiles go with it (ADR 0001 §8).

**Idea.** The app is reachable at a URL on Oracle Cloud, and the profiles live there. Whatever
device is the screen machine connects to it, gets the app and the profiles, and runs the engine
locally: audio, camera, rendering and External control stay on the local network. Every change
merged to `main` on GitHub deploys to Oracle automatically. Free tier first, to see how it
works there.

**Why it matters.** A stable home, reachable from any location and any screen machine, with
profiles no longer tied to one machine. It is also the first step towards selling the app
(B-13).

**Not this.** A set that stops when venue internet drops. Rendering or media on the server.
Accounts for other people or payments (B-13). Deploying by hand. Paid Oracle resources the
owner has not decided on.

**Open questions.**

- A new ADR: ADR 0001 defers hosting (§7) and names Azure.
- What a screen machine needs: only a browser (the app kept for offline after the first load),
  or a local install that syncs with the cloud. This decides where B-04's LAN pairing runs.
- Behaviour without internet: at start-up, mid-set, and profiles edited offline then synced.
- Login for the hosted URL: bought, not built (ADR 0001 Q3), and able to grow into customer
  accounts (B-13).
- HTTPS and a domain name.
- Free-tier limits: idle instances can be reclaimed, ARM or x86, region, and what "stable"
  means in numbers.
- The GitHub to Oracle deploy: how GitHub gets access, how a failed deploy is undone,
  migrations on deploy.
- Backups of the cloud database, and logs (ADR 0001 expected Application Insights at hosting).

**Touches.** A guess: a new ADR, the `127.0.0.1` row in `docs/invariants.md`,
`server/src/config.ts`, server bind address and TLS, B-04 External control, profile storage, a
GitHub Actions workflow, a new infrastructure folder. Oracle credentials are the owner's (a hard
stop). Depends on B-04.

### B-13 — Selling it

- **Status:** idea
- **Added:** 2026-11-15
- **Size:** L

**Problem.** Other DJs and VJs could pay for the app, but today it is a single-owner tool.

**Idea.** A placeholder (wording proposed, not yet the owner's): the hosted app serves paying
customers, each with their own profiles.

**Why it matters.** It is the owner's stated long-term goal, and it keeps B-12 from making
choices that block it.

**Not this.** Something B-12 builds now; B-12 only must not block it.

**Open questions.** Who the buyers are, pricing model, keeping each customer's data separate,
payments, terms and privacy, support.

**Touches.** A guess: auth, profile storage, ADR 0001 (Q3, §7). Depends on B-12.

### B-14 — Image assets in profiles

- **Status:** idea
- **Added:** 2026-11-15
- **Size:** M

**Problem.** A profile drawn from a painting can borrow its palette, motion and idea through code
(B-03), but not the painting itself: its exact colour grade, its surface, its brushwork.

**Idea.** A profile may carry images, stored by id in `DATA_DIR/assets/` (SDR decision 4), that
custom effects (B-03) read as textures: a colour-grade lookup so the camera takes on the
painting's colours, a surface texture blended over the feed, warp or mask maps that push the
picture along the strokes.

**Why it matters.** It makes "based on this painting" literally true, which code alone cannot
fake convincingly.

**Not this.** Neural style transfer at run time (breaks the latency bound). Blobs in the
database. Assets referenced by file path (SDR constraint).

**Open questions.**

- Which of the three uses come first (probably the colour grade).
- Upload, storage and clean-up on delete; size limits.
- Assets in the export file: a new `formatVersion`, the import limit.
- The endpoint the screen page reads assets from, and the amended request invariant.
- How `pnpm profile:check` and the `/profile` command handle assets.

**Touches.** B-03's custom effect contract (texture inputs), `shared/` file format, `server/`
storage and an endpoint, `docs/invariants.md` request row. Depends on B-03. Split out of B-03 at
its spec interview (B-03 SD2).

### B-15 — iPad as an audio source

- **Status:** idea
- **Added:** 2026-11-17
- **Size:** L

**Problem.** Found in B-06's H1 (2026-11-16): on the iPad, `/send` stops its camera and microphone
as soon as another app comes to the front, so the iPad cannot run its own app (a DJ app, say) and
send at the same time. Safari on iPadOS has no system-audio capture either, so what the iPad
plays cannot reach the screen machine.

**Idea.** The iPad sends audio to the screen machine like the laptop does in B-06: its input or
what it plays, kept running while another app is in front.

**Why it matters.** A DJ or VJ who plays from an iPad gets the same clean main audio the laptop
gives, without a microphone in front of a speaker.

**Not this.** Rendering or analysis on the iPad. A second main audio at the same time (B-06
SD-rules stand).

**Open questions.**

- Whether a web page can do this at all: iPadOS suspends capture in a hidden page (B-06 SD9) and
  Safari has no `getDisplayMedia` audio. If not, this needs a native app, which B-06's spec
  ruled out ("an app or extension on any device").
- If a native app: whether it speaks the same `/send` pairing and WebRTC setup, how it is
  distributed and signed, and whether ReplayKit or an audio share from the DJ app is the source.
- Whether a wired path (iPad audio out into the screen machine's input) is enough instead.

**Touches.** A guess: the `/send` protocol in `shared/src/control.ts`, pairing, ADR 0001/0002;
a new client outside `web/`. Depends on B-06.

### B-16 — Primary colour wheel always on the controller

- **Status:** idea
- **Added:** 2026-11-17
- **Size:** S

**Problem.** Mid-set I want to switch quickly between the abstraction dial and the primary
colour. On `/control` the colour wheel is a pop-up over the whole controller, so every colour
change ends with tapping Done before the dial can be reached again: one action too many.

**Idea.** The primary colour wheel is always visible on the controller, next to the dials, in DJ
and VJ mode alike. No pop-up, no Done: drag the colour, move the abstraction dial, back to the
colour, without opening or closing anything. Reset stays.

**Why it matters.** Colour and abstraction become one quick gesture by hand instead of a sequence
of taps, so the visuals follow the music faster.

**Not this.** Anything that has to be opened or closed before a dial can be reached. A wheel too
small to hit a colour by hand. Scrolling between the wheel and the abstraction dial (on a phone
that is the same extra action in another form).

**Open questions.**

- Whether VJ mode's other palette swatches still open a pop-up, or point the inline wheel at
  their slot instead.
- How the wheel and both dials fit on a phone in portrait at 320 CSS px wide (B-04: no
  horizontal scrolling), and in landscape.
- Whether the wheel's size or the layout differs per mode.
- This amends B-04 SD11 and its UI rule "Colour wheel: modal over the controller"; the spec
  records the amendment.

**Touches.** `web/src/control/` (`Controller.tsx`, `Wheel.tsx`, `styles.ts`), the B-04 spec and
its wheel browser tests (AC23). A guess: no new control message, no change to the server or
`engine/`. Depends on B-04.

### B-17 — Echo as a built-in effect

- **Status:** idea
- **Added:** 2026-11-19
- **Size:** S

**Problem.** The echo in the Neon Silhouette profile (`profiles/neon-silhouette.md`) lives inside
that one profile's custom code. In it, a moving silhouette leaves fading copies of itself that
fan out into colour. When I build another profile in the builder I cannot add it. The nearest
built-in, `smear`, mixes in 85% of the previous frame, which gives a soft blur, not separate
trails.

**Idea.** Echo is one more effect in the builder's list, next to pixelate and RGB split, usable in
any profile. It keeps Neon Silhouette's look. The last frame fades and is kept where it is
brighter than the new one, and the trail's red and blue drift apart so it fans out into colour.
Its strength is how long the trails last, from none to about half a second.

**Why it matters.** The best motion effect so far is locked in one profile. As a built-in it is
available to every profile, and it gets a live strength slider through B-18.

**Not this.** A renamed `smear`. Trails that build up until the screen goes white (the max, never
a sum, keeps the feedback below 1).

**Open questions.**

- Whether the colour fan-out is part of Echo or a separate setting (a colour slot, or none).
- Whether Neon Silhouette is rewritten to use the built-in echo.
- Whether a new effect type means a new profile file `formatVersion`.
- How strength maps to trail length, and where Echo sits among the built-ins' fixed order.

**Touches.** `engine/` (a new pass reading the previous frame), `shared/src/profile.ts` (the
effect list), the builder's effect list, `pnpm profile:check`, `docs/custom-effects.md`, the
B-02 effect table. A guess: no server change.

### B-18 — Effect strength sliders on the controller

- **Status:** idea
- **Added:** 2026-11-19
- **Size:** M

**Problem.** Mid-set I want to push one effect's strength up or down, for example more echo on a
breakdown. On `/control` I only have profiles, cameras, the two dials and colour, so an effect's
strength is fixed at whatever the profile stored.

**Idea.** In the builder every effect gets two toggles, **DJ** and **VJ**. When one is on, that
effect's strength shows as a slider on `/control` in that mode, for the active profile. Pushing it
changes the screen live. Switching profiles starts again from the stored values: live changes
are never saved into profiles (ADR 0001).

**Why it matters.** The profile's author decides which effects can be played live, and keeps DJ
mode to the one or two that matter, with one hand free. The set stops being locked to the stored
strengths.

**Not this.** A full effect editor on the controller: no adding, removing or reordering effects,
and no other parameters. Saving live strengths back into the profile. A DJ mode that fills up
with sliders until it needs scrolling.

**Open questions.**

- How the sliders fit on a phone in portrait at 320 CSS px wide next to the two dials and B-16's
  always-visible wheel (B-04: no horizontal scrolling), and whether there is a cap per mode.
- Whether a custom effect's own parameters can be ticked too, or only its strength.
- How a slider is labelled: the type's name, or a custom effect's label.
- Whether a ticked effect with an audio binding shows the stored amount or the bound result.
- Which new control message it needs (`shared/src/control.ts`), and how the screen applies it.
- This amends B-04 SD9 and its mode layouts; the spec records the amendment.

**Touches.** `shared/src/profile.ts` (two flags per effect), the builder, `shared/src/control.ts`,
`web/src/control/`, the screen applying it, the B-04 spec. Depends on B-04, sits next to B-16 in
the controller layout.
