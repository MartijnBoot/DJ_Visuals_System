// T6 (B-04 spec SD2, SD14, SD27, SD29, AC1, AC3 to AC6; plan PD8, PD10): the External control
// listener's lifecycle and its routes, with `boot()` in process and the address seam. Every test
// passes the seam: the gate never binds a real LAN address (SD29). The default wiring is
// `addresses.test.ts`'s; real private addresses are the owner's H4.
import { toScreenSchema, type ControlStatus, type ToScreen } from "@djv/shared";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { boot, type Booted } from "../src/boot.ts";
import type { ControlAddress } from "../src/control/addresses.ts";
import { loadConfig } from "../src/config.ts";
import { closeAll, connect, lanGet, refused, testRoot, type Client } from "./control-client.ts";
import { freePort, repoRoot } from "./spawn-server.ts";

const PAGE = "<!doctype html><title>control-fixture-page</title>";
const LOOPBACK: ControlAddress = { address: "127.0.0.1", name: "loopback (test)" };

let tmp: string;
let booted: Booted | undefined;
let blocker: Server | undefined;
let port: number;
let controlPort: number;
let lines: Record<string, unknown>[];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "djv-lan-"));
  lines = [];
});

afterEach(async () => {
  closeAll();
  await booted?.close();
  booted = undefined;
  await new Promise<void>((res) => (blocker ? blocker.close(() => res()) : res()));
  blocker = undefined;
  rmSync(tmp, { recursive: true, force: true });
});

function plantSite(): string {
  const site = join(tmp, "site");
  mkdirSync(join(site, "assets"), { recursive: true });
  writeFileSync(join(site, "index.html"), PAGE);
  writeFileSync(join(site, "assets", "app-1234.js"), "console.log('app');");
  writeFileSync(join(site, "favicon.svg"), "<svg/>");
  writeFileSync(join(tmp, "secret.txt"), "outside-the-static-folder");
  return site;
}

/** `staticDir: null` boots as `--api-only`. */
async function start(
  addresses: () => ControlAddress[] = () => [LOOPBACK],
  staticDir: string | null = plantSite(),
) {
  port = await freePort();
  controlPort = await freePort();
  const log = pino(
    { level: "info" },
    { write: (line: string) => void lines.push(JSON.parse(line) as Record<string, unknown>) },
  );
  booted = await boot(
    loadConfig({
      APP_ENV: "test",
      LOG_LEVEL: "info",
      APP_MODE: "local",
      PORT: String(port),
      CONTROL_PORT: String(controlPort),
      DATA_DIR: join(tmp, "data"),
    }),
    {
      migrationsDir: resolve(repoRoot, "server/migrations"),
      ...(staticDir === null ? {} : { staticDir }),
      controlAddresses: addresses,
    },
    log,
  );
}

async function screen(): Promise<Client<ToScreen>> {
  const client = await connect(`ws://127.0.0.1:${port}/api/control/screen`, toScreenSchema, {
    origin: `http://127.0.0.1:${port}`,
  });
  await client.find((m) => m.type === "status");
  return client;
}

/** Sends a panel action and returns the status that answers it. */
async function act(client: Client<ToScreen>, type: string): Promise<ControlStatus> {
  const answer = client.next((m) => m.type === "status");
  client.send({ type });
  const message = await answer;
  if (message.type !== "status") throw new Error("not a status");
  return message.status;
}

/** The LAN listener over TLS, trusting this test's own root alone (B-06 T5). */
const lan = (path: string, init?: Parameters<typeof lanGet>[2]) =>
  lanGet(`https://127.0.0.1:${controlPort}${path}`, testRoot(join(tmp, "data")), init);

const externalIPv4 = () =>
  Object.values(networkInterfaces())
    .flat()
    .filter((i) => i !== undefined && i.family === "IPv4" && !i.internal)
    .map((i) => i!.address);

describe("after boot (AC1)", () => {
  it(
    "nothing listens on CONTROL_PORT, on 127.0.0.1 or any non-internal address",
    { timeout: 30_000 },
    async () => {
      await start();
      const hosts = ["127.0.0.1", ...externalIPv4()];
      const results = await Promise.all(hosts.map((h) => refused(h, controlPort)));
      expect(Object.fromEntries(hosts.map((h, i) => [h, results[i]]))).toEqual(
        Object.fromEntries(hosts.map((h) => [h, true])),
      );
    },
  );
});

describe("switching on (AC3, AC5, PD8)", () => {
  it("binds the seam's addresses, issues a code and reports them", async () => {
    await start();
    const client = await screen();
    const status = await act(client, "enable");
    expect(status).toEqual({
      on: true,
      addresses: [LOOPBACK],
      port: controlPort,
      code: expect.stringMatching(/^[A-Z2-9]{6}$/),
      devices: [],
      pending: [],
      senders: [],
      fingerprint: expect.stringMatching(/^[0-9A-F]{16}$/),
    });
    expect(await refused("127.0.0.1", controlPort)).toBe(false);
  });

  it("answers GET /control with the page and /assets/* with the built assets", async () => {
    await start();
    await act(await screen(), "enable");
    const page = await lan("/control");
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toMatch(/text\/html/);
    expect(await page.text()).toContain("control-fixture-page");
    // B-06 T18: the sending page is the same built page.
    const send = await lan("/send");
    expect(send.status).toBe(200);
    expect(send.headers.get("content-type")).toMatch(/text\/html/);
    expect(await send.text()).toContain("control-fixture-page");
    const asset = await lan("/assets/app-1234.js");
    expect(asset.status).toBe(200);
    expect(await asset.text()).toContain("console.log");
  });

  it("answers 404 to every other path, and sets no CORS header", async () => {
    await start();
    await act(await screen(), "enable");
    for (const path of [
      "/",
      "/builder",
      "/api/health",
      "/api/profiles",
      "/api/profiles/x",
      "/index.html",
      "/favicon.svg",
      "/assets/nope.js",
      "/assets/../index.html",
      "/control/x",
      "/send/x",
    ]) {
      const response = await lan(path);
      expect(response.status, path).toBe(404);
      const cors = [...response.headers.keys()].filter((h) => h.startsWith("access-control-"));
      expect(cors, path).toEqual([]);
    }
    const post = await lan("/api/profiles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(post.status).toBe(404);
  });

  it("is idempotent: a second enable keeps the code and the listener", async () => {
    await start();
    const client = await screen();
    const first = await act(client, "enable");
    const second = await act(client, "enable");
    expect(second.code).toBe(first.code);
    expect((await lan("/control")).status).toBe(200);
  });

  it("under --api-only answers 404 to /control, /send and /assets/*", async () => {
    await start(() => [LOOPBACK], null);
    expect((await act(await screen(), "enable")).on).toBe(true);
    expect((await lan("/control")).status).toBe(404);
    expect((await lan("/send")).status).toBe(404);
    expect((await lan("/assets/app-1234.js")).status).toBe(404);
  });
});

describe("switching off (AC6)", () => {
  it("stops listening and discards the code", async () => {
    await start();
    const client = await screen();
    await act(client, "enable");
    const status = await act(client, "disable");
    expect(status).toEqual({
      on: false,
      addresses: [],
      port: controlPort,
      code: null,
      devices: [],
      pending: [],
      senders: [],
      fingerprint: null,
    });
    expect(await refused("127.0.0.1", controlPort)).toBe(true);
  });

  it("closes the listener when the server closes", async () => {
    await start();
    await act(await screen(), "enable");
    await booted!.close();
    booted = undefined;
    expect(await refused("127.0.0.1", controlPort)).toBe(true);
  });
});

describe("failures (AC4, edge cases)", () => {
  it("with no private address stays off, binds nothing and says so", async () => {
    await start(() => []);
    const status = await act(await screen(), "enable");
    expect(status).toMatchObject({ on: false, code: null, error: "no_address" });
    expect(await refused("127.0.0.1", controlPort)).toBe(true);
  });

  it("with the port held stays off, says so, and the main listener is unaffected", async () => {
    await start();
    blocker = createServer();
    await new Promise<void>((res) => blocker!.listen(controlPort, "127.0.0.1", res));
    const client = await screen();
    const status = await act(client, "enable");
    expect(status).toMatchObject({ on: false, code: null, error: "port_in_use" });
    expect((await fetch(`http://127.0.0.1:${port}/api/health`)).status).toBe(200);
    await new Promise<void>((res) => blocker!.close(() => res()));
    blocker = undefined;
    expect(await refused("127.0.0.1", controlPort)).toBe(true); // nothing of ours was left bound
    expect((await act(client, "enable")).on).toBe(true); // and switching on works once it is free
  });

  it("binds all or nothing: one address in use closes the ones already bound", async () => {
    await start(() => [LOOPBACK, { address: "127.0.0.2", name: "second loopback (test)" }]);
    blocker = createServer();
    await new Promise<void>((res) => blocker!.listen(controlPort, "127.0.0.2", res));
    const status = await act(await screen(), "enable");
    expect(status).toMatchObject({ on: false, error: "port_in_use" });
    expect(await refused("127.0.0.1", controlPort)).toBe(true);
  });
});

describe("logging (SD27)", () => {
  it("logs on, new code and off, with addresses and port, never the code", async () => {
    await start();
    const client = await screen();
    const { code } = await act(client, "enable");
    const renewed = await act(client, "newCode");
    expect(renewed.code).not.toBe(code);
    await act(client, "disable");
    const on = lines.find((l) => l.msg === "external control on");
    expect(on).toMatchObject({ addresses: ["127.0.0.1"], port: controlPort });
    expect(lines.filter((l) => l.msg === "new code issued")).toHaveLength(1);
    expect(lines.filter((l) => l.msg === "external control off")).toHaveLength(1);
    const text = JSON.stringify(lines);
    expect(text).not.toContain(code!);
    expect(text).not.toContain(renewed.code!);
  });
});
