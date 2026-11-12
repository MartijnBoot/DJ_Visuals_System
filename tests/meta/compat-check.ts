// The compiler-API helper behind the compat tests (AC19; B-01 T6, B-02 T8): a compat file in
// `web/` is type-checked with `web/tsconfig.json`, optionally with one source file served
// rewritten, so a test can prove the type check fails when a shape drifts.
import { resolve } from "node:path";
import ts from "typescript";
import { expect } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../..");
const webDir = resolve(repoRoot, "web");

export interface CompatTarget {
  /** The compat file, relative to the repository root, e.g. `web/src/features-compat.ts`. */
  compatFile: string;
  /** The source file whose text `mutate` rewrites, as a path suffix, e.g. `/audio/src/features.ts`. */
  mutated: string;
}

/**
 * Type-checks the compat file; `mutate` rewrites the text of `target.mutated`. Returns the
 * compat file's own diagnostics only: a mutated shape also breaks its own package, and those
 * errors must not stand in for the compat check (B-01 review finding 2).
 */
export function compatDiagnostics(
  target: CompatTarget,
  mutate?: (source: string) => string,
): string[] {
  const compatFile = resolve(repoRoot, target.compatFile);
  const suffix = target.mutated.toLowerCase();
  const isMutated = (fileName: string) =>
    fileName.replace(/\\/g, "/").toLowerCase().endsWith(suffix);

  const configPath = resolve(webDir, "tsconfig.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, webDir);
  const host = ts.createCompilerHost(options);
  let served = false;
  if (mutate) {
    const readFile = host.readFile.bind(host);
    const getSourceFile = host.getSourceFile.bind(host);
    host.readFile = (fileName) => {
      const text = readFile(fileName);
      return text !== undefined && isMutated(fileName) ? mutate(text) : text;
    };
    host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
      if (!isMutated(fileName)) {
        return getSourceFile(fileName, languageVersion, onError, shouldCreate);
      }
      served = true;
      return ts.createSourceFile(fileName, host.readFile(fileName)!, languageVersion, true);
    };
  }
  const program = ts.createProgram({ rootNames: [compatFile], options, host });
  if (mutate) expect(served, `the mutated ${target.mutated} was never read`).toBe(true);
  return ts
    .getPreEmitDiagnostics(program)
    .filter((d) => d.file !== undefined && resolve(d.file.fileName) === compatFile)
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
}
