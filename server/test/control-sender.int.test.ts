// B-06 T7, T8 (spec SD6, SD15, SD16, SD25, AC8 to AC12, AC34): senders on the real device socket,
// with `boot()` in process, the address seam on 127.0.0.1 and the LAN listener's TLS trusting
// the test's own root alone. T7: the role in the request, the approval and the reconnect.
import {
  toDeviceSchema,
  toScreenSchema,
  type ControlStatus,
  type ToDevice,
  type ToScreen,
} from "@djv/shared";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { boot, type Booted } from "../src/boot.ts";
import { loadConfig } from "../src/config.ts";
import { closeAll, connect, testRoot, type Client, type ConnectOptions } from "./control-client.ts";
import { freePort, repoRoot } from "./spawn-server.ts";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

let tmp: string;
let booted: Booted | undefined;
let port: number;
let controlPort: number;
let lines: Record<string, unknown>[];
let screen: Client<ToScreen>;
let code: string;

const isStatus = (m: ToScreen): m is Extract<ToScreen, { type: "status" }> => m.type === "status";
const is =
  <T extends ToDevice["type"]>(type: T) =>
  (m: ToDevice): m is Extract<ToDevice, { type: T }> =>
    m.type === type;

async function openScreen(): Promise<Client<ToScreen>> {
  const client = await connect(`ws://127.0.0.1:${port}/api/control/screen`, toScreenSchema, {
    origin: `http://127.0.0.1:${port}`,
  });
  await client.find(isStatus);
  return client;
}

/** A panel action; resolves with the status that answers it. */
async function act(message: { type: string; deviceId?: string }): Promise<ControlStatus> {
  const answer = screen.next(isStatus);
  screen.send(message);
  return (await answer).status;
}

/** Resolves with the first status from now on that `pred` holds for. */
const statusWhere = async (pred: (s: ControlStatus) => boolean) =>
  (await screen.next((m) => isStatus(m) && pred(m.status), 10_000)) as Extract<
    ToScreen,
    { type: "status" }
  >;

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), "djv-sender-"));
  lines = [];
  port = await freePort();
  controlPort = await freePort();
  booted = await boot(
    loadConfig({
      APP_ENV: "test",
      LOG_LEVEL: "debug",
      PORT: String(port),
      CONTROL_PORT: String(controlPort),
      DATA_DIR: join(tmp, "data"),
    }),
    {
      migrationsDir: resolve(repoRoot, "server/migrations"),
      controlAddresses: () => [{ address: "127.0.0.1", name: "loopback (test)" }],
    },
    pino(
      { level: "debug" },
      { write: (line: string) => void lines.push(JSON.parse(line) as Record<string, unknown>) },
    ),
  );
  screen = await openScreen();
  code = (await act({ type: "enable" })).code!;
});

afterEach(async () => {
  closeAll();
  await booted?.close();
  booted = undefined;
  rmSync(tmp, { recursive: true, force: true });
});

function device(options: ConnectOptions = {}): Promise<Client<ToDevice>> {
  return connect(`wss://127.0.0.1:${controlPort}/api/control/device`, toDeviceSchema, {
    origin: `https://127.0.0.1:${controlPort}`,
    ca: testRoot(join(tmp, "data")),
    headers: { "user-agent": UA },
    ...options,
  });
}

/** A device that asked to send `sends` and is waiting: its client and id. */
async function asking(sends: ("video" | "audio")[], options: ConnectOptions = {}) {
  const client = await device(options);
  const seen = statusWhere((s) => s.pending.length > 0);
  client.send({ type: "hello", code, sends });
  await client.find(is("waiting"));
  const status = (await seen).status;
  return { client, deviceId: status.pending.at(-1)!.deviceId, status };
}

/** A sender approved from the panel: its client, id and key. */
async function sender(sends: ("video" | "audio")[], options: ConnectOptions = {}) {
  const { client, deviceId } = await asking(sends, options);
  screen.send({ type: "accept", deviceId });
  const approved = await client.find(is("approved"));
  return { client, deviceId, key: approved.key };
}

describe("a sender's request and approval (T7, SD6, SD15, AC8)", () => {
  it("a hello with sends reaches the screen's status as pending with its role", async () => {
    const { status, deviceId } = await asking(["video", "audio"]);
    expect(status.pending).toEqual([
      { deviceId, hint: "Chrome on Windows", label: "Device 1", sends: ["video", "audio"] },
    ]);
    expect(lines).toContainEqual(
      expect.objectContaining({
        msg: "sender requested",
        device: "Device 1",
        sends: ["video", "audio"],
      }),
    );
  });

  it("accept → approved with sends, and the sender is listed apart, online", async () => {
    const seen = statusWhere((s) => s.senders.length === 1);
    const { client, deviceId } = await sender(["video"]);
    expect(client.messages.find(is("approved"))).toEqual({
      type: "approved",
      key: expect.any(String),
      deviceId,
      sends: ["video"],
    });
    const { status } = await seen;
    expect(status.devices).toEqual([]);
    expect(status.senders).toEqual([
      { deviceId, hint: "Chrome on Windows", label: "Device 1", sends: ["video"], online: true },
    ]);
  });

  it("the key reconnects as a sender from the same IP, and offline in between", async () => {
    const { client, deviceId, key } = await sender(["audio"]);
    const offline = statusWhere((s) => s.senders[0]?.online === false);
    client.ws.close();
    await client.closed;
    await offline;
    const back = statusWhere((s) => s.senders[0]?.online === true);
    const again = await device();
    again.send({ type: "hello", key });
    expect(await again.find(is("approved"))).toEqual({
      type: "approved",
      key,
      deviceId,
      sends: ["audio"],
    });
    await back;
  });

  it("the key from another IP is refused and ends that sender", async () => {
    const { key } = await sender(["video"]);
    const gone = statusWhere((s) => s.senders.length === 0);
    const other = await device({ localAddress: "127.0.0.2" });
    other.send({ type: "hello", key });
    expect(await other.find(is("refused"))).toEqual({ type: "refused", reason: "ended" });
    await gone;
  });

  it("a second audio sender is refused with audio_taken", async () => {
    await sender(["audio"]);
    const second = await device({ localAddress: "127.0.0.2" });
    second.send({ type: "hello", code, sends: ["audio"] });
    expect(await second.find(is("refused"))).toEqual({ type: "refused", reason: "audio_taken" });
  });
});
