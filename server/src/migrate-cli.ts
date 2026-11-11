// `pnpm migrate`: the same config and the same runner as boot, without listening (spec AC8).
//   node --env-file-if-exists=.env.local server/src/migrate-cli.ts
import { resolve } from "node:path";
import { openAndMigrate } from "./boot.ts";
import { loadConfigFromProcess } from "./config.ts";
import { createLogger, fatal } from "./log.ts";

function main(): void {
  const config = loadConfigFromProcess();
  const log = createLogger(config.LOG_LEVEL);
  const { db, schemaVersion } = openAndMigrate(
    config,
    { migrationsDir: resolve(import.meta.dirname, "../migrations") },
    log,
  );
  db.close();
  log.info({ schemaVersion }, "migrations up to date");
}

try {
  main();
} catch (error) {
  fatal(error);
}
