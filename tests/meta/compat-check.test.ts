// B-08 AC6 (review finding C1; owner 2026-11-14: every drift is caught): a compat mutation test
// must fail when the real source has drifted, whichever field drifted. A drifted real file
// already yields diagnostics that read like a mutation's, so the helper refuses a mutation
// that changes nothing (before compiling), and refuses any mutation while the unmutated
// compat file has a diagnostic. `drift` stands in for an edit to the real file, so these tests
// never touch the repository.
import { describe, expect, it } from "vitest";
import { compatDiagnostics } from "./compat-check.ts";

const profile = { compatFile: "web/src/profile-compat.ts", mutated: "/engine/src/profile.ts" };
const features = { compatFile: "web/src/features-compat.ts", mutated: "/audio/src/features.ts" };

describe(
  "compatDiagnostics refuses a mutation that proves nothing (B-08 AC6)",
  { timeout: 0 },
  () => {
    it.each([profile, features])("a mutation that changes nothing: $mutated", (target) => {
      expect(() => compatDiagnostics(target, (source) => source)).toThrow(/changed nothing/);
    });

    it("drift in a field the mutation does not touch: features' beat", () => {
      const drift = (s: string) => s.replace(/^(\s*)beat: number;/m, "$1pulse: number;");
      const renameLevel = (s: string) => s.replace(/^(\s*)level:/m, "$1loudness:");
      expect(drift("  beat: number;")).toContain("pulse:");
      expect(() => compatDiagnostics(features, renameLevel, { drift })).toThrow(/drifted/);
    });

    it("drift in a field the mutation does not touch: profile's dials", () => {
      const drift = (s: string) => s.replace(/^(\s*)dials: Dials;/m, "$1knobs: Dials;");
      const renameAmount = (s: string) =>
        s.replace(/^(\s*)amount: number;/gm, "$1strength: number;");
      expect(drift("  dials: Dials;")).toContain("knobs:");
      expect(() => compatDiagnostics(profile, renameAmount, { drift })).toThrow(/drifted/);
    });
  },
);
