// Like migrate-cli.ts, with the migrations folder taken from argv[2].
import { openAndMigrate } from "../../src/boot.ts";
import { loadConfigFromProcess } from "../../src/config.ts";
import { createLogger, fatal } from "../../src/log.ts";

const migrationsDir = process.argv[2];
if (!migrationsDir) throw new Error("usage: migrate-entry.ts <migrationsDir>");

try {
  const config = loadConfigFromProcess();
  const { db } = openAndMigrate(config, { migrationsDir }, createLogger(config.LOG_LEVEL));
  db.close();
} catch (error) {
  fatal(error);
}
