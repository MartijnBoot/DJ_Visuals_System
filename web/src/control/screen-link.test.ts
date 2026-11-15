// T9 (B-04 spec SD5, SD13, SD22, SD25, AC26, AC29 to AC31; plan PD3, PD12, PD17): the screen
// page's socket with a fake socket and fake timers.
import {
  screenStateSchema,
  type Control,
  type ControlStatus,
  type ScreenState,
  type ToScreen,
} from "@djv/shared";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { SocketLike } from "./device-link.ts";
import { createActiveProfile } from "../profiles/active.ts";
import { createScreenLink, toScreenState, type ScreenLink } from "./screen-link.ts";

class FakeSocket implements SocketLike {
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: { type: string; [k: string]: unknown }[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    FakeSocket.all.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data) as { type: string });
  }
  close() {
    this.drop();
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  deliver(message: ToScreen) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  drop() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.();
  }
}

const state: ScreenState = {
  profiles: [{ id: "builtin", name: "Built-in" }],
  activeId: "builtin",
  palette: ["#000000", "#ffffff"],
  storedPalette: ["#000000", "#ffffff"],
  primary: 1,
  dials: { recognisability: 0.3, reactivity: 0.7 },
  cameras: [],
  cameraId: null,
  camera: "idle",
  audio: "idle",
  started: false,
  reason: null,
};

const status = (devices: string[] = []): ControlStatus => ({
  on: true,
  addresses: [{ address: "192.168.1.5", name: "Wi-Fi" }],
  port: 8001,
  code: "ABC234",
  devices: devices.map((deviceId, i) => ({
    deviceId,
    hint: "Safari on iPhone",
    label: `Device ${i}`,
  })),
  pending: [],
});

let link: ScreenLink;
let onControl: Mock<(deviceId: string, control: Control) => void>;
let onNewDevice: Mock<() => void>;
let built: number;
const latest = () => FakeSocket.all.at(-1)!;
const types = (s: FakeSocket) => s.sent.map((m) => m.type);

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.all = [];
  built = 0;
  onControl = vi.fn<(deviceId: string, control: Control) => void>();
  onNewDevice = vi.fn<() => void>();
  link = createScreenLink({
    url: "ws://127.0.0.1:8000/api/control/screen",
    connect: () => new FakeSocket(),
    buildState: () => {
      built++;
      return state;
    },
    onControl,
    onNewDevice,
  });
  link.start();
});

afterEach(() => {
  link.stop();
  vi.useRealTimers();
});

describe("state (SD5, PD3)", () => {
  it("sends the state in the first frame after connecting", () => {
    link.flush([]);
    expect(FakeSocket.all).toHaveLength(1);
    expect(latest().sent).toEqual([]); // not open yet
    latest().open();
    link.flush([]);
    expect(latest().sent).toEqual([{ type: "state", state }]);
  });

  it("sends at most one state per frame however many changes, and none without a change", () => {
    latest().open();
    link.flush([]);
    link.markDirty();
    link.markDirty();
    link.markDirty();
    link.flush([]);
    link.flush([]);
    expect(types(latest())).toEqual(["state", "state"]);
    expect(built).toBe(2);
  });

  it("sends a frame's acknowledgements as one batch, before that frame's state", () => {
    latest().open();
    link.markDirty();
    link.flush([
      { deviceId: "d1", seq: 1 },
      { deviceId: "d2", seq: 3 },
    ]);
    expect(latest().sent).toEqual([
      {
        type: "applied",
        entries: [
          { deviceId: "d1", seq: 1 },
          { deviceId: "d2", seq: 3 },
        ],
      },
      { type: "state", state },
    ]);
  });
});

describe("from the server", () => {
  it("hands each control on with its device", () => {
    latest().open();
    latest().deliver({ type: "control", deviceId: "d1", control: { type: "refresh", seq: 2 } });
    expect(onControl).toHaveBeenCalledWith("d1", { type: "refresh", seq: 2 });
  });

  it("keeps the status for the panel", () => {
    latest().open();
    latest().deliver({ type: "status", status: status() });
    expect(link.view()).toMatchObject({ connection: "open", superseded: false, status: status() });
  });

  it("lists the profiles for a device it has not seen, once per device (PD12, SD22)", () => {
    latest().open();
    latest().deliver({ type: "status", status: status([]) });
    expect(onNewDevice).not.toHaveBeenCalled();
    latest().deliver({ type: "status", status: status(["d1"]) });
    latest().deliver({ type: "status", status: status(["d1"]) });
    expect(onNewDevice).toHaveBeenCalledTimes(1);
    latest().deliver({ type: "status", status: status(["d1", "d2"]) });
    expect(onNewDevice).toHaveBeenCalledTimes(2);
  });

  it("ignores a message that fails the schema", () => {
    latest().open();
    latest().onmessage?.({ data: "garbage" });
    latest().onmessage?.({ data: '{"type":"control","deviceId":"d1","control":{"type":"x"}}' });
    expect(onControl).not.toHaveBeenCalled();
  });

  it("after superseded, says so, sends nothing further and does not reconnect (AC31)", () => {
    latest().open();
    latest().deliver({ type: "superseded" });
    expect(link.view().superseded).toBe(true);
    link.markDirty();
    link.flush([{ deviceId: "d1", seq: 1 }]);
    expect(link.send({ type: "enable" })).toBe(false);
    latest().deliver({ type: "control", deviceId: "d1", control: { type: "refresh", seq: 2 } });
    expect(onControl).not.toHaveBeenCalled();
    expect(latest().sent).toEqual([]);
    latest().drop();
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.all).toHaveLength(1);
  });
});

describe("panel actions (SD25)", () => {
  it("sends them while open, and drops them while down", () => {
    latest().open();
    expect(link.send({ type: "disconnect", deviceId: "d1" })).toBe(true);
    expect(latest().sent).toEqual([{ type: "disconnect", deviceId: "d1" }]);
    latest().drop();
    expect(link.send({ type: "enable" })).toBe(false);
  });
});

describe("reconnecting (PD17)", () => {
  it("is down while closed, reconnects at 0.5 s doubling to 5 s, and sends the state again", () => {
    latest().open();
    link.flush([]);
    latest().drop();
    expect(link.view()).toMatchObject({ connection: "down", status: null });
    const waits: number[] = [];
    for (let i = 0; i < 5; i++) {
      const count = FakeSocket.all.length;
      let waited = 0;
      while (FakeSocket.all.length === count) {
        vi.advanceTimersByTime(100);
        waited += 100;
      }
      waits.push(waited);
      if (i < 4) latest().drop();
    }
    expect(waits).toEqual([500, 1000, 2000, 4000, 5000]);
    latest().open();
    link.flush([]);
    expect(types(latest())).toEqual(["state"]);
  });

  it("never fetches anything itself", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    latest().open();
    for (let i = 0; i < 10; i++) {
      link.markDirty();
      link.flush([]);
      vi.advanceTimersByTime(1000);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("toScreenState (SD5, SD8, AC26)", () => {
  const facts = async (list: "ok" | "unreachable") => {
    const active = createActiveProfile({
      api: {
        list: async () =>
          list === "ok" ? { kind: "ok" as const, profiles: [] } : { kind: "unreachable" as const },
        get: async () => ({ kind: "missing" as const }),
      },
      storage: { load: () => null, save: () => {} },
      setProfile: async () => {},
      setDials: () => {},
      log: () => {},
    });
    await active.open();
    return {
      profiles: active.state(),
      dials: { recognisability: 0.4, reactivity: 0.6 },
      capture: { camera: "ok" as const, audio: "lost" as const, cameraId: "cam-1" },
      cameras: [{ deviceId: "cam-1", label: "Front" }],
      started: true,
    };
  };

  it("carries the picker's list, the live palette, primary, dials, cameras and sources", async () => {
    const built = toScreenState(await facts("ok"));
    expect(screenStateSchema.parse(built)).toEqual({
      profiles: [{ id: "builtin", name: "Built-in" }],
      activeId: "builtin",
      palette: ["#000000", "#ffffff"],
      storedPalette: ["#000000", "#ffffff"],
      primary: 1,
      dials: { recognisability: 0.4, reactivity: 0.6 },
      cameras: [{ deviceId: "cam-1", label: "Front" }],
      cameraId: "cam-1",
      camera: "ok",
      audio: "lost",
      started: true,
      reason: null,
    });
  });

  it("puts the panel's exact reason in the state when the list fails (AC26)", async () => {
    const input = await facts("unreachable");
    expect(input.profiles.reason).toMatch(/^profiles unavailable: the server cannot be reached/);
    expect(toScreenState(input).reason).toBe(input.profiles.reason);
  });

  it("sends no camera id before one is open", async () => {
    const input = await facts("ok");
    const built = toScreenState({ ...input, capture: { camera: "idle", audio: "idle" } });
    expect(built.cameraId).toBeNull();
    expect(screenStateSchema.safeParse(built).success).toBe(true);
  });
});
