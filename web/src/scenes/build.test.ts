// B-07 T7 (SD1, SD18, SD19, AC19, AC26; plan PD8): the scene Save builds from the staged look —
// the base profile with the live palette and strengths baked in, the staged dials, feed and
// transition — valid against the shared schema, a custom effect's code carried untouched.
import { profileSchema, sceneDefinitionSchema, type Profile } from "@djv/shared";
import { describe, expect, it } from "vitest";
import { buildScene } from "./build.ts";
import type { StagedDefinition } from "./staged.ts";

const base: Profile = {
  name: "Warm",
  palette: ["#1a0500", "#c2410c", "#fbbf24"],
  dials: { recognisability: 0.2, reactivity: 0.9 },
  effects: [
    { type: "paletteMap", amount: 1 },
    { type: "flash", amount: 0.5, colourSlot: 2, dj: true },
    {
      type: "custom",
      label: "Glow",
      amount: 0.3,
      abstraction: false,
      params: [{ name: "spread", value: 0.4 }],
      code: "vec4 c = source(uv);\nreturn c * 1.2;",
    },
  ],
  primary: 1,
};

const staged: StagedDefinition = {
  id: "w1",
  name: "Warm",
  stored: base,
  palette: ["#000000", "#ff0000", "#fbbf24"],
  amounts: [1, 0.9, 0.7],
  dials: { recognisability: 0.6, reactivity: 0.4 },
  feed: { kind: "remote", hint: "Chrome on Android" },
  transition: { kind: "dip", duration: 3 },
};

describe("buildScene (PD8)", () => {
  it("bakes the live palette and strengths into the copy and carries dials, feed and transition", () => {
    const scene = buildScene(staged);
    expect(scene).toEqual({
      profile: {
        ...base,
        palette: ["#000000", "#ff0000", "#fbbf24"],
        effects: [
          { type: "paletteMap", amount: 1 },
          { type: "flash", amount: 0.9, colourSlot: 2, dj: true },
          { ...base.effects[2]!, amount: 0.7 },
        ],
      },
      dials: { recognisability: 0.6, reactivity: 0.4 },
      feed: { kind: "remote", hint: "Chrome on Android" },
      transition: { kind: "dip", duration: 3 },
    });
  });

  it("keeps the source profile's name and starting dials in the copy (unused at recall)", () => {
    const { profile } = buildScene(staged);
    expect(profile.name).toBe("Warm");
    expect(profile.dials).toEqual(base.dials);
  });

  it("passes the shared schema, a custom effect included (SD19, AC26)", () => {
    const scene = buildScene(staged);
    expect(sceneDefinitionSchema.parse(scene)).toEqual(scene);
    expect(profileSchema.safeParse(scene.profile).success).toBe(true);
    expect(scene.profile.effects[2]).toEqual({ ...base.effects[2], amount: 0.7 });
  });

  it("leaves the feed out when there is none (SD6)", () => {
    const scene = buildScene({ ...staged, feed: null });
    expect(scene).not.toHaveProperty("feed");
    expect(sceneDefinitionSchema.safeParse(scene).success).toBe(true);
  });

  it("never changes the staged look it was built from", () => {
    const before = structuredClone(staged);
    buildScene(staged);
    expect(staged).toEqual(before);
  });
});
