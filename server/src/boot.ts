// Boot sequence (spec, In scope): config (done by the caller) -> ensure DATA_DIR -> open the
// database -> migrate -> listen on 127.0.0.1:PORT. Throws on any failure; the entry point turns
// the throw into one fatal line (log.ts). Paths are arguments so tests can inject them.
import { accessSync, constants, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { MAX_SCREEN_MESSAGE } from "@djv/shared";
import type { WebSocket } from "ws";
import { createApp, registerStatic } from "./app.ts";
import { ConfigError, type Config } from "./config.ts";
import { defaultControlAddresses, type ControlAddress } from "./control/addresses.ts";
import { attachDevice } from "./control/device.ts";
import { createHub, type Hub } from "./control/hub.ts";
import { createLan } from "./control/lan.ts";
import { createPairing } from "./control/pairing.ts";
import { routeUpgrades, socketServer } from "./control/upgrade.ts";
import { openDatabase, type Db } from "./db.ts";
import { registerHealth } from "./health.ts";
import { createLogger, type Logger } from "./log.ts";
import { migrate } from "./migrate.ts";
import { registerProfiles } from "./profiles/routes.ts";
import { createProfileStore } from "./profiles/store.ts";
import { createCertificateStore } from "./tls/store.ts";

export const HOST = "127.0.0.1";
export const DB_FILE = "djvisuals.sqlite";
/** The screen socket's path on the main listener (B-04 API contract). */
export const SCREEN_SOCKET = "/api/control/screen";
/** The device socket's path on the External control listener (B-04 API contract). */
export const DEVICE_SOCKET = "/api/control/device";
/** Vite's dev server, whose proxy forwards the screen page's Origin (B-04 SD25). */
const VITE_ORIGIN = "http://localhost:5173";

/**
 * The screen socket accepts exactly its own listener's origins and Vite's (B-04 PD2): both
 * names of 127.0.0.1:PORT reach this listener, and no foreign page can claim either.
 */
export const screenOrigins = (port: number): readonly string[] => [
  `http://127.0.0.1:${port}`,
  `http://localhost:${port}`,
  VITE_ORIGIN,
];

export interface BootPaths {
  /** The folder of NNNN_<slug>.sql files. */
  migrationsDir: string;
  /** The built web app to serve; absent means API only (`--api-only`, plan PD10). */
  staticDir?: string;
  /**
   * The addresses External control binds (B-04 SD29, PD10); absent means the machine's private
   * IPv4 addresses. Tests pass `127.0.0.1`, so the gate never binds a real LAN address.
   */
  controlAddresses?: () => ControlAddress[];
}

export interface Booted {
  close(): Promise<void>;
}

/** Creates DATA_DIR and DATA_DIR/assets/. A directory that cannot be made or written is reported
 *  as a malformed DATA_DIR, in the same shape as a config problem (plan PD6). */
export function ensureDirectories(dataDir: string): { dataDir: string; assetsDir: string } {
  const root = resolve(dataDir);
  const assetsDir = join(root, "assets");
  try {
    mkdirSync(assetsDir, { recursive: true });
    accessSync(root, constants.W_OK);
    accessSync(assetsDir, constants.W_OK);
  } catch {
    throw new ConfigError([
      { variable: "DATA_DIR", reason: "cannot be created or is not writable" },
    ]);
  }
  return { dataDir: root, assetsDir };
}

/** Ensure directories, open the database and apply pending migrations. Shared by boot and
 *  `pnpm migrate` (spec SD7, AC8). The caller owns the returned database. */
export function openAndMigrate(
  config: Config,
  paths: BootPaths,
  log: Logger,
): { db: Db; schemaVersion: number } {
  const dirs = ensureDirectories(config.DATA_DIR);
  log.debug({ dataDir: dirs.dataDir, assetsDir: dirs.assetsDir }, "directories ensured");
  const file = join(dirs.dataDir, DB_FILE);
  const db = openDatabase(file);
  log.info({ file }, "database opened");
  try {
    const { schemaVersion } = migrate(db, paths.migrationsDir, log);
    return { db, schemaVersion };
  } catch (error) {
    db.close();
    throw error;
  }
}

export async function boot(
  config: Config,
  paths: BootPaths,
  log: Logger = createLogger(config.LOG_LEVEL),
): Promise<Booted> {
  // Checked first: `pnpm start` must never come up serving 404 for `/` (plan PD10).
  if (paths.staticDir !== undefined && !existsSync(join(paths.staticDir, "index.html"))) {
    throw new Error(`no index.html in ${resolve(paths.staticDir)}; run pnpm build`);
  }
  const { db, schemaVersion } = openAndMigrate(config, paths, log);
  const app = createApp(log);
  let listenedAt = Date.now();
  registerHealth(app, {
    schemaVersion,
    uptimeSeconds: () => Math.floor((Date.now() - listenedAt) / 1000),
  });
  registerProfiles(app, createProfileStore(db, log));
  // External control (B-04): the screen socket on this listener, the device socket on each LAN
  // instance. The screen socket's `maxPayload` sits above its message limit, so an oversized
  // message is dropped with a warn rather than closing the socket (AC33); `ws` closes beyond it.
  // The device socket's is 64 KB (PD1): its own limit is 4 KB.
  const now = () => Date.now();
  const random = (size: number) => crypto.getRandomValues(new Uint8Array(size));
  // B-06 SD4, SD23: the local CA under DATA_DIR/tls/, read only when switching on.
  const certificateStore = createCertificateStore({
    dir: join(resolve(config.DATA_DIR), "tls"),
    now,
    random,
    log,
  });
  const deviceSockets = socketServer(64 * 1024);
  const hub: Hub = createHub({
    log,
    controlPort: config.CONTROL_PORT,
    now,
    pairing: createPairing({ now, random }),
    lan: createLan({
      log,
      port: config.CONTROL_PORT,
      ...(paths.staticDir === undefined ? {} : { staticDir: resolve(paths.staticDir) }),
      addresses: paths.controlAddresses ?? defaultControlAddresses,
      certificates: (addresses) => certificateStore.forAddresses(addresses),
      prepare: (lanApp, { address }) => {
        // Closing this listener waits for every connection, upgraded ones included. The hub ends
        // the sockets it knows (a hello was sent); one still open here never said hello, and
        // would hold switching off open for good (AC6), so it is cut.
        const sockets = new Set<WebSocket>();
        lanApp.addHook("preClose", async () => {
          for (const socket of sockets) if (socket.readyState === socket.OPEN) socket.terminate();
        });
        routeUpgrades(lanApp.server, [
          {
            path: DEVICE_SOCKET,
            // Its own listener's origin only (SD25): the page it served on this address, over
            // HTTPS (B-06 AC7).
            origins: () => [`https://${address}:${config.CONTROL_PORT}`],
            wss: deviceSockets,
            onConnection: (socket, request) => {
              sockets.add(socket);
              socket.on("close", () => sockets.delete(socket));
              attachDevice(socket, request, { hub, log, now });
            },
          },
        ]);
      },
    }),
  });
  const screenSockets = socketServer(4 * MAX_SCREEN_MESSAGE);
  routeUpgrades(app.server, [
    {
      path: SCREEN_SOCKET,
      origins: () => screenOrigins(config.PORT),
      wss: screenSockets,
      onConnection: (socket) => hub.attachScreen(socket),
    },
  ]);
  try {
    if (paths.staticDir !== undefined) await registerStatic(app, resolve(paths.staticDir));
    await app.listen({ host: HOST, port: config.PORT });
  } catch (error) {
    db.close();
    throw error;
  }
  listenedAt = Date.now();
  const address = app.server.address();
  log.info(
    {
      address: typeof address === "object" && address ? address.address : address,
      port: config.PORT,
    },
    "listening",
  );
  return {
    async close() {
      await hub.close();
      screenSockets.close();
      deviceSockets.close();
      await app.close();
      db.close();
    },
  };
}
