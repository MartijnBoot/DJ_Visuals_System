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
| 1 | B-01 | Live visual engine | L | idea |
| 2 | B-02 | Visual profiles with an in-app builder | L | idea |
| 3 | B-04 | Live set controls | M | idea |
| 4 | B-03 | Claude Code-authored profiles | M | idea |

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

- **Status:** idea
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

- **Status:** idea
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

- **Status:** idea
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

### B-04 — Live set controls

- **Status:** idea
- **Added:** 2026-11-11
- **Size:** M

**Problem.** Mid-set the mood shifts, the camera needs to swing from DJ to crowd, and whoever
is at the controls may be the DJ with one hand free or a VJ (Visual Jockey) with full
attention.

**Idea.** A control surface, separate from the output screen, to switch profiles, change base
colours live with a colour picker, raise or lower camera recognisability, and switch camera
source. One or two taps for the DJ, more detail for the VJ.

**Why it matters.** Without it the set is locked to whatever was prepared beforehand.

**Not this.** Controls only on the output screen. Anything that needs a mouse and a menu while
mixing.

**Open questions.**

- Whether the control surface runs on a phone, and how it pairs with the screen machine.
- Whether live colour changes can be saved back into a profile.
- Transition behaviour when switching profiles: hard cut or crossfade.
- Whether a DJ layout and a VJ layout are two views or one view with a toggle.

**Touches.** B-01 settings, B-02 profiles, a second client view. Guess: a realtime channel
between the control surface and the renderer.
