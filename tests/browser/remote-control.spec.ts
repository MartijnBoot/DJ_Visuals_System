// B-06 T16 (spec AC8, AC14, AC20, AC24, SD8, SD22, UI "Controller"): the real `/control` page with
// remote senders — the role in the approval prompt, the remote camera tile with its mark, disabled
// before Start, and the main-audio switch. Phones are LAN contexts at 390×844; senders are
// scripted (`sender-client.ts`) and make their own media.
import { expect, test, type Page } from "@playwright/test";
import { startControlServer, type ControlServer } from "./control-server.ts";
import { near, patch, slide, start } from "./helpers.ts";
import { remote, type Remote } from "./remote-fixtures.ts";
import { SENDER_RGB } from "./sender-client.ts";

let server: ControlServer;
let r: Remote;

test.beforeEach(async () => {
  server = await startControlServer();
  r = remote(server);
});

test.afterEach(async () => {
  await r.dispose();
  await server.dispose();
});

const tile = (phone: Page, deviceId: string) =>
  phone.locator(`[data-testid=camera-tile][data-camera-id="remote:${deviceId}"]`);

test("the prompt names a sender's role, its camera tile carries the remote mark and waits for Start, and tapping it draws the sender (AC8, AC14, AC24)", async ({
  page,
  browser,
}) => {
  const { code, url } = await r.screen(page);
  const phone = await r.phone(page, browser, url); // Device 1

  // DJ mode: the badge's prompt names the role.
  const video = await r.sender(page, code, ["video"]); // Device 2
  await phone.getByTestId("waiting-badge").click();
  await expect(phone.getByTestId("approval-text")).toHaveText(
    /^Chrome on \w+ — Device 2 wants to send video$/,
  );
  await phone.getByTestId("approve").click();
  const { deviceId } = await video.waitFor("approved");

  // VJ mode: the inline list names it too.
  await phone.getByTestId("mode-vj").click();
  await r.sender(page, code, ["video", "audio"]); // Device 3
  await expect(phone.getByTestId("approval-text")).toHaveText(
    /^Chrome on \w+ — Device 3 wants to send video and audio$/,
  );
  await phone.getByTestId("refuse").click();
  await phone.getByTestId("mode-dj").click();

  // Listed with its mark, disabled before Start with the existing note (AC24).
  await expect(tile(phone, deviceId)).toHaveText(/^Chrome on \w+ — Device 2/, { timeout: 20_000 });
  await expect(tile(phone, deviceId).getByTestId("remote-mark")).toBeVisible();
  await expect(tile(phone, deviceId)).toBeDisabled();
  await expect(phone.getByTestId("camera-note")).toHaveText("Start on the screen machine");
  const local = phone.locator("[data-testid=camera-tile]:not([data-camera-id^='remote:'])");
  await expect(local.getByTestId("remote-mark")).toHaveCount(0);

  await start(page);
  await slide(page, "recognisability", "Home");
  await slide(page, "reactivity", "Home");
  await page.keyboard.press("s");
  await expect(tile(phone, deviceId)).toBeEnabled();
  await tile(phone, deviceId).click();
  await expect(tile(phone, deviceId)).toHaveAttribute("aria-pressed", "true", { timeout: 20_000 });
  const { width, height } = page.viewportSize()!;
  await expect
    .poll(async () => near(await patch(page, width / 4, height / 2), [...SENDER_RGB], 40), {
      timeout: 20_000,
    })
    .toBe(true);
});

test("the main-audio switch: absent without an audio sender, 'screen machine' pins the local input and a second controller shows it (AC20, SD22)", async ({
  page,
  browser,
}) => {
  const { code, url } = await r.screen(page);
  const first = await r.phone(page, browser, url);
  await r.pairedSender(page, code, ["video"]);
  await start(page); // the panel stays open: the next request is accepted there
  await expect(first.getByTestId("main-audio")).toHaveCount(0); // no audio sender

  await r.pairedSender(page, code, ["audio"]); // Device 3
  const second = await r.phone(page, browser, url);
  for (const phone of [first, second]) {
    await expect(phone.getByTestId("main-audio-remote")).toHaveAttribute("aria-pressed", "true", {
      timeout: 20_000,
    });
    await expect(phone.getByTestId("main-audio-line")).toHaveText("audio: remote (Device 3) ok");
  }

  await first.getByTestId("main-audio-local").click();
  await page.keyboard.press("o");
  await expect(page.getByTestId("overlay-audio")).toHaveText("audio: local");
  for (const phone of [first, second]) {
    await expect(phone.getByTestId("main-audio-local")).toHaveAttribute("aria-pressed", "true");
    await expect(phone.getByTestId("main-audio-remote")).toHaveAttribute("aria-pressed", "false");
    await expect(phone.getByTestId("main-audio-line")).toHaveText("audio: local");
  }

  // VJ mode has the same switch; "laptop" sends it back to remote.
  await second.getByTestId("mode-vj").click();
  await second.getByTestId("main-audio-remote").click();
  await expect(page.getByTestId("overlay-audio")).toHaveText("audio: remote (Device 3) ok", {
    timeout: 10_000,
  });
  await expect(first.getByTestId("main-audio-remote")).toHaveAttribute("aria-pressed", "true");
});
