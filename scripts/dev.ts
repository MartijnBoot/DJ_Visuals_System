// `pnpm dev` (spec SD10, plan PD9): the server under `node --watch`, and the Vite dev server
// with hot reload on 5173, proxying /api to the server. The port comes from the server's own
// config module, so the environment keeps one reader and `web/` imports nothing from `server/`.
// Run from the repository root:
//   node --env-file-if-exists=.env.local scripts/dev.ts
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { createServer } from "vite";
import { loadConfigFromProcess } from "../server/src/config.ts";
import { fatal } from "../server/src/log.ts";

const root = resolve(import.meta.dirname, "..");

async function main(): Promise<void> {
  const config = loadConfigFromProcess();

  const server = spawn(
    process.execPath,
    ["--watch", "--env-file-if-exists=.env.local", "server/src/main.ts"],
    { cwd: root, stdio: "inherit" },
  );

  const vite = await createServer({
    root: resolve(root, "web"),
    configFile: resolve(root, "web/vite.config.ts"),
    server: { proxy: { "/api": `http://127.0.0.1:${config.PORT}` } },
  });
  await vite.listen();
  vite.printUrls();

  const stop = () => {
    server.kill();
    void vite.close().then(() => process.exit(0));
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

main().catch(fatal);
