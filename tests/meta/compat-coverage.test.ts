// B-08 AC7 (SD3, plan PD8): the `types` step type-checks both compat files only while
// `web/tsconfig.json` covers them. This reads the parsed config's file list, which resolves
// `include` against the disk and compiles nothing, so it stays fast however busy the machine is.
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { webConfig } from "./compat-check.ts";

const repoRoot = resolve(import.meta.dirname, "../..");
const compatFiles = ["web/src/profile-compat.ts", "web/src/features-compat.ts"].map((f) =>
  resolve(repoRoot, f).toLowerCase(),
);
const covered = (fileNames: readonly string[]) => {
  const names = new Set(fileNames.map((f) => resolve(f).toLowerCase()));
  return compatFiles.filter((f) => names.has(f));
};

describe("web/tsconfig.json covers the compat files (B-08 AC7)", () => {
  it("lists both compat files", () => {
    expect(covered(webConfig().fileNames)).toEqual(compatFiles);
  });

  it("sees neither when a planted config leaves src out", () => {
    const planted = webConfig({ include: ["vite.config.ts"] });
    expect(planted.fileNames.length).toBeGreaterThan(0);
    expect(covered(planted.fileNames)).toEqual([]);
  });
});
