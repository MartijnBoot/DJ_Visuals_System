// T5 (B-04 spec SD20, SD27, AC33; plan PD3): what a socket's received message goes through
// before anything acts on it — rate, size, JSON, schema — with a fake socket and clock.
import {
  MAX_DEVICE_MESSAGE,
  MAX_SCREEN_MESSAGE,
  MAX_SETUP_MESSAGE,
  deviceMessageSchema,
  type DeviceMessage,
} from "@djv/shared";
import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deviceMaxBytes, receive, screenMaxBytes } from "./channel.ts";

let clock: number;
let socket: EventEmitter;
let got: DeviceMessage[];
const log = { warn: vi.fn(), debug: vi.fn() };

const text = (message: unknown) => Buffer.from(JSON.stringify(message));
const deliver = (data: Buffer, isBinary = false) => socket.emit("message", data, isBinary);

function listen(
  ratePerSecond: number | null = 120,
  maxBytes: number | ((type: string) => number) = MAX_DEVICE_MESSAGE,
) {
  receive(socket, {
    schema: deviceMessageSchema,
    maxBytes,
    ratePerSecond,
    now: () => clock,
    log,
    socket: "device",
    onMessage: (m) => got.push(m),
  });
}

beforeEach(() => {
  clock = 0;
  socket = new EventEmitter();
  got = [];
  log.warn.mockReset();
  log.debug.mockReset();
});

describe("receive", () => {
  it("hands a valid message on and logs its type only, at debug", () => {
    listen();
    deliver(text({ type: "colour", seq: 1, slot: 0, value: "#ff8800" }));
    expect(got).toEqual([{ type: "colour", seq: 1, slot: 0, value: "#ff8800" }]);
    expect(log.debug).toHaveBeenCalledWith({ socket: "device", type: "colour" }, "control message");
    expect(JSON.stringify(log.debug.mock.calls)).not.toContain("#ff8800");
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("drops a message failing its schema with one warn naming its type", () => {
    listen();
    deliver(text({ type: "colour", seq: 1, slot: 9, value: "#ff8800" }));
    deliver(text({ type: "newCode" }));
    expect(got).toEqual([]);
    expect(log.warn.mock.calls).toEqual([
      [{ socket: "device", type: "colour" }, "control message dropped"],
      [{ socket: "device", type: "newCode" }, "control message dropped"],
    ]);
  });

  it("drops text that is not JSON, and any binary frame, as unparseable", () => {
    listen();
    deliver(Buffer.from("garbage"));
    deliver(text({ type: "refresh", seq: 1 }), true);
    expect(got).toEqual([]);
    expect(log.warn.mock.calls.map(([fields]) => fields)).toEqual([
      { socket: "device", type: "unparseable" },
      { socket: "device", type: "unparseable" },
    ]);
  });

  it("drops a message over the size limit with one warn, and takes one at the limit", () => {
    listen();
    const pad = (bytes: number) => {
      const base = { type: "pick", seq: 1, id: "" };
      return { ...base, id: "x".repeat(Math.min(200, bytes - JSON.stringify(base).length)) };
    };
    const atLimit = Buffer.alloc(MAX_DEVICE_MESSAGE, " ");
    text(pad(100)).copy(atLimit);
    deliver(atLimit);
    expect(got).toHaveLength(1);
    const over = Buffer.alloc(MAX_DEVICE_MESSAGE + 1, " ");
    text(pad(100)).copy(over);
    deliver(over);
    expect(got).toHaveLength(1);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(
      { socket: "device", type: "pick" },
      "control message dropped",
    );
  });

  it("drops messages beyond 120 in a sliding second, quietly, and takes them again after", () => {
    listen();
    for (let i = 0; i < 125; i++) deliver(text({ type: "refresh", seq: i }));
    expect(got).toHaveLength(120);
    clock += 999;
    deliver(text({ type: "refresh", seq: 200 }));
    expect(got).toHaveLength(120);
    clock += 1;
    deliver(text({ type: "refresh", seq: 201 }));
    expect(got).toHaveLength(121);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("counts a dropped message toward the rate, so a flood of garbage is also capped", () => {
    listen();
    for (let i = 0; i < 120; i++) deliver(Buffer.from("garbage"));
    deliver(text({ type: "refresh", seq: 1 }));
    expect(got).toEqual([]);
    expect(log.warn).toHaveBeenCalledTimes(120);
  });

  it("has no rate limit when none is given (the screen socket, PD3)", () => {
    listen(null);
    for (let i = 0; i < 500; i++) deliver(text({ type: "refresh", seq: i }));
    expect(got).toHaveLength(500);
  });
});

describe("a size limit per message type (B-06 T8, SD16, AC11)", () => {
  const offer = (bytes: number) => ({ type: "offer", sdp: "v".repeat(bytes) });

  it("a device socket takes a setup message up to 16 KB and the rest up to 4 KB", () => {
    listen(120, deviceMaxBytes);
    deliver(text(offer(10_000)));
    deliver(text({ type: "candidate", candidate: "c".repeat(900), sdpMid: "0", sdpMLineIndex: 0 }));
    expect(got.map((m) => m.type)).toEqual(["offer", "candidate"]);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("drops a 17 KB offer with one warn naming offer", () => {
    listen(120, deviceMaxBytes);
    deliver(text({ type: "offer", sdp: "v".repeat(15_000), pad: "x".repeat(2_400) }));
    expect(got).toEqual([]);
    expect(log.warn.mock.calls).toEqual([
      [{ socket: "device", type: "offer" }, "control message dropped"],
    ]);
  });

  it("drops a 5 KB control with one warn naming its type", () => {
    listen(120, deviceMaxBytes);
    deliver(text({ type: "dials", seq: 1, reactivity: 0.5, pad: "x".repeat(5_000) }));
    expect(got).toEqual([]);
    expect(log.warn.mock.calls).toEqual([
      [{ socket: "device", type: "dials" }, "control message dropped"],
    ]);
  });

  it("on the screen socket holds answer, candidate and stream to 16 KB, the rest to its own limit", () => {
    expect(screenMaxBytes("answer")).toBe(MAX_SETUP_MESSAGE);
    expect(screenMaxBytes("candidate")).toBe(MAX_SETUP_MESSAGE);
    expect(screenMaxBytes("stream")).toBe(MAX_SETUP_MESSAGE);
    expect(screenMaxBytes("state")).toBe(MAX_SCREEN_MESSAGE);
    expect(screenMaxBytes("unknown")).toBe(MAX_SCREEN_MESSAGE);
    expect(deviceMaxBytes("offer")).toBe(MAX_SETUP_MESSAGE);
    expect(deviceMaxBytes("candidate")).toBe(MAX_SETUP_MESSAGE);
    expect(deviceMaxBytes("hello")).toBe(MAX_DEVICE_MESSAGE);
    expect(deviceMaxBytes("unparseable")).toBe(MAX_DEVICE_MESSAGE);
  });
});
