// B-03 T13, T14 (spec AC9, AC10, SD7; plan PD12): `pnpm profile:check` run as a child process
// on files in a temporary folder, the way an agent runs it. It launches its own Chromium.
import { expect, test, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  builtInShaped,
  cameraThrough,
  customEffect,
  fileOf,
  strobe,
  swirl,
} from "./fixtures/custom-profiles.ts";
import type { Definition } from "./fixtures/profiles.ts";

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

// B-18 SD3 (plan T1): the fader flags are version 3, which the check reads like import does.
test("a version-3 file with the fader flags exits 0", async () => {
  const profile = swirl("Flagged");
  profile.effects[0] = { ...profile.effects[0]!, dj: true };
  profile.effects[1] = { ...profile.effects[1]!, vj: true };
  const text = JSON.stringify({ formatVersion: 3, profiles: [profile] });
  const run = await check(write("flagged.json", text), "--out", join(dir, "stills"));
  expect(run.stderr).toBe("");
  expect(run.code).toBe(0);
  expect(run.lines).toContain('profile "Flagged": compiles');
});

test("a version-4 file and a text file each exit 1 with one line (AC10)", async () => {
  const v4 = await check(write("v4.json", JSON.stringify({ formatVersion: 4, profiles: [] })));
  expect(v4.code).toBe(1);
  expect(v4.lines).toEqual(["unsupported file version"]);
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

// B-03 T14 (spec AC9, SD7; plan PD12): the stills and the flash-limiter report.
const MOMENTS = ["quiet", "kick", "hihat"];
const DIALS = ["0-0", "start", "1-1"];
const STILLS = MOMENTS.flatMap((m) => DIALS.map((d) => `${m}-${d}.png`)).sort();

/** Width, height and whether the picture has more than one colour, decoded by the browser. */
async function decode(page: Page, file: string) {
  const data = `data:image/png;base64,${readFileSync(file).toString("base64")}`;
  return page.evaluate(async (src) => {
    const image = new Image();
    image.src = src;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const g = canvas.getContext("2d")!;
    g.drawImage(image, 0, 0);
    const d = g.getImageData(0, 0, image.width, image.height).data;
    let varied = false;
    for (let i = 4; i < d.length && !varied; i += 4) {
      if (Math.abs(d[i]! - d[0]!) + Math.abs(d[i + 1]! - d[1]!) + Math.abs(d[i + 2]! - d[2]!) > 6) {
        varied = true;
      }
    }
    const c = 4 * (Math.floor(image.height / 2) * image.width + Math.floor(image.width / 2));
    return {
      width: image.width,
      height: image.height,
      varied,
      centre: [d[c]!, d[c + 1]!, d[c + 2]!],
    };
  }, data);
}

test("two profiles give 18 stills of 640×360, the same bytes on a second run, and a kick that shows (AC9)", async ({
  page,
}) => {
  await page.goto("/api/health");
  const file = write("two.json", fileOf(swirl("Swirl"), builtInShaped("Calm")));
  const first = await check(file, "--out", join(dir, "a"));
  const second = await check(file, "--out", join(dir, "b"));
  expect(first.code, first.lines.join("\n")).toBe(0);
  expect(second.code).toBe(0);
  expect(first.lines).toContain(`stills: ${join(dir, "a")}`);
  for (const slug of ["swirl", "calm"]) {
    const names = readdirSync(join(dir, "a", slug)).sort();
    expect(names).toEqual(STILLS);
    for (const name of names) {
      const a = readFileSync(join(dir, "a", slug, name));
      expect(a.equals(readFileSync(join(dir, "b", slug, name))), `${slug}/${name} differs`).toBe(
        true,
      );
      const png = await decode(page, join(dir, "a", slug, name));
      expect(png, `${slug}/${name}`).toMatchObject({ width: 640, height: 360, varied: true });
    }
  }
  const quiet = readFileSync(join(dir, "a", "swirl", "quiet-start.png"));
  expect(quiet.equals(readFileSync(join(dir, "a", "swirl", "kick-start.png")))).toBe(false);
});

test("a strobe reports the limiter clipping it; a built-in-only profile does not (AC9, SD5)", async () => {
  const run = await check(
    write("pair.json", fileOf(strobe("Strobe"), builtInShaped("Calm"))),
    "--out",
    join(dir, "s"),
  );
  expect(run.code).toBe(0);
  const strobeLine = run.lines.find((l) => l.startsWith('profile "Strobe": flash limiter'));
  expect(strobeLine).toMatch(
    /^profile "Strobe": flash limiter: clipped in [1-9]\d* of \d+ frames$/,
  );
  expect(run.lines).toContain('profile "Calm": flash limiter: not clipped');
});

test("a steady custom profile is not clipped: the cut into it from the engine's start is not counted (PD12)", async () => {
  // The negative: steady, and as far from the built-in look as a picture can be.
  const steady: Definition = {
    ...cameraThrough("Steady"),
    effects: [customEffect("Negative", "return vec3(1.0) - source(uv);")],
  };
  const run = await check(write("steady.json", fileOf(steady)), "--out", join(dir, "t"));
  expect(run.code).toBe(0);
  expect(run.lines).toContain('profile "Steady": flash limiter: not clipped');
});

test("--camera puts the image in front of the profile: its colour shows at dials (0, 0) (AC9)", async ({
  page,
}) => {
  await page.goto("/api/health");
  // Orange, with a small blue square: orange is the dominant colour.
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 180;
    const g = canvas.getContext("2d")!;
    g.fillStyle = "#ff8000";
    g.fillRect(0, 0, 320, 180);
    g.fillStyle = "#0000ff";
    g.fillRect(10, 10, 30, 30);
    return canvas.toDataURL("image/png").split(",")[1]!;
  });
  const image = join(dir, "orange.png");
  writeFileSync(image, Buffer.from(png, "base64"));
  const run = await check(
    write("through.json", fileOf(cameraThrough("Through"))),
    "--camera",
    image,
    "--out",
    join(dir, "c"),
  );
  expect(run.code, run.lines.join("\n")).toBe(0);
  const still = await decode(page, join(dir, "c", "through", "quiet-0-0.png"));
  expect(
    still.centre.every((v, i) => Math.abs(v - [255, 128, 0][i]!) <= 8),
    `${still.centre}`,
  ).toBe(true);
  const tinted = await decode(page, join(dir, "c", "through", "quiet-1-1.png"));
  expect(tinted.centre[0]).toBeLessThan(120); // the custom effect at full strength
});

test("by default the stills go under profiles/.check/, which git ignores (PD12)", async () => {
  const stem = `check-${Date.now()}`;
  const run = await check(write(`${stem}.json`, fileOf(builtInShaped("Calm"))));
  const folder = resolve(import.meta.dirname, "../../profiles/.check", stem);
  try {
    expect(run.code).toBe(0);
    expect(run.lines).toContain(`stills: ${folder}`);
    expect(readdirSync(join(folder, "calm")).sort()).toEqual(STILLS);
    const status = await git("status", "--porcelain", "--untracked-files=all", "profiles");
    expect(status.trim()).toBe("");
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

function git(...args: string[]): Promise<string> {
  return new Promise((done, fail) =>
    execFile("git", args, { cwd: resolve(import.meta.dirname, "../..") }, (error, stdout) =>
      error ? fail(error) : done(stdout),
    ),
  );
}
