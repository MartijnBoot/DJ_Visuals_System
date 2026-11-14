// AC3, AC4, AC7, AC14, AC19 against the real entry point.
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { connect, createServer, type Server } from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { baseEnv, freePort, spawnServer, type SpawnedServer } from "./spawn-server.ts";

let tmp: string;
let server: SpawnedServer | undefined;
let blocker: Server | undefined;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "djv-boot-"));
});

afterEach(async () => {
  await server?.kill();
  server = undefined;
  await new Promise<void>((res) => (blocker ? blocker.close(() => res()) : res()));
  blocker = undefined;
  rmSync(tmp, { recursive: true, force: true });
});

async function bootOk(overrides: Record<string, string> = {}) {
  const port = await freePort();
  const dataDir = join(tmp, "data");
  server = spawnServer(baseEnv({ PORT: String(port), DATA_DIR: dataDir, ...overrides }));
  await server.waitForLine((l) => l.msg === "listening");
  return { port, dataDir };
}

function fatalLines(s: SpawnedServer) {
  return s.lines().filter((l) => l.level === 60);
}

function variablesOf(line: Record<string, unknown>): string[] {
  return (line.problems as { variable: string }[]).map((p) => p.variable);
}

function refused(host: string, port: number): Promise<boolean> {
  return new Promise((res) => {
    const socket = connect({ host, port });
    const finish = (value: boolean) => {
      socket.destroy();
      res(value);
    };
    socket.setTimeout(5000, () => finish(true));
    socket.once("error", () => finish(true));
    socket.once("connect", () => finish(false));
  });
}

describe("boot (AC3, AC19)", () => {
  it("creates DATA_DIR and DATA_DIR/assets and listens on 127.0.0.1:PORT", async () => {
    const { port, dataDir } = await bootOk();
    expect(statSync(dataDir).isDirectory()).toBe(true);
    expect(statSync(join(dataDir, "assets")).isDirectory()).toBe(true);
    const listening = server!.lines().find((l) => l.msg === "listening")!;
    expect(listening.address).toBe("127.0.0.1");
    expect(listening.port).toBe(port);
    expect(await refused("127.0.0.1", port)).toBe(false);
  });

  it(
    "refuses connections on every non-internal IPv4 address of the machine (PD14)",
    { timeout: 30_000 },
    async () => {
      const { port } = await bootOk();
      const external = Object.values(networkInterfaces())
        .flat()
        .filter((i) => i !== undefined && i.family === "IPv4" && !i.internal)
        .map((i) => i!.address);
      // A refusal takes about two seconds on Windows, so the addresses are tried together.
      const results = await Promise.all(external.map((a) => refused(a, port)));
      expect(Object.fromEntries(external.map((a, i) => [a, results[i]]))).toEqual(
        Object.fromEntries(external.map((a) => [a, true])),
      );
    },
  );

  it(
    "refuses /api/profiles on every non-internal IPv4 address like health (B-02 AD6)",
    { timeout: 30_000 },
    async () => {
      const { port } = await bootOk();
      const external = Object.values(networkInterfaces())
        .flat()
        .filter((i) => i !== undefined && i.family === "IPv4" && !i.internal)
        .map((i) => i!.address);
      const reachable = await Promise.all(
        external.map((a) =>
          fetch(`http://${a}:${port}/api/profiles`, { signal: AbortSignal.timeout(10_000) }).then(
            () => true,
            () => false,
          ),
        ),
      );
      expect(Object.fromEntries(external.map((a, i) => [a, reachable[i]]))).toEqual(
        Object.fromEntries(external.map((a) => [a, false])),
      );
      expect((await fetch(`http://127.0.0.1:${port}/api/profiles`)).status).toBe(200);
    },
  );
});

describe("fail-fast config (AC4)", () => {
  it("exits non-zero with one line naming the variable, creating no directory", async () => {
    const dataDir = join(tmp, "data");
    server = spawnServer(baseEnv({ PORT: undefined, DATA_DIR: dataDir }));
    const { code } = await server.exited;
    expect(code).toBe(1);
    const fatal = fatalLines(server);
    expect(fatal).toHaveLength(1);
    expect(fatal[0]!.problems).toEqual([{ variable: "PORT", reason: "is missing" }]);
    expect(server.lines()).toHaveLength(1);
    expect(existsSync(dataDir)).toBe(false);
  });

  it("names every bad variable in that one line", async () => {
    server = spawnServer(baseEnv({ APP_ENV: "nope", LOG_LEVEL: undefined, PORT: "0" }));
    const { code } = await server.exited;
    expect(code).toBe(1);
    const fatal = fatalLines(server);
    expect(fatal).toHaveLength(1);
    expect(variablesOf(fatal[0]!)).toEqual(["APP_ENV", "LOG_LEVEL", "PORT", "DATA_DIR"]);
  });

  it("reports a DATA_DIR that cannot be created as DATA_DIR (PD6)", async () => {
    const file = join(tmp, "a-file");
    writeFileSync(file, "not a directory\n");
    const port = String(await freePort());
    server = spawnServer(baseEnv({ PORT: port, DATA_DIR: join(file, "data") }));
    const { code } = await server.exited;
    expect(code).toBe(1);
    const fatal = fatalLines(server);
    expect(fatal).toHaveLength(1);
    expect(variablesOf(fatal[0]!)).toEqual(["DATA_DIR"]);
  });
});

describe("port in use (AC7)", () => {
  it("exits non-zero with one line and never listens", async () => {
    const port = await freePort();
    blocker = createServer();
    await new Promise<void>((res) => blocker!.listen(port, "127.0.0.1", res));
    server = spawnServer(baseEnv({ PORT: String(port), DATA_DIR: join(tmp, "data") }));
    const { code } = await server.exited;
    expect(code).toBe(1);
    const fatal = fatalLines(server);
    expect(fatal).toHaveLength(1);
    expect(fatal[0]!.code).toBe("EADDRINUSE");
    expect(server.lines().filter((l) => l.msg === "listening")).toHaveLength(0);
  });
});

describe("JSON logs (AC14, PD7)", () => {
  it("every line is JSON, debug is absent at info, a request's lines share one reqId", async () => {
    const { port } = await bootOk({ LOG_LEVEL: "info" });
    const response = await fetch(`http://127.0.0.1:${port}/nope`);
    expect(response.status).toBe(404);
    await server!.waitForLine((l) => l.msg === "request completed");
    const lines = server!.lines(); // throws on a non-JSON line
    expect(lines.every((l) => typeof l.level === "number")).toBe(true);
    expect(lines.filter((l) => (l.level ?? 0) < 30)).toEqual([]);
    const withReqId = lines.filter((l) => "reqId" in l);
    expect(withReqId.length).toBeGreaterThanOrEqual(2);
    expect(new Set(withReqId.map((l) => l.reqId)).size).toBe(1);
  });

  it("debug lines appear at debug", async () => {
    await bootOk({ LOG_LEVEL: "debug" });
    expect(server!.lines().some((l) => l.level === 20)).toBe(true);
  });

  it("never carries a key or value of the inherited environment", async () => {
    const sentinel = "sentinel-value-that-must-not-be-logged";
    const { port } = await bootOk({ DJV_TEST_SENTINEL: sentinel });
    await fetch(`http://127.0.0.1:${port}/x`);
    await server!.waitForLine((l) => l.msg === "request completed");
    const envKeys = ["APP_ENV", "LOG_LEVEL", "PORT", "DATA_DIR", "DJV_TEST_SENTINEL"];
    const keysOf = (v: unknown): string[] =>
      v && typeof v === "object"
        ? Object.entries(v).flatMap(([k, inner]) => [k, ...keysOf(inner)])
        : [];
    for (const line of server!.lines()) {
      expect(keysOf(line).filter((k) => envKeys.includes(k))).toEqual([]);
      expect(JSON.stringify(line)).not.toContain(sentinel);
    }
  });
});
