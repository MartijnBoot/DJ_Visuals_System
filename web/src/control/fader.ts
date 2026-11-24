// The fader's gesture rules (B-19 spec SD2, SD7, SD9, AC2 to AC5, AC7, AC9, AC10; plan PD5, PD6,
// PD8), without a browser. A fader is grabbed anywhere and moves by the drag, never to the touch:
// the value changes by the drag's distance over the travel, clamped to 0 and 1 on every move, so
// overshoot is forgotten and a reversal moves at once. One pointer per fader; a second is
// ignored. A touch without a change sends nothing. While dragging, at most one value per frame
// and at least `FADER_GAP_MS` apart (two faders together stay under the socket's 120 a second);
// the last value goes at once on release. A let-go (lock, cancel, blur, re-layout) drops what is
// pending and sends nothing more for that drag. Keys move by 0.01, 0.1 or to an end, one send per
// press. The internal value is unrounded; what is sent and shown is on the 0.01 grid.
import { createSendThrottle, type ThrottleDeps } from "./wheel-math.ts";

/** Two faders held together send at most 2 × 1000 / 20 = 100 values a second. */
export const FADER_GAP_MS = 20;

export type FaderGestureDeps = Omit<ThrottleDeps<number>, "minGapMs"> & {
  /** B-09 PD16: a fader that matters only at the next pick sends less often; default 20 ms. */
  minGapMs?: number;
};

export interface FaderGesture {
  /** A pointer lands; `position` grows toward more. False when another pointer holds the fader. */
  down(pointerId: number, position: number, value: number, travel: number): boolean;
  /** The held pointer moved: the shown value, or null for a pointer that does not hold it. */
  move(pointerId: number, position: number): number | null;
  /** The held pointer lifted: its last value goes now. */
  up(pointerId: number): void;
  /** Lets go mid-drag: nothing more is sent for this drag. */
  letGo(): void;
  /** A key on the focused fader, from the shown `value`: the new value, or null for no change. */
  key(key: string, value: number): number | null;
  held(): boolean;
}

/** A value on the 0.01 grid. */
export const onGrid = (value: number) => Math.round(value * 100) / 100;

const clamp = (value: number) => Math.min(1, Math.max(0, value));

/** The 0–100 readout and `aria-valuetext` (PD8). */
export const readout = (value: number) => Math.round(value * 100);

const KEYS: Readonly<Record<string, (value: number) => number>> = {
  ArrowRight: (v) => v + 0.01,
  ArrowUp: (v) => v + 0.01,
  ArrowLeft: (v) => v - 0.01,
  ArrowDown: (v) => v - 0.01,
  PageUp: (v) => v + 0.1,
  PageDown: (v) => v - 0.1,
  Home: () => 0,
  End: () => 1,
};

export function createFaderGesture(deps: FaderGestureDeps): FaderGesture {
  const throttle = createSendThrottle<number>({ ...deps, minGapMs: deps.minGapMs ?? FADER_GAP_MS });
  let hold: {
    pointerId: number;
    position: number;
    value: number;
    travel: number;
    shown: number;
  } | null = null;

  return {
    down(pointerId, position, value, travel) {
      if (hold) return false;
      hold = { pointerId, position, value, travel: Math.max(1, travel), shown: onGrid(value) };
      return true;
    },
    move(pointerId, position) {
      if (!hold || hold.pointerId !== pointerId) return null;
      hold.value = clamp(hold.value + (position - hold.position) / hold.travel);
      hold.position = position;
      const shown = onGrid(hold.value);
      if (shown !== hold.shown) {
        hold.shown = shown;
        throttle.push(shown);
      }
      return shown;
    },
    up(pointerId) {
      if (!hold || hold.pointerId !== pointerId) return;
      hold = null;
      throttle.release();
    },
    letGo() {
      hold = null;
      throttle.drop();
    },
    key(key, value) {
      const step = KEYS[key];
      if (!step || hold) return null;
      const next = onGrid(clamp(step(value)));
      if (next === value) return null;
      deps.send(next);
      return next;
    },
    held: () => hold !== null,
  };
}
