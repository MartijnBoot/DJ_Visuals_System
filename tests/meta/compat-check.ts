// The compiler-API helper behind the compat tests (AC19; B-01 T6, B-02 T8): a compat file in
// `web/` is type-checked with `web/tsconfig.json`, optionally with one source file served
// rewritten, so a test can prove the type check fails when a shape drifts. `webConfig` is the
// one reader of `web/tsconfig.json` for these tests (B-08 PD8).
import { resolve } from "node:path";
import ts from "typescript";
import { expect } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../..");
const webDir = resolve(repoRoot, "web");
const webConfigPath = resolve(webDir, "tsconfig.json");

/**
 * `web/tsconfig.json` parsed: its options and the files its `include` resolves to on disk.
 * Compiles nothing. `override` replaces top-level keys of the raw config, so a test can plant
 * a config that leaves a folder out (B-08 AC7).
 */
export function webConfig(override: Record<string, unknown> = {}): ts.ParsedCommandLine {
  const raw = ts.readConfigFile(webConfigPath, ts.sys.readFile).config as Record<string, unknown>;
  return ts.parseJsonConfigFileContent(
    { ...raw, ...override },
    ts.sys,
    webDir,
    undefined,
    webConfigPath,
  );
}

export interface CompatTarget {
  /** The compat file, relative to the repository root, e.g. `web/src/features-compat.ts`. */
  compatFile: string;
  /** The source file whose text `mutate` rewrites, as a path suffix, e.g. `/audio/src/features.ts`. */
  mutated: string;
}

/** For the helper's own test: `drift` rewrites the real file as an edit to it would. */
export interface CompatOptions {
  drift?: (source: string) => string;
}

const baselines = new Map<string, string[]>();

/**
 * Type-checks the compat file with `mutate` rewriting the text of `target.mutated`, and returns
 * the compat file's own diagnostics: a mutated shape also breaks its own package, and those
 * errors must not stand in for the compat check (B-01 review finding 2).
 *
 * A mutation proves something only against an undrifted shape (B-08 AC6; owner 2026-11-14:
 * every drift is caught), so first: `mutate` must change the real text (checked before
 * compiling), and the unmutated compat file must have no diagnostic. That baseline compiles
 * once per compat file per run and is shared by its mutation tests.
 */
export function compatDiagnostics(
  target: CompatTarget,
  mutate: (source: string) => string,
  { drift }: CompatOptions = {},
): string[] {
  const real = ts.sys.readFile(resolve(repoRoot, target.mutated.replace(/^\//, "")));
  expect(real, `${target.mutated} could not be read`).toBeDefined();
  const current = drift ? drift(real!) : real!;
  expect(
    mutate(current),
    `the mutation of ${target.mutated} changed nothing: the real shape no longer has what ` +
      `the test rewrites, so it has drifted (B-08 AC6)`,
  ).not.toBe(current);

  let baseline = drift ? undefined : baselines.get(target.compatFile);
  if (baseline === undefined) {
    baseline = diagnosticsOf(target, drift);
    if (!drift) baselines.set(target.compatFile, baseline);
  }
  expect(
    baseline,
    `${target.compatFile} has drifted from ${target.mutated} before any mutation (B-08 AC6)`,
  ).toEqual([]);

  return diagnosticsOf(target, (source) => mutate(drift ? drift(source) : source));
}

/** The compat file's own diagnostics, with `rewrite` (if any) applied to `target.mutated`. */
function diagnosticsOf(target: CompatTarget, rewrite?: (source: string) => string): string[] {
  const compatFile = resolve(repoRoot, target.compatFile);
  const suffix = target.mutated.toLowerCase();
  const isMutated = (fileName: string) =>
    fileName.replace(/\\/g, "/").toLowerCase().endsWith(suffix);

  const { options } = webConfig();
  const host = ts.createCompilerHost(options);
  let served = false;
  if (rewrite) {
    const readFile = host.readFile.bind(host);
    const getSourceFile = host.getSourceFile.bind(host);
    host.readFile = (fileName) => {
      const text = readFile(fileName);
      return text !== undefined && isMutated(fileName) ? rewrite(text) : text;
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
  if (rewrite) expect(served, `the rewritten ${target.mutated} was never read`).toBe(true);
  return ts
    .getPreEmitDiagnostics(program)
    .filter((d) => d.file !== undefined && resolve(d.file.fileName) === compatFile)
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
}
