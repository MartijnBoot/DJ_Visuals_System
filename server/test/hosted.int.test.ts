// B-12 T5 (AC1–AC4, AC27, SD4–SD6, SD17, PD10–PD12): a hosted server as a child process, against
// the fake issuer in this process. Each refused request comes from its own forwarded address, so
// the rate limit (tested on its own below) never decides a case.
import { toProfileFile, type Profile } from "@djv/shared";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFakeIssuer, type FakeIssuer } from "./fake-issuer.ts";
import { baseEnv, freePort, spawnServer, type SpawnedServer } from "./spawn-server.ts";

const CLIENT = "hosted-test-client";
const ALLOWED = "allowed-subject-7f3a";
const OTHER = "other-subject-91bc";

const warm: Profile = {
  name: "Warm",
  palette: ["#1a0500", "#c2410c", "#fbbf24"],
  dials: { recognisability: 0.2, reactivity: 0.9 },
  effects: [{ type: "paletteMap", amount: 1 }],
};

let tmp: string;
let issuer: FakeIssuer;
let otherIssuer: FakeIssuer;
let server: SpawnedServer;
let base: string;
let address = 0;

/** A fresh forwarded address per call, so no case shares a rate-limit window. */
const nextAddress = () => `10.0.${Math.floor(++address / 250)}.${(address % 250) + 1}`;

async function call(
  method: string,
  path: string,
  token?: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${base}${path}`, {
    method,
    headers: {
      "x-forwarded-for": nextAddress(),
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const good = () => issuer.token({ sub: ALLOWED });

async function profileCount(): Promise<number> {
  const response = await call("GET", "/api/profiles", good());
  expect(response.status).toBe(200);
  return ((await response.json()) as { profiles: unknown[] }).profiles.length;
}

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "djv-hosted-"));
  issuer = await startFakeIssuer({ clientId: CLIENT, subject: ALLOWED });
  otherIssuer = await startFakeIssuer({ clientId: CLIENT, subject: ALLOWED });
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  server = spawnServer(
    baseEnv({
      APP_MODE: "hosted",
      PORT: String(port),
      DATA_DIR: join(tmp, "data"),
      OIDC_ISSUER: issuer.url,
      OIDC_CLIENT_ID: CLIENT,
      ALLOWED_SUBJECT: ALLOWED,
    }),
  );
  await server.waitForLine((l) => l.msg === "listening");
});

afterAll(async () => {
  await server?.kill();
  await issuer?.close();
  await otherIssuer?.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("the allowed subject (SD4)", () => {
  it("creates, reads, updates, imports and deletes", async () => {
    const created = await call("POST", "/api/profiles", good(), warm);
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    expect((await call("GET", `/api/profiles/${id}`, good())).status).toBe(200);
    const put = await call("PUT", `/api/profiles/${id}`, good(), { ...warm, revision: 1 });
    expect(put.status).toBe(200);
    const imported = await call("POST", "/api/profiles/import", good(), toProfileFile([warm]));
    expect(imported.status).toBe(201);
    expect((await call("DELETE", `/api/profiles/${id}`, good())).status).toBe(204);
  });
});

describe("refused tokens (AC1, AC3)", () => {
  const kinds: [string, () => string | undefined][] = [
    ["no token", () => undefined],
    [
      "an expired token",
      () => issuer.token({ sub: ALLOWED, exp: Math.floor(Date.now() / 1000) - 120 }),
    ],
    ["a token of another key", () => issuer.token({ sub: ALLOWED }, { secondKey: true })],
    ["a token of another issuer", () => otherIssuer.token({ sub: ALLOWED })],
    ["garbage", () => "not.a.token"],
  ];

  it.each(kinds)("%s gets 401 on every profile route and changes nothing", async (_name, make) => {
    const keep = await call("POST", "/api/profiles", good(), { ...warm, name: `Keep ${_name}` });
    const { id } = (await keep.json()) as { id: string };
    const before = await profileCount();
    const routes: [string, string, unknown?][] = [
      ["GET", "/api/profiles"],
      ["POST", "/api/profiles", { ...warm, name: "Intruder" }],
      ["GET", `/api/profiles/${id}`],
      ["PUT", `/api/profiles/${id}`, { ...warm, name: "Changed", revision: 1 }],
      ["DELETE", `/api/profiles/${id}`],
      ["POST", "/api/profiles/import", toProfileFile([{ ...warm, name: "Imported" }])],
    ];
    for (const [method, path, body] of routes) {
      const response = await call(method, path, make(), body);
      expect(response.status, `${method} ${path}`).toBe(401);
      expect(await response.json()).toEqual({ error: "unauthorized" });
    }
    expect(await profileCount()).toBe(before);
    const kept = await call("GET", `/api/profiles/${id}`, good());
    expect(((await kept.json()) as { name: string }).name).toBe(`Keep ${_name}`);
  });
});

describe("another subject (AC2)", () => {
  it("gets 403 on every profile route, changes nothing, and no log line holds its subject", async () => {
    const before = await profileCount();
    const other = () => issuer.token({ sub: OTHER });
    for (const [method, path, body] of [
      ["GET", "/api/profiles"],
      ["POST", "/api/profiles", { ...warm, name: "Theirs" }],
      ["POST", "/api/profiles/import", toProfileFile([warm])],
    ] as [string, string, unknown?][]) {
      const response = await call(method, path, other(), body);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "forbidden" });
    }
    expect(await profileCount()).toBe(before);
    await server.waitForLine((l) => l.outcome === "forbidden");
    for (const line of server.lines()) expect(JSON.stringify(line)).not.toContain(OTHER);
  });
});

describe("the rate limit through the proxy's address (SD17, PD11)", () => {
  it("refuses the 11th request from one forwarded address with 429, and not another address", async () => {
    const from = (ip: string, token?: string) =>
      fetch(`${base}/api/profiles`, {
        headers: {
          "x-forwarded-for": ip,
          ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
        },
      });
    for (let i = 0; i < 10; i += 1) expect((await from("10.200.0.1")).status).toBe(401);
    const blocked = await from("10.200.0.1", good());
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: "rate_limited" });
    expect((await from("10.200.0.2", good())).status).toBe(200);
  });
});

describe("what stays open (SD5)", () => {
  it("serves /api/health without a token, saying hosted and the public sign-in settings", async () => {
    const response = await call("GET", "/api/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      mode: "hosted",
      cloud: false,
      signIn: { issuer: issuer.url, clientId: CLIENT },
    });
  });
});

describe("nothing of External control (AC4, PD10)", () => {
  it.each(["/control", "/send", "/trust", "/api/control/screen", "/api/control/device"])(
    "answers 404 on GET %s",
    async (path) => {
      expect((await call("GET", path, good())).status).toBe(404);
    },
  );

  it.each(["/api/control/screen", "/api/control/device", "/"])(
    "answers a WebSocket upgrade on %s with 404",
    async (path) => {
      const status = await new Promise<number>((resolve, reject) => {
        const req = httpRequest(`${base}${path}`, {
          headers: {
            connection: "Upgrade",
            upgrade: "websocket",
            "sec-websocket-version": "13",
            "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
            origin: base,
          },
        });
        req.on("response", (response) => resolve(response.statusCode ?? 0));
        req.on("upgrade", () => resolve(101));
        req.on("error", reject);
        req.end();
      });
      expect(status).toBe(404);
    },
  );

  it("never creates DATA_DIR/tls", () => {
    expect(existsSync(join(tmp, "data"))).toBe(true);
    expect(existsSync(join(tmp, "data", "tls"))).toBe(false);
  });
});

describe("the listener and its answers (AC27, SD6, SD17, PD12)", () => {
  it("listens on 127.0.0.1", async () => {
    const line = await server.waitForLine((l) => l.msg === "listening");
    expect(line.address).toBe("127.0.0.1");
  });

  it("sends no CORS header, even to a foreign Origin", async () => {
    for (const [method, path, token] of [
      ["GET", "/api/health", undefined],
      ["GET", "/api/profiles", good()],
      ["GET", "/api/profiles", undefined],
      ["OPTIONS", "/api/profiles", undefined],
    ] as [string, string, string | undefined][]) {
      const response = await call(method, path, token, undefined, {
        origin: "https://evil.example.test",
      });
      expect(response.headers.get("access-control-allow-origin"), `${method} ${path}`).toBeNull();
    }
  });

  it("logs a request's path without its query", async () => {
    const marker = "querymarker5d1e";
    await call("GET", `/api/health?code=${marker}&state=${marker}`);
    await call("GET", `/api/profiles?cursor=${marker}`, good());
    await server.waitForLine((l) => l.msg === "request completed" && l.reqId !== undefined);
    await new Promise((r) => setTimeout(r, 200));
    const logged = server.lines().map((l) => JSON.stringify(l));
    expect(logged.some((l) => l.includes('"url":"/api/health"'))).toBe(true);
    for (const line of logged) expect(line).not.toContain(marker);
  });

  it("logs no token", async () => {
    const token = good();
    await call("GET", "/api/profiles", token);
    await new Promise((r) => setTimeout(r, 200));
    const signature = token.split(".")[2]!;
    for (const line of server.lines()) expect(JSON.stringify(line)).not.toContain(signature);
  });
});
