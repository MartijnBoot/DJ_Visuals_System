// `pnpm check:load` (B-08 SD4, SD8): the gate, `bash scripts/check.sh` unchanged, run while the
// loads in `under-load.ts` run beside it on port 8124. Exits with the gate's exit code, or 1 when
// a load died during a green run (PD5). Not part of the gate or CI. On Windows, run it from Git
// Bash, as the gate itself is: from PowerShell `bash` can resolve to WSL's.
//   node scripts/check-under-load.ts
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { LOAD_PORT } from "../tests/browser/fixtures/launch.ts";
import { runUnderLoad } from "./under-load.ts";

const root = resolve(import.meta.dirname, "..");

function runGate(signal: AbortSignal): Promise<number> {
  return new Promise((done) => {
    let settled = false;
    const settle = (code: number) => {
      if (!settled) done(code);
      settled = true;
    };
    const child = spawn("bash", ["scripts/check.sh"], { cwd: root, stdio: "inherit", signal });
    child.on("error", (error) => {
      if (!signal.aborted) console.error(`check:load: could not run the gate: ${error.message}`);
      settle(signal.aborted ? 130 : 1);
    });
    child.on("close", (code) => settle(signal.aborted ? 130 : (code ?? 1)));
  });
}

try {
  process.exit(await runUnderLoad({ port: LOAD_PORT, gate: ({ signal }) => runGate(signal) }));
} catch (error) {
  console.error(`check:load: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
