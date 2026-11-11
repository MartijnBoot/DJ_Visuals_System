// AC19 (spec SD11; plan T6): the type check fails when `audio/`'s and `engine/`'s
// `AudioFeatures` drift apart. `web/src/features-compat.ts` is type-checked with the compiler
// API, once against the real `audio/src/features.ts` and once against a copy served with a
// field renamed. Only the first may pass.
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../..");
const webDir = resolve(repoRoot, "web");
const compatFile = resolve(webDir, "src/features-compat.ts");

const isAudioFeatures = (fileName: string) =>
  fileName.replace(/\\/g, "/").toLowerCase().endsWith("/audio/src/features.ts");

/** Type-checks the compat file with `web/tsconfig.json`; `mutate` rewrites audio's shape. */
function diagnostics(mutate?: (source: string) => string): string[] {
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
      return text !== undefined && isAudioFeatures(fileName) ? mutate(text) : text;
    };
    host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
      if (!isAudioFeatures(fileName)) {
        return getSourceFile(fileName, languageVersion, onError, shouldCreate);
      }
      served = true;
      return ts.createSourceFile(fileName, host.readFile(fileName)!, languageVersion, true);
    };
  }
  const program = ts.createProgram({ rootNames: [compatFile], options, host });
  if (mutate) expect(served, "the mutated audio/src/features.ts was never read").toBe(true);
  return ts
    .getPreEmitDiagnostics(program)
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
}

describe("AudioFeatures compatibility (AC19)", () => {
  it("type-checks against the real shapes", () => {
    expect(diagnostics()).toEqual([]);
  });

  it("fails when audio renames a field", () => {
    const renamed = (s: string) => s.replace(/^(\s*)level:/m, "$1loudness:");
    expect(renamed("export interface X {\n  level: number;\n}")).toContain("loudness:");
    const found = diagnostics(renamed);
    expect(found.length).toBeGreaterThan(0);
    expect(found.join("\n")).toMatch(/level|loudness/);
  });

  it("fails when audio adds a required field the engine lacks", () => {
    const extra = (s: string) =>
      s.replace(/^(\s*)level: number;/m, "$1level: number;\n$1tempo: number;");
    const found = diagnostics(extra);
    expect(found.join("\n")).toMatch(/tempo/);
  });
});
