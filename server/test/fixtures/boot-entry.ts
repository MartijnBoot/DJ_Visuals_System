// Like main.ts, with the migrations folder taken from argv[2] so a test can plant a broken one.
import { boot } from "../../src/boot.ts";
import { loadConfigFromProcess } from "../../src/config.ts";
import { fatal } from "../../src/log.ts";

const migrationsDir = process.argv[2];
if (!migrationsDir) throw new Error("usage: boot-entry.ts <migrationsDir>");

boot(loadConfigFromProcess(), { migrationsDir }).catch(fatal);
