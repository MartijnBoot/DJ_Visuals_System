// B-08 AC6 (review finding C1): a compat mutation test must fail when the real source has
// drifted from what it rewrites. A rewrite that finds nothing to change serves the real file
// unchanged, and a drifted real file already yields diagnostics that read like the mutation's,
// so the helper refuses a mutation that changes nothing, before it compiles anything.
import { describe, expect, it } from "vitest";
import { compatDiagnostics } from "./compat-check.ts";

describe("compatDiagnostics refuses a mutation that changes nothing (B-08 AC6)", () => {
  it.each([
    { compatFile: "web/src/profile-compat.ts", mutated: "/engine/src/profile.ts" },
    { compatFile: "web/src/features-compat.ts", mutated: "/audio/src/features.ts" },
  ])("$mutated", (target) => {
    expect(() => compatDiagnostics(target, (source) => source)).toThrow(/changed nothing/);
  });
});
