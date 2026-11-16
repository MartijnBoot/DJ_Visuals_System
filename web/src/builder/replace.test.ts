// B-03 T12 (spec AC17, AC19, SD10; plan PD11): which stored profile a one-profile import replaces.
import type { Profile, ProfileFile, StoredProfile } from "@djv/shared";
import { describe, expect, it } from "vitest";
import { BUILTIN_ID } from "../profiles/builtin.ts";
import { replaceTarget } from "./replace.ts";

const definition = (name: string): Profile => ({
  name,
  palette: ["#000000", "#ffffff"],
  dials: { recognisability: 0.5, reactivity: 0.5 },
  effects: [],
});

const stored = (id: string, name: string): StoredProfile => ({
  ...definition(name),
  id,
  revision: 3,
  createdAt: "2026-11-15T10:00:00.000Z",
  updatedAt: "2026-11-15T10:00:00.000Z",
});

const file = (...names: string[]): ProfileFile => ({
  formatVersion: 1,
  profiles: names.map(definition),
});

const list = [stored("a", "Starry Night"), stored("b", "Warm")];

describe("replaceTarget (PD11)", () => {
  it("finds the stored profile of the same name, trimmed and in any case", () => {
    expect(replaceTarget(file("Starry Night"), list)?.id).toBe("a");
    expect(replaceTarget(file("  starry NIGHT "), list)?.id).toBe("a");
  });

  it("finds nothing for a free name", () => {
    expect(replaceTarget(file("Cool"), list)).toBeNull();
  });

  it("never offers the built-in", () => {
    const withBuiltin = [{ ...stored(BUILTIN_ID, "Built-in") }, ...list];
    expect(replaceTarget(file("Built-in"), withBuiltin)).toBeNull();
  });

  it("finds nothing for a file of two profiles, even when a name is taken", () => {
    expect(replaceTarget(file("Starry Night", "Other"), list)).toBeNull();
  });
});
