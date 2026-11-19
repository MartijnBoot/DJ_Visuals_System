// The fader (B-19 spec SD2, SD7, SD9, SD13, AC2 to AC11; plan PD4, PD5, PD7, PD8): a hand-written
// `role="slider"` whose whole track is the touch target, grabbed anywhere and moved by the drag
// (`fader.ts`), never to the touch point. Its cap and readout follow the finger only while its
// own pointer holds it and show `value` — the screen's — otherwise: after a release, a cancel, a
// blur, a lock, a change of axis (the page re-laid out). Locked, it stays focusable with
// `aria-disabled` and ignores keys and pointers. Horizontal: right is more; vertical: up is more.
// Nothing animates.
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { createFaderGesture, readout } from "./fader.ts";

export interface FaderProps {
  testId: string;
  label: string;
  /** The value to show while no pointer holds the fader (the screen's). */
  value: number;
  disabled: boolean;
  /** A new value: at most one per frame while dragging, the last at once on release. */
  onSend(value: number): void;
  /** The axis; the stylesheet lays it out from the page's arrangement (PD3). */
  orientation?: "horizontal" | "vertical";
}

export function Fader(props: FaderProps) {
  const vertical = props.orientation === "vertical";
  const labelId = useId();
  const send = useRef(props.onSend);
  send.current = props.onSend;
  const gesture = useMemo(
    () =>
      createFaderGesture({
        now: () => performance.now(),
        requestFrame: (fn) => requestAnimationFrame(fn),
        cancelFrame: (id) => cancelAnimationFrame(id),
        send: (value) => send.current(value),
      }),
    [],
  );
  /** The held value while this fader's own pointer drags it, else null. */
  const [held, setHeld] = useState<number | null>(null);
  const holder = useRef<number | null>(null);

  const letGo = () => {
    holder.current = null;
    gesture.letGo();
    setHeld(null);
  };

  // A lock mid-drag lets go: nothing more is sent for that drag (SD9).
  useEffect(() => {
    if (props.disabled) letGo();
  }, [props.disabled]);
  // So does a change of axis: the drag's distances no longer mean what they did (SD9).
  useEffect(() => {
    if (holder.current !== null) letGo();
  }, [vertical]);

  /** The pointer's position along the axis, growing toward more. */
  const along = (e: { clientX: number; clientY: number }) => (vertical ? -e.clientY : e.clientX);

  const shown = held ?? props.value;
  const level = Math.min(1, Math.max(0, shown));
  const number = readout(shown);

  return (
    <div className="djv-fader" style={{ "--level": level } as CSSProperties}>
      <div
        role="slider"
        tabIndex={0}
        data-testid={props.testId}
        className="djv-fader-slider"
        aria-labelledby={labelId}
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={shown}
        aria-valuetext={String(number)}
        aria-orientation={vertical ? "vertical" : "horizontal"}
        aria-disabled={props.disabled}
        onPointerDown={(e) => {
          if (props.disabled || (e.pointerType === "mouse" && e.button !== 0)) return;
          const box = e.currentTarget.getBoundingClientRect();
          const travel = vertical ? box.height : box.width;
          if (!gesture.down(e.pointerId, along(e), props.value, travel)) return;
          holder.current = e.pointerId;
          e.currentTarget.setPointerCapture(e.pointerId);
          // Held but not yet moved: the cap stays where the screen put it, on the grid or not.
          setHeld(props.value);
        }}
        onPointerMove={(e) => {
          const next = gesture.move(e.pointerId, along(e));
          if (next !== null) setHeld(next);
        }}
        onPointerUp={(e) => {
          if (holder.current !== e.pointerId) return;
          holder.current = null;
          gesture.up(e.pointerId);
          setHeld(null);
        }}
        onPointerCancel={(e) => {
          if (holder.current === e.pointerId) letGo();
        }}
        onBlur={() => {
          if (holder.current !== null) letGo();
        }}
        onKeyDown={(e) => {
          if (props.disabled || !FADER_KEYS.has(e.key)) return;
          e.preventDefault(); // never scrolls the page, even at an end
          gesture.key(e.key, props.value);
        }}
      >
        <span className="djv-fader-fill" aria-hidden />
        <span className="djv-fader-cap" aria-hidden />
      </div>
      <span id={labelId} className="djv-fader-label">
        {props.label}
      </span>
      <span className="djv-fader-readout" data-testid={`${props.testId}-readout`} aria-hidden>
        {number}
      </span>
    </div>
  );
}

/** The fader's own keys (PD5). */
const FADER_KEYS = new Set([
  "ArrowRight",
  "ArrowUp",
  "ArrowLeft",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
]);
