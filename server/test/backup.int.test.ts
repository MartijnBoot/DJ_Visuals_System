// B-12 T15 (AC31, SD10, PD25): the backup CLI as a child process against an in-process fake
// bucket that recomputes every request's SigV4 signature and refuses a wrong one with 403.
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listKeys, signV4 } from "../src/backup/bucket.ts";
import { openDatabase } from "../src/db.ts";
import { baseEnv, repoRoot, spawnServer, type SpawnedServer } from "./spawn-server.ts";

const cli = resolve(repoRoot, "server/src/backup-cli.ts");
const migrateCli = resolve(repoRoot, "server/src/migrate-cli.ts");
const SECRET = "fake-secret-key-6c1d9e";
const KEY_ID = "fake-key-id";
const REGION = "eu-amsterdam-1";
const BUCKET = "djv-backups";

interface FakeBucket {
  objects: Map<string, Buffer>;
  refusePut: boolean;
  badSignatures: number;
  url: string;
  server: Server;
}

let tmp: string;
let dataDir: string;
let bucket: FakeBucket;
const children: SpawnedServer[] = [];

async function startBucket(): Promise<FakeBucket> {
  const fake = {
    objects: new Map<string, Buffer>(),
    refusePut: false,
    badSignatures: 0,
  } as FakeBucket;
  fake.server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);
    const url = new URL(req.url!, "http://x");
    const authorization = String(req.headers.authorization ?? "");
    const signedNames = /SignedHeaders=([^,]+)/.exec(authorization)?.[1]?.split(";") ?? [];
    const headers = Object.fromEntries(signedNames.map((n) => [n, String(req.headers[n] ?? "")]));
    const payloadHash = createHash("sha256").update(body).digest("hex");
    const expected =
      headers["x-amz-date"] &&
      signV4({
        method: req.method!,
        path: url.pathname,
        query: [...url.searchParams.entries()],
        headers,
        payloadHash,
        region: REGION,
        service: "s3",
        accessKeyId: KEY_ID,
        secretAccessKey: SECRET,
      }).authorization;
    if (
      !expected ||
      expected !== authorization ||
      req.headers["x-amz-content-sha256"] !== payloadHash
    ) {
      fake.badSignatures += 1;
      res.statusCode = 403;
      res.end("<Error><Code>SignatureDoesNotMatch</Code></Error>");
      return;
    }
    const [, bucketName, ...rest] = url.pathname.split("/");
    const key = decodeURIComponent(rest.join("/"));
    if (bucketName !== BUCKET) {
      res.statusCode = 404;
      res.end();
      return;
    }
    if (req.method === "GET" && key === "") {
      const prefix = url.searchParams.get("prefix") ?? "";
      const keys = [...fake.objects.keys()].filter((k) => k.startsWith(prefix)).sort();
      res.end(
        `<ListBucketResult>${keys.map((k) => `<Contents><Key>${k}</Key></Contents>`).join("")}</ListBucketResult>`,
      );
      return;
    }
    if (req.method === "PUT") {
      if (fake.refusePut) {
        res.statusCode = 403;
        res.end("<Error><Code>AccessDenied</Code></Error>");
        return;
      }
      fake.objects.set(key, body);
      res.end();
      return;
    }
    if (req.method === "GET") {
      const object = fake.objects.get(key);
      res.statusCode = object ? 200 : 404;
      res.end(object ?? "");
      return;
    }
    if (req.method === "DELETE") {
      fake.objects.delete(key);
      res.statusCode = 204;
      res.end();
      return;
    }
    res.statusCode = 405;
    res.end();
  });
  await new Promise<void>((r) => fake.server.listen(0, "127.0.0.1", r));
  const address = fake.server.address();
  fake.url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  return fake;
}

function env(overrides: Record<string, string | undefined> = {}) {
  return baseEnv({
    // Never bound: the CLI does not listen.
    PORT: "8000",
    DATA_DIR: dataDir,
    BACKUP_ENDPOINT: bucket.url,
    BACKUP_REGION: REGION,
    BACKUP_BUCKET: BUCKET,
    BACKUP_ACCESS_KEY_ID: KEY_ID,
    BACKUP_SECRET_ACCESS_KEY: SECRET,
    ...overrides,
  });
}

async function run(args: string[], overrides: Record<string, string | undefined> = {}) {
  const child = spawnServer(env(overrides), { entry: cli, args });
  children.push(child);
  const { code } = await child.exited;
  return { code, lines: child.lines(), stdout: JSON.stringify(child.lines()) + child.stderr() };
}

function profileNames(): string[] {
  const db = openDatabase(join(dataDir, "djvisuals.sqlite"));
  try {
    return db.all<{ name: string }>("SELECT name FROM profiles ORDER BY name").map((r) => r.name);
  } finally {
    db.close();
  }
}

function addProfile(name: string) {
  const db = openDatabase(join(dataDir, "djvisuals.sqlite"));
  try {
    db.run(
      "INSERT INTO profiles (id, name, revision, definition, created_at, updated_at) VALUES (?, ?, 1, '{}', 'x', 'x')",
      `id-${name}`,
      name,
    );
  } finally {
    db.close();
  }
}

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), "djv-backup-"));
  dataDir = join(tmp, "data");
  bucket = await startBucket();
  const migrate = spawnServer(baseEnv({ PORT: "8000", DATA_DIR: dataDir }), {
    entry: migrateCli,
  });
  children.push(migrate);
  expect((await migrate.exited).code).toBe(0);
  addProfile("One");
});

afterEach(async () => {
  await Promise.all(children.splice(0).map((c) => c.kill()));
  await new Promise<void>((r) => bucket.server.close(() => r()));
  rmSync(tmp, { recursive: true, force: true });
});

describe("backup (AC31)", () => {
  it("writes a checked copy to the bucket with one line, and leaves no local copy", async () => {
    const result = await run(["backup"]);
    expect(result.code).toBe(0);
    const written = result.lines.filter((l) => l.msg === "backup written");
    expect(written).toHaveLength(1);
    expect(written[0]!.object).toMatch(
      /^djvisuals-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.sqlite$/,
    );
    expect(written[0]!.bytes).toBeGreaterThan(0);
    expect([...bucket.objects.keys()]).toEqual([written[0]!.object]);
    expect(readdirSync(join(dataDir, "backups"))).toEqual([]);
    expect(bucket.badSignatures).toBe(0);
    expect(result.stdout).not.toContain(SECRET);
  });

  it("sixteen runs leave the newest fourteen", async () => {
    const names: string[] = [];
    for (let i = 0; i < 16; i += 1) {
      const result = await run(["backup"]);
      expect(result.code).toBe(0);
      names.push(String(result.lines.find((l) => l.msg === "backup written")!.object));
    }
    expect([...bucket.objects.keys()].sort()).toEqual(names.slice(2).sort());
    expect(bucket.badSignatures).toBe(0);
  });

  it("an upload refused 403 exits 1 with one line naming the step, and deletes nothing", async () => {
    for (let i = 0; i < 15; i += 1)
      bucket.objects.set(`djvisuals-2026-01-${String(i + 10)}.sqlite`, Buffer.from("x"));
    const before = [...bucket.objects.keys()].sort();
    bucket.refusePut = true;
    const result = await run(["backup"]);
    expect(result.code).toBe(1);
    const failed = result.lines.filter((l) => (l.level ?? 0) >= 50);
    expect(failed).toHaveLength(1);
    expect(failed[0]!.step).toBe("upload");
    expect([...bucket.objects.keys()].sort()).toEqual(before);
    expect(result.stdout).not.toContain(SECRET);
  });

  it("refuses to run without the backup settings", async () => {
    const result = await run(["backup"], {
      BACKUP_ENDPOINT: undefined,
      BACKUP_REGION: undefined,
      BACKUP_BUCKET: undefined,
      BACKUP_ACCESS_KEY_ID: undefined,
      BACKUP_SECRET_ACCESS_KEY: undefined,
    });
    expect(result.code).toBe(1);
    expect(result.lines.filter((l) => (l.level ?? 0) >= 50)[0]!.step).toBe("configuration");
  });
});

describe("snapshot --to (the deploy's copy, PD23)", () => {
  it("keeps the checked local copy and uploads it", async () => {
    const file = join(tmp, "pre-abc.sqlite");
    const result = await run(["snapshot", "--to", file]);
    expect(result.code).toBe(0);
    expect(existsSync(file)).toBe(true);
    expect(bucket.objects.size).toBe(1);
  });

  it("keeps the local copy without the backup settings, saying the upload was skipped", async () => {
    const file = join(tmp, "pre-def.sqlite");
    const result = await run(["snapshot", "--to", file], {
      BACKUP_ENDPOINT: undefined,
      BACKUP_REGION: undefined,
      BACKUP_BUCKET: undefined,
      BACKUP_ACCESS_KEY_ID: undefined,
      BACKUP_SECRET_ACCESS_KEY: undefined,
    });
    expect(result.code).toBe(0);
    expect(existsSync(file)).toBe(true);
    expect(result.lines.some((l) => l.msg === "upload skipped: backup not configured")).toBe(true);
  });
});

describe("restore --latest (SD11)", () => {
  it("brings back the profiles of the newest backup", async () => {
    expect((await run(["backup"])).code).toBe(0);
    addProfile("Two");
    expect((await run(["backup"])).code).toBe(0);
    addProfile("Three");
    expect(profileNames()).toEqual(["One", "Three", "Two"]);
    const result = await run(["restore", "--latest"]);
    expect(result.code).toBe(0);
    expect(profileNames()).toEqual(["One", "Two"]);
    expect(existsSync(join(dataDir, "djvisuals.sqlite-wal"))).toBe(false);
  });

  it("refuses a newest backup that fails the check, leaving the database as it was", async () => {
    expect((await run(["backup"])).code).toBe(0);
    const newest = listKeys(
      `<x>${[...bucket.objects.keys()].map((k) => `<Key>${k}</Key>`).join("")}</x>`,
    ).sort()[0]!;
    bucket.objects.set(newest, Buffer.from("not a database"));
    addProfile("Two");
    const result = await run(["restore", "--latest"]);
    expect(result.code).toBe(1);
    expect(result.lines.filter((l) => (l.level ?? 0) >= 50)[0]!.step).toBe("check");
    expect(profileNames()).toEqual(["One", "Two"]);
  });
});
