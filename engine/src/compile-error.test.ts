// B-03 T6 (spec AC10, AC14, AC21; plan PD9): a compiler log mapped onto the custom effect whose
// body owns each line, with the line counted in that body.
import { describe, expect, it } from "vitest";
import { locateErrors, ProfileCompileError } from "./compile-error.ts";
import { buildFragment, fragmentLayout } from "./shader.ts";

const bodies = [
  { effectIndex: 1, label: "Swirl", firstLine: 98, lineCount: 3 },
  { effectIndex: 3, label: "Glow", firstLine: 120, lineCount: 2 },
];

describe("locateErrors (PD9)", () => {
  it("gives one issue per error, in the body that owns its line, counted from 1", () => {
    // As Chromium's ANGLE prints it (seen 2026-11-15).
    const log =
      "ERROR: 0:99: 'nope' : undeclared identifier\n" +
      "ERROR: 0:121: 'missing' : undeclared identifier\n" +
      "Fragment shader is not compiled.\n";
    expect(locateErrors(log, bodies)).toEqual([
      { effectIndex: 1, label: "Swirl", line: 2, message: "'nope' : undeclared identifier" },
      { effectIndex: 3, label: "Glow", line: 2, message: "'missing' : undeclared identifier" },
    ]);
  });

  it("reports an error outside every body with effectIndex -1 and its own line", () => {
    expect(locateErrors("ERROR: 0:40: 'x' : syntax error", bodies)).toEqual([
      { effectIndex: -1, label: "", line: 40, message: "'x' : syntax error" },
    ]);
  });

  it("treats a body's first and last lines as its own, and the next line as not", () => {
    const at = (line: number) => locateErrors(`ERROR: 0:${line}: m`, bodies)[0]!.effectIndex;
    expect([97, 98, 100, 101].map(at)).toEqual([-1, 1, 1, -1]);
  });

  it("finds an error that follows the program's log on the same line", () => {
    const log = "WebGL2: program did not link: link failed ERROR: 0:99: 'nope' : x\n";
    expect(locateErrors(log, bodies)).toEqual([
      { effectIndex: 1, label: "Swirl", line: 2, message: "'nope' : x" },
    ]);
  });

  it("drops a repeated error (the program log can repeat the shader's) and finds none in prose", () => {
    const log = "ERROR: 0:99: 'nope' : x\nlink failed\nERROR: 0:99: 'nope' : x\n";
    expect(locateErrors(log, bodies)).toHaveLength(1);
    expect(locateErrors("Fragment shader is not compiled.", bodies)).toEqual([]);
  });
});

describe("fragmentLayout (PD9)", () => {
  it("names the lines each custom body occupies in the built source", () => {
    const entries = [
      "zoom",
      { type: "custom", code: "vec3 a = source(uv);\nreturn a;" },
      "flash",
      { type: "custom", code: "return source(uv);" },
    ] as const;
    const source = buildFragment([...entries]);
    const lines = source.split("\n");
    const layout = fragmentLayout([...entries]);
    expect(layout).toEqual([
      { effectIndex: 1, firstLine: expect.any(Number), lineCount: 2 },
      { effectIndex: 3, firstLine: expect.any(Number), lineCount: 1 },
    ]);
    expect(lines[layout[0]!.firstLine - 1]).toBe("vec3 a = source(uv);");
    expect(lines[layout[0]!.firstLine]).toBe("return a;");
    expect(lines[layout[1]!.firstLine - 1]).toBe("return source(uv);");
  });

  it("is empty for a built-in-only list", () => {
    expect(fragmentLayout(["zoom", "flash"])).toEqual([]);
  });
});

describe("ProfileCompileError", () => {
  it("carries the issues and names the first located effect in its message", () => {
    const error = new ProfileCompileError([
      { effectIndex: 1, label: "Swirl", line: 2, message: "'nope' : undeclared identifier" },
    ]);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ProfileCompileError");
    expect(error.issues).toHaveLength(1);
    expect(error.message).toContain('custom effect "Swirl", line 2');
  });
});
