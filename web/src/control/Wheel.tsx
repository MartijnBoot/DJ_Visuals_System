// The colour wheel (B-04 spec SD11, AC20, AC21, AC23, UI "Colour wheel"): a modal over the
// controller with a hue and saturation disc drawn by hand on a canvas, a brightness slider, the
// current and the stored colour side by side, Reset and Done. Touch-drag first, with pointer
// capture; arrow keys move hue (left, right) and saturation (up, down) for a laptop without a
// mouse. While dragging, at most one change per animation frame and always the last position
// (`wheel-math.ts`). It edits the active profile's palette in memory only; nothing is saved.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createSendThrottle,
  hexToHsv,
  hsvToHex,
  hueSatToPoint,
  pointToHueSat,
  type Hsv,
} from "./wheel-math.ts";
import { styles } from "./styles.ts";

export interface WheelProps {
  slot: number;
  /** The colour on screen now (the live palette). */
  current: string;
  /** The profile's stored colour for the slot. */
  stored: string;
  disabled: boolean;
  onColour(value: string): void;
  onReset(): void;
  onDone(): void;
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

const swatch = (colour: string) =>
  ({
    width: 56,
    height: 56,
    borderRadius: 8,
    border: "2px solid #fff",
    background: colour,
  }) as const;

export function Wheel(props: WheelProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const disc = useRef<HTMLCanvasElement>(null);
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(props.current));
  const send = useRef(props.onColour);
  send.current = props.onColour;
  const throttle = useMemo(
    () =>
      createSendThrottle<string>({
        now: () => performance.now(),
        requestFrame: (fn) => requestAnimationFrame(fn),
        cancelFrame: (id) => cancelAnimationFrame(id),
        send: (value) => send.current(value),
      }),
    [],
  );

  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    if (disc.current) drawDisc(disc.current, hsv.v);
  }, [hsv.v]);

  const change = (next: Hsv, settle: boolean) => {
    setHsv(next);
    throttle.push(hsvToHex(next));
    if (settle) throttle.release();
  };

  const fromPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const scale = SIZE / box.width;
    const { h, s } = pointToHueSat(
      (e.clientX - box.left) * scale - RADIUS,
      (e.clientY - box.top) * scale - RADIUS,
      RADIUS,
    );
    change({ ...hsv, h, s }, false);
  };

  const marker = hueSatToPoint(hsv.h, hsv.s, RADIUS);
  const value = hsvToHex(hsv);

  return (
    <dialog
      ref={dialog}
      data-testid="wheel"
      data-slot={props.slot}
      aria-label={`Colour ${props.slot + 1}`}
      style={styles.dialog}
      onClose={props.onDone}
    >
      <div style={{ display: "grid", gap: 12, justifyItems: "center" }}>
        <div style={{ position: "relative", width: "min(240px, 70vw)", aspectRatio: "1" }}>
          <canvas
            ref={disc}
            data-testid="wheel-disc"
            width={SIZE}
            height={SIZE}
            tabIndex={0}
            role="application"
            aria-label="Hue and saturation: arrow keys move hue left and right, saturation up and down"
            style={{ width: "100%", height: "100%", touchAction: "none", borderRadius: "50%" }}
            onPointerDown={(e) => {
              if (props.disabled) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              fromPointer(e);
            }}
            onPointerMove={(e) => {
              if (!props.disabled && e.currentTarget.hasPointerCapture(e.pointerId)) fromPointer(e);
            }}
            onPointerUp={() => throttle.release()}
            onPointerCancel={() => throttle.release()}
            onKeyDown={(e) => {
              if (props.disabled) return;
              const moves: Record<string, Partial<Hsv>> = {
                ArrowLeft: { h: (hsv.h - HUE_STEP + 360) % 360 },
                ArrowRight: { h: (hsv.h + HUE_STEP) % 360 },
                ArrowUp: { s: Math.min(1, hsv.s + SAT_STEP) },
                ArrowDown: { s: Math.max(0, hsv.s - SAT_STEP) },
              };
              const move = moves[e.key];
              if (!move) return;
              e.preventDefault();
              change({ ...hsv, ...move }, true);
            }}
          />
          <span
            aria-hidden
            style={{
              position: "absolute",
              left: `${50 + (marker.x / SIZE) * 100}%`,
              top: `${50 + (marker.y / SIZE) * 100}%`,
              width: 16,
              height: 16,
              margin: -8,
              borderRadius: "50%",
              border: "2px solid #fff",
              boxShadow: "0 0 0 2px #000",
              pointerEvents: "none",
            }}
          />
        </div>
        <label style={{ display: "grid", gap: 4, width: "100%" }}>
          Brightness
          <input
            type="range"
            data-testid="wheel-brightness"
            min={0}
            max={1}
            step={0.01}
            disabled={props.disabled}
            value={hsv.v}
            style={styles.slider}
            onChange={(e) => change({ ...hsv, v: Number(e.target.value) }, false)}
            onPointerUp={() => throttle.release()}
            onKeyUp={() => throttle.release()}
            onBlur={() => throttle.release()}
          />
        </label>
        <div style={styles.row}>
          <span style={{ display: "grid", gap: 4, justifyItems: "center" }}>
            <span
              data-testid="wheel-current"
              data-colour={props.current}
              style={swatch(props.current)}
            />
            on screen
          </span>
          <span style={{ display: "grid", gap: 4, justifyItems: "center" }}>
            <span
              data-testid="wheel-stored"
              data-colour={props.stored}
              style={swatch(props.stored)}
            />
            stored
          </span>
          <span data-testid="wheel-value" style={styles.note}>
            {value}
          </span>
        </div>
        <div style={styles.row}>
          <button
            type="button"
            data-testid="wheel-reset"
            disabled={props.disabled}
            style={styles.button}
            onClick={() => {
              setHsv(hexToHsv(props.stored));
              props.onReset();
            }}
          >
            Reset
          </button>
          <button
            type="button"
            data-testid="wheel-done"
            style={styles.active}
            onClick={() => dialog.current?.close()}
          >
            Done
          </button>
        </div>
      </div>
    </dialog>
  );
}
