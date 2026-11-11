// AC15: the environment is read in server/src/config.ts and nowhere else. Proven twice: the
// ESLint rule fires on a snippet placed anywhere else, and a scan of every source file in the
// working tree (tracked or not yet) finds the text nowhere else, so a file ESLint does not see
// cannot slip through.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../..");
const configModule = "server/src/config.ts";
// Joined so this file is not itself a hit for the scan below; the test titles avoid it too.
const forbidden = ["process", "env"].join(".");
const snippet = `export const port = ${forbidden}.PORT;\n`;

// One instance: loading the flat config and the TypeScript parser is the slow part.
const eslint = new ESLint({ cwd: repoRoot });

async function ruleIdsFor(filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(snippet, { filePath: resolve(repoRoot, filePath) });
  return (result?.messages ?? []).map((m) => m.ruleId ?? "(fatal)");
}

describe("config boundary (AC15)", () => {
  it("lint fails an environment read outside the config module", { timeout: 30_000 }, async () => {
    expect(await ruleIdsFor("server/src/other.ts")).toContain("no-restricted-properties");
  });

  it("lint allows it inside the config module", { timeout: 30_000 }, async () => {
    expect(await ruleIdsFor(configModule)).not.toContain("no-restricted-properties");
  });

  it("no source file outside the config module contains the text", () => {
    const files = execFileSync(
      "git",
      [
        "ls-files",
        "-z",
        "--cached",
        "--others",
        "--exclude-standard",
        "--",
        "*.ts",
        "*.tsx",
        "*.js",
      ],
      { cwd: repoRoot, encoding: "utf8" },
    )
      .split("\0")
      .filter((f) => f.length > 0 && f !== configModule);
    const offenders = files.filter((f) =>
      readFileSync(resolve(repoRoot, f), "utf8").includes(forbidden),
    );
    expect(offenders).toEqual([]);
  });
});
