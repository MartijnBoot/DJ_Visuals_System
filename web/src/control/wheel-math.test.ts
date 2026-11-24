// T13 (B-04 spec SD11, AC20; plan PD14): the colour wheel's maths, without a browser.
import { describe, expect, it, vi } from "vitest";
import {
  createSendThrottle,
  follow,
  hexToHsv,
  hsvToHex,
  hueSatToPoint,
  pointToHueSat,
  MIN_GAP_MS,
} from "./wheel-math.ts";

describe("HSV and #rrggbb", () => {
  it.each([
    ["#ff0000", { h: 0, s: 1, v: 1 }],
    ["#00ff00", { h: 120, s: 1, v: 1 }],
    ["#0000ff", { h: 240, s: 1, v: 1 }],
    ["#ffffff", { h: 0, s: 0, v: 1 }],
    ["#000000", { h: 0, s: 0, v: 0 }],
    ["#808080", { h: 0, s: 0, v: 128 / 255 }],
  ])("%s ↔ %o", (hex, hsv) => {
    const got = hexToHsv(hex);
    expect(got.h).toBeCloseTo(hsv.h, 5);
    expect(got.s).toBeCloseTo(hsv.s, 5);
    expect(got.v).toBeCloseTo(hsv.v, 5);
    expect(hsvToHex(hsv)).toBe(hex);
  });

  it("round-trips every colour on a coarse grid exactly", () => {
    for (let r = 0; r < 256; r += 17) {
      for (let g = 0; g < 256; g += 51) {
        for (let b = 0; b < 256; b += 85) {
          const hex = `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
          expect(hsvToHex(hexToHsv(hex))).toBe(hex);
        }
      }
    }
  });

  it("reads upper case and wraps the hue", () => {
    expect(hexToHsv("#FF8800")).toEqual(hexToHsv("#ff8800"));
    expect(hsvToHex({ h: 360, s: 1, v: 1 })).toBe("#ff0000");
    expect(hsvToHex({ h: -120, s: 1, v: 1 })).toBe("#0000ff");
  });
});

describe("the disc", () => {
  it("puts hue 0 at the right, 90 at the bottom, saturation by distance from the centre", () => {
    expect(pointToHueSat(100, 0, 100)).toEqual({ h: 0, s: 1 });
    const bottom = pointToHueSat(0, 50, 100);
    expect(bottom.h).toBeCloseTo(90, 5);
    expect(bottom.s).toBeCloseTo(0.5, 5);
    expect(pointToHueSat(-100, 0, 100).h).toBeCloseTo(180, 5);
    expect(pointToHueSat(0, -100, 100).h).toBeCloseTo(270, 5);
  });

  it("clamps a point outside the disc to its edge, and the centre to no saturation", () => {
    expect(pointToHueSat(300, 0, 100)).toEqual({ h: 0, s: 1 });
    expect(pointToHueSat(0, 0, 100)).toEqual({ h: 0, s: 0 });
  });

  it("maps hue and saturation back to the point", () => {
    const { x, y } = hueSatToPoint(90, 0.5, 100);
    expect(x).toBeCloseTo(0, 5);
    expect(y).toBeCloseTo(50, 5);
  });
});

describe("the send throttle (PD14, SD11)", () => {
  function rig() {
    let clock = 0;
    let frames: (() => void)[] = [];
    const sent: { value: string; at: number }[] = [];
    const throttle = createSendThrottle<string>({
      now: () => clock,
      requestFrame: (fn) => {
        frames.push(fn);
        return frames.length;
      },
      cancelFrame: () => {
        frames = [];
      },
      send: (value) => sent.push({ value, at: clock }),
    });
    /** One animation frame `ms` after the last. */
    const frame = (ms: number) => {
      clock += ms;
      const due = frames;
      frames = [];
      due.forEach((f) => f());
    };
    return { throttle, frame, sent };
  }

  it("sends at most one change per frame: the newest of that frame", () => {
    const { throttle, frame, sent } = rig();
    throttle.push("a");
    throttle.push("b");
    throttle.push("c");
    frame(16);
    expect(sent.map((s) => s.value)).toEqual(["c"]);
    frame(16);
    expect(sent).toHaveLength(1); // nothing new, nothing sent
  });

  it("keeps sends at least 16 ms apart on a 120 Hz display", () => {
    const { throttle, frame, sent } = rig();
    for (let i = 0; i < 24; i++) {
      throttle.push(String(i));
      frame(8.33);
    }
    const gaps = sent.slice(1).map((s, i) => s.at - sent[i]!.at);
    expect(gaps.every((g) => g >= MIN_GAP_MS)).toBe(true);
    expect(sent.length).toBeLessThanOrEqual(13);
    expect(sent.length).toBeGreaterThanOrEqual(10);
  });

  it("always sends the last position on release, at once", () => {
    const { throttle, frame, sent } = rig();
    throttle.push("a");
    frame(16);
    throttle.push("b");
    throttle.push("last");
    throttle.release();
    expect(sent.map((s) => s.value)).toEqual(["a", "last"]);
    frame(16);
    expect(sent).toHaveLength(2);
  });

  it("drop() cancels the frame and forgets the pending value: nothing is sent", () => {
    const { throttle, frame, sent } = rig();
    throttle.push("a");
    frame(16);
    throttle.push("b");
    throttle.drop();
    frame(16);
    throttle.release();
    frame(16);
    expect(sent.map((s) => s.value)).toEqual(["a"]);
    // The throttle still works after a drop.
    throttle.push("c");
    frame(16);
    expect(sent.map((s) => s.value)).toEqual(["a", "c"]);
  });

  it("minGapMs sets the gap between sends; the default stays 16 ms", () => {
    let clock = 0;
    let frames: (() => void)[] = [];
    const sent: number[] = [];
    const throttle = createSendThrottle<string>({
      now: () => clock,
      requestFrame: (fn) => frames.push(fn),
      cancelFrame: () => void (frames = []),
      send: () => sent.push(clock),
      minGapMs: 20,
    });
    for (let i = 0; i < 120; i++) {
      throttle.push(String(i));
      clock += 1000 / 120;
      const due = frames;
      frames = [];
      due.forEach((f) => f());
    }
    const gaps = sent.slice(1).map((at, i) => at - sent[i]!);
    expect(gaps.every((g) => g >= 20)).toBe(true);
    expect(sent.length).toBeLessThanOrEqual(50);
    expect(MIN_GAP_MS).toBe(16);
  });

  it("sends nothing on a release with nothing pending", () => {
    const { throttle, sent } = rig();
    throttle.release();
    expect(sent).toEqual([]);
    const send = vi.fn();
    const quiet = createSendThrottle<string>({
      now: () => 0,
      requestFrame: () => 1,
      cancelFrame: () => {},
      send,
    });
    quiet.release();
    expect(send).not.toHaveBeenCalled();
  });
});

describe("follow: the screen's colour unless ours already makes it (B-16 SD7, PD6)", () => {
  it("keeps hue and saturation at black when the screen shows black", () => {
    const ours = { h: 200, s: 0.7, v: 0 };
    expect(follow(ours, "#000000")).toBe(ours);
  });

  it("keeps hue at grey (saturation 0) when the screen shows that grey", () => {
    const ours = { h: 120, s: 0, v: 0.5 };
    expect(follow(ours, hsvToHex(ours))).toBe(ours);
  });

  it("keeps ours on an exact match", () => {
    const ours = { h: 30, s: 0.5, v: 0.8 };
    expect(follow(ours, hsvToHex(ours))).toBe(ours);
  });

  it("adopts the screen's colour when it differs", () => {
    const ours = { h: 200, s: 0.7, v: 0 };
    expect(follow(ours, "#ff0000")).toEqual(hexToHsv("#ff0000"));
  });

  it("ignores case", () => {
    const ours = { h: 30, s: 0.5, v: 0.8 };
    expect(follow(ours, hsvToHex(ours).toUpperCase())).toBe(ours);
  });
});
