// B-12 T9 (AC5, AC11–AC16, AC18; spec Verification steps 1 and 2): one sync run at a time,
// started through the test hook. In process: a hosted cloud with an injected clock, the fake
// issuer, and two local installs A and B, each with its own DATA_DIR and connected through the
// real loopback sign-in. A reaches the cloud through `cloud-proxy`, so a run can be cut.
import {
  cloudConnectSchema,
  profileListSchema,
  type Profile,
  type StoredProfile,
} from "@djv/shared";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { boot, type Booted, type CloudInternals } from "../src/boot.ts";
import { loadConfig } from "../src/config.ts";
import { startCloudProxy, type CloudProxy } from "./cloud-proxy.ts";
import { startFakeIssuer, type FakeIssuer } from "./fake-issuer.ts";
import { freePort, repoRoot } from "./spawn-server.ts";

const CLIENT = "sync-client";
const DAY = 24 * 3600 * 1000;

interface Node {
  base: string;
  booted: Booted;
  internals?: CloudInternals;
  lines: string[];
}

let tmp: string;
let issuer: FakeIssuer;
let proxy: CloudProxy;
let clock: number;
let cloud: Node;
let a: Node;
let b: Node;

const look = (name: string, shade = "#222222"): Profile => ({
  name,
  palette: ["#000000", shade, "#ffffff"],
  dials: { recognisability: 0.5, reactivity: 0.5 },
  effects: [{ type: "paletteMap", amount: 1 }],
});

async function start(name: string, env: Record<string, string>): Promise<Node> {
  const port = await freePort();
  const node: Node = { base: `http://127.0.0.1:${port}`, lines: [] } as unknown as Node;
  node.booted = await boot(
    loadConfig({
      APP_ENV: "test",
      LOG_LEVEL: "info",
      PORT: String(port),
      CONTROL_PORT: String(port + 1),
      DATA_DIR: join(tmp, name),
      ...env,
    } as Record<string, string>),
    {
      migrationsDir: resolve(repoRoot, "server/migrations"),
      now: () => (name === "cloud" ? clock : Date.now()),
      cloudInternals: (internals) => (node.internals = internals),
      // Every run here is started by the test; the scheduler's timers never fire (T10).
      syncTimers: { set: () => 0, clear: () => {} },
    },
    pino({ level: "info" }, { write: (line: string) => void node.lines.push(line) }),
  );
  return node;
}

async function call(node: Node, method: string, path: string, body?: unknown, token?: string) {
  const response = await fetch(`${node.base}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? (JSON.parse(text) as unknown) : null };
}

/** The real loopback sign-in: connect, the provider, the callback. */
async function connect(node: Node) {
  const { url } = cloudConnectSchema.parse(
    (await call(node, "POST", "/api/cloud/connect", {})).body,
  );
  const back = new URL((await fetch(url, { redirect: "manual" })).headers.get("location")!);
  const page = await fetch(`${node.base}${back.pathname}${back.search}`);
  expect(page.status).toBe(200);
}

const list = async (node: Node, token?: string) =>
  profileListSchema.parse((await call(node, "GET", "/api/profiles", undefined, token)).body)
    .profiles;
const cloudList = () => list(cloud, issuer.token());
const names = async (node: Node, token?: string) => (await list(node, token)).map((p) => p.name);

async function create(node: Node, profile: Profile): Promise<StoredProfile> {
  const answer = await call(node, "POST", "/api/profiles", profile);
  expect(answer.status).toBe(201);
  return answer.body as StoredProfile;
}

async function edit(node: Node, id: string, profile: Profile) {
  const current = (await list(node)).find((p) => p.id === id)!;
  const answer = await call(node, "PUT", `/api/profiles/${id}`, {
    ...profile,
    revision: current.revision,
  });
  expect(answer.status).toBe(200);
}

const remove = async (node: Node, id: string) =>
  expect((await call(node, "DELETE", `/api/profiles/${id}`)).status).toBe(204);

const sync = async (node: Node) => node.internals!.sync();

/** What both sides must agree on: ids, names and definitions (AC5). */
const shapes = (profiles: StoredProfile[]) =>
  profiles.map(({ id, name, palette, dials, effects, conflictCopy }) => ({
    id,
    name,
    palette,
    dials,
    effects,
    conflictCopy: conflictCopy ?? false,
  }));

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), "djv-sync-"));
  clock = Date.parse("2026-11-17T10:00:00.000Z");
  issuer = await startFakeIssuer({ clientId: CLIENT });
  cloud = await start("cloud", {
    APP_MODE: "hosted",
    OIDC_ISSUER: issuer.url,
    OIDC_CLIENT_ID: CLIENT,
    ALLOWED_SUBJECT: issuer.subject,
  });
  proxy = await startCloudProxy(cloud.base);
  const local = (url: string) => ({
    APP_MODE: "local",
    CLOUD_URL: url,
    OIDC_ISSUER: issuer.url,
    OIDC_CLIENT_ID: CLIENT,
  });
  a = await start("a", local(proxy.url));
  b = await start("b", local(cloud.base));
  await connect(a);
  await connect(b);
});

afterEach(async () => {
  for (const node of [a, b, cloud]) await node?.booted.close();
  await proxy.close();
  await issuer.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("the first sync (AC5)", () => {
  it("A's three reach the cloud and B with the same ids, names and definitions", async () => {
    for (const name of ["One", "Two", "Three"]) await create(a, look(name));
    expect(await sync(a)).toMatchObject({ outcome: "done", pushed: 3 });
    expect(await sync(b)).toMatchObject({ outcome: "done", pulled: 3 });
    expect(await sync(a)).toMatchObject({ outcome: "done" });
    const onA = shapes(await list(a));
    expect(onA).toHaveLength(3);
    expect(shapes(await list(b))).toEqual(onA);
    expect(shapes(await cloudList())).toEqual(onA);
    expect(a.internals!.store.cursor()).toBeGreaterThan(0);
    expect(b.internals!.store.cursor()).toBeGreaterThan(0);
    expect(a.internals!.store.pending()).toEqual([]);
    expect(b.internals!.store.pending()).toEqual([]);
  });

  it("a run with nothing to move is one request", async () => {
    await sync(a);
    proxy.requests.length = 0;
    expect(await sync(a)).toMatchObject({ outcome: "done", pulled: 0, pushed: 0 });
    expect(proxy.requests).toEqual(["GET /api/sync/changes"]);
  });
});

describe("two machines (AC11–AC15)", () => {
  async function shared(name = "Shared"): Promise<StoredProfile> {
    const profile = await create(a, look(name));
    await sync(a);
    await sync(b);
    return profile;
  }

  it("an edit on each side keeps the cloud's under the name and the other as Name (2) on all three (AC14)", async () => {
    const p = await shared();
    await edit(a, p.id, look("Shared", "#aa0000"));
    await edit(b, p.id, look("Shared", "#00bb00"));
    await sync(a);
    expect((await sync(b)).conflicts).toBe(1);
    await sync(a);
    await sync(b);
    for (const node of [a, b]) {
      const profiles = await list(node);
      expect(profiles.map((x) => [x.name, x.palette[1], x.conflictCopy ?? false])).toEqual([
        ["Shared", "#aa0000", false],
        ["Shared (2)", "#00bb00", true],
      ]);
      expect(node.internals!.store.conflictCount()).toBe(1);
    }
    expect(shapes(await cloudList())).toEqual(shapes(await list(a)));
  });

  it("a delete on A reaches the cloud and B (AC11)", async () => {
    const p = await shared();
    await remove(a, p.id);
    await sync(a);
    expect(await cloudList()).toEqual([]);
    await sync(b);
    expect(await list(b)).toEqual([]);
    expect(b.internals!.store.pending()).toEqual([]);
  });

  it("a delete on A after B's pushed edit loses: A gets B's version back (AC12)", async () => {
    const p = await shared();
    await edit(b, p.id, look("Shared by B", "#0000cc"));
    await sync(b);
    await remove(a, p.id);
    await sync(a);
    expect(await names(a)).toEqual(["Shared by B"]);
    expect(await names(cloud, issuer.token())).toEqual(["Shared by B"]);
    expect(a.internals!.store.pending()).toEqual([]);
  });

  it("an edit on B of a profile A deleted restores it on the cloud with the same id (AC13)", async () => {
    const p = await shared();
    await remove(a, p.id);
    await sync(a);
    await edit(b, p.id, look("Kept by B"));
    await sync(b);
    const onCloud = await cloudList();
    expect(onCloud.map((x) => [x.id, x.name])).toEqual([[p.id, "Kept by B"]]);
    await sync(a);
    expect((await list(a)).map((x) => [x.id, x.name])).toEqual([[p.id, "Kept by B"]]);
  });

  it("each machine's own Set ends as Set and Set (2) on all three (AC15)", async () => {
    await create(a, look("Set"));
    await create(b, look("Set", "#333333"));
    await sync(a);
    await sync(b);
    await sync(a);
    for (const node of [a, b]) expect(await names(node)).toEqual(["Set", "Set (2)"]);
    expect(await names(cloud, issuer.token())).toEqual(["Set", "Set (2)"]);
    expect(new Set((await list(a)).map((x) => x.id)).size).toBe(2);
  });
});

describe("back after more than 90 days (AC18)", () => {
  it("B's cursor resets; it pulls the full set and keeps its unsynced edit as a copy", async () => {
    const kept = await create(a, look("Kept"));
    const gone = await create(a, look("Gone"));
    await sync(a);
    await sync(b);
    await remove(a, gone.id);
    await sync(a);
    await edit(b, kept.id, look("Kept", "#bb00bb"));
    clock += 91 * DAY;
    expect(await sync(b)).toMatchObject({ outcome: "done" });
    expect(b.lines.some((l) => l.includes("sync pulled the full set"))).toBe(true);
    const onB = await list(b);
    expect(onB.map((x) => [x.name, x.palette[1], x.conflictCopy ?? false])).toEqual([
      ["Kept", "#222222", false],
      ["Kept (2)", "#bb00bb", true],
    ]);
    expect(onB.find((x) => x.name === "Kept")!.id).toBe(kept.id);
    expect(await names(cloud, issuer.token())).toEqual(["Kept", "Kept (2)"]);
  });
});

describe("a run cut mid-way (AC16)", () => {
  it("leaves every profile whole, and the next run completes", async () => {
    for (const name of ["One", "Two", "Three"]) await create(a, look(name));
    proxy.passFor(2, { kind: "drop" }); // the pull and the first push only
    expect(await sync(a)).toMatchObject({ outcome: "offline", pushed: 1 });
    const half = await cloudList();
    expect(half).toHaveLength(1);
    expect(a.internals!.store.pending()).toHaveLength(2);
    expect(await names(a)).toEqual(["One", "Three", "Two"]);
    proxy.mode = { kind: "pass" };
    expect(await sync(a)).toMatchObject({ outcome: "done", pushed: 2 });
    expect(shapes(await cloudList())).toEqual(shapes(await list(a)));
    expect(a.internals!.store.pending()).toEqual([]);
  });

  it("answers 429 and 5xx as offline with the queue intact (AC17)", async () => {
    await create(a, look("Queued"));
    for (const status of [429, 503]) {
      proxy.mode = { kind: "status", status };
      expect((await sync(a)).outcome).toBe("offline");
      expect(a.internals!.store.pending()).toHaveLength(1);
    }
  });
});

describe("logs (SD18, AC26)", () => {
  it("say sync finished with counts, and hold no definition or token", async () => {
    await create(a, look("Marker-c9f1"));
    await sync(a);
    await sync(b);
    const finished = a.lines
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .filter((l) => l.msg === "sync finished")
      .at(-1); // the connect ran one of its own first
    expect(finished).toMatchObject({ pulled: 0, pushed: 1, conflicts: 0 });
    for (const line of [...a.lines, ...b.lines, ...cloud.lines]) {
      expect(line).not.toContain("#222222");
      for (const secret of [...issuer.issued.idTokens, ...issuer.issued.refreshTokens]) {
        expect(line).not.toContain(secret);
      }
    }
  });
});
