// AC19 (spec SD11; plan T6): the type check fails when `audio/`'s and `engine/`'s
// `AudioFeatures` drift apart. `web/src/features-compat.ts` is type-checked with the compiler
// API, once against the real `audio/src/features.ts` and once against a copy served with a
// field renamed. Only the first may pass. The helper is `compat-check.ts` (B-02 T8).
import { describe, expect, it } from "vitest";
import { compatDiagnostics } from "./compat-check.ts";

const target = { compatFile: "web/src/features-compat.ts", mutated: "/audio/src/features.ts" };
const diagnostics = (mutate?: (source: string) => string) => compatDiagnostics(target, mutate);

describe("AudioFeatures compatibility (AC19)", () => {
  it("type-checks against the real shapes", () => {
    expect(diagnostics()).toEqual([]);
  });

  it("fails when audio renames a field", () => {
    const renamed = (s: string) => s.replace(/^(\s*)level:/m, "$1loudness:");
    expect(renamed("export interface X {\n  level: number;\n}")).toContain("loudness:");
    const found = diagnostics(renamed);
    expect(found.length).toBeGreaterThan(0);
    expect(found.join("\n")).toMatch(/level|loudness/);
  });

  it("fails when audio adds a required field the engine lacks", () => {
    const extra = (s: string) =>
      s.replace(/^(\s*)level: number;/m, "$1level: number;\n$1tempo: number;");
    const found = diagnostics(extra);
    expect(found.join("\n")).toMatch(/tempo/);
  });
});
