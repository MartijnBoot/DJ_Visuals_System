// Entry: the real environment into the boot sequence. Run from the repository root:
//   node --env-file-if-exists=.env.local server/src/main.ts
import { boot } from "./boot.ts";
import { loadConfigFromProcess } from "./config.ts";
import { fatal } from "./log.ts";

async function main(): Promise<void> {
  const config = loadConfigFromProcess();
  const booted = await boot(config);
  const stop = () => {
    void booted.close().then(() => process.exit(0));
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

main().catch(fatal);
