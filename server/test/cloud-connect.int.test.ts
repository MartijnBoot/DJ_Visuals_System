// B-12 T7 (AC24, AC25, AC26, AC19, SD15, PD20): a local install booted in process with cloud
// settings, against the fake issuer: connect, the loopback callback, the session file,
// disconnect, a revoked sign-in kept across a restart. Every log line and every answer is
// scanned for the code, the refresh token and the ID token.
import { cloudConnectSchema, cloudStatusSchema } from "@djv/shared";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { boot, type Booted, type CloudInternals } from "../src/boot.ts";
import { loadConfig } from "../src/config.ts";
import { startFakeIssuer, type FakeIssuer } from "./fake-issuer.ts";
import { freePort, repoRoot } from "./spawn-server.ts";

const CLIENT = "local-connect-client";
let tmp: string;
let issuer: FakeIssuer;
let booted: Booted | undefined;
let internals: CloudInternals | undefined;
let base: string;
let lines: string[];
let answers: string[];

async function start(withCloud = true): Promise<void> {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  internals = undefined;
  booted = await boot(
    loadConfig({
      APP_ENV: "test",
      LOG_LEVEL: "debug",
      APP_MODE: "local",
      PORT: String(port),
      CONTROL_PORT: String(port + 1),
      DATA_DIR: join(tmp, "data"),
      ...(withCloud
        ? { CLOUD_URL: "http://127.0.0.1:9", OIDC_ISSUER: issuer.url, OIDC_CLIENT_ID: CLIENT }
        : {}),
    }),
    {
      migrationsDir: resolve(repoRoot, "server/migrations"),
      cloudInternals: (i) => (internals = i),
    },
    pino({ level: "debug" }, { write: (line: string) => void lines.push(line) }),
  );
}

async function restart(withCloud = true) {
  await booted?.close();
  await start(withCloud);
}

/** Fetches and keeps the answer's text for the secrets scan. */
async function call(method: string, path: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  const text = await response.text();
  answers.push(text);
  return { status: response.status, text, type: response.headers.get("content-type") };
}

const status = async () =>
  cloudStatusSchema.parse(JSON.parse((await call("GET", "/api/cloud/status")).text));

/** Connect → the provider → back to the loopback callback. */
async function connect() {
  const { url } = cloudConnectSchema.parse(
    JSON.parse((await call("POST", "/api/cloud/connect", {})).text),
  );
  const redirect = await fetch(url, { redirect: "manual" });
  const back = new URL(redirect.headers.get("location")!);
  expect(back.origin).toBe(base);
  return call("GET", `${back.pathname}${back.search}`);
}

const sessionFile = () => join(tmp, "data", "cloud", "session.json");

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), "djv-connect-"));
  lines = [];
  answers = [];
  issuer = await startFakeIssuer({ clientId: CLIENT });
  await start();
});

afterEach(async () => {
  await booted?.close();
  booted = undefined;
  await issuer.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("connect and disconnect (AC24)", () => {
  it("connects through the provider, keeps the session file, and disconnects leaving every profile", async () => {
    expect(await status()).toEqual({ state: "not_connected", lastSyncAt: null, conflicts: 0 });
    const created = await call("POST", "/api/profiles", {
      name: "Mine",
      palette: ["#000000", "#ffffff"],
      dials: { recognisability: 0.5, reactivity: 0.5 },
      effects: [],
    });
    expect(created.status).toBe(201);

    const page = await connect();
    expect(page.status).toBe(200);
    expect(page.type).toMatch(/^text\/html/);
    expect(page.text).toContain("Connected to the cloud — you can close this tab");
    expect(page.text).not.toContain("<script");
    expect(existsSync(sessionFile())).toBe(true);
    expect((await status()).state).toBe("connected");

    const after = await call("POST", "/api/cloud/disconnect", {});
    expect(cloudStatusSchema.parse(JSON.parse(after.text)).state).toBe("not_connected");
    expect(existsSync(sessionFile())).toBe(false);
    const list = JSON.parse((await call("GET", "/api/profiles")).text) as { profiles: unknown[] };
    expect(list.profiles).toHaveLength(1);
  });

  it("a callback with a wrong state answers the failure page and stores nothing", async () => {
    await call("POST", "/api/cloud/connect", {});
    const page = await call("GET", "/api/cloud/callback?code=fake-code-x&state=wrong");
    expect(page.status).toBe(400);
    expect(page.text).toContain("Sign-in failed — try again from the panel");
    expect(page.text).not.toContain("fake-code-x");
    expect(existsSync(sessionFile())).toBe(false);
  });
});

describe("a revoked sign-in (AC25)", () => {
  it("is signed_out, still after a restart, and the app keeps working", async () => {
    await connect();
    issuer.refuseRefresh = true;
    await restart();
    expect((await status()).state).toBe("connected"); // nothing has asked yet
    expect(await internals!.signin.idToken()).toEqual({ kind: "signed_out" });
    expect((await status()).state).toBe("signed_out");
    await restart();
    expect((await status()).state).toBe("signed_out");
    expect((await call("GET", "/api/profiles")).status).toBe(200);
  });
});

describe("no secret in a log line or an answer (AC26)", () => {
  it("holds none of the codes, refresh tokens or ID tokens of a connect, a renewal and a disconnect", async () => {
    await connect();
    await restart();
    await internals!.signin.idToken();
    await call("POST", "/api/cloud/disconnect", {});
    const secrets = [
      ...issuer.issued.codes,
      ...issuer.issued.refreshTokens,
      ...issuer.issued.idTokens,
    ];
    expect(issuer.issued.codes.length).toBeGreaterThanOrEqual(1);
    expect(issuer.issued.refreshTokens.length).toBeGreaterThanOrEqual(2);
    for (const secret of secrets) expect(secret.length).toBeGreaterThan(16);
    for (const text of [...lines, ...answers]) {
      for (const secret of secrets) expect(text).not.toContain(secret);
    }
  });
});

describe("without the cloud settings (AC19)", () => {
  it("has no /api/cloud/* at all", async () => {
    await restart(false);
    expect((await call("GET", "/api/cloud/status")).status).toBe(404);
    expect((await call("POST", "/api/cloud/connect", {})).status).toBe(404);
    expect(internals).toBeUndefined();
  });
});
