// B-12 T6 (AC1, AC2, AC11–AC13, AC15, AC18, PD16, PD17, PD21): the cloud's sync endpoints over
// HTTP, on a hosted server booted in process with an injected clock, against the fake issuer.
import {
  syncChangesSchema,
  syncDeleteSchema,
  syncFullSchema,
  storedProfileSchema,
  type Profile,
} from "@djv/shared";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { boot, type Booted } from "../src/boot.ts";
import { loadConfig } from "../src/config.ts";
import { startFakeIssuer, type FakeIssuer } from "./fake-issuer.ts";
import { freePort, repoRoot } from "./spawn-server.ts";

const CLIENT = "sync-api-client";
const ALLOWED = "sync-allowed-subject";
const DAY = 24 * 3600 * 1000;

const warm: Profile = {
  name: "Warm",
  palette: ["#1a0500", "#c2410c", "#fbbf24"],
  dials: { recognisability: 0.2, reactivity: 0.9 },
  effects: [{ type: "paletteMap", amount: 1 }],
};

let tmp: string;
let issuer: FakeIssuer;
let booted: Booted | undefined;
let base: string;
let clock: number;
let address = 0;

async function bootServer(mode: "hosted" | "local"): Promise<void> {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  booted = await boot(
    loadConfig({
      APP_ENV: "test",
      LOG_LEVEL: "warn",
      APP_MODE: mode,
      PORT: String(port),
      CONTROL_PORT: String(port + 1),
      DATA_DIR: join(tmp, mode),
      ...(mode === "hosted"
        ? { OIDC_ISSUER: issuer.url, OIDC_CLIENT_ID: CLIENT, ALLOWED_SUBJECT: ALLOWED }
        : {}),
    }),
    { migrationsDir: resolve(repoRoot, "server/migrations"), now: () => clock },
    pino({ level: "silent" }),
  );
}

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), "djv-sync-api-"));
  clock = Date.parse("2026-11-17T10:00:00.000Z");
  issuer = await startFakeIssuer({ clientId: CLIENT, subject: ALLOWED });
  await bootServer("hosted");
});

afterEach(async () => {
  await booted?.close();
  booted = undefined;
  await issuer.close();
  rmSync(tmp, { recursive: true, force: true });
});

async function call(method: string, path: string, body?: unknown, token = issuer.token()) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "x-forwarded-for": `10.1.${Math.floor(++address / 250)}.${(address % 250) + 1}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? (JSON.parse(text) as unknown) : null };
}

const changes = async (cursor: number, limit?: number) => {
  const answer = await call(
    "GET",
    `/api/sync/changes?cursor=${cursor}${limit === undefined ? "" : `&limit=${limit}`}`,
  );
  expect(answer.status).toBe(200);
  return syncChangesSchema.parse(answer.body);
};

describe("the endpoints (PD17)", () => {
  it("a push creates, the feed lists it, a push on its revision updates", async () => {
    const created = await call("PUT", "/api/sync/profiles/m-1", { ...warm, baseRevision: 0 });
    expect(created.status).toBe(200);
    expect(storedProfileSchema.parse(created.body)).toMatchObject({ id: "m-1", revision: 1 });
    const feed = await changes(0);
    expect(feed).toMatchObject({ cursor: 1, more: false });
    expect("changes" in feed && feed.changes[0]).toMatchObject({ kind: "profile", seq: 1 });
    const updated = await call("PUT", "/api/sync/profiles/m-1", {
      ...warm,
      name: "Warmer",
      baseRevision: 1,
    });
    expect(storedProfileSchema.parse(updated.body)).toMatchObject({ name: "Warmer", revision: 2 });
  });

  it("a stale push is 409 with the current profile (AC14)", async () => {
    await call("PUT", "/api/sync/profiles/m-1", { ...warm, baseRevision: 0 });
    await call("PUT", "/api/sync/profiles/m-1", { ...warm, name: "Cloud's", baseRevision: 1 });
    const stale = await call("PUT", "/api/sync/profiles/m-1", {
      ...warm,
      name: "Mine",
      baseRevision: 1,
    });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({
      error: "conflict",
      reason: "stale_revision",
      current: { name: "Cloud's", revision: 2 },
    });
  });

  it("an arrival under a taken name becomes Name (2) (AC15)", async () => {
    await call("PUT", "/api/sync/profiles/a", { ...warm, name: "Set", baseRevision: 0 });
    const second = await call("PUT", "/api/sync/profiles/b", {
      ...warm,
      name: "Set",
      baseRevision: 0,
    });
    expect(storedProfileSchema.parse(second.body).name).toBe("Set (2)");
  });

  it("deletes, refuses a delete after an edit, repeats, and 404s an unknown id (AC11, AC12)", async () => {
    await call("PUT", "/api/sync/profiles/a", { ...warm, name: "A", baseRevision: 0 });
    await call("PUT", "/api/sync/profiles/b", { ...warm, name: "B", baseRevision: 0 });
    await call("PUT", "/api/sync/profiles/b", { ...warm, name: "B edited", baseRevision: 1 });
    const done = await call("DELETE", "/api/sync/profiles/a?baseRevision=1");
    expect(syncDeleteSchema.parse(done.body)).toEqual({ deleted: true });
    expect(
      syncDeleteSchema.parse((await call("DELETE", "/api/sync/profiles/a?baseRevision=1")).body),
    ).toEqual({ deleted: true });
    const kept = await call("DELETE", "/api/sync/profiles/b?baseRevision=1");
    expect(syncDeleteSchema.parse(kept.body)).toMatchObject({
      deleted: false,
      current: { name: "B edited", revision: 2 },
    });
    expect((await call("DELETE", "/api/sync/profiles/zzz?baseRevision=1")).status).toBe(404);
    expect((await call("DELETE", "/api/sync/profiles/b")).status).toBe(400);
  });

  it("a push on a deleted id restores it with the same id (AC13)", async () => {
    await call("PUT", "/api/sync/profiles/a", { ...warm, baseRevision: 0 });
    await call("DELETE", "/api/sync/profiles/a?baseRevision=1");
    const restored = await call("PUT", "/api/sync/profiles/a", {
      ...warm,
      name: "Edited",
      baseRevision: 1,
    });
    expect(storedProfileSchema.parse(restored.body)).toMatchObject({
      id: "a",
      name: "Edited",
      revision: 2,
    });
  });

  it("the full set pages by id with the counter", async () => {
    for (const id of ["c", "a", "b"]) {
      await call("PUT", `/api/sync/profiles/${id}`, { ...warm, name: id, baseRevision: 0 });
    }
    const first = syncFullSchema.parse((await call("GET", "/api/sync/full?limit=2")).body);
    expect(first.profiles.map((p) => p.id)).toEqual(["a", "b"]);
    expect(first).toMatchObject({ counter: 3, more: true });
    const second = syncFullSchema.parse((await call("GET", "/api/sync/full?after=b&limit=2")).body);
    expect(second.profiles.map((p) => p.id)).toEqual(["c"]);
    expect(second.more).toBe(false);
  });

  it("refuses a body that fails the profile schema with 400 invalid", async () => {
    const answer = await call("PUT", "/api/sync/profiles/a", { ...warm, baseRevision: -1 });
    expect(answer.status).toBe(400);
    expect(answer.body).toMatchObject({ error: "invalid" });
  });

  it("pages of 50; limit=51 and a malformed cursor are 400 (PD21)", async () => {
    for (let i = 0; i < 51; i += 1) {
      await call("PUT", `/api/sync/profiles/p-${i}`, { ...warm, name: `P${i}`, baseRevision: 0 });
    }
    const page = await changes(0);
    expect("changes" in page && page.changes.length).toBe(50);
    expect(page).toMatchObject({ more: true, cursor: 50 });
    expect((await call("GET", "/api/sync/changes?cursor=0&limit=51")).status).toBe(400);
    expect((await call("GET", "/api/sync/changes?cursor=-1")).status).toBe(400);
    expect((await call("GET", "/api/sync/full?limit=51")).status).toBe(400);
  });

  it("a hosted /api/profiles edit appears in the feed", async () => {
    const created = await call("POST", "/api/profiles", warm);
    expect(created.status).toBe(201);
    const { id } = storedProfileSchema.parse(created.body);
    await call("PUT", `/api/profiles/${id}`, { ...warm, name: "Edited", revision: 1 });
    await call("DELETE", `/api/profiles/${id}`);
    const feed = await changes(0);
    expect("changes" in feed && feed.changes).toEqual([
      { kind: "tombstone", seq: 3, id, revision: 2 },
    ]);
  });
});

describe("90 days on (AC18)", () => {
  it("purges old tombstones and answers reset to a cursor below them", async () => {
    await call("PUT", "/api/sync/profiles/a", { ...warm, name: "A", baseRevision: 0 });
    await call("PUT", "/api/sync/profiles/b", { ...warm, name: "B", baseRevision: 0 });
    await call("DELETE", "/api/sync/profiles/a?baseRevision=1"); // seq 3
    clock += 91 * DAY;
    await call("PUT", "/api/sync/profiles/c", { ...warm, name: "C", baseRevision: 0 }); // seq 4
    expect(await changes(2)).toEqual({ reset: true });
    const fresh = await changes(0);
    expect("changes" in fresh && fresh.changes.map((c) => c.kind)).toEqual(["profile", "profile"]);
    expect(await changes(3)).toMatchObject({ cursor: 4, more: false });
  });
});

describe("who may sync (AC1, AC2)", () => {
  it.each([
    ["GET", "/api/sync/changes?cursor=0"],
    ["GET", "/api/sync/full"],
    ["PUT", "/api/sync/profiles/a"],
    ["DELETE", "/api/sync/profiles/a?baseRevision=0"],
  ])("%s %s is 401 without a token and 403 for another subject", async (method, path) => {
    const body = method === "PUT" ? { ...warm, baseRevision: 0 } : undefined;
    expect((await call(method, path, body, "")).status).toBe(401);
    expect((await call(method, path, body, issuer.token({ sub: "someone-else" }))).status).toBe(
      403,
    );
    expect(((await changes(0)) as { changes: unknown[] }).changes).toEqual([]);
  });
});

describe("a local install", () => {
  it("has no sync endpoints", async () => {
    await booted?.close();
    await bootServer("local");
    expect((await fetch(`${base}/api/sync/changes?cursor=0`)).status).toBe(404);
  });
});
