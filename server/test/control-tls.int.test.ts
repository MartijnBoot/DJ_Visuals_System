// B-06 T5 (spec AC1, AC3, AC4, AC5, AC7, SD4, SD13, SD23; plan PD9): the External control listener
// serves HTTPS only, with the certificate store's server certificate for exactly the bound
// addresses, and a client that trusts the test's own root and nothing else completes a real
// handshake. The root is made in this test's temporary DATA_DIR, never in the repository.
import { toDeviceSchema, toScreenSchema, type ControlStatus, type ToScreen } from "@djv/shared";
import { generateKeyPairSync, X509Certificate } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { connect as tcpConnect } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { connect as tlsConnect, type PeerCertificate } from "node:tls";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { boot, type Booted } from "../src/boot.ts";
import type { ControlAddress } from "../src/control/addresses.ts";
import { loadConfig } from "../src/config.ts";
import { rootCertificate, toPem } from "../src/tls/certificate.ts";
import { closeAll, connect, refused, testRoot, type Client } from "./control-client.ts";
import { freePort, repoRoot } from "./spawn-server.ts";

const ONE: ControlAddress = { address: "127.0.0.1", name: "loopback (test)" };
const TWO: ControlAddress = { address: "127.0.0.2", name: "second loopback (test)" };

let tmp: string;
let booted: Booted | undefined;
let port: number;
let controlPort: number;
let lines: Record<string, unknown>[];
let seam: ControlAddress[];
let screen: Client<ToScreen>;

const dataDir = () => join(tmp, "data");
const root = () => testRoot(dataDir());

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), "djv-tls-"));
  lines = [];
  seam = [ONE];
  port = await freePort();
  controlPort = await freePort();
  booted = await boot(
    loadConfig({
      APP_ENV: "test",
      LOG_LEVEL: "debug",
      PORT: String(port),
      CONTROL_PORT: String(controlPort),
      DATA_DIR: dataDir(),
    }),
    { migrationsDir: resolve(repoRoot, "server/migrations"), controlAddresses: () => seam },
    pino(
      { level: "debug" },
      { write: (line: string) => void lines.push(JSON.parse(line) as Record<string, unknown>) },
    ),
  );
  screen = await connect(`ws://127.0.0.1:${port}/api/control/screen`, toScreenSchema, {
    origin: `http://127.0.0.1:${port}`,
  });
  await screen.find((m) => m.type === "status");
});

afterEach(async () => {
  closeAll();
  await booted?.close();
  booted = undefined;
  rmSync(tmp, { recursive: true, force: true });
});

async function act(type: string): Promise<ControlStatus> {
  const answer = screen.next((m) => m.type === "status");
  screen.send({ type });
  const message = await answer;
  if (message.type !== "status") throw new Error("not a status");
  return message.status;
}

/** A TLS handshake with `host` trusting `ca` alone: the peer's certificate, or the error. */
function handshake(
  host: string,
  ca: string | Buffer,
): Promise<{ ok: true; cert: PeerCertificate } | { ok: false; code: string }> {
  return new Promise((resolve) => {
    const socket = tlsConnect({ host, port: controlPort, ca });
    socket.setTimeout(10_000, () => socket.destroy(new Error("timeout")));
    socket.once("secureConnect", () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      resolve({ ok: true, cert });
    });
    socket.once("error", (e: NodeJS.ErrnoException) => resolve({ ok: false, code: e.code ?? "" }));
  });
}

const peerDer = async (host: string) => {
  const result = await handshake(host, root());
  if (!result.ok) throw new Error(`handshake failed: ${result.code}`);
  return result.cert.raw;
};

describe("first switch-on with an empty DATA_DIR (AC1, SD4)", () => {
  it("creates the root, and a client trusting only it completes a handshake on every address", async () => {
    seam = [ONE, TWO];
    const status = await act("enable");
    expect(status.on).toBe(true);
    for (const { address } of seam) {
      const result = await handshake(address, root());
      expect(result.ok, address).toBe(true);
    }
    expect(lines.map((l) => l.msg)).toEqual(
      expect.arrayContaining(["root created", "certificate issued"]),
    );
  });

  it("fails the handshake for a client trusting an unrelated CA", async () => {
    await act("enable");
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const other = toPem(
      rootCertificate({
        key: privateKey,
        createdAt: new Date(),
        serial: new Uint8Array(16).fill(1),
      }),
    );
    const result = await handshake("127.0.0.1", other);
    expect(result).toEqual({ ok: false, code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" });
  });

  it("serves a certificate whose names are exactly the bound addresses", async () => {
    seam = [ONE, TWO];
    await act("enable");
    const cert = new X509Certificate(await peerDer("127.0.0.1"));
    expect(cert.subjectAltName).toBe("IP Address:127.0.0.1, IP Address:127.0.0.2");
    expect(cert.verify(new X509Certificate(root()).publicKey)).toBe(true);
  });

  it("reports the root's fingerprint in the status while on, and null when off", async () => {
    const on = await act("enable");
    const full = new X509Certificate(root()).fingerprint256.replaceAll(":", "");
    expect(on.fingerprint).toBe(full.slice(0, 16));
    expect((await act("disable")).fingerprint).toBeNull();
  });
});

describe("reuse and reissue (AC3)", () => {
  it("enable, disable, enable with the same addresses reuses the certificate", async () => {
    await act("enable");
    const first = await peerDer("127.0.0.1");
    await act("disable");
    await act("enable");
    expect((await peerDer("127.0.0.1")).equals(first)).toBe(true);
    expect(lines.filter((l) => l.msg === "certificate issued")).toHaveLength(1);
  });

  it("another address issues a new certificate under the same root", async () => {
    const before = await act("enable");
    const first = await peerDer("127.0.0.1");
    await act("disable");
    seam = [TWO];
    const after = await act("enable");
    const second = new X509Certificate(await peerDer("127.0.0.2"));
    expect(second.raw.equals(first)).toBe(false);
    expect(second.subjectAltName).toBe("IP Address:127.0.0.2");
    expect(after.fingerprint).toBe(before.fingerprint);
  });
});

describe("an unreadable store (AC4)", () => {
  it("a truncated root.crt: cert_store, CONTROL_PORT refused, the server keeps running", async () => {
    await act("enable");
    await act("disable");
    const file = join(dataDir(), "tls", "root.crt");
    writeFileSync(file, readFileSync(file).subarray(0, 60));
    const status = await act("enable");
    expect(status).toMatchObject({ on: false, code: null, error: "cert_store", fingerprint: null });
    expect(await refused("127.0.0.1", controlPort)).toBe(true);
    expect((await fetch(`http://127.0.0.1:${port}/api/health`)).status).toBe(200);
    expect(lines.some((l) => l.msg === "certificate store unreadable")).toBe(true);
  });
});

describe("HTTPS only (AC5, SD13)", () => {
  it("a plain-HTTP request on CONTROL_PORT gets no HTTP response", async () => {
    await act("enable");
    const answer = await new Promise<string>((resolve) => {
      const socket = tcpConnect({ host: "127.0.0.1", port: controlPort });
      let text = "";
      socket.setTimeout(5000, () => socket.destroy());
      socket.once("connect", () =>
        socket.write("GET /control HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"),
      );
      socket.on("data", (c) => (text += String(c)));
      socket.once("error", () => {});
      socket.once("close", () => resolve(text));
    });
    expect(answer).not.toMatch(/^HTTP\/1\.[01] \d{3}/);
    expect(answer).not.toContain("<");
  });
});

describe("the device socket's Origin over HTTPS (AC7)", () => {
  const url = () => `wss://127.0.0.1:${controlPort}/api/control/device`;

  it("accepts https://<address>:CONTROL_PORT", async () => {
    await act("enable");
    const client = await connect(url(), toDeviceSchema, {
      origin: `https://127.0.0.1:${controlPort}`,
      ca: root(),
    });
    expect(client.ws.readyState).toBe(client.ws.OPEN);
  });

  it.each([
    ["the plain-HTTP origin of the same port", () => `http://127.0.0.1:${controlPort}`],
    ["a foreign origin", () => "https://evil.example"],
    ["another address's origin", () => `https://127.0.0.2:${controlPort}`],
  ])("refuses %s with 403", async (_label, origin) => {
    await act("enable");
    await expect(connect(url(), toDeviceSchema, { origin: origin(), ca: root() })).rejects.toThrow(
      "HTTP 403",
    );
  });
});

describe("keys (AC35)", () => {
  it("no log line contains a private key", async () => {
    seam = [ONE, TWO];
    await act("enable");
    await act("disable");
    seam = [ONE];
    await act("enable");
    for (const line of lines) expect(JSON.stringify(line)).not.toContain("PRIVATE KEY");
  });
});
