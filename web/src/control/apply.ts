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
import type { AppliedEntry, Control, TransitionChoice } from "@djv/shared";
import type { Dials } from "@djv/engine";

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
}

export interface Applier {
  receive(deviceId: string, control: Control): void;
  /** Applies everything received; returns this frame's acknowledgements. */
  drain(): AppliedEntry[];
}

export function createApplier(deps: ApplierDeps): Applier {
  let queue: { deviceId: string; control: Control }[] = [];
  let settled: AppliedEntry[] = [];

  const apply = (deviceId: string, control: Control, acks: AppliedEntry[]) => {
    const ack = { deviceId, seq: control.seq };
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
      case "pick": {
        const settle = () => void settled.push(ack);
        deps.pick(control.id).then(settle, settle);
        return; // acknowledged at the swap
      }
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
