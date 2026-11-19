// B-19 (spec SD8, SD11, SD12, AC22; plan PD2, PD12, T2, T4): the controller's look belongs to
// `/control` alone. No file outside `web/src/control/` imports the controller's style module or its
// stylesheet, so `/send` and every other route keep their own look. Every selector of the
// stylesheet starts at `.djv-control`, it loads nothing (no `url(`, `@import`, `@font-face`), and
// its tokens meet every contrast pair of the brief's table (`docs/design/controller-style.md`).
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { contrast } from "../contrast.ts";

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

const stylesheet = resolve(controlDir, "controller.css");
const brief = resolve(repoRoot, "docs/design/controller-style.md");

/** Every style rule's selectors, at any depth of at-rules; at-rule preludes are skipped. */
export function selectors(css: string): string[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const found: string[] = [];
  let prelude = "";
  const atDepths: boolean[] = [];
  for (const char of text) {
    if (char === "{") {
      const head = prelude.trim();
      const isAt = head.startsWith("@");
      // A rule inside a style rule's block would be nesting; a declaration block holds none.
      if (!isAt && !atDepths.includes(false)) found.push(...head.split(",").map((s) => s.trim()));
      atDepths.push(isAt);
      prelude = "";
    } else if (char === "}") {
      atDepths.pop();
      prelude = "";
    } else if (char === ";") {
      prelude = "";
    } else {
      prelude += char;
    }
  }
  return found;
}

/** The custom properties declared on `.djv-control` itself. */
export function tokens(css: string): Map<string, string> {
  const block = /(?:^|})\s*\.djv-control\s*\{([^}]*)\}/.exec(css.replace(/\/\*[\s\S]*?\*\//g, ""));
  const found = new Map<string, string>();
  for (const m of (block?.[1] ?? "").matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    found.set(m[1]!, m[2]!.trim());
  }
  return found;
}

interface Pair {
  id: string;
  fg: string;
  bg: string;
  min: number;
  ratio: number;
}

/** The brief's contrast table: one pair per row, the tokens by name. */
export function pairs(markdown: string): Pair[] {
  const row = /^\| ([TN]\d+) \| `(--[\w-]+)` \| `(--[\w-]+)` \| ([\d.]+) \| ([\d.]+) \|/gm;
  return [...markdown.matchAll(row)].map((m) => ({
    id: m[1]!,
    fg: m[2]!,
    bg: m[3]!,
    min: Number(m[4]),
    ratio: Number(m[5]),
  }));
}

describe("the stylesheet is scoped and self-contained (AC22, AC23, SD12)", () => {
  const css = readFileSync(stylesheet, "utf8");

  it("the selector reader sees nested and grouped selectors", () => {
    expect(
      selectors(`.a, .b > c { x: 1 } @media (min-width: 1px) { .d:hover { y: 2 } } /* .e {} */`),
    ).toEqual([".a", ".b > c", ".d:hover"]);
  });

  it("every selector starts at .djv-control", () => {
    const all = selectors(css);
    expect(all.length).toBeGreaterThan(0);
    expect(all.filter((s) => !/^\.djv-control(?![\w-])/.test(s))).toEqual([]);
  });

  it("loads nothing: no url(, @import or @font-face", () => {
    expect(css).not.toMatch(/url\(|@import|@font-face/i);
  });
});

describe("the tokens meet the brief's contrast pairs (SD11, AC1)", () => {
  const css = readFileSync(stylesheet, "utf8");
  const declared = tokens(css);
  const table = pairs(readFileSync(brief, "utf8"));

  it("reads every pair of the brief's table", () => {
    expect(table.length).toBeGreaterThanOrEqual(32);
    expect(table.filter((p) => p.id.startsWith("T")).every((p) => p.min === 4.5)).toBe(true);
    expect(table.filter((p) => p.id.startsWith("N")).every((p) => p.min === 3)).toBe(true);
  });

  it.each(pairs(readFileSync(brief, "utf8")).map((p) => [p.id, p] as const))("%s", (_, pair) => {
    const fg = declared.get(pair.fg);
    const bg = declared.get(pair.bg);
    expect(fg, `${pair.fg} on .djv-control`).toMatch(/^#[0-9a-f]{6}$/i);
    expect(bg, `${pair.bg} on .djv-control`).toMatch(/^#[0-9a-f]{6}$/i);
    const ratio = contrast(fg!, bg!);
    expect(ratio).toBeGreaterThanOrEqual(pair.min);
    // The brief's number is the one the stylesheet gives.
    expect(Math.abs(ratio - pair.ratio)).toBeLessThan(0.006);
  });
});
