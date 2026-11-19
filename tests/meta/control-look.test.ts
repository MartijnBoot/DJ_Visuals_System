// B-19 (spec SD8, SD12, AC22; plan PD2, PD12): the controller's look belongs to `/control` alone.
// No file outside `web/src/control/` imports the controller's style module or its stylesheet, so
// `/send` and every other route keep their own look.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../..");
const webSrc = resolve(repoRoot, "web/src");
const controlDir = resolve(webSrc, "control");
/** The controller's look, without extension or query. */
const LOOK = [resolve(controlDir, "styles"), resolve(controlDir, "controller.css")];

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

/** Every module specifier in `source`: static, side-effect, dynamic and re-export. */
export function specifiers(source: string): string[] {
  const found: string[] = [];
  const pattern = /(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g;
  for (const match of source.matchAll(pattern)) found.push(match[1]!);
  return found;
}

/** Whether `specifier`, imported from `file`, names the controller's look. */
export function namesLook(file: string, specifier: string): boolean {
  if (!specifier.startsWith(".")) return false;
  const target = resolve(dirname(file), specifier.split("?")[0]!).replace(/\.(ts|tsx)$/, "");
  return LOOK.includes(target);
}

describe("the controller's look stays on /control (AC22)", () => {
  it("the detector flags an import of the style module or the stylesheet", () => {
    const send = resolve(webSrc, "send/Send.tsx");
    const flagged = (src: string) => specifiers(src).filter((s) => namesLook(send, s));
    expect(flagged(`import { styles } from "../control/styles.ts";`)).toHaveLength(1);
    expect(flagged(`import css from "../control/controller.css?inline";`)).toHaveLength(1);
    expect(flagged(`import "../control/controller.css";`)).toHaveLength(1);
    expect(flagged(`const m = await import("../control/styles.ts");`)).toHaveLength(1);
    expect(flagged(`import { openSocket } from "../control/pair-link.ts";`)).toEqual([]);
  });

  it("no file outside web/src/control imports control/styles or controller.css", () => {
    const outside = sources(webSrc).filter(
      (f) => !f.startsWith(controlDir + "\\") && !f.startsWith(controlDir + "/"),
    );
    expect(outside.length).toBeGreaterThan(0);
    const importers = outside
      .filter((f) => specifiers(readFileSync(f, "utf8")).some((s) => namesLook(f, s)))
      .map((f) => relative(repoRoot, f).replaceAll("\\", "/"));
    expect(importers).toEqual([]);
  });
});
