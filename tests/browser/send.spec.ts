// B-06 T18 (spec SD1, SD12, SD14, SD18, AC5, AC13, AC15, AC25, AC26, AC31 to AC33; plan PD3): the
// real `/send` page from the LAN listener, in LAN contexts of the gate's browser (its fake camera
// and microphone), against the in-process server with the address seam. A scripted controller
// sees the requests and sends the camera control; the screen page accepts from its panel. Every
// wait is on text a page shows or a message it received, never a fixed time.
import { expect, test, type Page } from "@playwright/test";
import { startControlServer, type ControlServer, type DeviceClient } from "./control-server.ts";
import { record, start, type RecorderOptions } from "./helpers.ts";
import { remote, type Remote } from "./remote-fixtures.ts";

let server: ControlServer;
let r: Remote;
/** The `/send` contexts this file opens itself. */
const closing: (() => Promise<void>)[] = [];

test.beforeEach(async () => {
  server = await startControlServer();
  r = remote(server);
});

test.afterEach(async () => {
  for (const close of closing.splice(0)) await close();
  await r.dispose();
  await server.dispose();
});

type LockWindow = { __locks: { requested: number; released: number } };

/** A `/send` page opened from the code's link, its media recorded and its wake lock counted. */
async function sendPage(page: Page, code: string, options: RecorderOptions = {}) {
  const context = await page.context().browser()!.newContext({ ignoreHTTPSErrors: true });
  const sender = await context.newPage();
  await record(sender, options);
  await sender.addInitScript(() => {
    const w = window as unknown as LockWindow;
    w.__locks = { requested: 0, released: 0 };
    Object.defineProperty(Navigator.prototype, "wakeLock", {
      configurable: true,
      get: () => ({
        request: async () => {
          w.__locks.requested++;
          const sentinel = Object.assign(new EventTarget(), {
            released: false,
            type: "screen",
            release: async () => {
              if (sentinel.released) return;
              sentinel.released = true;
              w.__locks.released++;
              sentinel.dispatchEvent(new Event("release"));
            },
          });
          return sentinel;
        },
      }),
    });
  });
  await sender.goto(`${server.lanOrigin}/send#code=${code}`);
  await expect(sender.getByTestId("send-button")).toBeVisible();
  closing.push(() => context.close());
  return sender;
}

const tracks = (sender: Page) =>
  sender.evaluate(() =>
    (window as unknown as { __media: { tracks: MediaStreamTrack[] } }).__media.tracks.map((t) => ({
      kind: t.kind,
      state: t.readyState,
    })),
  );

const lastPending = async (controller: DeviceClient) => {
  const all = (await controller.messages()).flatMap((m) =>
    m.type === "pending" ? [m.requests] : [],
  );
  return all.at(-1) ?? [];
};

async function acceptOne(page: Page) {
  const button = page.getByTestId("control-accept");
  await expect(button).toHaveCount(1);
  await button.click();
  await expect(button).toHaveCount(0);
}

test("Send needs Camera or Audio; the request carries its role; Standing by, then On screen, and the other Standing by (AC15, AC31, AC32, PD3)", async ({
  page,
}) => {
  const { code } = await r.screen(page);
  const controller = await r.pairedController(page, code);
  const first = await sendPage(page, code);

  await first.getByTestId("send-video").uncheck();
  await expect(first.getByTestId("send-audio")).not.toBeChecked();
  await expect(first.getByTestId("send-button")).toBeDisabled();
  await first.getByTestId("send-video").check();
  await expect(first.getByTestId("send-button")).toBeEnabled();
  await first.getByTestId("send-button").click();
  await expect(first.getByTestId("link-line")).toHaveText("Waiting for approval");
  await expect
    .poll(async () => (await lastPending(controller)).map((e) => e.sends))
    .toEqual([["video"]]);
  const { deviceId } = (await lastPending(controller))[0]!;
  await acceptOne(page);
  await expect(first.getByTestId("send-role")).toHaveText("Sends video");
  await expect(first.getByTestId("send-line-video")).toHaveText("Standing by", {
    timeout: 20_000,
  });
  await expect(first.getByTestId("send-keep")).toHaveText("Keep this page open");
  await expect(first.getByTestId("send-preview")).toBeVisible();
  expect(await first.evaluate(() => (window as unknown as LockWindow).__locks)).toEqual({
    requested: 1,
    released: 0,
  });

  const second = await sendPage(page, code);
  await second.getByTestId("send-button").click(); // the remembered choice: Camera
  await expect(second.getByTestId("link-line")).toHaveText("Waiting for approval");
  await acceptOne(page);
  await expect(second.getByTestId("send-line-video")).toHaveText("Standing by", {
    timeout: 20_000,
  });

  await start(page, { reopen: false });
  await controller.send({ type: "camera", seq: 1, deviceId: `remote:${deviceId}` });
  await expect(first.getByTestId("send-line-video")).toHaveText("On screen", { timeout: 20_000 });
  await expect(second.getByTestId("send-line-video")).toHaveText("Standing by");
});

test("an audio sender captures with processing off, and says Sending audio after Start (AC33, PD3)", async ({
  page,
}) => {
  const { code } = await r.screen(page);
  const sender = await sendPage(page, code);
  await sender.getByTestId("send-video").uncheck();
  await sender.getByTestId("send-audio").check();
  await expect(sender.getByTestId("send-audio-source")).toContainText("System audio");
  await sender.getByTestId("send-button").click();
  await acceptOne(page);
  await expect(sender.getByTestId("send-line-audio")).toHaveText("Standing by", {
    timeout: 20_000,
  });
  const settings = await sender.evaluate(() =>
    (window as unknown as { __media: { tracks: MediaStreamTrack[] } }).__media.tracks
      .filter((t) => t.kind === "audio")
      .map((t) => {
        const s = t.getSettings();
        return [s.echoCancellation, s.noiseSuppression, s.autoGainControl];
      }),
  );
  expect(settings).toEqual([[false, false, false]]);
  await start(page, { reopen: false });
  await expect(sender.getByTestId("send-line-audio")).toHaveText("Sending audio", {
    timeout: 20_000,
  });
});

test("a screen reload shows Screen reconnecting…, then connects again with no click and the same capture (AC25)", async ({
  page,
}) => {
  const { code } = await r.screen(page);
  const sender = await sendPage(page, code);
  await sender.getByTestId("send-button").click();
  await acceptOne(page);
  await expect(sender.getByTestId("send-line-video")).toHaveText("Standing by", {
    timeout: 20_000,
  });
  // Every status the page shows, in order, recorded in the page (as `watchLink` does for D-10).
  await sender.evaluate(() => {
    const w = window as unknown as { __lines: string[] };
    w.__lines = [];
    const line = document.querySelector("[data-testid=link-line]")!;
    new MutationObserver(() => w.__lines.push(line.textContent ?? "")).observe(line, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  });
  const before = await tracks(sender);

  await page.reload();
  await expect(sender.getByTestId("link-line")).toHaveText("Connected", { timeout: 20_000 });
  await expect(sender.getByTestId("send-line-video")).toHaveText("Standing by", {
    timeout: 20_000,
  });
  const lines = await sender.evaluate(() => (window as unknown as { __lines: string[] }).__lines);
  expect(lines).toContain("Screen reconnecting…");
  expect(lines.at(-1)).toBe("Connected");
  // The same capture: no new request, every track still live.
  expect(await tracks(sender)).toEqual(before);
  expect(before.every((t) => t.state === "live")).toBe(true);
});

test("External control off ends the pairing and the capture (AC26)", async ({ page }) => {
  const { code } = await r.screen(page);
  const sender = await sendPage(page, code);
  await sender.getByTestId("send-button").click();
  await acceptOne(page);
  await expect(sender.getByTestId("send-line-video")).toHaveText("Standing by", {
    timeout: 20_000,
  });
  await page.getByTestId("control-switch").click();
  await expect(page.getByTestId("control-switch")).not.toBeChecked();
  await expect(sender.getByTestId("link-line")).toHaveText("Pairing ended — scan the code again");
  await expect.poll(async () => (await tracks(sender)).map((t) => t.state)).toEqual(["ended"]);
  await expect
    .poll(() => sender.evaluate(() => (window as unknown as LockWindow).__locks.released))
    .toBe(1);
  await expect(sender.getByTestId("send-button")).toBeVisible(); // the choice is offered again
});

test("the code field takes a whole typed code, and Send requests with it (review C5)", async ({
  page,
}) => {
  const { code } = await r.screen(page);
  const context = await page.context().browser()!.newContext({ ignoreHTTPSErrors: true });
  closing.push(() => context.close());
  const sender = await context.newPage();
  await record(sender);
  await sender.goto(`${server.lanOrigin}/send`); // opened without the QR code's link
  const field = sender.getByTestId("send-code");
  await field.pressSequentially(code); // one key at a time, as a person types
  await expect(field).toHaveValue(code);
  await sender.getByTestId("send-button").click();
  await expect(sender.getByTestId("link-line")).toHaveText("Waiting for approval");
});

test("/send is served on the LAN listener only (AC5)", async ({ page }) => {
  await r.screen(page);
  const context = await page.context().browser()!.newContext({ ignoreHTTPSErrors: true });
  closing.push(() => context.close());
  expect((await context.request.get(`${server.lanOrigin}/send`)).status()).toBe(200);
  expect((await page.request.get(`${server.origin}/send`)).status()).toBe(404);
});

for (const [name, options, setup, reason] of [
  [
    "camera permission denied",
    { cameraDenied: true },
    async () => {},
    "camera permission denied: allow it in the browser's site settings",
  ],
  [
    "a System audio share cancelled",
    { display: "reject" },
    async (s: Page) => {
      await s.getByTestId("send-video").uncheck();
      await s.getByTestId("send-audio").check();
      await s.getByTestId("send-audio-source").selectOption("system");
    },
    "system audio share cancelled",
  ],
  [
    "a share without audio",
    { display: "video-only" },
    async (s: Page) => {
      await s.getByTestId("send-video").uncheck();
      await s.getByTestId("send-audio").check();
      await s.getByTestId("send-audio-source").selectOption("system");
    },
    "the shared source has no audio (tick 'share audio')",
  ],
] as const) {
  test(`${name} shows B-01's reason and sends no request`, async ({ page }) => {
    const { code } = await r.screen(page);
    const sender = await sendPage(page, code, options as RecorderOptions);
    await setup(sender);
    await sender.getByTestId("send-button").click();
    await expect(sender.getByTestId("send-reason")).toHaveText(reason);
    await expect(sender.getByTestId("link-line")).toHaveCount(0); // no link was made
    await expect(page.getByTestId("control-accept")).toHaveCount(0);
    expect((await tracks(sender)).every((t) => t.state === "ended")).toBe(true);
  });
}

test("microphone permission denied shows B-01's reason and sends no request", async ({ page }) => {
  const { code } = await r.screen(page);
  const context = await page.context().browser()!.newContext({ ignoreHTTPSErrors: true });
  closing.push(() => context.close());
  const sender = await context.newPage();
  await sender.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException("refused by the test", "NotAllowedError");
    };
  });
  await sender.goto(`${server.lanOrigin}/send#code=${code}`);
  await sender.getByTestId("send-video").uncheck();
  await sender.getByTestId("send-audio").check();
  await sender.getByTestId("send-button").click();
  await expect(sender.getByTestId("send-reason")).toHaveText(
    "microphone permission denied: allow it in the browser's site settings",
  );
  await expect(sender.getByTestId("link-line")).toHaveCount(0);
  await expect(page.getByTestId("control-accept")).toHaveCount(0);
});
