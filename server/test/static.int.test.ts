// AC10, SD10, PD10: the one process serves the built app from a static folder given to it.
import { request } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { baseEnv, freePort, repoRoot, spawnServer, type SpawnedServer } from "./spawn-server.ts";

const staticEntry = resolve(repoRoot, "server/test/fixtures/static-entry.ts");
const PAGE = "<!doctype html><title>static-fixture-page</title>";
const SECRET = "outside-the-static-folder";

let tmp: string;
let server: SpawnedServer | undefined;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "djv-static-"));
});

afterEach(async () => {
  await server?.kill();
  server = undefined;
  rmSync(tmp, { recursive: true, force: true });
});

async function serve(staticDir: string): Promise<number> {
  const port = await freePort();
  server = spawnServer(baseEnv({ PORT: String(port), DATA_DIR: join(tmp, "data") }), {
    entry: staticEntry,
    args: [staticDir],
  });
  await server.waitForLine((l) => l.msg === "listening");
  return port;
}

/** A raw GET that sends the path exactly as written; `fetch` would normalise `..` away. */
function rawGet(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((res, rej) => {
    const req = request({ host: "127.0.0.1", port, path, method: "GET" }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => (body += chunk));
      response.on("end", () => res({ status: response.statusCode ?? 0, body }));
    });
    req.on("error", rej);
    req.end();
  });
}

function plantSite(): string {
  const site = join(tmp, "site");
  mkdirSync(site);
  writeFileSync(join(site, "index.html"), PAGE);
  writeFileSync(join(tmp, "secret.txt"), SECRET);
  return site;
}

describe("static serving (AC10)", () => {
  it("serves index.html at /", async () => {
    const port = await serve(plantSite());
    const response = await fetch(`http://127.0.0.1:${port}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/text\/html/);
    expect(await response.text()).toContain("static-fixture-page");
  });

  it("answers 404 for an unknown path outside /api", async () => {
    const port = await serve(plantSite());
    expect((await fetch(`http://127.0.0.1:${port}/nope`)).status).toBe(404);
  });

  it("still answers /api/health", async () => {
    const port = await serve(plantSite());
    const response = await fetch(`http://127.0.0.1:${port}/api/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ok" });
  });

  it("does not let a .. path escape the folder", async () => {
    const port = await serve(plantSite());
    for (const path of ["/../secret.txt", "/%2e%2e/secret.txt", "/..%2fsecret.txt"]) {
      const { status, body } = await rawGet(port, path);
      expect(status, path).not.toBe(200);
      expect(body, path).not.toContain(SECRET);
    }
  });
});

describe("boot without a built app (PD10)", () => {
  it("fails with one line and a non-zero exit when the folder has no index.html", async () => {
    const empty = join(tmp, "empty");
    mkdirSync(empty);
    const port = await freePort();
    server = spawnServer(baseEnv({ PORT: String(port), DATA_DIR: join(tmp, "data") }), {
      entry: staticEntry,
      args: [empty],
    });
    const { code } = await server.exited;
    expect(code).not.toBe(0);
    const lines = server.lines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: 60 });
    expect(JSON.stringify(lines[0])).toContain("index.html");
  });
});
