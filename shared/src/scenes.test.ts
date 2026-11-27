// B-07 T2 (SD1, SD8, SD19, AC20): the scene, its feed, its transition and the bundle file.
import { describe, expect, it } from "vitest";
import { issuesFrom } from "./profile-api.ts";
import type { Profile } from "./profile.ts";
import {
  SCENE_LIMITS,
  sceneDefinitionSchema,
  sceneFileSchema,
  sceneNameAt,
  sceneNameSchema,
  storedSceneSchema,
  toSceneFile,
  type SceneDefinition,
} from "./scenes.ts";

const profile: Profile = {
  name: "Warm",
  palette: ["#1a0500", "#c2410c", "#fbbf24"],
  dials: { recognisability: 0.2, reactivity: 0.9 },
  effects: [
    { type: "paletteMap", amount: 1 },
    { type: "flash", amount: 0.4, colourSlot: 2, vj: true },
    {
      type: "custom",
      label: "Glow",
      amount: 0.5,
      abstraction: false,
      params: [],
      code: "return colour;",
    },
  ],
};

const scene: SceneDefinition = {
  profile,
  dials: { recognisability: 0.4, reactivity: 0.6 },
  feed: { kind: "local", deviceId: "cam-1", label: "Logitech C920" },
  transition: { kind: "crossfade", duration: 2 },
};

const pathsOf = (value: unknown) => {
  const parsed = sceneDefinitionSchema.safeParse(value);
  return parsed.success ? [] : issuesFrom(parsed.error).map((issue) => issue.path);
};

describe("sceneDefinitionSchema", () => {
  it("parses a full scene, a remote feed and a scene with no feed", () => {
    expect(sceneDefinitionSchema.parse(scene)).toEqual(scene);
    const remote = { ...scene, feed: { kind: "remote", hint: "Chrome on Android" } };
    expect(sceneDefinitionSchema.parse(remote)).toEqual(remote);
    const { feed: _feed, ...noFeed } = scene;
    expect(sceneDefinitionSchema.parse(noFeed)).toEqual(noFeed);
  });

  it("refuses a missing dials, an extra key and a feed of an unknown kind, with their path", () => {
    const { dials: _dials, ...noDials } = scene;
    expect(pathsOf(noDials)).toEqual(["dials"]);
    expect(pathsOf({ ...scene, quality: 1 })).toEqual([""]);
    expect(pathsOf({ ...scene, feed: { kind: "none" } })).toEqual(["feed.kind"]);
  });

  it("refuses a transition outside B-09's kinds and durations", () => {
    expect(pathsOf({ ...scene, transition: { kind: "spin", duration: 2 } })).toEqual([
      "transition.kind",
    ]);
    expect(pathsOf({ ...scene, transition: { kind: "cut", duration: 9 } })).toEqual([
      "transition.duration",
    ]);
    expect(
      pathsOf({ ...scene, transition: { kind: "cut", duration: 1, keepColour: true } }),
    ).toEqual(["transition"]);
  });

  it("refuses a custom effect with invalid code through the profile schema (SD19)", () => {
    const bad = {
      ...scene,
      profile: {
        ...profile,
        effects: [{ ...profile.effects[2]!, code: "#define x 1\nreturn colour;" }],
      },
    };
    expect(pathsOf(bad)).toEqual(["profile.effects.0.code"]);
  });
});

describe("sceneNameSchema", () => {
  it("trims, and takes 1 to 60 characters", () => {
    expect(sceneNameSchema.parse("  Warm crowd ")).toBe("Warm crowd");
    expect(sceneNameSchema.safeParse("   ").success).toBe(false);
    expect(sceneNameSchema.safeParse("x".repeat(60)).success).toBe(true);
    expect(sceneNameSchema.safeParse("x".repeat(61)).success).toBe(false);
  });
});

describe("storedSceneSchema", () => {
  it("is the definition with an id, a name and its times", () => {
    const stored = {
      id: "s-1",
      name: "Warm crowd",
      definition: scene,
      createdAt: "2026-11-26T10:00:00.000Z",
      updatedAt: "2026-11-26T10:00:00.000Z",
    };
    expect(storedSceneSchema.parse(stored)).toEqual(stored);
  });
});

describe("the scenes file (SD8)", () => {
  it("round trips through toSceneFile", () => {
    const file = toSceneFile([
      { name: "Warm crowd", definition: scene },
      { name: "Booth", definition: { ...scene, feed: undefined } },
    ]);
    expect(file.formatVersion).toBe(1);
    expect(file.scenes[0]).toEqual({ name: "Warm crowd", ...scene });
    expect(file.scenes[1]).not.toHaveProperty("feed");
    expect(sceneFileSchema.parse(JSON.parse(JSON.stringify(file)))).toEqual(file);
  });

  it("writes each profile as a profile file entry: a fader flag only when on", () => {
    const off = {
      ...scene,
      profile: { ...profile, effects: [{ type: "paletteMap" as const, amount: 1, dj: false }] },
    };
    const [entry] = toSceneFile([{ name: "A", definition: off }]).scenes;
    expect(entry!.profile.effects[0]).toEqual({ type: "paletteMap", amount: 1 });
  });

  it("holds 1 to 200 scenes, and names the scene an issue points into", () => {
    expect(sceneFileSchema.safeParse({ formatVersion: 1, scenes: [] }).success).toBe(false);
    const many = Array.from({ length: SCENE_LIMITS.scenes + 1 }, (_, i) => ({
      name: `S${i}`,
      ...scene,
    }));
    expect(sceneFileSchema.safeParse({ formatVersion: 1, scenes: many }).success).toBe(false);
    expect(sceneFileSchema.safeParse({ formatVersion: 2, scenes: [many[0]] }).success).toBe(false);

    const file = {
      formatVersion: 1,
      scenes: [
        { name: "Good", ...scene },
        { name: "Bad", ...scene, dials: {} },
      ],
    };
    const parsed = sceneFileSchema.safeParse(file);
    expect(parsed.success).toBe(false);
    const [issue] = issuesFrom(parsed.error!);
    expect(issue!.path).toBe("scenes.1.dials.recognisability");
    expect(sceneNameAt(issue!.path, file)).toBe("Bad");
    expect(sceneNameAt("formatVersion", file)).toBeUndefined();
    expect(sceneNameAt("scenes.5.name", file)).toBeUndefined();
  });

  it("states the limits SD18 fixes", () => {
    expect(SCENE_LIMITS).toEqual({ scenes: 200, definitionBytes: 131072 });
  });
});
