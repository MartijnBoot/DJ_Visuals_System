// B-07 T10 (SD8, AC25; plan PD9, PD23): the scenes file — exported from the scenes the server
// returns, read and checked before anything is sent, and cut into parts that each fit one screen
// message.
import {
  MAX_SCREEN_MESSAGE,
  SCENE_LIMITS,
  sceneFileSchema,
  type SceneDefinition,
  type StoredScene,
} from "@djv/shared";
import { describe, expect, it } from "vitest";
import {
  exportScenes,
  importParts,
  readSceneImport,
  sceneFileName,
  sceneIssueLine,
  toSceneImportIssue,
} from "./file.ts";

const definition: SceneDefinition = {
  profile: {
    name: "Warm",
    palette: ["#1a0500", "#c2410c"],
    dials: { recognisability: 0.2, reactivity: 0.9 },
    effects: [
      { type: "paletteMap", amount: 1 },
      {
        type: "custom",
        label: "Glow",
        amount: 0.3,
        abstraction: false,
        params: [],
        code: "return source(uv).rgb;",
      },
    ],
  },
  dials: { recognisability: 0.6, reactivity: 0.4 },
  feed: { kind: "remote", hint: "Chrome on Android" },
  transition: { kind: "crossfade", duration: 2 },
};

const stored = (id: string, name: string, scene = definition): StoredScene => ({
  id,
  name,
  definition: scene,
  createdAt: "2026-11-26T10:00:00.000Z",
  updatedAt: "2026-11-26T10:00:00.000Z",
});

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

describe("sceneFileName (SD8)", () => {
  it("is the scene's slug for one, the bundle's name for more", () => {
    expect(sceneFileName(["Warm crowd!"])).toBe("warm-crowd.djv-scenes.json");
    expect(sceneFileName(["???"])).toBe("scene.djv-scenes.json");
    expect(sceneFileName(["A", "B"])).toBe("djv-scenes.djv-scenes.json");
  });
});

describe("exportScenes (AC25)", () => {
  it("fetches each scene and writes { formatVersion: 1, scenes } with no id or timestamp", async () => {
    const all = { a: stored("a", "Warm crowd"), b: stored("b", "Booth") };
    const asked: string[] = [];
    const result = await exportScenes(
      [
        { id: "a", name: "Warm crowd" },
        { id: "b", name: "Booth" },
      ],
      (id) => {
        asked.push(id);
        return Promise.resolve(all[id as "a" | "b"]);
      },
    );
    expect(asked).toEqual(["a", "b"]);
    if (result.kind !== "ok") throw new Error(result.kind);
    expect(result.fileName).toBe("djv-scenes.djv-scenes.json");
    expect(result.count).toBe(2);
    const parsed = JSON.parse(result.text) as unknown;
    expect(sceneFileSchema.parse(parsed).scenes.map((s) => s.name)).toEqual([
      "Warm crowd",
      "Booth",
    ]);
    for (const key of ["id", "createdAt", "updatedAt"])
      expect(result.text).not.toContain(`"${key}"`);
  });

  it("fails as a whole when one scene cannot be fetched, and with nothing to export", async () => {
    const result = await exportScenes(
      [
        { id: "a", name: "A" },
        { id: "b", name: "B" },
      ],
      (id) => Promise.resolve(id === "a" ? stored("a", "A") : null),
    );
    expect(result.kind).toBe("failed");
    expect((await exportScenes([], () => Promise.resolve(null))).kind).toBe("empty");
  });
});

describe("readSceneImport (SD8, AC25)", () => {
  it("round trips an exported file", async () => {
    const exported = await exportScenes([{ id: "a", name: "Warm crowd" }], () =>
      Promise.resolve(stored("a", "Warm crowd")),
    );
    if (exported.kind !== "ok") throw new Error(exported.kind);
    const result = readSceneImport(exported.text);
    if (result.kind !== "ok") throw new Error(result.kind);
    expect(result.file.scenes[0]).toMatchObject({
      name: "Warm crowd",
      dials: definition.dials,
      feed: definition.feed,
      transition: definition.transition,
    });
    expect(result.file.scenes[0]!.profile.effects).toEqual(definition.profile.effects);
  });

  it("refuses text that is not JSON, and another format version", () => {
    expect(readSceneImport("{").kind).toBe("not_json");
    expect(readSceneImport(JSON.stringify({ formatVersion: 2, scenes: [] })).kind).toBe(
      "unsupported_version",
    );
  });

  it("names the scene and the field that fail", () => {
    const file = {
      formatVersion: 1,
      scenes: [
        { name: "Fine", ...definition },
        { name: "Broken", ...definition, transition: { kind: "spin", duration: 1 } },
      ],
    };
    const result = readSceneImport(JSON.stringify(file));
    if (result.kind !== "invalid") throw new Error(result.kind);
    expect(result.issues.map(sceneIssueLine)).toEqual([
      expect.stringMatching(/^Broken: transition\.kind — /),
    ]);
  });

  it("refuses a scene over 128 KiB before anything is sent, naming it (PD23)", () => {
    // Each code is under the 8 KiB limit, but every newline is two bytes once escaped in JSON,
    // so twelve of them take the scene past 128 KiB (the plan's Risks row).
    const code = `${"\n".repeat(8000)}return vec3(0.0);`;
    const effects = Array.from({ length: 12 }, (_, i) => ({
      ...definition.profile.effects[1]!,
      label: `Glow ${i}`,
      code,
    }));
    const big = { ...definition, profile: { ...definition.profile, effects } };
    expect(bytes(big)).toBeGreaterThan(SCENE_LIMITS.definitionBytes);
    const result = readSceneImport(
      JSON.stringify({ formatVersion: 1, scenes: [{ name: "Big", ...big }] }),
    );
    if (result.kind !== "invalid") throw new Error(result.kind);
    expect(result.issues).toEqual([
      { scene: "Big", field: "scene", message: "larger than 128 KiB" },
    ]);
  });
});

describe("toSceneImportIssue", () => {
  it("reads the server's issue path as the scene and the field", () => {
    expect(
      toSceneImportIssue({ path: "scenes.3.dials.reactivity", message: "Too big", scene: "Dock" }),
    ).toEqual({ scene: "Dock", field: "dials.reactivity", message: "Too big" });
    expect(toSceneImportIssue({ path: "scenes.0", message: "Bad" })).toEqual({
      scene: "scene 1",
      field: "scene",
      message: "Bad",
    });
    expect(toSceneImportIssue({ path: "", message: "Bad" })).toEqual({
      field: "file",
      message: "Bad",
    });
  });
});

describe("importParts (PD9)", () => {
  it("keeps every scene in order, in parts that each fit one screen message", () => {
    const code = `// ${"g".repeat(100_000)}\nreturn vec3(0.0);`;
    const big = {
      name: "Big",
      ...definition,
      profile: { ...definition.profile, effects: [{ ...definition.profile.effects[1]!, code }] },
    };
    const scenes = Array.from({ length: 7 }, (_, i) => ({ ...big, name: `Big ${i}` }));
    const parts = importParts(scenes);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.flat().map((s) => s.name)).toEqual(scenes.map((s) => s.name));
    parts.forEach((part, i) => {
      const message = {
        type: "scenes.import",
        requestId: 1_000_000,
        importId: 1_000_000,
        part: i,
        parts: parts.length,
        scenes: part,
      };
      expect(bytes(message)).toBeLessThan(MAX_SCREEN_MESSAGE);
    });
  });

  it("puts a small file in one part", () => {
    expect(importParts([{ name: "A", ...definition }])).toHaveLength(1);
  });
});
