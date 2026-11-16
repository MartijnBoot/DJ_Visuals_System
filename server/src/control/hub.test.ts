// T7 (B-04 spec SD18, AC10): a request unanswered for 60 s expires — the device is told and
// closed, and the request leaves the panel's list and every controller's — on fake timers with
// fake sockets, so the test does not wait a minute.
import type { ControlStatus, ToDevice, ToScreen } from "@djv/shared";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import type { Logger } from "../log.ts";
import { createHub, type Hub } from "./hub.ts";
import type { Lan } from "./lan.ts";
import { createPairing } from "./pairing.ts";

class FakeSocket extends EventEmitter {
  readyState = 1;
  sent: unknown[] = [];
  closedWith: number | null = null;
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close(code: number) {
    if (this.readyState !== 1) return;
    this.readyState = 3;
    this.closedWith = code;
    this.emit("close");
  }
  terminate() {
    this.close(1006);
  }
  /** Delivers a message as `ws` would. */
  receive(message: unknown) {
    this.emit("message", Buffer.from(JSON.stringify(message)), false);
  }
}

const lan: Lan = {
  enable: async () => ({ ok: true, addresses: [{ address: "127.0.0.1", name: "test" }] }),
  disable: async () => {},
  isOn: () => true,
  addresses: () => [{ address: "127.0.0.1", name: "test" }],
};

const info = vi.fn();
const log = { info, warn: vi.fn(), debug: vi.fn(), error: vi.fn() } as unknown as Logger;

let hub: Hub;
let screen: FakeSocket;
let counter = 0;

const statuses = () =>
  (screen.sent as ToScreen[]).flatMap((m) => (m.type === "status" ? [m.status] : []));
const lastStatus = (): ControlStatus => statuses().at(-1)!;
const asSocket = (s: FakeSocket) => s as unknown as WebSocket;

beforeEach(async () => {
  vi.useFakeTimers();
  info.mockReset();
  hub = createHub({
    log,
    controlPort: 8001,
    now: () => Date.now(),
    pairing: createPairing({
      now: () => Date.now(),
      random: (size) => Uint8Array.from({ length: size }, () => counter++ % 248),
    }),
    lan,
  });
  screen = new FakeSocket();
  hub.attachScreen(asSocket(screen));
  screen.receive({ type: "enable" });
  await vi.advanceTimersByTimeAsync(0);
});

afterEach(async () => {
  await hub.close();
  vi.useRealTimers();
});

function request(ip = "192.168.1.20") {
  const socket = new FakeSocket();
  const deviceId = hub.request(asSocket(socket), ip, lastStatus().code!, "Safari on iPhone");
  expect(deviceId).not.toBeNull();
  return { socket, deviceId: deviceId! };
}

describe("request expiry (SD18, AC10)", () => {
  it("expires an unanswered request at 60 s and not before", async () => {
    const { socket, deviceId } = request();
    expect(lastStatus().pending.map((d) => d.deviceId)).toEqual([deviceId]);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(socket.closedWith).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(socket.sent.at(-1)).toEqual({ type: "refused", reason: "expired" });
    expect(socket.closedWith).not.toBeNull();
    expect(lastStatus().pending).toEqual([]);
    expect(info).toHaveBeenCalledWith({ device: "Device 1" }, "device request expired");
  });

  it("tells every approved controller that the request left", async () => {
    const first = request();
    screen.receive({ type: "accept", deviceId: first.deviceId });
    await vi.advanceTimersByTimeAsync(0);
    const second = request("192.168.1.21");
    const pendingOf = () =>
      (first.socket.sent as ToDevice[]).filter((m) => m.type === "pending").at(-1);
    expect(pendingOf()).toEqual({
      type: "pending",
      requests: [
        { deviceId: second.deviceId, hint: "Safari on iPhone", label: "Device 2", sends: [] },
      ],
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(pendingOf()).toEqual({ type: "pending", requests: [] });
    expect(lastStatus().devices.map((d) => d.deviceId)).toEqual([first.deviceId]);
  });

  it("expires each request on its own clock", async () => {
    const early = request();
    await vi.advanceTimersByTimeAsync(30_000);
    const late = request("192.168.1.21");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(early.socket.closedWith).not.toBeNull();
    expect(late.socket.closedWith).toBeNull();
    expect(lastStatus().pending.map((d) => d.deviceId)).toEqual([late.deviceId]);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(late.socket.closedWith).not.toBeNull();
  });

  it("an accepted request does not expire", async () => {
    const { socket, deviceId } = request();
    screen.receive({ type: "accept", deviceId });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(socket.closedWith).toBeNull();
    expect(lastStatus().devices.map((d) => d.deviceId)).toEqual([deviceId]);
  });
});
