// B-03 T13, T14 (spec AC9, AC10, SD7; plan PD12): `pnpm profile:check` run as a child process
// on files in a temporary folder, the way an agent runs it. It launches its own Chromium.
import { expect, test } from "@playwright/test";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { customEffect, fileOf, swirl } from "./fixtures/custom-profiles.ts";

const SCRIPT = resolve(import.meta.dirname, "../../scripts/profile-check.ts");
/** As `pnpm profile:check` runs it (package.json): `stripTypeScriptTypes` is experimental. */
const NO_WARNING = "--disable-warning=ExperimentalWarning";

let dir: string;
test.beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "djv-check-"));
});
test.afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

interface Run {
  code: number;
  lines: string[];
  stderr: string;
}

/** Runs the script; `lines` are its report on stdout, one per line. */
function check(...args: string[]): Promise<Run> {
  return new Promise((done) => {
    const node = [NO_WARNING, SCRIPT, ...args];
    execFile(process.execPath, node, { timeout: 120_000 }, (error, stdout, stderr) => {
      const code = error ? ((error as { code?: number }).code ?? 1) : 0;
      done({ code, lines: stdout.split(/\r?\n/).filter((l) => l !== ""), stderr });
    });
  });
}

function write(name: string, text: string): string {
  const path = join(dir, name);
  writeFileSync(path, text);
  return path;
}

test("a valid file exits 0 and says each profile compiles (AC9)", async () => {
  const run = await check(write("swirl.json", fileOf(swirl())), "--out", join(dir, "stills"));
  expect(run.stderr).toBe("");
  expect(run.code).toBe(0);
  expect(run.lines).toContain('profile "Swirl": compiles');
});

test("a 41-character label exits 1 naming the profile, the effect and the field (AC10)", async () => {
  const profile = swirl("Long");
  profile.effects[1] = { ...profile.effects[1]!, label: "x".repeat(41) };
  const run = await check(write("long.json", fileOf(profile)));
  expect(run.code).toBe(1);
  expect(run.lines).toEqual([
    `profile "Long": effect 2 ("${"x".repeat(41)}"): label — a label is 1 to 40 characters`,
  ]);
});

test("code that does not compile exits 1 naming the effect and the line in its body (AC10)", async () => {
  const profile = swirl("Broken");
  profile.effects.push(
    customEffect("Second", "vec3 c = source(uv);\nc *= 0.5;\nreturn c * undeclaredName;"),
  );
  const run = await check(write("broken.json", fileOf(profile)));
  expect(run.code).toBe(1);
  expect(run.lines).toHaveLength(1);
  expect(run.lines[0]).toMatch(
    /^profile "Broken": custom effect "Second", line 3: .*undeclaredName/,
  );
});

test("a version-3 file and a text file each exit 1 with one line (AC10)", async () => {
  const v3 = await check(write("v3.json", JSON.stringify({ formatVersion: 3, profiles: [] })));
  expect(v3.code).toBe(1);
  expect(v3.lines).toEqual(["unsupported file version"]);
  const text = await check(write("notes.txt", "these are not profiles"));
  expect(text.code).toBe(1);
  expect(text.lines).toEqual(["not a JSON file"]);
});

test("no arguments, or a file that is not there, exits 2 with the usage", async () => {
  const none = await check();
  expect(none.code).toBe(2);
  expect(none.stderr).toMatch(/^usage: pnpm profile:check <file>/);
  const missing = await check(join(dir, "nothing.json"));
  expect(missing.code).toBe(2);
  expect(missing.stderr).toMatch(/cannot read/);
});
