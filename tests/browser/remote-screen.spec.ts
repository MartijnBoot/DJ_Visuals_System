// B-06 T13 (spec SD7, SD8, SD12, SD17, SD21, AC12, AC14 to AC18, AC24, AC27; plan PD6, PD7, PD10,
// PD12): the screen page draws and analyses what scripted senders send. Two browser contexts on
// 127.0.0.1 (PD10), media made by the sender (`sender-client.ts`), the in-process server with the
// address seam, a controller speaking the device socket for the controls and the state. Every
// wait is on a state the page or a message shows, never a fixed time.
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type { ScreenState } from "../../shared/src/control.ts";
import {
  deviceClient,
  LAN_CONTEXT,
  startControlServer,
  type ControlServer,
  type DeviceClient,
} from "./control-server.ts";
import { cameraColours, meter, near, patch, record, slide, start } from "./helpers.ts";
import { senderClient, SENDER_RGB, type SenderClient } from "./sender-client.ts";

let server: ControlServer;
const contexts: BrowserContext[] = [];

test.beforeEach(async () => {
  server = await startControlServer();
});

test.afterEach(async () => {
  for (const c of contexts.splice(0)) await c.close();
  await server.dispose();
});

type PeerWindow = { __peers: RTCConfiguration[] };

/** The screen page, its media recorded, every peer connection's configuration kept. */
async function screen(page: Page): Promise<string> {
  await record(page);
  await page.addInitScript(() => {
    const w = window as unknown as PeerWindow;
    w.__peers = [];
    const Base = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends Base {
      constructor(config?: RTCConfiguration) {
        super(config);
        w.__peers.push(config ?? {});
      }
    };
  });
  await page.goto(`${server.origin}/`);
  await page.getByTestId("control-switch").click();
  await expect(page.getByTestId("control-switch")).toBeChecked();
  return (await page.getByTestId("control-code").textContent()) ?? "";
}

async function lanContext(page: Page) {
  const context = await page.context().browser()!.newContext(LAN_CONTEXT);
  contexts.push(context);
  return context;
}

/** Accepts the one waiting request from the panel. */
async function accept(page: Page) {
  const button = page.getByTestId("control-accept");
  await expect(button).toHaveCount(1);
  await button.click();
  await expect(button).toHaveCount(0);
}

async function pairedSender(page: Page, code: string, sends: ("video" | "audio")[]) {
  const sender = await senderClient(await lanContext(page), server, sends);
  await sender.request(code);
  await accept(page);
  const { deviceId } = await sender.waitFor("approved");
  return { sender, deviceId };
}

async function pairedController(page: Page, code: string): Promise<DeviceClient> {
  const controller = await deviceClient(await lanContext(page), server);
  await controller.send({ type: "hello", code });
  await controller.waitFor("waiting");
  await accept(page);
  await controller.waitFor("approved");
  return controller;
}

/** The newest state the controller holds, once `pred` holds for it. */
async function stateWhere(controller: DeviceClient, pred: (s: ScreenState) => boolean) {
  let found: ScreenState | null = null;
  await expect
    .poll(
      async () => {
        const states = (await controller.messages()).flatMap((m) =>
          m.type === "state" ? [m.state] : [],
        );
        found = states.at(-1) ?? null;
        return found !== null && pred(found);
      },
      { timeout: 20_000 },
    )
    .toBe(true);
  return found!;
}

const streams = async (sender: SenderClient) =>
  (await sender.messages()).flatMap((m) => (m.type === "stream" ? [m.active] : []));

async function peerConfigs(page: Page) {
  return page.evaluate(() => (window as unknown as PeerWindow).__peers);
}

test("a video sender is listed, takes the picture only when picked, and the other stays paused (AC14 to AC16)", async ({
  page,
}) => {
  const code = await screen(page);
  const controller = await pairedController(page, code);
  await start(page);
  await slide(page, "recognisability", "Home");
  await slide(page, "reactivity", "Home");
  const [leftRgb, rightRgb] = await cameraColours(page);
  const { width, height } = page.viewportSize()!;
  const isCamera = (p: number[]) => near(p, leftRgb, 16) || near(p, rightRgb, 16);
  await expect.poll(async () => isCamera(await patch(page, width / 4, height / 2))).toBe(true);

  const a = await pairedSender(page, code, ["video"]);
  const b = await pairedSender(page, code, ["video"]);
  const listed = await stateWhere(controller, (s) =>
    [a, b].every(({ deviceId }) =>
      s.cameras.some((c) => c.deviceId === `remote:${deviceId}` && c.remote),
    ),
  );
  // "<hint> — Device n": the hint is the platform's own ("Chrome on Windows", "… on Linux").
  expect(listed.cameras.find((c) => c.deviceId === `remote:${a.deviceId}`)!.label).toMatch(
    /^Chrome on \w+ — Device 2$/,
  );
  // Listed, not picked: the picture is still the local camera.
  expect(isCamera(await patch(page, width / 4, height / 2))).toBe(true);

  // Every drawn frame from here, across the switch, is sampled in the page.
  await page.evaluate(() => {
    const w = window as unknown as { __samples: number[][] };
    w.__samples = [];
    const canvas = document.querySelector<HTMLCanvasElement>("[data-testid=screen]")!;
    const copy = document.createElement("canvas");
    copy.width = copy.height = 4;
    const g = copy.getContext("2d", { willReadFrequently: true })!;
    requestAnimationFrame(function sample() {
      requestAnimationFrame(sample);
      g.drawImage(canvas, canvas.width / 4 - 2, canvas.height / 2 - 2, 4, 4, 0, 0, 4, 4);
      const d = g.getImageData(0, 0, 4, 4).data;
      const sum = [0, 0, 0];
      for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) sum[c]! += d[i + c]!;
      w.__samples.push(sum.map((v) => v / 16));
    });
  });
  await controller.send({ type: "camera", seq: 1, deviceId: `remote:${a.deviceId}` });
  await controller.waitFor("applied");
  const isSender = (p: number[]) => near(p, [...SENDER_RGB], 40);
  await expect
    .poll(async () => isSender(await patch(page, width / 4, height / 2)), { timeout: 20_000 })
    .toBe(true);
  // The sender's colour as this browser decodes it, then every sampled frame is one of the two.
  const drawn = await patch(page, width / 4, height / 2);
  const samples = await page.evaluate(
    () => (window as unknown as { __samples: number[][] }).__samples,
  );
  expect(samples.length).toBeGreaterThan(5);
  const foreign = samples.filter((p) => !isCamera(p) && !near(p, drawn, 16));
  expect(foreign, "a frame that is neither camera (the no-camera look)").toEqual([]);

  const state = await stateWhere(controller, (s) => s.cameraId === `remote:${a.deviceId}`);
  expect(state.cameraId).toBe(`remote:${a.deviceId}`);
  expect(await streams(a.sender)).toContain(true);
  expect(await streams(b.sender)).not.toContain(true); // paused throughout (SD12)

  // No ICE server anywhere (AC12), and nothing remote remembered (AC27).
  for (const config of await peerConfigs(page)) expect(config.iceServers ?? []).toEqual([]);
  for (const s of [a.sender, b.sender]) {
    for (const servers of await s.iceServers()) expect(servers).toEqual([]);
  }
  expect(await page.evaluate(() => localStorage.getItem("djv.sources") ?? "")).not.toContain(
    "remote",
  );
});

test("an audio sender becomes main at Start, falls back to the local input when it stops, and nothing remote is remembered (AC17, AC18, AC24, AC27)", async ({
  page,
}) => {
  const code = await screen(page);
  const controller = await pairedController(page, code);
  const video = await pairedSender(page, code, ["video"]);
  const audio = await pairedSender(page, code, ["audio"]);
  // Before Start: both connect and stay paused (SD17, AC24).
  await expect.poll(() => audio.sender.peerState(), { timeout: 20_000 }).toBe("connected");
  await expect.poll(() => video.sender.peerState(), { timeout: 20_000 }).toBe("connected");
  expect(await streams(audio.sender)).not.toContain(true);
  expect(await streams(video.sender)).not.toContain(true);
  const before = await stateWhere(controller, () => true);
  expect(before.mainAudio).toBeNull();

  await start(page);
  // At Start the audio sender becomes main, its tone in the mid band on the panel's meters.
  const main = await stateWhere(
    controller,
    (s) => s.mainAudio?.choice === "remote" && s.mainAudio.playing === "remote",
  );
  expect(main.mainAudio).toEqual({ choice: "remote", playing: "remote", label: "Device 3" });
  await expect.poll(() => meter(page, "mid"), { timeout: 10_000 }).toBeGreaterThan(0.2);
  expect(await streams(audio.sender)).toContain(true);
  expect(await streams(video.sender)).not.toContain(true);
  // The local input stays open, unanalysed (SD7).
  expect(
    await page.evaluate(() =>
      (window as unknown as { __media: { tracks: MediaStreamTrack[] } }).__media.tracks
        .filter((t) => t.kind === "audio")
        .map((t) => t.readyState),
    ),
  ).toContain("live");

  // The sender's track stops: the screen plays its local input (AC18), clicks in the low band.
  await audio.sender.stopTrack("audio");
  await stateWhere(
    controller,
    (s) => s.mainAudio?.choice === "remote" && s.mainAudio.playing === "local",
  );
  await expect.poll(() => meter(page, "mid"), { timeout: 10_000 }).toBeLessThan(0.05);
  await expect.poll(() => meter(page, "low"), { timeout: 10_000 }).toBeGreaterThan(0.1);

  expect(await page.evaluate(() => localStorage.getItem("djv.sources") ?? "")).not.toContain(
    "remote",
  );
  for (const config of await peerConfigs(page)) expect(config.iceServers ?? []).toEqual([]);
});
