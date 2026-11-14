// Boot sequence (spec, In scope): config (done by the caller) -> ensure DATA_DIR -> open the
// database -> migrate -> listen on 127.0.0.1:PORT. Throws on any failure; the entry point turns
// the throw into one fatal line (log.ts). Paths are arguments so tests can inject them.
import { accessSync, constants, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { createApp, registerStatic } from "./app.ts";
import { ConfigError, type Config } from "./config.ts";
import { openDatabase, type Db } from "./db.ts";
import { registerHealth } from "./health.ts";
import { createLogger, type Logger } from "./log.ts";
import { migrate } from "./migrate.ts";
import { registerProfiles } from "./profiles/routes.ts";
import { createProfileStore } from "./profiles/store.ts";

export const HOST = "127.0.0.1";
export const DB_FILE = "djvisuals.sqlite";

export interface BootPaths {
  /** The folder of NNNN_<slug>.sql files. */
  migrationsDir: string;
  /** The built web app to serve; absent means API only (`--api-only`, plan PD10). */
  staticDir?: string;
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
      await app.close();
      db.close();
    },
  };
}
