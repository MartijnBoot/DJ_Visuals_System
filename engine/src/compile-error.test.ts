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

  it("treats a body's first and last lines as its own, and lines beyond its function as not", () => {
    const at = (line: number) => locateErrors(`ERROR: 0:${line}: m`, bodies)[0]!.effectIndex;
    expect([96, 98, 100, 102].map(at)).toEqual([-1, 1, 1, -1]);
  });

  // B-03 review, finding 1: ANGLE reports a missing `;` on a body's last line at its function's
  // closing brace, and a missing `return` at its signature. Both are the body's errors.
  it("places an error on the body's own signature at its first line, on its closing brace at its last", () => {
    const log =
      "ERROR: 0:97: 'fx2Custom' : Function does not return a value\n" +
      "ERROR: 0:101: '}' : syntax error\n";
    expect(locateErrors(log, bodies)).toEqual([
      {
        effectIndex: 1,
        label: "Swirl",
        line: 1,
        message: "'fx2Custom' : Function does not return a value",
      },
      { effectIndex: 1, label: "Swirl", line: 3, message: "'}' : syntax error" },
    ]);
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
    // The body's own function wraps it directly: `locateErrors` counts these two lines as the
    // body's (B-03 review, finding 1).
    expect(lines[layout[0]!.firstLine - 2]).toBe("vec3 fx2Custom(vec2 uv) {");
    expect(lines[layout[0]!.firstLine + 1]).toBe("}");
    expect(lines[layout[1]!.firstLine - 2]).toBe("vec3 fx4Custom(vec2 uv) {");
    expect(lines[layout[1]!.firstLine]).toBe("}");
  });

  // B-03 review, finding 2: GLSL ends a line at a carriage return too, so a lone `\r` must
  // count as one, or every line after it is reported in the wrong place.
  it("counts a lone carriage return and a CRLF as one line end each, as the compiler does", () => {
    const entries = [
      { type: "custom", code: "vec3 a = source(uv);\rvec3 b = a;\r\nreturn b;" },
    ] as const;
    const source = buildFragment([...entries]);
    const [body] = fragmentLayout([...entries]);
    expect(body!.lineCount).toBe(3);
    const lines = source.split(/\r\n|\r|\n/);
    expect(lines[body!.firstLine - 1]).toBe("vec3 a = source(uv);");
    expect(lines[body!.firstLine + 1]).toBe("return b;");
    expect(lines[body!.firstLine + 2]).toBe("}");
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
