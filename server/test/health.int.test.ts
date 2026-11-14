// AC9, AC14 (request id), SD12: GET /api/health through the shared schema.
import { healthResponseSchema } from "@djv/shared";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { baseEnv, freePort, repoRoot, spawnServer, type SpawnedServer } from "./spawn-server.ts";

const realMigrations = resolve(repoRoot, "server/migrations");
const bootEntry = resolve(repoRoot, "server/test/fixtures/boot-entry.ts");

let tmp: string;
let server: SpawnedServer | undefined;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "djv-health-"));
});

afterEach(async () => {
  await server?.kill();
  server = undefined;
  rmSync(tmp, { recursive: true, force: true });
});

async function bootWith(migrationsDir?: string): Promise<number> {
  const port = await freePort();
  const env = baseEnv({ PORT: String(port), DATA_DIR: join(tmp, "data") });
  server = migrationsDir
    ? spawnServer(env, { entry: bootEntry, args: [migrationsDir] })
    : spawnServer(env);
  await server.waitForLine((l) => l.msg === "listening");
  return port;
}

describe("GET /api/health (AC9)", () => {
  it("answers 200 with a body that validates against the shared schema, version 2", async () => {
    const port = await bootWith();
    const response = await fetch(`http://127.0.0.1:${port}/api/health`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/application\/json/);
    const body = healthResponseSchema.parse(await response.json());
    expect(body.status).toBe("ok");
    expect(body.schemaVersion).toBe(2);
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(body.uptimeSeconds).toBeLessThan(30);
  });

  it("reports version 2 with a second migration applied", async () => {
    const dir = join(tmp, "migrations");
    mkdirSync(dir);
    copyFileSync(join(realMigrations, "0001_init.sql"), join(dir, "0001_init.sql"));
    writeFileSync(join(dir, "0002_more.sql"), "CREATE TABLE more (id INTEGER PRIMARY KEY);\n");
    const port = await bootWith(dir);
    const body = healthResponseSchema.parse(
      await (await fetch(`http://127.0.0.1:${port}/api/health`)).json(),
    );
    expect(body.schemaVersion).toBe(2);
  });

  it("logs the request's lines under one reqId", async () => {
    const port = await bootWith();
    await fetch(`http://127.0.0.1:${port}/api/health`);
    await server!.waitForLine((l) => l.msg === "request completed");
    const withReqId = server!.lines().filter((l) => "reqId" in l);
    expect(withReqId.length).toBeGreaterThanOrEqual(2);
    expect(new Set(withReqId.map((l) => l.reqId)).size).toBe(1);
  });

  it("answers 404 for an unknown /api path", async () => {
    const port = await bootWith();
    expect((await fetch(`http://127.0.0.1:${port}/api/nope`)).status).toBe(404);
  });
});
