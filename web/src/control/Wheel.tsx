// The colour block (B-04 spec SD11, AC20, AC21; B-16 SD1, SD2, SD5, SD10, PD8, PD13): a section
// pinned in the controller's grid, never a dialog, with a hue and saturation disc drawn by hand on
// a canvas, the brightness fader standing vertically beside it at the disc's height (the
// controller's own fader, B-19 AC11, B-16 PD9), the label naming the slot, the current colour with
// its hex value, the stored colour and Reset. Touch-drag first, with pointer
// capture; arrow keys move hue (left, right) and saturation (up, down) for a laptop without a
// mouse. While dragging, at most one change per animation frame and always the last position
// (`wheel-math.ts`). It edits the active profile's palette in memory only; nothing is saved.
import { useEffect, useMemo, useRef, useState } from "react";
import { Fader } from "./Fader.tsx";
import {
  createSendThrottle,
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
    <section
      data-testid="wheel"
      data-slot={props.slot}
      aria-label={`Colour ${props.slot + 1}`}
      className="djv-colour"
    >
      <h2 data-testid="wheel-label" className="djv-legend djv-colour-label">
        {`Colour ${props.slot + 1}${props.primary ? " · primary" : ""}`}
      </h2>
      <div className="djv-disc">
        <canvas
          ref={disc}
          data-testid="wheel-disc"
          width={SIZE}
          height={SIZE}
          tabIndex={0}
          role="application"
          aria-label="Hue and saturation: arrow keys move hue left and right, saturation up and down"
          className="djv-disc-canvas"
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
          onSend={(v) => change({ ...hsv, v }, true)}
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
          onClick={() => {
            setHsv(hexToHsv(props.stored));
            props.onReset();
          }}
        >
          Reset
        </button>
      </div>
    </section>
  );
}
