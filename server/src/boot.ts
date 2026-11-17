// Boot sequence (spec, In scope): config (done by the caller) -> ensure DATA_DIR -> open the
// database -> migrate -> listen on 127.0.0.1:PORT. Throws on any failure; the entry point turns
// the throw into one fatal line (log.ts). Paths are arguments so tests can inject them.
import { accessSync, constants, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { MAX_SCREEN_MESSAGE, type CloudStatus } from "@djv/shared";
import type { WebSocket } from "ws";
import { createApp, registerStatic, type App } from "./app.ts";
import { ConfigError, type Config, type SignInSettings } from "./config.ts";
import { defaultControlAddresses, type ControlAddress } from "./control/addresses.ts";
import { createGuard, isGuardedPath } from "./auth/guard.ts";
import { createIssuer } from "./auth/issuer.ts";
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
import { createProfileStore, type ProfileStore } from "./profiles/store.ts";
import { registerSync } from "./sync/routes.ts";
import { registerCloud } from "./cloud/routes.ts";
import { createSessionStore } from "./cloud/session-store.ts";
import { createSignin, type Signin } from "./cloud/signin.ts";
import { runSync, type SyncResult } from "./cloud/sync.ts";
import { createScheduler, realTimers, type Scheduler, type Timers } from "./cloud/scheduler.ts";
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
  /**
   * The cloud's clock for profile writes and the tombstone clean-up (B-12 T6, T9); absent means
   * `Date.now`. Tests move it 90 days on (AC18).
   */
  now?: () => number;
  /** In-process tests reach the local install's cloud parts through this (B-12 T7, T9). */
  cloudInternals?: (internals: CloudInternals) => void;
  /** The sync scheduler's timers (B-12 T10); tests that start each run themselves pass inert ones. */
  syncTimers?: Timers;
}

/** What a test may drive directly on a local install with cloud settings. */
export interface CloudInternals {
  signin: Signin;
  store: ProfileStore;
  /** "Sync now" through the scheduler; a refusal reads as outcome "paused". */
  sync(): Promise<SyncResult>;
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
  // B-12 SD6, PD11: hosted, Caddy forwards from 127.0.0.1; the bind below is the same.
  const app = createApp(log, config.APP_MODE === "hosted" ? { trustProxy: HOST } : {});
  let listenedAt = Date.now();
  registerHealth(app, {
    schemaVersion,
    uptimeSeconds: () => Math.floor((Date.now() - listenedAt) / 1000),
    mode: config.APP_MODE,
    cloud: config.cloud !== null,
    // Both are public values: the browser's sign-in needs them (PD8). Never the subject.
    signIn: config.signIn && { issuer: config.signIn.issuer, clientId: config.signIn.clientId },
  });
  if (config.signIn) guardProfiles(app, config.signIn, log);
  const clock = paths.now ?? (() => Date.now());
  const store = createProfileStore(db, log, () => new Date(clock()), { mode: config.APP_MODE });
  // B-12 SD15, PD19, PD20: a local install with the cloud settings syncs; without them there is
  // no scheduler and no `/api/cloud/*` at all (AC19).
  const cloud = config.cloud ? startCloud(app, config, store, paths, log, clock) : null;
  registerProfiles(app, store, () => cloud?.scheduler.wrote());
  // B-12 PD17: the cloud's sync endpoints exist in hosted mode only, behind the guard.
  if (config.APP_MODE === "hosted") registerSync(app, store, clock);
  // B-12 PD10: a hosted server never builds External control: no certificate store, hub, LAN
  // listener or screen socket, and every WebSocket upgrade is a raw 404.
  let externalControl: { close(): Promise<void> } | null = null;
  if (config.APP_MODE === "hosted") routeUpgrades(app.server, []);
  else {
    externalControl = startExternalControl(app, config, paths, log, (running) =>
      cloud?.scheduler.setRunning(running),
    );
  }
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
      await cloud?.scheduler.close();
      await externalControl?.close();
      await app.close();
      db.close();
    },
  };
}

/**
 * The local install's cloud parts (B-12 T7, T10): the sign-in, the scheduler that runs sync,
 * and `/api/cloud/*`. A connected install syncs at boot (SD2, AC5).
 */
function startCloud(
  app: App,
  config: Config,
  store: ProfileStore,
  paths: BootPaths,
  log: Logger,
  clock: () => number,
): { scheduler: Scheduler } {
  const settings = config.cloud!;
  const fetchImpl: typeof fetch = (input, init) => fetch(input, init);
  const signin = createSignin({
    clientId: settings.clientId,
    port: config.PORT,
    issuer: createIssuer({ url: settings.issuer, fetch: fetchImpl, now: clock, log }),
    store: createSessionStore(resolve(config.DATA_DIR)),
    fetch: fetchImpl,
    now: clock,
    log,
  });
  const scheduler = createScheduler({
    run: (mayContinue) =>
      runSync({ store, signin, cloudUrl: settings.url, fetch: fetchImpl, log, mayContinue }),
    timers: paths.syncTimers ?? realTimers,
    now: clock,
    log,
  });
  /** PD18: the panel's row, from the sign-in and the scheduler. */
  const status = (): CloudStatus => {
    const signedIn = signin.state();
    const run = scheduler.status();
    const state =
      signedIn !== "connected"
        ? signedIn
        : run.paused
          ? "paused"
          : run.syncing
            ? "syncing"
            : run.offline
              ? "offline"
              : "connected";
    return { state, lastSyncAt: run.lastSyncAt, conflicts: store.conflictCount() };
  };
  registerCloud(app, {
    signin,
    status,
    syncNow: () => scheduler.syncNow(),
    onConnected: () => scheduler.start(),
    onDisconnected: () => scheduler.stop(),
  });
  if (signin.state() === "connected") scheduler.start();
  paths.cloudInternals?.({
    signin,
    store,
    sync: async () => {
      const answer = await scheduler.syncNow();
      return answer.refused
        ? { outcome: "paused", pulled: 0, pushed: 0, conflicts: 0 }
        : answer.result;
    },
  });
  return { scheduler };
}

/**
 * B-12 SD4, AC1–AC3: the bearer check on `/api/profiles*` and `/api/sync/*`, before any route
 * or body. The issuer's keys are read on the first request, not at boot.
 */
function guardProfiles(app: App, signIn: SignInSettings, log: Logger): void {
  const now = () => Date.now();
  const issuer = createIssuer({ url: signIn.issuer, fetch: (i, init) => fetch(i, init), now, log });
  const guard = createGuard({
    verify: (token) => issuer.verify(token, signIn.clientId),
    allowedSubject: signIn.allowedSubject,
    now,
    log,
  });
  app.addHook("onRequest", async (request, reply) => {
    if (!isGuardedPath(request.url.split("?")[0]!)) return;
    const refusal = await guard.check(request.ip, request.headers.authorization);
    if (refusal) await reply.code(refusal.status).send(refusal.body);
  });
}

/** The local install's External control (B-04, B-06), as before B-12. */
function startExternalControl(
  app: App,
  config: Config,
  paths: BootPaths,
  log: Logger,
  onRunning: (running: boolean) => void,
): { close(): Promise<void> } {
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
    onRunning,
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
  return {
    async close() {
      await hub.close();
      screenSockets.close();
      deviceSockets.close();
    },
  };
}
