// The colour wheel's maths (B-04 spec SD11, AC20; plan PD14): HSV and `#rrggbb` both ways, a point
// on the disc to hue and saturation and back (hue 0 at the right, turning clockwise on screen,
// saturation by distance from the centre), and the send throttle: while dragging, at most one
// change per animation frame and at least 16 ms apart — well inside the device socket's 120
// messages a second on a 120 Hz display — and always the last position on release.

export interface Hsv {
  /** 0 to 360. */
  h: number;
  /** 0 to 1. */
  s: number;
  /** 0 to 1. */
  v: number;
}

export const MIN_GAP_MS = 16;

export function hexToHsv(hex: string): Hsv {
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255) as [
    number,
    number,
    number,
  ];
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  let h = 0;
  if (delta > 0) {
    if (max === r) h = 60 * (((g - b) / delta + 6) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
  }
  return { h, s: max === 0 ? 0 : delta / max, v: max };
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const hue = ((h % 360) + 360) % 360;
  const f = (k: number) => {
    const p = (k + hue / 60) % 6;
    return v - v * s * Math.max(0, Math.min(p, 4 - p, 1));
  };
  return `#${[f(5), f(3), f(1)]
    .map((c) =>
      Math.round(Math.min(1, Math.max(0, c)) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/** `x`, `y` relative to the disc's centre, in the same units as `radius`. */
export function pointToHueSat(x: number, y: number, radius: number): { h: number; s: number } {
  const distance = Math.hypot(x, y);
  if (distance === 0) return { h: 0, s: 0 };
  const h = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return { h, s: Math.min(1, distance / radius) };
}

export function hueSatToPoint(h: number, s: number, radius: number): { x: number; y: number } {
  const angle = (h * Math.PI) / 180;
  return { x: Math.cos(angle) * s * radius, y: Math.sin(angle) * s * radius };
}

export interface ThrottleDeps<T> {
  now(): number;
  requestFrame(fn: () => void): number;
  cancelFrame(id: number): void;
  send(value: T): void;
}

export interface SendThrottle<T> {
  /** A new position while dragging. */
  push(value: T): void;
  /** The drag ended: the last position goes now. */
  release(): void;
}

export function createSendThrottle<T>(deps: ThrottleDeps<T>): SendThrottle<T> {
  let pending: { value: T } | null = null;
  let frame: number | null = null;
  let lastSent = -Infinity;

  const flush = () => {
    if (!pending) return;
    deps.send(pending.value);
    pending = null;
    lastSent = deps.now();
  };

  const onFrame = () => {
    frame = null;
    if (!pending) return;
    if (deps.now() - lastSent >= MIN_GAP_MS) flush();
    else frame = deps.requestFrame(onFrame);
  };

  return {
    push(value) {
      pending = { value };
      if (frame === null) frame = deps.requestFrame(onFrame);
    },
    release() {
      if (frame !== null) deps.cancelFrame(frame);
      frame = null;
      flush();
    },
  };
}
