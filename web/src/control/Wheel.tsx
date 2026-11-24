// The colour block (B-04 spec SD11, AC20, AC21; B-16 SD1, SD2, SD5, SD10, PD8, PD13): a section
// pinned in the controller's grid, never a dialog, with a hue and saturation disc drawn by hand on
// a canvas, the brightness fader standing vertically beside it at the disc's height (the
// controller's own fader, B-19 AC11, B-16 PD9), the label naming the slot, the current colour with
// its hex value, the stored colour and Reset. Touch-drag first, with pointer
// capture; arrow keys move hue (left, right) and saturation (up, down) for a laptop without a
// mouse. While dragging, at most one change per animation frame and always the last position
// (`wheel-math.ts`). It edits the active profile's palette in memory only; nothing is saved.
//
// A long-lived control (B-16 SD7, SD8, PD6, PD7, PD11, PD12): while the disc or the brightness
// fader is held, the marker, the brightness and the hex value follow the hand and the screen's
// reports are not shown; otherwise each new report is shown through `follow`, which keeps the
// wheel's own hue and saturation when they already make the reported colour (black, grey). One
// pointer holds the disc. A pointer cancel, a blur, a change of arrangement or a lock lets go:
// nothing more is sent for that drag and the screen's value shows. Locked, nothing takes input and
// the block shows "Locked" and the hatching, as the bank does.
import { useEffect, useMemo, useReducer, useRef } from "react";
import type { Arrangement } from "./arrangement.ts";
import { Fader } from "./Fader.tsx";
import {
  createSendThrottle,
  follow,
  hexToHsv,
  hsvToHex,
  hueSatToPoint,
  pointToHueSat,
  type Hsv,
} from "./wheel-math.ts";

export interface WheelProps {
  slot: number;
  /** Whether `slot` is the profile's primary slot: the label says so (B-16 SD3, AC9, AC10). */
  primary: boolean;
  /** The colour on screen now (the live palette). */
  current: string;
  /** The profile's stored colour for the slot. */
  stored: string;
  disabled: boolean;
  /** The page's arrangement: a change lets go of a drag (PD11). */
  arrangement: Arrangement;
  onColour(value: string): void;
  onReset(): void;
}

const SIZE = 240;
const RADIUS = SIZE / 2;
const HUE_STEP = 5;
const SAT_STEP = 0.05;

/** The disc at brightness `v`, one pixel at a time. */
function drawDisc(canvas: HTMLCanvasElement, v: number) {
  const g = canvas.getContext("2d");
  if (!g) return;
  const image = g.createImageData(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = x + 0.5 - RADIUS;
      const dy = y + 0.5 - RADIUS;
      if (Math.hypot(dx, dy) > RADIUS) continue;
      const { h, s } = pointToHueSat(dx, dy, RADIUS);
      const n = Number.parseInt(hsvToHex({ h, s, v }).slice(1), 16);
      const i = (y * SIZE + x) * 4;
      image.data[i] = (n >> 16) & 255;
      image.data[i + 1] = (n >> 8) & 255;
      image.data[i + 2] = n & 255;
      image.data[i + 3] = 255;
    }
  }
  g.putImageData(image, 0, 0);
}

export function Wheel(props: WheelProps) {
  const disc = useRef<HTMLCanvasElement>(null);
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  /** The wheel's own colour: the last one it showed while not held. */
  const own = useRef<Hsv>(hexToHsv(props.current));
  /** The screen's report `own` last followed. */
  const seen = useRef(props.current);
  /** The pointer holding the disc (PD7), the brightness fader's hold (PD6), the held colour. */
  const discHolder = useRef<number | null>(null);
  const faderHeld = useRef(false);
  const drag = useRef<Hsv | null>(null);
  /** The last colour sent until a report shows it, then null: an echo is still to come. */
  const awaiting = useRef<string | null>(null);
  /** The last report looked at, held or not, to clear `awaiting`. */
  const reported = useRef(props.current);
  const send = useRef(props.onColour);
  send.current = props.onColour;
  const throttle = useMemo(
    () =>
      createSendThrottle<string>({
        now: () => performance.now(),
        requestFrame: (fn) => requestAnimationFrame(fn),
        cancelFrame: (id) => cancelAnimationFrame(id),
        send: (value) => {
          awaiting.current = value;
          send.current(value);
        },
      }),
    [],
  );

  if (props.current !== reported.current) {
    reported.current = props.current;
    if (props.current.toLowerCase() === awaiting.current) awaiting.current = null;
  }
  const held = () => discHolder.current !== null || faderHeld.current;
  if (!held() && props.current !== seen.current) {
    own.current = follow(own.current, props.current);
    seen.current = props.current;
  }
  const hsv = held() ? (drag.current ?? own.current) : own.current;

  /**
   * A hold ended. Its last value is the wheel's own; while that value's echo is still to come the
   * next report shows, otherwise the screen's value shows now (another controller may have changed
   * the slot during the hold, AC12).
   */
  const settle = () => {
    if (drag.current) own.current = drag.current;
    drag.current = null;
    if (awaiting.current === null) own.current = follow(own.current, props.current);
    seen.current = props.current;
  };
  /** SD8, AC16: a let-go. Nothing more is sent, and the screen's value shows. */
  const letGoDisc = () => {
    if (discHolder.current === null) return;
    discHolder.current = null;
    throttle.drop();
    drag.current = faderHeld.current ? drag.current : null;
    own.current = follow(own.current, props.current);
    seen.current = props.current;
    redraw();
  };

  useEffect(() => {
    if (props.disabled) {
      letGoDisc();
      own.current = follow(own.current, props.current);
      seen.current = props.current;
      redraw();
    }
  }, [props.disabled]);
  useEffect(() => letGoDisc(), [props.arrangement]);
  useEffect(() => () => throttle.drop(), [throttle]);
  useEffect(() => {
    if (disc.current) drawDisc(disc.current, hsv.v);
  }, [hsv.v]);

  /** A key press: not held, so the new colour is the wheel's own and goes at once. */
  const keyed = (next: Hsv) => {
    own.current = next;
    seen.current = props.current;
    throttle.push(hsvToHex(next));
    throttle.release();
    redraw();
  };

  const fromPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const scale = SIZE / box.width;
    const { h, s } = pointToHueSat(
      (e.clientX - box.left) * scale - RADIUS,
      (e.clientY - box.top) * scale - RADIUS,
      RADIUS,
    );
    drag.current = { ...(drag.current ?? own.current), h, s };
    throttle.push(hsvToHex(drag.current));
    redraw();
  };

  const marker = hueSatToPoint(hsv.h, hsv.s, RADIUS);
  const value = hsvToHex(hsv);

  return (
    <section
      data-testid="wheel"
      data-slot={props.slot}
      aria-label={`Colour ${props.slot + 1}`}
      className={props.disabled ? "djv-colour is-locked" : "djv-colour"}
    >
      <div className="djv-colour-label">
        {props.disabled ? (
          <span data-testid="wheel-locked" className="djv-locked-tag">
            Locked
          </span>
        ) : (
          <h2 data-testid="wheel-label" className="djv-legend">
            {`Colour ${props.slot + 1}${props.primary ? " · primary" : ""}`}
          </h2>
        )}
      </div>
      <div className="djv-disc">
        <canvas
          ref={disc}
          data-testid="wheel-disc"
          width={SIZE}
          height={SIZE}
          tabIndex={0}
          role="application"
          aria-label="Hue and saturation: arrow keys move hue left and right, saturation up and down"
          aria-disabled={props.disabled}
          className="djv-disc-canvas"
          onPointerDown={(e) => {
            if (props.disabled || discHolder.current !== null) return;
            if (e.pointerType === "mouse" && e.button !== 0) return;
            discHolder.current = e.pointerId;
            e.currentTarget.setPointerCapture(e.pointerId);
            fromPointer(e);
          }}
          onPointerMove={(e) => {
            if (discHolder.current === e.pointerId) fromPointer(e);
          }}
          onPointerUp={(e) => {
            if (discHolder.current !== e.pointerId) return;
            discHolder.current = null;
            throttle.release();
            if (!faderHeld.current) settle();
            redraw();
          }}
          onPointerCancel={(e) => {
            if (discHolder.current === e.pointerId) letGoDisc();
          }}
          onBlur={letGoDisc}
          onKeyDown={(e) => {
            if (props.disabled || held()) return;
            const moves: Record<string, Partial<Hsv>> = {
              ArrowLeft: { h: (hsv.h - HUE_STEP + 360) % 360 },
              ArrowRight: { h: (hsv.h + HUE_STEP) % 360 },
              ArrowUp: { s: Math.min(1, hsv.s + SAT_STEP) },
              ArrowDown: { s: Math.max(0, hsv.s - SAT_STEP) },
            };
            const move = moves[e.key];
            if (!move) return;
            e.preventDefault();
            keyed({ ...hsv, ...move });
          }}
        />
        <span
          aria-hidden
          className="djv-marker"
          style={{
            left: `${50 + (marker.x / SIZE) * 100}%`,
            top: `${50 + (marker.y / SIZE) * 100}%`,
          }}
        />
      </div>
      <div className="djv-colour-fader">
        <Fader
          testId="wheel-brightness"
          label="Brightness"
          value={hsv.v}
          disabled={props.disabled}
          orientation="vertical"
          layout={props.arrangement}
          onHold={(on) => {
            if (on) {
              faderHeld.current = true;
            } else if (faderHeld.current) {
              faderHeld.current = false;
              if (discHolder.current === null) settle();
            }
            redraw();
          }}
          onSend={(v) => {
            // From the refs, not the render's `hsv`: the fader sends from an animation frame that
            // can run before a disc move in the same frame has re-rendered, and the render's hue
            // and saturation would undo that move.
            const next = {
              ...(faderHeld.current ? (drag.current ?? own.current) : own.current),
              v,
            };
            if (faderHeld.current) drag.current = next;
            else {
              own.current = next;
              seen.current = props.current;
            }
            // Through the disc's throttle, so a disc value still waiting is replaced, never sent
            // after this one with the old brightness.
            throttle.push(hsvToHex(next));
            throttle.release();
            redraw();
          }}
        />
      </div>
      <div className="djv-colour-info">
        <span className="djv-pair djv-pair-current">
          <span
            data-testid="wheel-current"
            data-colour={props.current}
            role="img"
            aria-label="on screen"
            className="djv-pair-swatch"
            style={{ background: props.current }}
          />
          <span data-testid="wheel-value">{value}</span>
        </span>
        <span className="djv-pair djv-pair-stored">
          <span
            data-testid="wheel-stored"
            data-colour={props.stored}
            aria-hidden
            className="djv-pair-swatch"
            style={{ background: props.stored }}
          />
          stored
        </span>
        <button
          type="button"
          data-testid="wheel-reset"
          disabled={props.disabled}
          className="djv-key djv-colour-reset"
          onClick={() => props.onReset()}
        >
          Reset
        </button>
      </div>
    </section>
  );
}
