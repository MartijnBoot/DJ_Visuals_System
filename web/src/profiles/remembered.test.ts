// T8 (B-02 plan PD9): the remembered profile id, a plain string that never throws.
import { describe, expect, it } from "vitest";
import { loadProfileId, PROFILE_KEY, saveProfileId } from "./remembered.ts";

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  };
}

const throwing = {
  getItem: () => {
    throw new Error("storage disabled");
  },
  setItem: () => {
    throw new Error("quota exceeded");
  },
};

describe("the remembered profile id", () => {
  it("round-trips under djv.profile", () => {
    const storage = memory();
    saveProfileId("3f2c", storage);
    expect(storage.data.get("djv.profile")).toBe("3f2c");
    expect(PROFILE_KEY).toBe("djv.profile");
    expect(loadProfileId(storage)).toBe("3f2c");
  });

  it("reads nothing, an empty string and a missing key as none", () => {
    expect(loadProfileId(memory())).toBeNull();
    expect(loadProfileId(memory({ "djv.profile": "" }))).toBeNull();
  });

  it("reads a throwing storage as none, and saving never throws", () => {
    expect(loadProfileId(throwing)).toBeNull();
    expect(() => saveProfileId("x", throwing)).not.toThrow();
  });
});
