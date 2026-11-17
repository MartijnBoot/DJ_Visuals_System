// B-12 T14 (AC26, PD13): a scripted local connect, sync, conflict and disconnect against the
// in-process cloud and the fake issuer. Every log line of both servers and every answer body read
// is scanned for the ID tokens, refresh tokens, codes, subject and email collected during the run
// (each checked to be non-empty and of its shape first, so an empty list cannot pass), and the
// logs for a definition's marker colour.
import { cloudConnectSchema, profileListSchema, type Profile } from "@djv/shared";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { boot, type Booted, type CloudInternals } from "../src/boot.ts";
import { loadConfig } from "../src/config.ts";
import { FAKE_EMAIL, startFakeIssuer, type FakeIssuer } from "./fake-issuer.ts";
import { freePort, repoRoot } from "./spawn-server.ts";

const CLIENT = "secrets-client";
const MARKER = "#5e7a19";

let tmp: string;
let issuer: FakeIssuer;
const logs: string[] = [];
const bodies: string[] = [];
const servers: Booted[] = [];
let cloudBase: string;
let localBase: string;
let internals: CloudInternals | undefined;

const look = (name: string, shade = MARKER): Profile => ({
  name,
  palette: ["#000000", shade, "#ffffff"],
  dials: { recognisability: 0.5, reactivity: 0.5 },
  effects: [{ type: "paletteMap", amount: 1 }],
});

async function start(name: string, env: Record<string, string>): Promise<string> {
  const port = await freePort();
  servers.push(
    await boot(
      loadConfig({
        APP_ENV: "test",
        LOG_LEVEL: "debug",
        PORT: String(port),
        CONTROL_PORT: String(port + 1),
        DATA_DIR: join(tmp, name),
        ...env,
      } as Record<string, string>),
      {
        migrationsDir: resolve(repoRoot, "server/migrations"),
        cloudInternals: (i) => (internals = i),
      },
      pino({ level: "debug" }, { write: (line: string) => void logs.push(line) }),
    ),
  );
  return `http://127.0.0.1:${port}`;
}

async function call(base: string, method: string, path: string, body?: unknown, token?: string) {
  const response = await fetch(`${base}${path}`, {
    method,
    redirect: "manual",
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  bodies.push(text);
  return { status: response.status, text, location: response.headers.get("location") };
}

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "djv-secrets-"));
  issuer = await startFakeIssuer({ clientId: CLIENT });
  cloudBase = await start("cloud", {
    APP_MODE: "hosted",
    OIDC_ISSUER: issuer.url,
    OIDC_CLIENT_ID: CLIENT,
    ALLOWED_SUBJECT: issuer.subject,
  });
  localBase = await start("local", {
    APP_MODE: "local",
    CLOUD_URL: cloudBase,
    OIDC_ISSUER: issuer.url,
    OIDC_CLIENT_ID: CLIENT,
  });
});

afterAll(async () => {
  for (const server of servers) await server.close();
  await issuer.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("a whole scripted run (AC26)", () => {
  it("connect, sync, conflict and disconnect leave no secret in a log line or an answer", async () => {
    // Connect through the loopback sign-in.
    const { url } = cloudConnectSchema.parse(
      JSON.parse((await call(localBase, "POST", "/api/cloud/connect", {})).text),
    );
    const redirect = await fetch(url, { redirect: "manual" });
    const back = new URL(redirect.headers.get("location")!);
    expect((await call(localBase, "GET", `${back.pathname}${back.search}`)).status).toBe(200);

    // A profile, synced.
    const created = JSON.parse(
      (await call(localBase, "POST", "/api/profiles", look("Shared"))).text,
    ) as { id: string };
    await internals!.sync();

    // A conflict: the cloud's copy and this machine's both change.
    const token = issuer.token();
    const onCloud = JSON.parse(
      (await call(cloudBase, "GET", `/api/profiles/${created.id}`, undefined, token)).text,
    ) as { revision: number };
    await call(
      cloudBase,
      "PUT",
      `/api/profiles/${created.id}`,
      {
        ...look("Shared", "#aa0000"),
        revision: onCloud.revision,
      },
      token,
    );
    const local = JSON.parse(
      (await call(localBase, "GET", `/api/profiles/${created.id}`)).text,
    ) as {
      revision: number;
    };
    await call(localBase, "PUT", `/api/profiles/${created.id}`, {
      ...look("Shared", "#00bb00"),
      revision: local.revision,
    });
    const result = await internals!.sync();
    expect(result).toMatchObject({ outcome: "done", conflicts: 1 });
    expect(
      profileListSchema
        .parse(JSON.parse((await call(localBase, "GET", "/api/profiles")).text))
        .profiles.map((p) => p.name),
    ).toEqual(["Shared", "Shared (2)"]);

    // A renewal, then sign-out.
    issuer.refuseRefresh = true;
    await internals!.signin.renew();
    await call(localBase, "GET", "/api/cloud/status");
    await call(localBase, "POST", "/api/cloud/disconnect", {});

    // The collected secrets, each of its shape first.
    const { idTokens, refreshTokens, codes } = issuer.issued;
    // The code exchange's one; the renewal was refused, so it issued none.
    expect(idTokens.length).toBe(1);
    expect(refreshTokens.length).toBeGreaterThanOrEqual(1);
    expect(codes.length).toBe(1);
    for (const t of idTokens) expect(t).toMatch(/^[\w-]+\.[\w-]+\.[\w-]{40,}$/);
    for (const t of refreshTokens) expect(t).toMatch(/^fake-refresh-[0-9a-f]{32}$/);
    for (const c of codes) expect(c).toMatch(/^fake-code-[0-9a-f]{24}$/);
    expect(issuer.subject.length).toBeGreaterThan(8);
    // `token`: the one this test used on the cloud's API directly.
    const secrets = [...idTokens, token, ...refreshTokens, ...codes, issuer.subject, FAKE_EMAIL];

    expect(logs.length).toBeGreaterThan(20);
    for (const text of [...logs, ...bodies]) {
      for (const secret of secrets) expect(text).not.toContain(secret);
    }
    // PD13: definitions belong in the API's answers, never in a log line.
    expect(bodies.some((b) => b.includes(MARKER))).toBe(true);
    for (const line of logs) expect(line).not.toContain(MARKER);
  });
});
