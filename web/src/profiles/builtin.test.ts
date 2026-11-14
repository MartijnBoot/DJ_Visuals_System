// T8 (B-02 plan PD8, PD9): the engine's built-in parses with the shared schema, and is listed
// under the reserved id.
import { BUILT_IN_PROFILE } from "@djv/engine";
import { profileSchema, storedProfileSchema } from "@djv/shared";
import { describe, expect, it } from "vitest";
import { BUILTIN_ID, builtinEntry } from "./builtin.ts";

describe("the built-in profile", () => {
  it("parses with the shared schema, equal to the engine's", () => {
    const parsed = profileSchema.parse(BUILT_IN_PROFILE);
    expect(parsed).toEqual(BUILT_IN_PROFILE);
  });

  it("is listed first-class under the reserved id, as an unfrozen copy", () => {
    const entry = builtinEntry();
    expect(entry.id).toBe(BUILTIN_ID);
    expect(entry.name).toBe("Built-in");
    expect(storedProfileSchema.safeParse(entry).success).toBe(true);
    expect(Object.isFrozen(entry.effects)).toBe(false);
    entry.palette.push("#123456");
    expect(BUILT_IN_PROFILE.palette).toHaveLength(2);
  });
});
