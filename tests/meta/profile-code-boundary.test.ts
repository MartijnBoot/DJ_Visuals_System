// B-03 AC24, SD1 (plan T16): profile code is GLSL only. It is never evaluated as JavaScript, so
// ESLint's no-eval, no-implied-eval and no-new-func fire on a snippet in `web/`, `engine/` and
// `scripts/`; and a custom effect's `code` is read only where it is validated, turned into
// shader source, keyed, or edited. The read is found with the type checker, not by text: the
// External control pairing code is also a `code`, and must not count.
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { ESLint } from "eslint";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { webConfig } from "./compat-check.ts";

const repoRoot = resolve(import.meta.dirname, "../..");

// One instance: loading the flat config and the TypeScript parser is the slow part.
const eslint = new ESLint({ cwd: repoRoot });

async function ruleIdsFor(snippet: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(snippet, { filePath: resolve(repoRoot, filePath) });
  return (result?.messages ?? []).map((m) => m.ruleId ?? "(fatal)");
}

// Joined so this file holds none of what it looks for.
const SNIPPETS: [rule: string, snippet: string][] = [
  ["no-eval", `export const run = (code: string) => ${["ev", "al"].join("")}(code);\n`],
  ["no-implied-eval", `export const later = () => setTimeout("draw()", 10);\n`],
  ["no-new-func", `export const make = (code: string) => new ${"Func"}tion(code);\n`],
];

describe("no string is evaluated as JavaScript (AC24)", () => {
  for (const place of ["web/src/x.ts", "engine/src/x.ts", "scripts/x.ts"]) {
    for (const [rule, snippet] of SNIPPETS) {
      it(`lint fails ${rule} in ${place}`, { timeout: 30_000 }, async () => {
        expect(await ruleIdsFor(snippet, place)).toContain(rule);
      });
    }
  }
});

/**
 * The files that read a custom effect's code: the engine's shader builder and its program key,
 * the builder's row, its reducer and its compile key. The schema validates the field without
 * reading it off an effect.
 */
const ALLOWED = new Set([
  "engine/src/index.ts",
  "engine/src/shader.ts",
  "web/src/builder/CustomRow.tsx",
  "web/src/builder/editor.ts",
  "web/src/builder/Preview.tsx",
]);

/** Every non-test source file of the app and the scripts, tracked or not yet. */
function sourceFiles(): string[] {
  return execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "*.ts", "*.tsx"],
    { cwd: repoRoot, encoding: "utf8" },
  )
    .split("\0")
    .filter((f) => /^(web|engine|shared|server|audio|scripts)\//.test(f))
    .filter((f) => !/\.test\.tsx?$/.test(f) && !f.startsWith("server/test/"));
}

/** A type that is, or has a union member that is, `{ type: "custom"; code: … }`. */
function isCustomEffect(checker: ts.TypeChecker, type: ts.Type): boolean {
  const members = type.isUnion() ? type.types : [type];
  return members.some((member) => {
    const kind = member.getProperty("type");
    if (!kind || !member.getProperty("code")) return false;
    const kindType = checker.getTypeOfSymbol(kind);
    return kindType.isStringLiteral() && kindType.value === "custom";
  });
}

/** The files, relative to the repository, that read `code` off a custom effect. */
function readersOfCode(): string[] {
  const files = sourceFiles();
  const { options } = webConfig();
  const program = ts.createProgram({
    rootNames: files.map((f) => resolve(repoRoot, f)),
    options: { ...options, noEmit: true },
  });
  const checker = program.getTypeChecker();
  const readers = new Set<string>();
  for (const file of files) {
    const source = program.getSourceFile(resolve(repoRoot, file));
    if (!source) continue;
    const visit = (node: ts.Node): void => {
      if (
        ts.isPropertyAccessExpression(node) &&
        node.name.text === "code" &&
        isCustomEffect(checker, checker.getTypeAtLocation(node.expression))
      ) {
        readers.add(file);
      }
      if (
        ts.isBindingElement(node) &&
        (node.propertyName ?? node.name).getText(source) === "code" &&
        ts.isObjectBindingPattern(node.parent) &&
        isCustomEffect(checker, checker.getTypeAtLocation(node.parent))
      ) {
        readers.add(file);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return [...readers].sort();
}

describe("a custom effect's code is read only where it becomes shader source (SD1)", () => {
  it("is read in the allowed files and nowhere else", { timeout: 120_000 }, () => {
    const readers = readersOfCode();
    expect(readers.filter((f) => !ALLOWED.has(f))).toEqual([]);
    // The scan sees the reads that exist: the engine's are the ones that matter.
    expect(readers).toContain("engine/src/shader.ts");
    expect(readers).toContain("engine/src/index.ts");
  });
});
