// AC19 (B-02 spec SD17; plan PD8, T8): the type check fails when `engine/`'s `Profile` and
// `shared/`'s drift apart. `web/src/profile-compat.ts` is type-checked with the compiler API,
// once against the real `engine/src/profile.ts` and once against a copy served with a field
// renamed or a required field added. Only the first may pass.
import { describe, expect, it } from "vitest";
import { compatDiagnostics } from "./compat-check.ts";

const target = { compatFile: "web/src/profile-compat.ts", mutated: "/engine/src/profile.ts" };
const diagnostics = (mutate?: (source: string) => string) => compatDiagnostics(target, mutate);

describe("Profile compatibility (AC19)", () => {
  it("type-checks against the real shapes", () => {
    expect(diagnostics()).toEqual([]);
  });

  it("fails when the engine renames amount", () => {
    const renamed = (s: string) => s.replace(/^(\s*)amount: number;/gm, "$1strength: number;");
    expect(renamed("  amount: number;")).toContain("strength:");
    const found = diagnostics(renamed);
    expect(found.length).toBeGreaterThan(0);
    expect(found.join("\n")).toMatch(/amount|strength/);
  });

  it("fails when the engine adds a required field shared lacks", () => {
    const extra = (s: string) =>
      s.replace(/^(\s*)palette: string\[\];/m, "$1palette: string[];\n$1tempo: number;");
    expect(diagnostics(extra).join("\n")).toMatch(/tempo/);
  });
});
