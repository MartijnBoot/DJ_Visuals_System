// T6 (spec SD6, AC5; plan PD10): the remembered device ids under one localStorage key.
import { describe, expect, it } from "vitest";
import { loadRemembered, REMEMBERED_KEY, saveRemembered } from "./remembered.ts";

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    map,
  };
}

describe("remembered sources (AC5, PD10)", () => {
  it("is empty when nothing is stored", () => {
    expect(loadRemembered(memoryStorage())).toEqual({});
  });

  it("round-trips a camera id and an audio input", () => {
    const storage = memoryStorage();
    saveRemembered({ cameraId: "cam-2" }, storage);
    saveRemembered({ audio: { kind: "input", deviceId: "mic-2" } }, storage);
    expect(loadRemembered(storage)).toEqual({
      cameraId: "cam-2",
      audio: { kind: "input", deviceId: "mic-2" },
    });
    expect(JSON.parse(storage.map.get(REMEMBERED_KEY)!)).toEqual(loadRemembered(storage));
  });

  it("round-trips system audio", () => {
    const storage = memoryStorage();
    saveRemembered({ audio: { kind: "system" } }, storage);
    expect(loadRemembered(storage)).toEqual({ audio: { kind: "system" } });
  });

  it("uses the key djv.sources", () => {
    expect(REMEMBERED_KEY).toBe("djv.sources");
  });

  it.each([
    ["not JSON", "{oops"],
    ["a number", "42"],
    ["null", "null"],
    ["an array", "[1]"],
    ["a numeric camera id", JSON.stringify({ cameraId: 3 })],
    ["an unknown audio kind", JSON.stringify({ audio: { kind: "radio" } })],
    ["an input without an id", JSON.stringify({ audio: { kind: "input" } })],
  ])("reads garbage (%s) as empty", (_name, raw) => {
    expect(loadRemembered(memoryStorage({ [REMEMBERED_KEY]: raw }))).toEqual({});
  });

  it("never throws when storage does", () => {
    const broken = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(loadRemembered(broken)).toEqual({});
    expect(() => saveRemembered({ cameraId: "x" }, broken)).not.toThrow();
  });
});
