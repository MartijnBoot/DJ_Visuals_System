// AC16 (plan PD13): the renderer is framework-free. `engine/package.json` declares no
// dependency of any kind, and the compiled output of every non-test file under engine/src
// has no bare module specifier, static or dynamic. Relative imports inside the package are
// allowed. A self-check proves the detector does flag a bare import.
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../..");
const engineDir = resolve(repoRoot, "engine");
const srcDir = join(engineDir, "src");

const dependencyFields = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

function isBare(specifier: string): boolean {
  return !specifier.startsWith("./") && !specifier.startsWith("../") && !specifier.startsWith("/");
}

/** Compiles one TypeScript source and returns every module specifier left in the output. */
export function compiledSpecifiers(source: string, fileName = "sample.ts"): string[] {
  const { outputText } = ts.transpileModule(source, {
    fileName,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
  });
  const out = ts.createSourceFile("out.js", outputText, ts.ScriptTarget.ES2022, true);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      found.push(node.moduleSpecifier.text);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      found.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(out);
  return found;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .map((f) => join(dir, f));
}

describe("engine boundary (AC16)", () => {
  it("the detector flags a bare import, static and dynamic, and not a relative one", () => {
    expect(compiledSpecifiers('import React from "react";\nexport const a = React;')).toEqual([
      "react",
    ]);
    expect(compiledSpecifiers('export const p = import("fastify");')).toEqual(["fastify"]);
    expect(compiledSpecifiers('export * from "zod";')).toEqual(["zod"]);
    expect(compiledSpecifiers('import { a } from "./a.ts";\nexport const b = a;')).toEqual([
      "./a.ts",
    ]);
    // A type-only import is erased and so is not an import at all.
    expect(compiledSpecifiers('import type { A } from "react";\nexport const a: A = 1;')).toEqual(
      [],
    );
  });

  it("engine/package.json declares no dependency of any kind", () => {
    const manifest = JSON.parse(readFileSync(join(engineDir, "package.json"), "utf8"));
    expect(Object.keys(manifest).filter((k) => dependencyFields.includes(k))).toEqual([]);
  });

  it("engine/tsconfig.json includes no Node types", () => {
    const tsconfig = JSON.parse(readFileSync(join(engineDir, "tsconfig.json"), "utf8"));
    expect(tsconfig.compilerOptions?.types ?? []).toEqual([]);
  });

  it("the compiled output of every engine source file imports nothing bare", () => {
    const files = sourceFiles(srcDir);
    expect(files.length).toBeGreaterThan(0);
    const offenders: Record<string, string[]> = {};
    for (const file of files) {
      const bare = compiledSpecifiers(readFileSync(file, "utf8"), file).filter(isBare);
      if (bare.length > 0) offenders[file] = bare;
    }
    expect(offenders).toEqual({});
  });
});
