// AC19 (spec SD11; plan T6): the type check fails when `audio/`'s and `engine/`'s
// `AudioFeatures` drift apart. `web/src/features-compat.ts` is type-checked with the compiler
// API against a copy of `audio/src/features.ts` served with a field renamed or a required
// field added; neither may pass. The helper is `compat-check.ts` (B-02 T8). The unmutated case
// is the `types` step's (`pnpm typecheck` compiles `web/`, which covers the compat file:
// `compat-coverage.test.ts`, B-08 SD3); the helper also requires it clean before either
// mutation counts, so any drift fails these tests too (B-08 AC6; owner 2026-11-14). No
// per-test time limit: these tests assert
// diagnostics, not how fast the compiler is, and load made them exceed vitest's 5 s (B-08 PD7,
// D-02).
import { describe, expect, it } from "vitest";
import { compatDiagnostics } from "./compat-check.ts";

const target = { compatFile: "web/src/features-compat.ts", mutated: "/audio/src/features.ts" };
const diagnostics = (mutate: (source: string) => string) => compatDiagnostics(target, mutate);

describe("AudioFeatures compatibility (AC19)", { timeout: 0 }, () => {
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
