// B-08 AC2: `runUnderLoad` keeps its loads up for the whole gate run, returns the gate's exit
// code, says when a load died (PD5), and leaves nothing behind. The gate here is a stand-in;
// `pnpm check:load` passes `bash scripts/check.sh`. Never 8123 or 8124: the real harness may be
// holding them while the gate runs this file. No timing is asserted, so the tests carry no
// time limit of their own (the CI job's limit ends a hang).
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer, type Server } from "node:net";
import { expect, test } from "@playwright/test";
import { canBind } from "../../scripts/port-check.ts";
import { runUnderLoad, type Load } from "../../scripts/under-load.ts";
import { GATE_PORT, LOAD_PORT } from "./fixtures/launch.ts";
import { expectCanvasChanging } from "./helpers.ts";

test.describe.configure({ timeout: 0 });

function listen(port = 0): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port }, () => resolve(server));
  });
}

const close = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()));

function portOf(server: Server): number {
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  return address.port;
}

/** A port that is free now and is neither the gate's nor the real load's. */
async function freePort(): Promise<number> {
  for (;;) {
    const server = await listen();
    const port = portOf(server);
    await close(server);
    if (port !== GATE_PORT && port !== LOAD_PORT) return port;
  }
}

interface Seen {
  load?: Load;
  exited: number;
}

/** Records the load the stand-in gate was handed, and counts workers that exit. */
function watch(seen: Seen, load: Load) {
  seen.load = load;
  for (const worker of load.workers) worker.once("exit", () => (seen.exited += 1));
}

async function expectAllStopped(seen: Seen, port: number) {
  const load = seen.load!;
  expect(seen.exited, "every busy-loop worker exited").toBe(load.workers.length);
  expect(load.browser.isConnected(), "the load's Chromium is closed").toBe(false);
  expect(await canBind(port), `port ${port} is free again`).toBe(true);
}

test("keeps both loads up while the gate runs and returns the gate's code", async () => {
  const port = await freePort();
  const seen: Seen = { exited: 0 };
  const lines: string[] = [];

  const code = await runUnderLoad({
    port,
    log: (line) => lines.push(line),
    gate: async (load) => {
      watch(seen, load);
      const health = await fetch(`http://127.0.0.1:${port}/api/health`);
      expect(health.status).toBe(200);
      expect(load.workers).toHaveLength(Math.ceil(availableParallelism() / 2));
      await expectCanvasChanging(load.page);
      return 3;
    },
  });

  expect(code).toBe(3);
  expect(lines.join("\n")).toContain(`${seen.load!.workers.length} busy-loop`);
  expect(lines.join("\n")).toContain(String(port));
  expect(lines.join("\n")).not.toContain("load died");
  await expectAllStopped(seen, port);
});

test("a green gate gives 0", async () => {
  const port = await freePort();
  const seen: Seen = { exited: 0 };
  const code = await runUnderLoad({
    port,
    log: () => {},
    gate: async (load) => {
      watch(seen, load);
      return 0;
    },
  });
  expect(code).toBe(0);
  await expectAllStopped(seen, port);
});

test("a load that dies during a green gate makes the run 1 (PD5)", async () => {
  const port = await freePort();
  const seen: Seen = { exited: 0 };
  const lines: string[] = [];
  const code = await runUnderLoad({
    port,
    log: (line) => lines.push(line),
    gate: async (load) => {
      watch(seen, load);
      await load.workers[0]!.terminate();
      return 0;
    },
  });
  expect(code).toBe(1);
  expect(lines).toContain("load died: this run proves nothing");
  await expectAllStopped(seen, port);
});

test("a gate that throws still stops the loads and frees the port", async () => {
  const port = await freePort();
  const seen: Seen = { exited: 0 };
  await expect(
    runUnderLoad({
      port,
      log: () => {},
      gate: async (load) => {
        watch(seen, load);
        throw new Error("the stand-in gate broke");
      },
    }),
  ).rejects.toThrow("the stand-in gate broke");
  await expectAllStopped(seen, port);
});

/** The harness's temporary folders that exist now. */
const loadDirs = () => readdirSync(tmpdir()).filter((name) => name.startsWith("djv-load-"));

// In plain Node, as `pnpm check:load` runs it: Playwright's test runner turns off the library's
// own SIGINT handler for browsers launched inside a test, so an in-process test cannot see a
// harness that leaves that handler on (it exits the process before the teardown finishes;
// review finding R1).
const SIGINT_CHILD = `
const { runUnderLoad } = await import(process.argv[1]);
const code = await runUnderLoad({
  port: Number(process.argv[2]),
  log: () => {},
  gate: async (load) => {
    process.emit("SIGINT", "SIGINT");
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return load.signal.aborted ? 7 : 8;
  },
});
console.log("harness returned " + code);
`;

test("Ctrl-C during the gate stops everything and removes the temporary folder (PD6)", async () => {
  const port = await freePort();
  const before = loadDirs();
  const harness = pathToFileURL(resolve(import.meta.dirname, "../../scripts/under-load.ts")).href;
  const child = spawn(
    process.execPath,
    ["--input-type=module", "-e", SIGINT_CHILD, harness, String(port)],
    {
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  let out = "";
  child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
  const exit = await new Promise<number | null>((done) => child.once("exit", done));

  expect(out, "the harness ran its teardown and returned, told the gate to stop").toContain(
    "harness returned 7",
  );
  expect(exit).toBe(0);
  expect(await canBind(port), `port ${port} is free again`).toBe(true);
  expect(
    loadDirs().filter((name) => !before.includes(name)),
    "no temporary folder left",
  ).toEqual([]);
});

test("a held port fails before the gate is called, naming the port", async () => {
  const holder = await listen();
  const port = portOf(holder);
  let called = false;
  try {
    await expect(
      runUnderLoad({
        port,
        log: () => {},
        gate: async () => {
          called = true;
          return 0;
        },
      }),
    ).rejects.toThrow(String(port));
  } finally {
    await close(holder);
  }
  expect(called).toBe(false);
});
