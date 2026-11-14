// B-08 PD12: `canBind` answers whether 127.0.0.1:<port> can be bound right now. It is the
// harness's check on its own port (8124) and the gate's warning on 8123.
import { createServer, type Server } from "node:net";
import { describe, expect, it } from "vitest";
import { canBind } from "./port-check.ts";

function listen(port = 0): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port }, () => resolve(server));
  });
}

const close = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()));

describe("canBind (B-08 PD12)", () => {
  it("is false while a listener holds the port and true after it closes", async () => {
    const holder = await listen();
    const address = holder.address();
    if (address === null || typeof address === "string") throw new Error("no port");
    expect(await canBind(address.port)).toBe(false);
    await close(holder);
    expect(await canBind(address.port)).toBe(true);
  });

  it("leaves the port free after probing it", async () => {
    const probe = await listen();
    const address = probe.address();
    if (address === null || typeof address === "string") throw new Error("no port");
    await close(probe);
    expect(await canBind(address.port)).toBe(true);
    const again = await listen(address.port);
    await close(again);
  });
});
