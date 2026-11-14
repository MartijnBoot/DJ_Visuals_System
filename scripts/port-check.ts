// Can 127.0.0.1:<port> be bound right now? (B-08 PD12.) The load harness checks its own port
// with it before starting anything; `scripts/check.sh` runs it as a script before the browser
// step:
//   node scripts/port-check.ts <port>    exit 0: free · 1: cannot be bound · 2: bad argument
import { createServer } from "node:net";

export function canBind(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

if (import.meta.main) {
  const arg = process.argv[2] ?? "";
  const port = Number(arg);
  if (!/^\d+$/.test(arg) || port < 1 || port > 65535) {
    console.error(`usage: node scripts/port-check.ts <port 1-65535>; got "${arg}"`);
    process.exit(2);
  }
  process.exit((await canBind(port)) ? 0 : 1);
}
