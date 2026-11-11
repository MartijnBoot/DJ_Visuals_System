// Boot sequence: config (done by the caller) -> ensure DATA_DIR -> listen on 127.0.0.1:PORT.
// Throws on any failure; the entry point turns the throw into one fatal line (log.ts).
import { accessSync, constants, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { createApp } from "./app.ts";
import { ConfigError, type Config } from "./config.ts";
import { createLogger, type Logger } from "./log.ts";

export const HOST = "127.0.0.1";

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

export async function boot(config: Config, log: Logger = createLogger(config.LOG_LEVEL)) {
  const dirs = ensureDirectories(config.DATA_DIR);
  log.debug({ dataDir: dirs.dataDir, assetsDir: dirs.assetsDir }, "directories ensured");

  const app = createApp(log);
  await app.listen({ host: HOST, port: config.PORT });
  const address = app.server.address();
  log.info(
    {
      address: typeof address === "object" && address ? address.address : address,
      port: config.PORT,
    },
    "listening",
  );
  const booted: Booted = { close: () => app.close() };
  return booted;
}
