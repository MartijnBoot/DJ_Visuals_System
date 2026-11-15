// `pnpm profile:check <file> [--camera <image>] [--out <dir>]` (B-03 spec SD7, AC9, AC10; plan
// PD12): what an agent runs to see its profile before the owner imports it. The file is checked
// against the shared schema exactly as the builder's import checks it (`readImport`), then every
// profile is compiled in the real engine in headless Chromium with the gate's software WebGL.
// The page is a blank one whose every request this script answers itself: the engine's own
// source, type-stripped by Node. Nothing of it ships in the app; no server is started.
// Exit: 0 valid, 1 a schema or compile failure, 2 usage or no Chromium.
import { chromium, type Browser, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { SOFTWARE_GL_ARGS } from "../tests/browser/fixtures/launch.ts";
import { readImport, type ImportIssue } from "../web/src/profiles/file.ts";
import type { Checked } from "./profile-check-page.ts";

const USAGE = "usage: pnpm profile:check <file> [--camera <image>] [--out <dir>]";
const ROOT = resolve(import.meta.dirname, "..");
const ORIGIN = "http://profile-check.invalid";

export interface Args {
  file: string;
  camera: string | null;
  out: string | null;
}

/** The arguments, or null when they are not a valid call. */
export function parseArgs(argv: readonly string[]): Args | null {
  const args: Args = { file: "", camera: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--camera" || arg === "--out") {
      const value = argv[++i];
      if (!value) return null;
      if (arg === "--camera") args.camera = value;
      else args.out = value;
    } else if (!arg.startsWith("--") && !args.file) {
      args.file = arg;
    } else {
      return null;
    }
  }
  return args.file ? args : null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * `profile "<name>": effect <n> ("<label>"): <field> — <message>`: the effect counted from 1, and
 * its label when it has one, so the author finds it in the file.
 */
export function schemaLine(issue: ImportIssue, parsed: unknown, profileIndex: number): string {
  const where = issue.profile === undefined ? "file" : `profile "${issue.profile}"`;
  const effect = /^effects\.(\d+)(?:\.(.*))?$/.exec(issue.field);
  if (!effect) return `${where}: ${issue.field} — ${issue.message}`;
  const index = Number(effect[1]);
  const profiles = isRecord(parsed) && Array.isArray(parsed.profiles) ? parsed.profiles : [];
  const raw = profiles[profileIndex];
  const entry = isRecord(raw) && Array.isArray(raw.effects) ? raw.effects[index] : undefined;
  const label = isRecord(entry) && typeof entry.label === "string" ? ` ("${entry.label}")` : "";
  return `${where}: effect ${index + 1}${label}: ${effect[2] || "effect"} — ${issue.message}`;
}

/** `profile "<name>": custom effect "<label>", line <n>: <message>`, or the fragment's line. */
export function compileLine(
  profile: string,
  issue: { effectIndex: number; label: string; line: number; message: string },
): string {
  if (issue.effectIndex < 0)
    return `profile "${profile}": shader line ${issue.line}: ${issue.message}`;
  return `profile "${profile}": custom effect "${issue.label}", line ${issue.line}: ${issue.message}`;
}

/** Serves the page and the engine's source, type-stripped, from this repository only. */
async function servePage(page: Page, camera: Buffer | null): Promise<void> {
  await page.route(`${ORIGIN}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/camera" && camera) return route.fulfill({ body: camera });
    if (path === "/") {
      return route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><title>loading</title><body style="margin:0"></body><script type="module" src="/scripts/profile-check-page.ts"></script>',
      });
    }
    const file = resolve(ROOT, `.${path}`);
    const inside = relative(ROOT, file).split(sep).join("/");
    const allowed =
      inside === "scripts/profile-check-page.ts" ||
      (inside.startsWith("engine/src/") && inside.endsWith(".ts") && !inside.endsWith(".test.ts"));
    if (!allowed) return route.fulfill({ status: 404, body: "" });
    const source = stripTypeScriptTypes(readFileSync(file, "utf8"), { mode: "strip" });
    return route.fulfill({ contentType: "text/javascript", body: source });
  });
  await page.goto(`${ORIGIN}/`);
  await page.waitForFunction(() => document.title === "ready");
}

async function launch(): Promise<Browser | null> {
  try {
    return await chromium.launch({ headless: true, args: [...SOFTWARE_GL_ARGS] });
  } catch (error) {
    console.error(
      `Chromium could not be started (${String(error).split("\n")[0]}); run: pnpm exec playwright install chromium`,
    );
    return null;
  }
}

async function main(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv);
  if (!args) {
    console.error(USAGE);
    return 2;
  }
  let text: string;
  try {
    text = readFileSync(args.file, "utf8");
  } catch (error) {
    console.error(`cannot read ${args.file}: ${(error as Error).message}\n${USAGE}`);
    return 2;
  }

  const read = readImport(text);
  if (read.kind === "not_json") return report(["not a JSON file"], 1);
  if (read.kind === "unsupported_version") return report(["unsupported file version"], 1);
  if (read.kind === "invalid") {
    // An issue names its profile, not its place: find the place by that name for the label.
    const parsed: unknown = JSON.parse(text);
    const profiles = isRecord(parsed) && Array.isArray(parsed.profiles) ? parsed.profiles : [];
    const placeOf = (name: string | undefined) =>
      profiles.findIndex((p) => isRecord(p) && p.name === name);
    return report(
      read.issues.map((issue) => schemaLine(issue, parsed, placeOf(issue.profile))),
      1,
    );
  }

  let camera: Buffer | null = null;
  if (args.camera) {
    try {
      camera = readFileSync(args.camera);
    } catch (error) {
      console.error(`cannot read ${args.camera}: ${(error as Error).message}\n${USAGE}`);
      return 2;
    }
  }
  const out = args.out
    ? resolve(args.out)
    : resolve(ROOT, "profiles", ".check", basename(args.file, extname(args.file)));

  const browser = await launch();
  if (!browser) return 2;
  try {
    const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
    await servePage(page, camera);
    const checked: { name: string; result: Checked }[] = [];
    for (const profile of read.file.profiles) {
      const result = await page.evaluate(
        (input) =>
          (
            window as unknown as {
              profileCheck: { check(p: unknown, o: { camera: boolean }): Promise<Checked> };
            }
          ).profileCheck.check(input.profile, { camera: input.camera }),
        { profile, camera: camera !== null },
      );
      checked.push({ name: profile.name, result });
    }
    const failures = checked.flatMap(({ name, result }) =>
      result.ok ? [] : result.issues.map((issue) => compileLine(name, issue)),
    );
    if (failures.length > 0) return report(failures, 1);

    const lines: string[] = [];
    const slugs = new Set<string>();
    for (const { name, result } of checked) {
      if (!result.ok) continue;
      const folder = join(out, freeSlug(name, slugs));
      mkdirSync(folder, { recursive: true });
      for (const still of result.stills) {
        writeFileSync(join(folder, still.name), Buffer.from(still.png, "base64"));
      }
      lines.push(`profile "${name}": compiles`);
      lines.push(
        result.clipped > 0
          ? `profile "${name}": flash limiter: clipped in ${result.clipped} of ${result.compared} frames`
          : `profile "${name}": flash limiter: not clipped`,
      );
    }
    lines.push(`stills: ${out}`);
    return report(lines, 0);
  } finally {
    await browser.close();
  }
}

/** A folder name for a profile, as the builder names a file (`file.ts`), unique in this run. */
function freeSlug(name: string, taken: Set<string>): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "profile";
  let slug = base;
  for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
  taken.add(slug);
  return slug;
}

function report(lines: readonly string[], code: number): number {
  for (const line of lines) console.log(line);
  return code;
}

process.exitCode = await main(process.argv.slice(2));
