// B-07 T3 (SD7, SD18, SD19, SD20; AC23, AC24, AC25, AC38, AC40; PD9): scenes over the screen
// socket, with `boot()` in process and a `ws` screen client, the control-device pattern.
import { toScreenSchema, type SceneDefinition, type SceneResult, type ToScreen } from "@djv/shared";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { boot, type Booted } from "../src/boot.ts";
import { loadConfig } from "../src/config.ts";
import { openDatabase } from "../src/db.ts";
import { closeAll, connect, type Client } from "./control-client.ts";
import { freePort, repoRoot } from "./spawn-server.ts";

/** A marker colour and a name that must never reach a log line (AC40). */
const MARKER = "#5c3e1a";
const NAME = "Warm crowd marker";

const definition: SceneDefinition = {
  profile: {
    name: "Warm",
    palette: ["#1a0500", MARKER, "#fbbf24"],
    dials: { recognisability: 0.2, reactivity: 0.9 },
    effects: [{ type: "paletteMap", amount: 1 }],
  },
  dials: { recognisability: 0.4, reactivity: 0.6 },
  feed: { kind: "local", deviceId: "cam-1", label: "Logitech C920" },
  transition: { kind: "crossfade", duration: 2 },
};

let tmp: string;
let booted: Booted | undefined;
let port: number;
let lines: Record<string, unknown>[];
let screen: Client<ToScreen>;
let nextId = 0;

async function start(): Promise<void> {
  port = await freePort();
  booted = await boot(
    loadConfig({
      APP_ENV: "test",
      LOG_LEVEL: "debug",
      APP_MODE: "local",
      PORT: String(port),
      CONTROL_PORT: String(await freePort()),
      DATA_DIR: join(tmp, "data"),
    }),
    { migrationsDir: resolve(repoRoot, "server/migrations") },
    pino(
      { level: "debug" },
      { write: (line: string) => void lines.push(JSON.parse(line) as Record<string, unknown>) },
    ),
  );
  screen = await openScreen();
}

async function stop(): Promise<void> {
  closeAll();
  await booted?.close();
  booted = undefined;
}

async function openScreen(): Promise<Client<ToScreen>> {
  const client = await connect(`ws://127.0.0.1:${port}/api/control/screen`, toScreenSchema, {
    origin: `http://127.0.0.1:${port}`,
  });
  await client.find((m) => m.type === "status");
  return client;
}

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), "djv-scenes-"));
  lines = [];
  await start();
});

afterEach(async () => {
  await stop();
  rmSync(tmp, { recursive: true, force: true });
});

/** Sends one scene request and returns its reply. */
async function ask(message: Record<string, unknown>, on = screen): Promise<SceneResult> {
  const requestId = ++nextId;
  const reply = on.next((m) => m.type === "scenes.result" && m.requestId === requestId);
  on.send({ ...message, requestId });
  return (await reply) as SceneResult;
}

const names = (result: SceneResult) => result.list?.map((s) => s.name);

async function save(name: string, scene: unknown = definition): Promise<SceneResult> {
  return ask({ type: "scenes.save", name, definition: scene });
}

const fileEntry = (name: string, scene: SceneDefinition = definition) => ({ name, ...scene });

const warns = () => lines.filter((l) => l.level === 40);

describe("save, list, get, update, rename, delete (SD9, AC19–AC22)", () => {
  it("answers each with the new list, ordered by name ignoring case", async () => {
    const saved = await save("booth");
    expect(saved).toMatchObject({ ok: true, scene: { name: "booth", definition } });
    expect(names(saved)).toEqual(["booth"]);
    const second = await save("Alley");
    expect(names(second)).toEqual(["Alley", "booth"]);
    expect(names(await ask({ type: "scenes.list" }))).toEqual(["Alley", "booth"]);

    const id = saved.scene!.id;
    expect(await ask({ type: "scenes.get", id })).toMatchObject({
      ok: true,
      scene: { id, name: "booth", definition },
    });

    const changed = { ...definition, dials: { recognisability: 1, reactivity: 1 } };
    const updated = await ask({
      type: "scenes.save",
      name: "ignored",
      definition: changed,
      updateId: id,
    });
    expect(updated).toMatchObject({ ok: true, scene: { id, name: "booth", definition: changed } });

    expect(await ask({ type: "scenes.rename", id, name: "alley" })).toMatchObject({
      ok: false,
      error: { reason: "name_taken" },
    });
    const renamed = await ask({ type: "scenes.rename", id, name: "Crowd" });
    expect(names(renamed)).toEqual(["Alley", "Crowd"]);

    const deleted = await ask({ type: "scenes.delete", id: second.scene!.id });
    expect(deleted).toMatchObject({ ok: true });
    expect(names(deleted)).toEqual(["Crowd"]);
    expect(await ask({ type: "scenes.get", id: second.scene!.id })).toMatchObject({
      ok: false,
      error: { reason: "missing" },
    });
  });

  it("refuses a taken name in any case, and an empty or too long one, storing nothing (AC20)", async () => {
    await save("Warm crowd");
    for (const name of ["WARM CROWD", "   ", "x".repeat(61)]) {
      const result = await save(name);
      expect(result.ok, name).toBe(false);
      expect(result.error?.reason).toBe(name === "WARM CROWD" ? "name_taken" : "invalid");
    }
    expect(names(await ask({ type: "scenes.list" }))).toEqual(["Warm crowd"]);
  });

  it("refuses a definition the shared schema refuses (SD19)", async () => {
    const result = await save("Bad", { ...definition, dials: {} });
    expect(result).toMatchObject({ ok: false, error: { reason: "invalid" } });
  });
});

describe("a restart (AC23)", () => {
  it("keeps every scene, and leaves out a broken row with one warn naming only its id", async () => {
    const kept = await save("Warm crowd");
    await stop();
    const db = openDatabase(join(tmp, "data", "djvisuals.sqlite"));
    db.run(
      "INSERT INTO scenes (id, name, definition, created_at, updated_at) VALUES ('broken-row', ?, '{nope', 'x', 'x')",
      NAME,
    );
    db.close();
    lines = [];
    await start();
    const listed = await ask({ type: "scenes.list" });
    expect(listed.list).toEqual([{ id: kept.scene!.id, name: "Warm crowd" }]);
    await ask({ type: "scenes.list" });
    const unusable = warns().filter(
      (l) => l.msg === "stored scene is unusable; left out of the list",
    );
    expect(unusable).toHaveLength(1);
    expect(unusable[0]).toMatchObject({ id: "broken-row" });
    expect(await ask({ type: "scenes.get", id: kept.scene!.id })).toMatchObject({
      ok: true,
      scene: { definition },
    });
  });
});

describe("limits (SD18, AC24, AC38)", () => {
  /** A definition of more than 128 KiB that still fits a 256 KiB message. */
  const large = (): SceneDefinition => ({
    ...definition,
    profile: {
      ...definition.profile,
      effects: Array.from({ length: 12 }, (_, i) => ({
        type: "custom" as const,
        label: `E${i}`,
        amount: 1,
        abstraction: false,
        params: [],
        // A quote is one byte of code and two of JSON: 12 × 8000 quotes pass 128 KiB.
        code: '"'.repeat(8000) + "return colour;",
      })),
    },
  });

  it("refuses a scene over 128 KiB with a reason", async () => {
    expect(Buffer.byteLength(JSON.stringify(large()))).toBeGreaterThan(131072);
    expect(await save("Big", large())).toMatchObject({ ok: false, error: { reason: "too_large" } });
  });

  it("refuses the 201st scene with a reason", async () => {
    const scenes = Array.from({ length: 200 }, (_, i) => fileEntry(`S${i}`));
    expect(
      await ask({ type: "scenes.import", importId: 1, part: 0, parts: 1, scenes }),
    ).toMatchObject({ ok: true });
    expect(await save("One more")).toMatchObject({ ok: false, error: { reason: "full" } });
  });

  it("drops a scenes.save over 256 KiB with one warn naming its type, and the socket stays open", async () => {
    const huge = { ...definition, profile: { ...definition.profile, name: "x".repeat(270_000) } };
    screen.send({ type: "scenes.save", requestId: 999, name: "Huge", definition: huge });
    expect(await ask({ type: "scenes.list" })).toMatchObject({ ok: true, list: [] });
    const dropped = warns().filter((l) => l.msg === "control message dropped");
    expect(dropped).toEqual([expect.objectContaining({ socket: "screen", type: "scenes.save" })]);
  });
});

describe("import in parts (SD8, AC25, PD9)", () => {
  it("stores three parts at the last one, a taken name becoming Name (2)", async () => {
    await save("Warm crowd");
    const parts = [
      [fileEntry("Warm crowd"), fileEntry("Booth")],
      [fileEntry("Alley")],
      [fileEntry("Dock")],
    ];
    const first = await ask({
      type: "scenes.import",
      importId: 7,
      part: 0,
      parts: 3,
      scenes: parts[0],
    });
    expect(first).toMatchObject({ ok: true });
    expect(first.list).toBeUndefined();
    expect(names(await ask({ type: "scenes.list" }))).toEqual(["Warm crowd"]);
    await ask({ type: "scenes.import", importId: 7, part: 1, parts: 3, scenes: parts[1] });
    const last = await ask({
      type: "scenes.import",
      importId: 7,
      part: 2,
      parts: 3,
      scenes: parts[2],
    });
    expect(names(last)).toEqual(["Alley", "Booth", "Dock", "Warm crowd", "Warm crowd (2)"]);
    const imported = lines.find((l) => l.msg === "scenes imported");
    expect(imported).toMatchObject({ count: 4 });
    expect(imported!.ids).toHaveLength(4);
  });

  it("stores nothing when a part is bad, naming the scene and the field", async () => {
    await ask({
      type: "scenes.import",
      importId: 8,
      part: 0,
      parts: 2,
      scenes: [fileEntry("Good")],
    });
    const bad = await ask({
      type: "scenes.import",
      importId: 8,
      part: 1,
      parts: 2,
      scenes: [
        fileEntry("Fine"),
        { ...fileEntry("Broken"), transition: { kind: "spin", duration: 1 } },
      ],
    });
    expect(bad).toMatchObject({ ok: false, error: { reason: "invalid" } });
    expect(bad.error!.issues).toContainEqual(
      expect.objectContaining({ path: "scenes.2.transition.kind", scene: "Broken" }),
    );
    expect(names(await ask({ type: "scenes.list" }))).toEqual([]);
  });

  it("discards the parts when a new import starts or the socket closes", async () => {
    await ask({
      type: "scenes.import",
      importId: 9,
      part: 0,
      parts: 2,
      scenes: [fileEntry("First")],
    });
    // A new import id: the first one's parts are gone, and its last part starts nothing.
    await ask({
      type: "scenes.import",
      importId: 10,
      part: 0,
      parts: 2,
      scenes: [fileEntry("Second")],
    });
    const stale = await ask({
      type: "scenes.import",
      importId: 9,
      part: 1,
      parts: 2,
      scenes: [fileEntry("Late")],
    });
    expect(stale).toMatchObject({ ok: false, error: { reason: "invalid" } });

    await ask({
      type: "scenes.import",
      importId: 11,
      part: 0,
      parts: 2,
      scenes: [fileEntry("Third")],
    });
    screen.ws.close();
    await screen.closed;
    screen = await openScreen();
    const after = await ask({
      type: "scenes.import",
      importId: 11,
      part: 1,
      parts: 2,
      scenes: [fileEntry("Fourth")],
    });
    expect(after).toMatchObject({ ok: false, error: { reason: "invalid" } });
    expect(names(await ask({ type: "scenes.list" }))).toEqual([]);
  });
});

describe("logging (SD20, AC40)", () => {
  it("logs each change by id and count, never a name or anything of a definition", async () => {
    const saved = await save(NAME);
    const id = saved.scene!.id;
    await ask({ type: "scenes.save", name: NAME, definition, updateId: id });
    await ask({ type: "scenes.rename", id, name: `${NAME} 2` });
    await ask({ type: "scenes.get", id });
    await ask({ type: "scenes.delete", id });
    await ask({ type: "scenes.import", importId: 1, part: 0, parts: 1, scenes: [fileEntry(NAME)] });

    for (const msg of ["scene saved", "scene updated", "scene renamed", "scene deleted"]) {
      expect(
        lines.find((l) => l.msg === msg),
        msg,
      ).toMatchObject({ id });
    }
    const text = JSON.stringify(lines);
    for (const secret of [NAME, MARKER, "Logitech", "Warm"])
      expect(text, secret).not.toContain(secret);
  });
});
