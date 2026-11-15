// Compile errors of custom code (B-03 spec AC10, AC14, AC21, SD17; plan PD9). The compiler numbers
// lines in the whole generated fragment; a person needs the line in their own text box. The
// engine knows which lines each custom body occupies (`fragmentLayout`), so the log is mapped
// back here, as a pure function. Chromium's ANGLE prints `ERROR: 0:<line>: <message>` (B-01
// SD12: Chromium only); a log without that shape locates nothing and the caller keeps it whole.

/** One compile error: the custom effect whose body holds it, and the line in that body. */
export interface CompileIssue {
  /** Index in the profile's effect list; -1 for an error outside every custom body. */
  effectIndex: number;
  /** The effect's label; empty outside every body. */
  label: string;
  /** 1-based, in the body's own text; in the whole fragment when outside every body. */
  line: number;
  message: string;
}

/** The lines a custom body occupies in the fragment, 1-based, with the effect it belongs to. */
export interface BodyLines {
  effectIndex: number;
  label: string;
  firstLine: number;
  lineCount: number;
}

/**
 * The one place the log's shape is known. Not anchored to a line start: the link failure puts
 * the program's log and the shader's on one line (`gl.ts`, `programReady`).
 */
const ERROR_LINE = /ERROR:\s*\d+:(\d+):\s*([^\n]*)/g;

/** Each distinct error of `log`, placed in the body that owns its line. */
export function locateErrors(log: string, bodies: readonly BodyLines[]): CompileIssue[] {
  const seen = new Set<string>();
  const issues: CompileIssue[] = [];
  for (const match of log.matchAll(ERROR_LINE)) {
    const line = Number(match[1]);
    const message = match[2]!.trim();
    const key = `${line}:${message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const body = bodies.find((b) => line >= b.firstLine && line < b.firstLine + b.lineCount);
    issues.push(
      body
        ? {
            effectIndex: body.effectIndex,
            label: body.label,
            line: line - body.firstLine + 1,
            message,
          }
        : { effectIndex: -1, label: "", line, message },
    );
  }
  return issues;
}

/** `setProfile` rejects with this when custom code does not compile (PD9). */
export class ProfileCompileError extends Error {
  readonly issues: readonly CompileIssue[];

  constructor(issues: readonly CompileIssue[]) {
    const located = issues.find((i) => i.effectIndex >= 0);
    super(
      located
        ? `custom effect "${located.label}", line ${located.line}: ${located.message}`
        : `the profile's shader does not compile: ${issues[0]?.message ?? "no message"}`,
    );
    this.name = "ProfileCompileError";
    this.issues = issues;
  }
}
