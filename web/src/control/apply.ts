// Applying External control's controls (B-04 spec SD5, SD17, SD23, AC19 to AC21, AC24 to AC26;
// plan PD5): a received control is queued, never applied on receipt, and the queue is drained at
// the start of the next frame (`startFrameFeed`'s `beforeFrame`), before the engine draws, so the
// engine uses it in the first frame that starts after the page received it. Dials go to the
// engine directly, not through a React state update whose timing is not the frame's. Every
// applied control is acknowledged in that frame's one `applied` batch; a pick when it settles,
// i.e. at the swap, in the batch of the frame after. B-06 (T13): a `camera` may name a remote
// camera (`remote:<deviceId>`), which goes to the same choice; `mainAudio` sets the main-audio
// choice (SD22). B-09 (T1): `transition` changes the current transition choice (SD19), applied and
// acknowledged like the dials. B-18 (T2): `effect` sets one effect's live strength, likewise.
// B-07 (T5, SD3, SD4, PD1, PD7): a control with `target: "staged"` edits the staged look instead
// (`scenes/staged.ts`), and is dropped and acknowledged while none exists; `stage` and `unstage`
// make and discard it. Without a target, or with `"live"`, every control does what it did.
import type { AppliedEntry, Control, Feed, TransitionChoice } from "@djv/shared";
import type { Dials } from "@djv/engine";
import type { Look } from "../profiles/active.ts";
import type { LiveSnapshot, StagedLook } from "../scenes/staged.ts";

export interface ApplierDeps {
  /** The dials the engine holds now. */
  dials(): Dials;
  /** The engine's dials now, and the panel's display. */
  setDials(dials: Dials): void;
  setColour(slot: number, value: string): void;
  resetColour(slot: number): void;
  /** A local camera id or `remote:<deviceId>` (B-06 SD21). */
  setCamera(deviceId: string): void;
  /** The main-audio choice (B-06 SD22). */
  setMainAudio(source: "remote" | "local"): void;
  /** Merges into the current transition choice, saves it and marks the state (B-09 SD5, SD9). */
  setTransition(change: Partial<TransitionChoice>): void;
  /** One effect's live strength (B-18 SD7); it drops a stale profile or index itself. */
  setStrength(profile: string, index: number, value: number): void;
  /** The panel picker's pick: prepared, hard cut, starting dials, remembered (AC18). */
  pick(id: string): Promise<void>;
  /** Lists the profiles again (SD22). */
  refresh(): void;
  /** Start has happened: before it no camera is open, so a camera control is a no-op (SD23). */
  started(): boolean;
  /** B-07: the staged look. */
  staged: StagedLook;
  /** B-07 AC1: the live look now, for Stage from live. */
  snapshot(): LiveSnapshot;
  /** B-07 PD6: the camera on screen as a feed; null when none is. */
  feedOnScreen(): Feed | null;
  /** B-07 PD7: a camera id (local, or `remote:<deviceId>`) as a feed; null when it names none. */
  feedOf(deviceId: string): Feed | null;
  /** B-09 SD5: the current transition choice, which Stage from live copies (AC1). */
  transition(): TransitionChoice;
  /** B-07 PD6: the camera id Go switches to for a feed, or null when nothing matches. */
  matchFeed(feed: Feed): string | null;
  /** B-07 AC16: "Feed unavailable — kept the current camera", until the next Go or pick. */
  setFeedNote(on: boolean): void;
  /** B-07 PD5: Go through the pick's own path (`active.adopt`). */
  adopt(look: Look, choice: TransitionChoice): Promise<"done" | "failed" | "superseded">;
}

export interface Applier {
  receive(deviceId: string, control: Control): void;
  /** Applies everything received; returns this frame's acknowledgements. */
  drain(): AppliedEntry[];
}

export function createApplier(deps: ApplierDeps): Applier {
  let queue: { deviceId: string; control: Control }[] = [];
  let settled: AppliedEntry[] = [];

  /** Stage from live (AC1): the live look, the camera on screen, the transition's kind and duration. */
  const stageLive = () => {
    const { kind, duration } = deps.transition();
    deps.staged.fromLive(deps.snapshot(), deps.dials(), deps.feedOnScreen(), { kind, duration });
  };

  /**
   * Go (SD3, SD6, PD5, PD6): a matched feed is switched first, as a camera tap switches it (only
   * after Start, SD23); no match keeps the camera and sets the note. Then the staged look goes
   * live by its own transition, and once it has, the staged look is a copy of the new live one,
   * still tied to its scene (AC11). A failed or superseded Go leaves the staged look as it is.
   */
  const go = (settle: () => void): boolean => {
    const staged = deps.staged.definition();
    if (!staged) return false; // AC12: nothing to do, acknowledged
    const fromScene = deps.staged.state()?.fromScene ?? null;
    deps.setFeedNote(false);
    if (staged.feed) {
      const id = deps.matchFeed(staged.feed);
      if (id === null) deps.setFeedNote(true);
      else if (deps.started()) deps.setCamera(id);
    }
    const { id, name, stored, palette, amounts, dials, feed, transition } = staged;
    deps
      .adopt(
        { id, name, stored, palette, amounts, dials },
        { kind: transition.kind, duration: transition.duration, keepColour: false },
      )
      .then((result) => {
        if (result !== "done" || deps.staged.state() === null) return;
        deps.staged.fromLive(deps.snapshot(), dials, feed, transition, fromScene);
      })
      .then(settle, settle);
    return true;
  };

  /** A control with `target: "staged"`: `true` when its acknowledgement waits (a pick). */
  const toStaged = (control: Control, settle: () => void): boolean => {
    const staged = deps.staged;
    if (staged.state() === null) return false; // AC4: dropped, acknowledged
    switch (control.type) {
      case "dials": {
        const { recognisability, reactivity } = control;
        staged.setDials({
          ...(recognisability !== undefined ? { recognisability } : {}),
          ...(reactivity !== undefined ? { reactivity } : {}),
        });
        return false;
      }
      case "colour":
        staged.setColour(control.slot, control.value);
        return false;
      case "resetColour":
        staged.resetColour(control.slot);
        return false;
      case "camera": {
        // PD7: only the feed Go will switch to; nothing is opened or resumed (AC18).
        const feed = deps.feedOf(control.deviceId);
        if (feed) staged.setFeed(feed);
        return false;
      }
      case "transition": {
        const { kind, duration } = control; // a Keep colour is ignored (SD1)
        staged.setTransition({
          ...(kind !== undefined ? { kind } : {}),
          ...(duration !== undefined ? { duration } : {}),
        });
        return false;
      }
      case "effect":
        staged.setStrength(control.profile, control.index, control.value);
        return false;
      case "pick":
        staged.pick(control.id).then(settle, settle);
        return true;
      default:
        return false;
    }
  };

  const apply = (deviceId: string, control: Control, acks: AppliedEntry[]) => {
    const ack = { deviceId, seq: control.seq };
    const settle = () => void settled.push(ack);
    if ("target" in control && control.target === "staged") {
      if (!toStaged(control, settle)) acks.push(ack);
      return;
    }
    switch (control.type) {
      case "dials": {
        const current = deps.dials();
        deps.setDials({
          recognisability: control.recognisability ?? current.recognisability,
          reactivity: control.reactivity ?? current.reactivity,
        });
        break;
      }
      case "colour":
        deps.setColour(control.slot, control.value);
        break;
      case "resetColour":
        deps.resetColour(control.slot);
        break;
      case "camera":
        if (deps.started()) deps.setCamera(control.deviceId);
        break;
      case "refresh":
        deps.refresh();
        break;
      case "mainAudio":
        deps.setMainAudio(control.source);
        break;
      case "transition": {
        const { kind, duration, keepColour } = control;
        deps.setTransition({
          ...(kind !== undefined ? { kind } : {}),
          ...(duration !== undefined ? { duration } : {}),
          ...(keepColour !== undefined ? { keepColour } : {}),
        });
        break;
      }
      case "effect":
        // B-18 PD6: acknowledged whether it lands or is dropped, so the controller's waiting
        // value clears and it shows the screen's.
        deps.setStrength(control.profile, control.index, control.value);
        break;
      case "pick":
        deps.pick(control.id).then(settle, settle);
        return; // acknowledged at the swap
      case "stage": {
        const from = control.from;
        if (from === "live") stageLive();
        else if ("profile" in from) {
          // A profile is staged on a copy of the live look, with no scene tie (PD4).
          stageLive();
          deps.staged.pick(from.profile).then(settle, settle);
          return; // acknowledged at its settle, as a pick
        }
        // `{ scene }`: acknowledged, staged from T7 on.
        break;
      }
      case "unstage":
        deps.staged.clear();
        break;
      case "go":
        if (go(settle)) return; // acknowledged at its settle, as a pick
        break;
      default:
        // B-09 PD15: a control type with no case fails the type check here.
        control satisfies never;
    }
    acks.push(ack);
  };

  return {
    receive(deviceId, control) {
      queue.push({ deviceId, control });
    },
    drain() {
      const acks = settled;
      settled = [];
      const due = queue;
      queue = [];
      for (const { deviceId, control } of due) apply(deviceId, control, acks);
      return acks;
    },
  };
}
