// T12 (B-06 spec SD9, SD12, SD19, AC16, AC22, AC23; plan PD7, PD8, PD14, PD17): which camera the
// picture wants, which one it shows, and which senders must stream, against a clock the test moves.
import { describe, expect, it } from "vitest";
import { createPicture, FALLBACK_MS, RETURN_MS } from "./picture.ts";

const LOCAL = "cam-1";
const A = "remote:dA";
const B = "remote:dB";
const T = 10_000;
const always = () => true;

function make(local: string | null = LOCAL) {
  const picture = createPicture();
  picture.setLocal(local);
  return picture;
}

describe("wanted (SD9, AC22, PD8)", () => {
  it("is the local camera before any pick, and null without one", () => {
    expect(make().wanted(T)).toBe(LOCAL);
    expect(make(null).wanted(T)).toBeNull();
  });

  it("is the picked remote camera", () => {
    const p = make();
    p.pick(A);
    expect(p.wanted(T)).toBe(A);
  });

  it("lost for 999 ms is still the remote; at 1 000 ms the local one", () => {
    const p = make();
    p.pick(A);
    p.lost(A, T);
    expect(p.wanted(T + FALLBACK_MS - 1)).toBe(A);
    expect(p.wanted(T + FALLBACK_MS)).toBe(LOCAL);
    expect(FALLBACK_MS).toBe(1000);
  });

  it("a loss shorter than a second never leaves the remote", () => {
    const p = make();
    p.pick(A);
    p.lost(A, T);
    p.back(A, T + 500);
    expect(p.wanted(T + 600)).toBe(A);
    expect(p.wanted(T + 10_000)).toBe(A);
  });

  it("returns to the remote after 3 000 ms back and steady", () => {
    const p = make();
    p.pick(A);
    p.lost(A, T);
    expect(p.wanted(T + 2000)).toBe(LOCAL);
    p.back(A, T + 5000);
    expect(p.wanted(T + 5000 + RETURN_MS - 1)).toBe(LOCAL);
    expect(p.wanted(T + 5000 + RETURN_MS)).toBe(A);
    expect(RETURN_MS).toBe(3000);
  });

  it("a loss inside the 3 s starts them over", () => {
    const p = make();
    p.pick(A);
    p.lost(A, T);
    p.tick(T + 1000);
    p.back(A, T + 2000);
    p.lost(A, T + 4000);
    p.back(A, T + 4500);
    expect(p.wanted(T + 2000 + RETURN_MS)).toBe(LOCAL);
    expect(p.wanted(T + 4500 + RETURN_MS)).toBe(A);
  });

  it("a pick during the wait stands when the remote returns (AC23)", () => {
    const p = make();
    p.pick(A);
    p.lost(A, T);
    p.tick(T + FALLBACK_MS);
    p.pick(B);
    p.back(A, T + 2000);
    expect(p.wanted(T + 60_000)).toBe(B);
  });

  it("a picked local camera during the wait stands too", () => {
    const p = make();
    p.pick(A);
    p.lost(A, T);
    p.tick(T + FALLBACK_MS);
    p.pick("cam-2");
    p.setLocal("cam-2");
    p.back(A, T + 2000);
    expect(p.wanted(T + 60_000)).toBe("cam-2");
  });

  it("falls back with no local camera to null, the no-camera look", () => {
    const p = make(null);
    p.pick(A);
    p.lost(A, T);
    expect(p.wanted(T + FALLBACK_MS)).toBeNull();
  });

  it("a gone remote camera falls back and never returns (PD17)", () => {
    const p = make();
    p.pick(A);
    p.gone(A);
    expect(p.wanted(T)).toBe(LOCAL);
    p.back(A, T);
    expect(p.wanted(T + 60_000)).toBe(LOCAL);
  });
});

describe("shown (AC16, PD14)", () => {
  it("moves to the wanted camera only once it has a frame", () => {
    const p = make();
    expect(p.shown(T, always)).toBe(LOCAL);
    p.pick(A);
    const ready = new Set<string>();
    expect(p.shown(T, (id) => ready.has(id))).toBe(LOCAL);
    expect(p.shown(T + 500, (id) => ready.has(id))).toBe(LOCAL);
    ready.add(A);
    expect(p.shown(T + 600, (id) => ready.has(id))).toBe(A);
  });

  it("never returns a camera ready calls false while another is shown", () => {
    const p = make();
    p.shown(T, always);
    const seen: (string | null)[] = [];
    p.pick(A);
    for (let t = T; t < T + 1000; t += 100) seen.push(p.shown(t, (id) => id !== A));
    p.pick(B);
    for (let t = T + 1000; t < T + 2000; t += 100) seen.push(p.shown(t, (id) => id !== B));
    expect(new Set(seen)).toEqual(new Set([LOCAL]));
  });

  it("with nothing shown yet, shows nothing until the camera is ready", () => {
    const p = make();
    expect(p.shown(T, () => false)).toBeNull();
    expect(p.shown(T + 100, always)).toBe(LOCAL);
  });

  it("goes to the no-camera look at once when nothing is wanted", () => {
    const p = make();
    p.shown(T, always);
    p.setLocal(null);
    expect(p.shown(T + 1, () => false)).toBeNull();
  });

  it("the fallback is shown once the remote has been lost a second", () => {
    const p = make();
    p.pick(A);
    p.shown(T, always);
    p.lost(A, T);
    expect(p.shown(T + 999, always)).toBe(A);
    expect(p.shown(T + 1000, always)).toBe(LOCAL);
  });
});

describe("active (SD12, PD7)", () => {
  it("is empty with only the local camera", () => {
    const p = make();
    p.shown(T, always);
    expect(p.active()).toEqual([]);
  });

  it("remote A → remote B: holds both until B is shown, then B alone", () => {
    const p = make();
    p.pick(A);
    p.shown(T, always);
    expect(p.active()).toEqual(["dA"]);
    p.pick(B);
    p.shown(T + 100, (id) => id !== B);
    expect([...p.active()].sort()).toEqual(["dA", "dB"]);
    p.shown(T + 200, always);
    expect(p.active()).toEqual(["dB"]);
  });

  it("a lost picked camera waiting to return keeps streaming", () => {
    const p = make();
    p.pick(A);
    p.shown(T, always);
    p.lost(A, T);
    p.shown(T + FALLBACK_MS, always);
    expect(p.active()).toEqual(["dA"]);
    p.pick(LOCAL);
    p.shown(T + 2000, always);
    expect(p.active()).toEqual([]);
  });

  it("a gone camera is never active", () => {
    const p = make();
    p.pick(A);
    p.shown(T, always);
    p.gone(A);
    p.shown(T + 1, always);
    expect(p.active()).toEqual([]);
  });
});
