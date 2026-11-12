// T13 (B-02 spec SD7, AC9, AC10): the export text and the local check of an import file.
import type { StoredProfile } from "@djv/shared";
import { describe, expect, it } from "vitest";
import { exportFile, fileName, importIssueLine, readImport } from "./file.ts";

const stored = (name: string): StoredProfile => ({
  name,
  palette: ["#000000", "#ffffff", "#ff0000"],
  dials: { recognisability: 0.3, reactivity: 0.7 },
  effects: [
    { type: "zoom", amount: 0.5 },
    { type: "flash", amount: 0, binding: { feature: "beat", amount: 1 }, colourSlot: 2 },
  ],
  id: "9f1c5a1e-0000-4000-8000-000000000000",
  revision: 4,
  createdAt: "2026-11-12T10:00:00.000Z",
  updatedAt: "2026-11-12T11:00:00.000Z",
});

describe("exportFile (AC9)", () => {
  it("is format version 1 with no id, revision or timestamp anywhere", () => {
    const text = exportFile([stored("Warm"), stored("Cool")]);
    const parsed = JSON.parse(text) as { formatVersion: number; profiles: unknown[] };
    expect(parsed.formatVersion).toBe(1);
    expect(parsed.profiles).toHaveLength(2);
    for (const key of ["id", "revision", "createdAt", "updatedAt"]) {
      expect(text).not.toContain(`"${key}"`);
    }
  });

  it("parses back to the same profiles", () => {
    const result = readImport(exportFile([stored("Warm"), stored("Cool")]));
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.file.profiles.map((p) => p.name)).toEqual(["Warm", "Cool"]);
      expect(result.file.profiles[0]!.effects).toHaveLength(2);
    }
  });
});

describe("fileName", () => {
  it("names a single profile after it, and a bundle generically", () => {
    expect(fileName([stored("Warm Glow!")])).toBe("warm-glow.djv.json");
    expect(fileName([stored("   ")])).toBe("profile.djv.json");
    expect(fileName([stored("a"), stored("b")])).toBe("djv-profiles.djv.json");
  });
});

describe("readImport (AC10)", () => {
  it("says not_json for text that is not JSON", () => {
    expect(readImport("this is not json")).toEqual({ kind: "not_json" });
    expect(readImport("")).toEqual({ kind: "not_json" });
  });

  it("says unsupported_version for another format version, before looking at the rest", () => {
    expect(readImport(JSON.stringify({ formatVersion: 2, profiles: "nonsense" }))).toEqual({
      kind: "unsupported_version",
    });
    expect(readImport(JSON.stringify({ formatVersion: 0, profiles: [] }))).toEqual({
      kind: "unsupported_version",
    });
  });

  it("names the profile and field that fail", () => {
    const broken = JSON.parse(exportFile([stored("Warm"), stored("Cool")])) as {
      profiles: { palette: string[] }[];
    };
    broken.profiles[1]!.palette[2] = "#zzzzzz";
    const result = readImport(JSON.stringify(broken));
    expect(result.kind).toBe("invalid");
    if (result.kind !== "invalid") return;
    expect(result.issues).toEqual([
      { profile: "Cool", field: "palette.2", message: expect.any(String) },
    ]);
    expect(importIssueLine(result.issues[0]!)).toMatch(/^Cool: palette\.2 — /);
  });

  it("reports a file that is not the format at all, and an empty bundle, as invalid", () => {
    expect(readImport("[]").kind).toBe("invalid");
    expect(readImport("{}").kind).toBe("invalid");
    expect(readImport(JSON.stringify({ formatVersion: 1, profiles: [] })).kind).toBe("invalid");
    const noName = readImport(JSON.stringify({ formatVersion: 1, profiles: [{ palette: [] }] }));
    expect(noName.kind).toBe("invalid");
    if (noName.kind === "invalid") {
      // No readable name: the profile is named by its position in the file.
      expect(noName.issues.every((i) => i.profile === "profile 1")).toBe(true);
      expect(importIssueLine(noName.issues[0]!)).toMatch(/^profile 1: /);
    }
  });

  it("refuses unknown keys, so a file cannot smuggle in code (SD1)", () => {
    const withCode = JSON.parse(exportFile([stored("Warm")])) as {
      profiles: Record<string, unknown>[];
    };
    withCode.profiles[0]!.shader = "void main() {}";
    expect(readImport(JSON.stringify(withCode)).kind).toBe("invalid");
  });
});
