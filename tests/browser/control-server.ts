// The External control specs' own server (B-04 plan PD13, SD29): `boot()` in the test process on
// two free ports, serving the built `web/dist`, a fresh DATA_DIR, and the address seam on
// 127.0.0.1, so no real LAN address is ever bound and the server can be closed and booted again
// on the same ports (T16's restart). Every log line is kept for the privacy checks. Beside it, a
// device client: a page on the LAN origin that opens the device socket with the browser's own
// WebSocket, so the Origin is right for free (PD1). The LAN listener is HTTPS (B-06 T5): its
// root is made in this server's temporary DATA_DIR at the first switch-on, and every LAN-side
// browser context is created with `LAN_CONTEXT` (B-06 PD9) — Chromium has no per-context trust
// store; the chain itself is proven by Node in `server/test/control-tls.int.test.ts`.
import type { BrowserContext, Page } from "@playwright/test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { connect as tcpConnect, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { boot, type Booted } from "../../server/src/boot.ts";
import type { Logger } from "../../server/src/log.ts";
import type { ToDevice } from "../../shared/src/control.ts";
import type { ControlAddress } from "../../server/src/control/addresses.ts";
import { loadConfig } from "../../server/src/config.ts";

const root = resolve(import.meta.dirname, "../..");

// The server's own logger package, from the server's dependencies: the root declares neither
// `pino` nor the workspace packages, and these checks add nothing to it.
const { pino } = createRequire(resolve(root, "server/package.json"))("pino") as {
  pino(options: { level: string }, stream: { write(line: string): void }): Logger;
};

export const LOOPBACK: ControlAddress = { address: "127.0.0.1", name: "loopback (test)" };

/** Every browser context that opens a LAN page (B-06 PD9). */
export const LAN_CONTEXT = { ignoreHTTPSErrors: true } as const;

/** True when nothing accepts a TCP connection on 127.0.0.1:`port`. */
export function lanRefused(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = tcpConnect({ host: "127.0.0.1", port });
    socket.setTimeout(10_000, () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("connect", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(true));
  });
}

export interface ControlServer {
  port: number;
  controlPort: number;
  /** The screen page's origin, `http://127.0.0.1:PORT`. */
  origin: string;
  /** The External control listener's origin, `https://127.0.0.1:CONTROL_PORT` (B-06 T5). */
  lanOrigin: string;
  /** The server's DATA_DIR (its `tls/` folder holds the root once switched on). */
  dataDir: string;
  /** The test root, PEM: exists once External control was switched on. */
  root(): Buffer;
  /** Every log line so far, parsed. */
  lines: Record<string, unknown>[];
  /** The seam's next answer; `[]` for "no private address". */
  setAddresses(addresses: ControlAddress[]): void;
  /** Closes the server (as a process exit would: everything in memory is gone). */
  close(): Promise<void>;
  /** Boots again on the same ports and the same DATA_DIR. */
  restart(): Promise<void>;
  /** Closes and removes the DATA_DIR. */
  dispose(): Promise<void>;
}

function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.once("error", rej);
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      const port = typeof address === "object" && address ? address.port : 0;
      srv.close(() => res(port));
    });
  });
}

export async function startControlServer(): Promise<ControlServer> {
  const port = await freePort();
  let controlPort = await freePort();
  while (controlPort === port) controlPort = await freePort();
  const dir = mkdtempSync(join(tmpdir(), "djv-control-"));
  const lines: Record<string, unknown>[] = [];
  const dataDir = join(dir, "data");
  let addresses: ControlAddress[] = [LOOPBACK];
  let booted: Booted | null = null;

  const bootOnce = async () => {
    booted = await boot(
      loadConfig({
        APP_ENV: "test",
        LOG_LEVEL: "debug",
        APP_MODE: "local",
        PORT: String(port),
        CONTROL_PORT: String(controlPort),
        DATA_DIR: dataDir,
      }),
      {
        migrationsDir: resolve(root, "server/migrations"),
        staticDir: resolve(root, "web/dist"),
        controlAddresses: () => addresses,
      },
      pino(
        { level: "debug" },
        { write: (line: string) => void lines.push(JSON.parse(line) as Record<string, unknown>) },
      ),
    );
  };
  await bootOnce();

  const close = async () => {
    const current = booted;
    booted = null;
    await current?.close();
  };

  return {
    port,
    controlPort,
    origin: `http://127.0.0.1:${port}`,
    lanOrigin: `https://127.0.0.1:${controlPort}`,
    dataDir,
    root: () => readFileSync(join(dataDir, "tls", "root.crt")),
    lines,
    setAddresses: (next) => void (addresses = next),
    close,
    restart: bootOnce,
    async dispose() {
      await close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** A device on the LAN origin speaking the device socket directly, for checks below the UI. */
export interface DeviceClient {
  page: Page;
  send(message: unknown): Promise<void>;
  messages(): Promise<ToDevice[]>;
  /** Waits for a message of `type` and returns it. */
  waitFor<T extends ToDevice["type"]>(type: T): Promise<Extract<ToDevice, { type: T }>>;
  closed(): Promise<boolean>;
}

type DeviceWindow = { __device: { ws: WebSocket; messages: ToDevice[]; closed: boolean } };

export async function deviceClient(
  context: BrowserContext,
  server: ControlServer,
): Promise<DeviceClient> {
  const page = await context.newPage();
  // The real `/control` from the LAN listener with its scripts aborted: a page on the listener's
  // own origin (so the socket's Origin is right) that runs no app code. The document itself must
  // come from the network: Chromium's Local Network Access treats a document fulfilled by
  // `page.route` as public and blocks its socket to a loopback address.
  await page.route(`${server.lanOrigin}/assets/**`, (route) => route.abort());
  await page.goto(`${server.lanOrigin}/control`);
  await page.evaluate(
    (url) =>
      new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(url);
        const state = { ws, messages: [] as unknown[], closed: false };
        (window as unknown as DeviceWindow).__device = state as DeviceWindow["__device"];
        ws.onmessage = (e) => state.messages.push(JSON.parse(String(e.data)));
        ws.onclose = () => (state.closed = true);
        ws.onopen = () => resolve();
        ws.onerror = () => reject(new Error("device socket failed"));
      }),
    `wss://127.0.0.1:${server.controlPort}/api/control/device`,
  );
  const messages = () => page.evaluate(() => (window as unknown as DeviceWindow).__device.messages);
  return {
    page,
    send: (message) =>
      page.evaluate(
        (m) => (window as unknown as DeviceWindow).__device.ws.send(JSON.stringify(m)),
        message,
      ),
    messages,
    async waitFor(type) {
      const handle = await page.waitForFunction(
        (t) => (window as unknown as DeviceWindow).__device.messages.find((m) => m.type === t),
        type,
      );
      return (await handle.jsonValue()) as never;
    },
    closed: () => page.evaluate(() => (window as unknown as DeviceWindow).__device.closed),
  };
}
