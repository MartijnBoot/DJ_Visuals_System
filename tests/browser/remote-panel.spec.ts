// B-06 T15 (spec AC8, AC13, AC14, AC20, SD8, SD15, UI "Panel"; plan PD5, PD16): the screen
// page's panel with remote senders — the `/send` QR code, the role in each pending request, the
// senders listed apart with their connection state, remote cameras in the camera picker, and the
// "Main audio" row. Senders are scripted (`sender-client.ts`) and make their own media. Every wait
// is on a state the page shows; the one wait on time is AC20's own 3 s window.
import { expect, test, type Page } from "@playwright/test";
import { startControlServer, type ControlServer } from "./control-server.ts";
import { cameraColours, meter, near, patch, slide, start } from "./helpers.ts";
import { remote, type Remote } from "./remote-fixtures.ts";
import { SENDER_RGB, type SenderClient } from "./sender-client.ts";

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

const UNREACHABLE =
  "Could not reach the screen machine — the network may block devices from talking to each other";

const senderRow = (page: Page, deviceId: string) =>
  page
    .locator(`[data-testid=control-senders] li[data-device-id="${deviceId}"]`)
    .getByTestId("control-device-text");

/** Pauses or resumes every encoding of the sender's current connection: its feed stalls (PD8). */
async function setSending(sender: SenderClient, sending: boolean) {
  await sender.page.evaluate(async (on) => {
    const pc = (window as unknown as { __sender: { pcs: RTCPeerConnection[] } }).__sender.pcs.at(
      -1,
    )!;
    for (const s of pc.getSenders()) {
      const parameters = s.getParameters();
      for (const e of parameters.encodings ?? []) e.active = on;
      await s.setParameters(parameters);
    }
  }, sending);
}

/** The page shows no text outside the overlay and the panel: the output carries none. */
async function expectNoTextOnOutput(page: Page) {
  const text = await page.evaluate(() => {
    const body = document.body.cloneNode(true) as HTMLElement;
    body.querySelectorAll("[data-testid=overlay], [data-testid=panel]").forEach((e) => e.remove());
    return body.textContent?.trim() ?? "";
  });
  expect(text).toBe("");
}

test("the /send QR code, each role named in the requests, senders listed apart, and no sideways scroll (AC8, SD15, PD16)", async ({
  page,
}) => {
  const { code, url } = await r.screen(page);
  await expect(page.getByTestId("control-send-qr")).toBeVisible();
  await expect(page.getByTestId("control-send-url")).toHaveText(url.replace("/control#", "/send#"));
  expect(url).toContain(`#code=${code}`);

  await r.sender(page, code, ["video"]); // Device 1
  await r.sender(page, code, ["audio"]); // Device 2
  await r.sender(page, code, ["video", "audio"]); // Device 3
  const pending = page.getByTestId("control-pending").locator("li");
  await expect(pending).toHaveText([
    /^Chrome on \w+ — Device 1 wants to send video/,
    /^Chrome on \w+ — Device 2 wants to send audio/,
    /^Chrome on \w+ — Device 3 wants to send video and audio/,
  ]);

  // With every block showing, the 400 px panel never scrolls sideways (D-05).
  const panel = page.getByTestId("panel");
  const { scrollWidth, clientWidth } = await panel.evaluate((p) => ({
    scrollWidth: p.scrollWidth,
    clientWidth: p.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

  // Accepted: listed under senders with role and state, not under the controllers.
  await page.getByTestId("control-accept").first().click();
  await expect(pending).toHaveCount(2);
  const deviceId = (await page
    .locator("[data-testid=control-senders] li")
    .first()
    .getAttribute("data-device-id"))!;
  await expect(senderRow(page, deviceId)).toHaveText(
    /^Chrome on \w+ — Device 1 · video · connected/,
    { timeout: 20_000 },
  );
  await expect(
    page
      .locator(`[data-testid=control-senders] li[data-device-id="${deviceId}"]`)
      .getByTestId("control-disconnect"),
  ).toBeVisible();
  await expect(page.getByTestId("control-devices")).toHaveText("none");
});

test("an approved video sender is in the picker with its mark, picking it there draws it, and its row reads on screen (AC14)", async ({
  page,
}) => {
  const { code } = await r.screen(page);
  const { deviceId } = await r.pairedSender(page, code, ["video"]); // Device 1
  await start(page);
  // A still picture: no audio-driven pulse between two reads of it.
  await slide(page, "recognisability", "Home");
  await slide(page, "reactivity", "Home");
  const [leftRgb, rightRgb] = await cameraColours(page);
  const { width, height } = page.viewportSize()!;
  const isCamera = (p: number[]) => near(p, leftRgb, 16) || near(p, rightRgb, 16);
  await expect.poll(async () => isCamera(await patch(page, width / 4, height / 2))).toBe(true);

  const picker = page.getByTestId("camera-picker");
  const option = picker.locator(`option[value="remote:${deviceId}"]`);
  await expect(option).toHaveText(/^Chrome on \w+ — Device 1 \(remote\)$/, { timeout: 20_000 });
  // The local cameras come first and carry no mark.
  const values = await picker
    .locator("option")
    .evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
  expect(values.at(-1)).toBe(`remote:${deviceId}`);
  for (const text of await picker.locator('option:not([value^="remote:"])').allTextContents()) {
    expect(text).not.toContain("(remote)");
  }
  // Listed, not picked: the picture has not changed.
  expect(isCamera(await patch(page, width / 4, height / 2))).toBe(true);
  await expect(senderRow(page, deviceId)).toHaveText(/ · video · connected$/);

  await picker.selectOption(`remote:${deviceId}`);
  await expect
    .poll(async () => near(await patch(page, width / 4, height / 2), [...SENDER_RGB], 40), {
      timeout: 20_000,
    })
    .toBe(true);
  await expect(picker).toHaveValue(`remote:${deviceId}`);
  await expect(senderRow(page, deviceId)).toHaveText(/ · video · on screen$/);
});

test("the main-audio row appears with an audio sender, and local pins the local input through a remote loss and return (AC20, SD8, SD22)", async ({
  page,
}) => {
  const { code } = await r.screen(page);
  await r.pairedSender(page, code, ["video"]);
  await start(page);
  await expect(page.getByTestId("panel-main-audio")).toHaveCount(0); // no audio sender

  const { sender, deviceId } = await r.pairedSender(page, code, ["audio"]); // Device 2
  const choice = page.getByTestId("panel-main-audio");
  const line = page.getByTestId("panel-main-audio-line");
  await expect(line).toHaveText("audio: remote (Device 2) ok", { timeout: 20_000 });
  await expect(choice).toHaveValue("remote");
  await expect.poll(() => meter(page, "mid"), { timeout: 10_000 }).toBeGreaterThan(0.2);

  await choice.selectOption("local");
  await expect(line).toHaveText("audio: local");
  await expect.poll(() => meter(page, "mid"), { timeout: 10_000 }).toBeLessThan(0.05);

  // The remote feed is lost, then back: the row follows, the choice holds.
  await setSending(sender, false);
  await expect(senderRow(page, deviceId)).toHaveText(/ · audio · lost$/, { timeout: 10_000 });
  await expect(line).toHaveText("audio: local");
  await setSending(sender, true);
  await expect(senderRow(page, deviceId)).toHaveText(/ · audio · connected$/, {
    timeout: 10_000,
  });
  // Past the 3 s in which a remote choice would have returned to it (AC19), local still plays.
  const back = await page.evaluate(() => performance.now());
  await page.waitForFunction((t) => performance.now() > t + 3500, back);
  await expect(line).toHaveText("audio: local");
  // The remote tone holds mid above 0.2 throughout; the local clicks let it fall.
  await expect.poll(() => meter(page, "mid"), { timeout: 10_000 }).toBeLessThan(0.05);

  // Remote again, from the panel: the steady remote plays.
  await choice.selectOption("remote");
  await expect(line).toHaveText("audio: remote (Device 2) ok");
  await expect.poll(() => meter(page, "mid"), { timeout: 10_000 }).toBeGreaterThan(0.2);
});

test("a sender whose peer is never reached reads 'Could not reach' on its row within 10 s, and the output shows no text (AC13)", async ({
  page,
}) => {
  const { code } = await r.screen(page);
  const sender = await r.sender(page, code, ["video"]);
  await sender.blockCandidates(); // before approval: its offer goes out with no reachable candidate
  await page.getByTestId("control-accept").click();
  const { deviceId } = await sender.waitFor("approved");
  await expect(senderRow(page, deviceId)).toHaveText(/ · video · connecting$/);
  await expect(senderRow(page, deviceId)).toHaveText(
    new RegExp(`^Chrome on \\w+ — Device 1 · video · ${UNREACHABLE}$`),
    { timeout: 15_000 },
  );
  expect(await sender.peerState()).not.toBe("connected");
  await expectNoTextOnOutput(page);
  await page.keyboard.press("s");
  await expect(page.getByTestId("panel")).toHaveCount(0);
  await expectNoTextOnOutput(page);
});
