// T7 (B-02 spec AC2, AC5 to AC8, AC10, AC13, AC21; plan PD10, PD11): the profile endpoints against
// the spawned server.
import {
  conflictErrorSchema,
  invalidErrorSchema,
  profileListSchema,
  storedProfileSchema,
  toProfileFile,
  type Profile,
  type StoredProfile,
} from "@djv/shared";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db.ts";
import { baseEnv, freePort, spawnServer, type SpawnedServer } from "./spawn-server.ts";

const warm: Profile = {
  name: "Warm",
  palette: ["#1a0500", "#c2410c", "#fbbf24"],
  dials: { recognisability: 0.2, reactivity: 0.9 },
  effects: [
    { type: "paletteMap", amount: 1 },
    { type: "flash", amount: 0, binding: { feature: "beat", amount: 1 }, colourSlot: 2 },
    { type: "mirror", amount: 0.5, segments: 6 },
  ],
};

let tmp: string;
let dataDir: string;
let server: SpawnedServer | undefined;
let base: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "djv-profiles-"));
  dataDir = join(tmp, "data");
});

afterEach(async () => {
  await server?.kill();
  server = undefined;
  rmSync(tmp, { recursive: true, force: true });
});

async function boot(): Promise<void> {
  const port = await freePort();
  server = spawnServer(baseEnv({ PORT: String(port), DATA_DIR: dataDir, LOG_LEVEL: "info" }));
  await server.waitForLine((l) => l.msg === "listening");
  base = `http://127.0.0.1:${port}`;
}

async function restart(): Promise<void> {
  await server?.kill();
  await boot();
}

const JSON_HEADERS = { "content-type": "application/json" };

const post = (path: string, body: unknown, headers: Record<string, string> = JSON_HEADERS) =>
  fetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body) });

const put = (id: string, body: unknown) =>
  fetch(`${base}/api/profiles/${id}`, {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });

async function create(profile: Profile = warm): Promise<StoredProfile> {
  const response = await post("/api/profiles", profile);
  expect(response.status).toBe(201);
  return storedProfileSchema.parse(await response.json());
}

async function list(): Promise<StoredProfile[]> {
  const response = await fetch(`${base}/api/profiles`);
  expect(response.status).toBe(200);
  return profileListSchema.parse(await response.json()).profiles;
}

describe("the round trip (AC2, AC5)", () => {
  it("creates, gets, lists alphabetically and case-insensitively, updates and deletes", async () => {
    await boot();
    expect(await list()).toEqual([]);
    const stored = await create();
    expect(stored).toMatchObject({ ...warm, revision: 1 });
    for (const name of ["beta", "Alpha", "Delta"]) await create({ ...warm, name });

    expect((await list()).map((p) => p.name)).toEqual(["Alpha", "beta", "Delta", "Warm"]);
    const got = await fetch(`${base}/api/profiles/${stored.id}`);
    expect(got.status).toBe(200);
    expect(storedProfileSchema.parse(await got.json())).toEqual(stored);

    const edited = { ...warm, palette: ["#000000", "#ffffff"], effects: [], revision: 1 };
    const updated = await put(stored.id, edited);
    expect(updated.status).toBe(200);
    expect(storedProfileSchema.parse(await updated.json())).toMatchObject({
      palette: ["#000000", "#ffffff"],
      effects: [],
      revision: 2,
      id: stored.id,
    });

    expect((await fetch(`${base}/api/profiles/${stored.id}`, { method: "DELETE" })).status).toBe(
      204,
    );
    expect((await fetch(`${base}/api/profiles/${stored.id}`)).status).toBe(404);
    expect((await fetch(`${base}/api/profiles/${stored.id}`, { method: "DELETE" })).status).toBe(
      404,
    );
    expect((await put(stored.id, edited)).status).toBe(404);
  });

  it("holds a saved profile equal across a restart (AC5)", async () => {
    await boot();
    const stored = await create();
    const saved = storedProfileSchema.parse(
      await (await put(stored.id, { ...warm, name: "Warmer", revision: 1 })).json(),
    );
    await restart();
    expect(await list()).toEqual([saved]);
  });
});

describe("conflicts (AC6, AC7)", () => {
  it("refuses a stale save with 409 stale_revision, the current profile, and stores nothing", async () => {
    await boot();
    const stored = await create();
    const first = await put(stored.id, { ...warm, name: "First", revision: 1 });
    expect(first.status).toBe(200);
    const current = storedProfileSchema.parse(await first.json());

    const stale = await put(stored.id, { ...warm, name: "Second", revision: 1 });
    expect(stale.status).toBe(409);
    const body = conflictErrorSchema.parse(await stale.json());
    expect(body).toEqual({ error: "conflict", reason: "stale_revision", current });
    expect(await list()).toEqual([current]);
  });

  it("refuses a create and a rename onto a taken name in another case with 409 name_taken", async () => {
    await boot();
    await create({ ...warm, name: "Cool" });
    const other = await create();
    const created = await post("/api/profiles", { ...warm, name: "COOL" });
    expect(created.status).toBe(409);
    expect(await created.json()).toEqual({ error: "conflict", reason: "name_taken" });
    const renamed = await put(other.id, { ...warm, name: "cool", revision: 1 });
    expect(renamed.status).toBe(409);
    expect(await renamed.json()).toEqual({ error: "conflict", reason: "name_taken" });
    expect((await list()).map((p) => p.name)).toEqual(["Cool", "Warm"]);
  });
});

describe("validation (AC8)", () => {
  const clauses: [string, (p: Profile) => unknown, string][] = [
    [
      "an unknown effect type",
      (p) => ({ ...p, effects: [{ type: "blur", amount: 0.5 }] }),
      "effects.0.type",
    ],
    [
      "an amount of 1.5",
      (p) => ({ ...p, effects: [{ type: "zoom", amount: 1.5 }] }),
      "effects.0.amount",
    ],
    [
      "a repeated type",
      (p) => ({
        ...p,
        effects: [
          { type: "zoom", amount: 0 },
          { type: "zoom", amount: 0 },
        ],
      }),
      "effects.1.type",
    ],
    [
      "thirteen effects",
      (p) => ({ ...p, effects: Array.from({ length: 13 }, () => ({ type: "zoom", amount: 0 })) }),
      "effects",
    ],
    ["one colour", (p) => ({ ...p, palette: ["#000000"] }), "palette"],
    ["seven colours", (p) => ({ ...p, palette: Array(7).fill("#000000") }), "palette"],
    ["a malformed colour", (p) => ({ ...p, palette: ["#000000", "#12345"] }), "palette.1"],
    [
      "a binding naming no feature",
      (p) => ({
        ...p,
        effects: [{ type: "zoom", amount: 0, binding: { feature: "tempo", amount: 1 } }],
      }),
      "effects.0.binding.feature",
    ],
    ["an empty name", (p) => ({ ...p, name: "" }), "name"],
    ["a 61-character name", (p) => ({ ...p, name: "x".repeat(61) }), "name"],
  ];

  for (const [label, mutate, path] of clauses) {
    it(`answers 400 naming ${path} for ${label}, and stores nothing`, async () => {
      await boot();
      const response = await post("/api/profiles", mutate(warm));
      expect(response.status).toBe(400);
      const body = invalidErrorSchema.parse(await response.json());
      expect(body.issues.map((i) => i.path)).toContain(path);
      expect(await list()).toEqual([]);
    });
  }

  it("answers 400 for a body that is not JSON, and for a failing update", async () => {
    await boot();
    const garbage = await fetch(`${base}/api/profiles`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: "{nope",
    });
    expect(garbage.status).toBe(400);
    const stored = await create();
    const bad = await put(stored.id, { ...warm, name: "", revision: 1 });
    expect(bad.status).toBe(400);
    expect(await list()).toEqual([stored]);
  });
});

describe("limits and content types (AC21)", () => {
  it("answers 413 for a 65 KB write", async () => {
    await boot();
    const response = await post("/api/profiles", { ...warm, name: "x".repeat(65 * 1024) });
    expect(response.status).toBe(413);
    expect(await list()).toEqual([]);
  });

  it("accepts a 900 KB import and refuses a 1.1 MB one with 413", async () => {
    await boot();
    const file = JSON.stringify(toProfileFile([{ ...warm }]));
    const padded = (bytes: number) => file + " ".repeat(bytes - file.length);
    const ok = await fetch(`${base}/api/profiles/import`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: padded(900 * 1024),
    });
    expect(ok.status).toBe(201);
    const big = await fetch(`${base}/api/profiles/import`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: padded(1100 * 1024),
    });
    expect(big.status).toBe(413);
    expect(await list()).toHaveLength(1);
  });

  it("answers 415 to text/plain and to a missing content type, on POST and PUT", async () => {
    await boot();
    const stored = await create();
    const attempts: [string, string, Record<string, string>][] = [
      ["POST", "/api/profiles", { "content-type": "text/plain" }],
      ["POST", "/api/profiles", {}],
      ["POST", "/api/profiles/import", { "content-type": "text/plain" }],
      ["PUT", `/api/profiles/${stored.id}`, { "content-type": "text/plain" }],
      ["PUT", `/api/profiles/${stored.id}`, {}],
    ];
    for (const [method, path, headers] of attempts) {
      const response = await fetch(`${base}${path}`, {
        method,
        headers,
        body: JSON.stringify({ ...warm, revision: 1 }),
      });
      expect(response.status, `${method} ${path} ${JSON.stringify(headers)}`).toBe(415);
    }
    expect(await list()).toEqual([stored]);
  });

  it("sets no CORS header on any response, including to OPTIONS with an Origin", async () => {
    await boot();
    const stored = await create();
    const responses = await Promise.all([
      fetch(`${base}/api/profiles`, { headers: { origin: "http://evil.example" } }),
      fetch(`${base}/api/profiles/${stored.id}`, { headers: { origin: "http://evil.example" } }),
      fetch(`${base}/api/profiles`, {
        method: "OPTIONS",
        headers: { origin: "http://evil.example" },
      }),
      fetch(`${base}/api/profiles`, {
        method: "POST",
        headers: { "content-type": "text/plain", origin: "http://evil.example" },
        body: "x",
      }),
      fetch(`${base}/api/health`, { headers: { origin: "http://evil.example" } }),
    ]);
    for (const response of responses) {
      const cors = [...response.headers.keys()].filter((h) => h.startsWith("access-control-"));
      expect(cors).toEqual([]);
    }
  });
});

describe("import (AC10)", () => {
  const second: Profile = { ...warm, name: "Cool" };

  it("stores a two-profile bundle with new ids and revision 1, and renames on a second import", async () => {
    await boot();
    const file = toProfileFile([warm, second]);
    const first = await post("/api/profiles/import", file);
    expect(first.status).toBe(201);
    const stored = profileListSchema.parse(await first.json()).profiles;
    expect(stored.map((p) => p.name)).toEqual(["Warm", "Cool"]);
    expect(stored.every((p) => p.revision === 1)).toBe(true);

    const again = profileListSchema.parse(
      await (await post("/api/profiles/import", file)).json(),
    ).profiles;
    expect(again.map((p) => p.name)).toEqual(["Warm (2)", "Cool (2)"]);
    expect(new Set([...stored, ...again].map((p) => p.id)).size).toBe(4);
    expect(await list()).toHaveLength(4);
  });

  it("stores nothing when one profile is invalid, and names the profile and field", async () => {
    await boot();
    const broken = { ...second, palette: ["#000000", "#ffffff", "#zzzzzz"] };
    const response = await post("/api/profiles/import", {
      formatVersion: 1,
      profiles: [warm, broken],
    });
    expect(response.status).toBe(400);
    const body = invalidErrorSchema.parse(await response.json());
    expect(body.issues).toEqual([
      { path: "profiles.1.palette.2", message: expect.any(String), profile: "Cool" },
    ]);
    expect(await list()).toEqual([]);
  });

  it("answers 422 for another format version, checked before the rest of the file", async () => {
    await boot();
    const response = await post("/api/profiles/import", { formatVersion: 2, profiles: "nonsense" });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "unsupported_version" });
    expect(await list()).toEqual([]);
  });
});

describe("a row broken by hand (AC13)", () => {
  it("is absent from the list and 422 on get", async () => {
    await boot();
    const good = await create({ ...warm, name: "Good" });
    const bad = await create({ ...warm, name: "Bad" });
    await server!.kill();
    const db = openDatabase(join(dataDir, "djvisuals.sqlite"));
    db.run("UPDATE profiles SET definition = ? WHERE id = ?", '{"palette":["red"]}', bad.id);
    db.close();
    await boot();
    expect(await list()).toEqual([good]);
    const response = await fetch(`${base}/api/profiles/${bad.id}`);
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "unusable" });
    expect((await put(bad.id, { ...warm, name: "Bad", revision: 5 })).status).toBe(422);
  });
});

describe("logging", () => {
  it("logs create, update, delete and import with the id and revision, never the definition", async () => {
    await boot();
    const stored = await create();
    await put(stored.id, { ...warm, name: "Warmer", revision: 1 });
    await post("/api/profiles/import", toProfileFile([{ ...warm, name: "Imported" }]));
    await fetch(`${base}/api/profiles/${stored.id}`, { method: "DELETE" });
    await server!.waitForLine((l) => l.msg === "profile deleted");

    const lines = server!.lines();
    const about = lines.filter((l) => typeof l.msg === "string" && l.msg.startsWith("profile"));
    expect(about.map((l) => l.msg)).toEqual(
      expect.arrayContaining([
        "profile created",
        "profile updated",
        "profiles imported",
        "profile deleted",
      ]),
    );
    expect(about.find((l) => l.msg === "profile updated")).toMatchObject({
      id: stored.id,
      revision: 2,
    });
    const text = JSON.stringify(lines);
    expect(text).toContain(stored.id);
    for (const secret of ["#c2410c", "#fbbf24", "paletteMap", "Warmer"]) {
      expect(text).not.toContain(secret);
    }
  });
});
