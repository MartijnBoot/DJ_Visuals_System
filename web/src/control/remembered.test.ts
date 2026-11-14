// B-04 (spec, Data): what External control keeps in browser storage.
import { describe, expect, it } from "vitest";
import { KEY_KEY, keyStore } from "./remembered.ts";

function memory() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

const broken = {
  getItem: () => {
    throw new Error("disabled");
  },
  setItem: () => {
    throw new Error("full");
  },
  removeItem: () => {
    throw new Error("disabled");
  },
};

describe("the session key (djv.controlKey)", () => {
  it("saves, loads and clears under its key", () => {
    const storage = memory();
    const keys = keyStore(storage);
    expect(keys.load()).toBeNull();
    keys.save("AAAAAAAAAAAAAAAAAAAAAA");
    expect(storage.map.get(KEY_KEY)).toBe("AAAAAAAAAAAAAAAAAAAAAA");
    expect(keys.load()).toBe("AAAAAAAAAAAAAAAAAAAAAA");
    keys.clear();
    expect(keys.load()).toBeNull();
  });

  it("never throws when storage is unavailable", () => {
    const keys = keyStore(broken);
    expect(keys.load()).toBeNull();
    expect(() => keys.save("x")).not.toThrow();
    expect(() => keys.clear()).not.toThrow();
  });
});
