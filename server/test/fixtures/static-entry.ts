// Like main.ts without `--api-only`, with the static folder taken from argv[2] so a test can
// serve a temporary one (or an empty one) instead of web/dist.
import { resolve } from "node:path";
import { boot } from "../../src/boot.ts";
import { loadConfigFromProcess } from "../../src/config.ts";
import { fatal } from "../../src/log.ts";

const staticDir = process.argv[2];
if (!staticDir) throw new Error("usage: static-entry.ts <staticDir>");

boot(loadConfigFromProcess(), {
  migrationsDir: resolve(import.meta.dirname, "../../migrations"),
  staticDir,
}).catch(fatal);
