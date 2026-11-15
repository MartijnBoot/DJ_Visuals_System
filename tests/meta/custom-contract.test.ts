// B-03 T15 (spec SD6, SD11, SD14, AC26; plan PD7): the custom effect contract in
// `docs/custom-effects.md` names exactly what the engine defines; the builder's template and the
// document's worked bodies pass the shared code checks; `/profile` writes files and runs the
// check, never the server; the inspiration folder and the stills are ignored by git, the
// authored profiles are not.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CUSTOM_CONTRACT } from "../../engine/src/shader.ts";
import { customCodeIssues } from "../../shared/src/profile.ts";
import { CUSTOM_TEMPLATE } from "../../web/src/builder/custom-template.ts";

const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const doc = read("docs/custom-effects.md");
const command = read(".claude/commands/profile.md");

/** The first-column names of the document's Names table, without their arguments. */
function documentedNames(): string[] {
  const section = doc.split(/^## /m).find((s) => s.startsWith("Names"));
  expect(section, "docs/custom-effects.md has a Names section").toBeDefined();
  return [...section!.matchAll(/^\|\s*`([^`]+)`\s*\|/gm)].map((m) => m[1]!.replace(/[([].*$/, ""));
}

describe("the contract document (PD7)", () => {
  it("names every contract name the engine defines, and no other", () => {
    const expected = [
      ...CUSTOM_CONTRACT.defines.filter((name) => name !== "audio"),
      ...CUSTOM_CONTRACT.audio.map((field) => `audio.${field}`),
      ...CUSTOM_CONTRACT.functions,
    ];
    expect(documentedNames().sort()).toEqual([...expected].sort());
  });

  it("gives worked bodies that pass the shared code checks", () => {
    const bodies = [...doc.matchAll(/```glsl\n([\s\S]*?)```/g)].map((m) => m[1]!);
    expect(bodies.length).toBeGreaterThanOrEqual(3);
    for (const body of bodies) expect(customCodeIssues(body), body).toEqual([]);
  });

  it("is what the builder's template follows", () => {
    expect(customCodeIssues(CUSTOM_TEMPLATE.code)).toEqual([]);
    expect(CUSTOM_TEMPLATE.code).toMatch(/\bsource\(uv\)/);
    expect(CUSTOM_TEMPLATE.code).toMatch(/\bparam\[0\]/);
  });
});

describe("the /profile command (SD6, SD14)", () => {
  it("writes the profile file and runs the check script", () => {
    expect(command).toContain("pnpm profile:check");
    expect(command).toContain("profiles/$1.json");
    expect(command).toContain("profiles/$1.md");
    expect(command).toContain("inspiration/$1/");
  });

  it("never names a server endpoint", () => {
    expect(command).not.toContain("/api/");
  });
});

describe("what git keeps (SD11, AC26)", () => {
  /** Whether git ignores `path`; `git check-ignore` exits 1 for a path it keeps. */
  const ignored = (path: string) => {
    try {
      execFileSync("git", ["check-ignore", "--no-index", "-q", path], { cwd: root });
      return true;
    } catch {
      return false;
    }
  };

  it("ignores the inspiration and the stills, and keeps the authored profiles", () => {
    expect(ignored("inspiration/x/a.png")).toBe(true);
    expect(ignored("profiles/.check/x.png")).toBe(true);
    expect(ignored("profiles/x.json")).toBe(false);
    expect(ignored("profiles/x.md")).toBe(false);
  });
});
