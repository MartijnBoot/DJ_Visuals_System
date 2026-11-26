// T7 (B-04 spec SD18, AC10): a request unanswered for 60 s expires — the device is told and
// closed, and the request leaves the panel's list and every controller's — on fake timers with
// fake sockets, so the test does not wait a minute.
import type { ControlStatus, ToDevice, ToScreen } from "@djv/shared";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import type { Logger } from "../log.ts";
import type { SceneStore } from "../scenes/store.ts";
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
  fingerprint: () => null,
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

function request(ip = "192.168.1.20", sends: ("video" | "audio")[] = []) {
  const socket = new FakeSocket();
  const deviceId = hub.request(asSocket(socket), ip, lastStatus().code!, "Safari on iPhone", sends);
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

describe("senders (B-06 T7, SD6, SD15, SD25, PD5)", () => {
  it("lists a sender's request with its role, and approved senders apart with online", async () => {
    const { socket, deviceId } = request("192.168.1.30", ["video"]);
    expect(lastStatus().pending).toEqual([
      { deviceId, hint: "Safari on iPhone", label: "Device 1", sends: ["video"] },
    ]);
    screen.receive({ type: "accept", deviceId });
    await vi.advanceTimersByTimeAsync(0);
    expect(socket.sent).toContainEqual({
      type: "approved",
      key: expect.any(String),
      deviceId,
      sends: ["video"],
    });
    expect(lastStatus().devices).toEqual([]);
    expect(lastStatus().senders).toEqual([
      { deviceId, hint: "Safari on iPhone", label: "Device 1", sends: ["video"], online: true },
    ]);
    socket.close(1000);
    hub.closed(deviceId, asSocket(socket)); // what device.ts does on the socket's close
    expect(lastStatus().senders[0]!.online).toBe(false);
  });

  it("a controller's approval carries empty sends and lists it among devices", async () => {
    const { socket, deviceId } = request();
    screen.receive({ type: "accept", deviceId });
    await vi.advanceTimersByTimeAsync(0);
    expect(socket.sent).toContainEqual({
      type: "approved",
      key: expect.any(String),
      deviceId,
      sends: [],
    });
    expect(lastStatus().devices.map((d) => d.deviceId)).toEqual([deviceId]);
    expect(lastStatus().senders).toEqual([]);
  });

  it("logs sender requested, accepted, rejected and expired with the label and role only", async () => {
    const a = request("192.168.1.31", ["audio"]);
    screen.receive({ type: "accept", deviceId: a.deviceId });
    const b = request("192.168.1.32", ["video", "audio"]);
    await vi.advanceTimersByTimeAsync(0);
    screen.receive({ type: "reject", deviceId: b.deviceId });
    request("192.168.1.33", ["video"]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(info).toHaveBeenCalledWith({ device: "Device 1", sends: ["audio"] }, "sender requested");
    expect(info).toHaveBeenCalledWith({ device: "Device 1", sends: ["audio"] }, "sender accepted");
    expect(info).toHaveBeenCalledWith(
      { device: "Device 2", sends: ["video", "audio"] },
      "sender rejected",
    );
    expect(info).toHaveBeenCalledWith(
      { device: "Device 3", sends: ["video"] },
      "sender request expired",
    );
    expect(JSON.stringify(info.mock.calls)).not.toContain("Safari");
  });

  it("refuses a second audio sender with audio_taken", async () => {
    const a = request("192.168.1.31", ["audio"]);
    screen.receive({ type: "accept", deviceId: a.deviceId });
    await vi.advanceTimersByTimeAsync(0);
    const socket = new FakeSocket();
    expect(
      hub.request(asSocket(socket), "192.168.1.40", lastStatus().code!, "Chrome on Windows", [
        "audio",
      ]),
    ).toBeNull();
    expect(socket.sent).toEqual([{ type: "refused", reason: "audio_taken" }]);
  });
});

describe("scene requests (B-07 PD9)", () => {
  it("a store that throws is answered as unavailable and logged by type only, not thrown", async () => {
    const error = vi.fn();
    const failing = new Proxy({} as SceneStore, {
      get: () => () => {
        throw new Error("SQLITE_BUSY: database is locked (Alley)");
      },
    });
    const local = createHub({
      log: { ...log, error } as unknown as Logger,
      controlPort: 8001,
      now: () => Date.now(),
      pairing: createPairing({ now: () => Date.now(), random: (size) => new Uint8Array(size) }),
      lan,
      scenes: failing,
    });
    const socket = new FakeSocket();
    local.attachScreen(asSocket(socket));
    expect(() => socket.receive({ type: "scenes.list", requestId: 7 })).not.toThrow();
    expect(socket.sent).toContainEqual({ type: "scenes.result", requestId: 7, ok: false });
    expect(error).toHaveBeenCalledWith({ type: "scenes.list" }, "scene request failed");
    expect(JSON.stringify(error.mock.calls)).not.toContain("Alley");
    await local.close();
  });
});

describe("the preview holder (B-07 T11, SD13, SD15, PD15)", () => {
  /** An approved controller: its socket and id. */
  async function controller(ip: string) {
    const c = request(ip);
    screen.receive({ type: "accept", deviceId: c.deviceId });
    await vi.advanceTimersByTimeAsync(0);
    return c;
  }
  const watch = (deviceId: string, watching = true) =>
    hub.preview(deviceId, { type: "previewStream", watching });
  const toScreen = (type: string) => (screen.sent as ToScreen[]).filter((m) => m.type === type);
  const holderOf = (socket: FakeSocket) =>
    (socket.sent as ToDevice[]).filter((m) => m.type === "preview").at(-1);

  it("a controller's previewStream makes it the holder; a second takes over and the first hears it", async () => {
    const a = await controller("192.168.1.50");
    const b = await controller("192.168.1.51");
    watch(a.deviceId);
    expect(holderOf(a.socket)).toEqual({ type: "preview", holder: true });
    expect(toScreen("preview").at(-1)).toEqual({ type: "preview", deviceId: a.deviceId });
    watch(b.deviceId);
    expect(holderOf(a.socket)).toEqual({ type: "preview", holder: false });
    expect(holderOf(b.socket)).toEqual({ type: "preview", holder: true });
    expect(toScreen("preview").at(-1)).toEqual({ type: "preview", deviceId: b.deviceId });
    expect(info).toHaveBeenCalledWith({ device: "Device 1" }, "preview stream opened");
    expect(info).toHaveBeenCalledWith({ device: "Device 1" }, "preview stream ended");
    expect(info).toHaveBeenCalledWith({ device: "Device 2" }, "preview stream opened");
  });

  it("a welcome tells a controller whether it holds the stream", async () => {
    const a = await controller("192.168.1.52");
    expect(holderOf(a.socket)).toEqual({ type: "preview", holder: false });
  });

  it("watching: false from a non-holder changes nothing; from the holder clears it", async () => {
    const a = await controller("192.168.1.53");
    const b = await controller("192.168.1.54");
    watch(a.deviceId);
    const before = toScreen("preview").length;
    watch(b.deviceId, false);
    expect(toScreen("preview")).toHaveLength(before);
    watch(a.deviceId, false);
    expect(toScreen("preview").at(-1)).toEqual({ type: "preview", deviceId: null });
    expect(holderOf(a.socket)).toEqual({ type: "preview", holder: false });
  });

  const clears: [string, (c: { socket: FakeSocket; deviceId: string }) => Promise<void>][] = [
    [
      "the holder's socket closing",
      async ({ socket, deviceId }) => {
        socket.close(1000);
        hub.closed(deviceId, asSocket(socket));
      },
    ],
    [
      "the panel's disconnect",
      async ({ deviceId }) => screen.receive({ type: "disconnect", deviceId }),
    ],
    ["switching off", async () => screen.receive({ type: "disable" })],
    ["a new code", async () => screen.receive({ type: "newCode" })],
  ];
  it.each(clears)("%s clears the holder and tells the screen", async (_name, clear) => {
    const a = await controller("192.168.1.55");
    watch(a.deviceId);
    await clear(a);
    await vi.advanceTimersByTimeAsync(0);
    expect(toScreen("preview").at(-1)).toEqual({ type: "preview", deviceId: null });
    expect(info).toHaveBeenCalledWith({ device: "Device 1" }, "preview stream ended");
    // The relay is closed: the old holder's answer reaches the screen no more.
    hub.preview(a.deviceId, { type: "previewAnswer", sdp: "v=0" });
    expect(toScreen("previewAnswer")).toEqual([]);
  });

  it("the screen closing or being superseded clears it and tells the holder", async () => {
    const a = await controller("192.168.1.56");
    watch(a.deviceId);
    const next = new FakeSocket();
    hub.attachScreen(asSocket(next));
    expect(holderOf(a.socket)).toEqual({ type: "preview", holder: false });
    expect(info).toHaveBeenCalledWith({ device: "Device 1" }, "preview stream ended");
    watch(a.deviceId);
    expect((next.sent as ToScreen[]).filter((m) => m.type === "preview").at(-1)).toEqual({
      type: "preview",
      deviceId: a.deviceId,
    });
    next.close(1000);
    expect(holderOf(a.socket)).toEqual({ type: "preview", holder: false });
  });

  it("relays the screen's setup to the holder only, and only the holder's to the screen", async () => {
    const a = await controller("192.168.1.57");
    const b = await controller("192.168.1.58");
    watch(a.deviceId);
    const candidate = { candidate: "candidate:1", sdpMid: "0", sdpMLineIndex: 0 };
    screen.receive({ type: "previewOffer", deviceId: a.deviceId, sdp: "v=0 a" });
    screen.receive({ type: "previewCandidate", deviceId: a.deviceId, ...candidate });
    screen.receive({ type: "previewOffer", deviceId: b.deviceId, sdp: "v=0 b" });
    await vi.advanceTimersByTimeAsync(0);
    const setup = (s: FakeSocket) =>
      (s.sent as ToDevice[]).filter(
        (m) => m.type === "previewOffer" || m.type === "previewCandidate",
      );
    expect(setup(a.socket)).toEqual([
      { type: "previewOffer", sdp: "v=0 a" },
      { type: "previewCandidate", ...candidate },
    ]);
    expect(setup(b.socket)).toEqual([]);
    hub.preview(a.deviceId, { type: "previewAnswer", sdp: "v=0 answer" });
    hub.preview(a.deviceId, { type: "previewCandidate", ...candidate });
    hub.preview(b.deviceId, { type: "previewAnswer", sdp: "v=0 stray" });
    expect(toScreen("previewAnswer")).toEqual([
      { type: "previewAnswer", deviceId: a.deviceId, sdp: "v=0 answer" },
    ]);
    expect(toScreen("previewCandidate")).toEqual([
      { type: "previewCandidate", deviceId: a.deviceId, ...candidate },
    ]);
  });
});
