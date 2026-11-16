// B-04 T10 (spec SD3, SD4, SD13, SD14, SD18, SD24, AC3, AC4, AC8, AC10, AC13, AC14, AC31, AC32):
// the panel's External control section against the in-process server with the address seam
// (PD13). A device here is a page on the LAN origin speaking the socket directly (PD1); the
// controller page itself is T12's.
import { expect, test, type Page } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  deviceClient,
  LAN_CONTEXT,
  lanRefused,
  startControlServer,
  type ControlServer,
} from "./control-server.ts";
import { expectCanvasChanging } from "./helpers.ts";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";

let server: ControlServer;

test.beforeEach(async () => {
  server = await startControlServer();
});

test.afterEach(async () => {
  await server.dispose();
});

async function screen(page: Page) {
  await page.goto(`${server.origin}/`);
  await expect(page.getByTestId("control-switch")).toBeVisible();
}

async function switchOn(page: Page): Promise<string> {
  await page.getByTestId("control-switch").click();
  await expect(page.getByTestId("control-switch")).toBeChecked();
  const code = (await page.getByTestId("control-code").textContent()) ?? "";
  expect(code).toMatch(/^[A-Z2-9]{6}$/);
  return code;
}

async function phone(page: Page) {
  const context = await page
    .context()
    .browser()!
    .newContext({ userAgent: IPHONE, ...LAN_CONTEXT });
  return deviceClient(context, server);
}

test("switching on shows the QR code, the URL with the code in its fragment, and the code (AC3)", async ({
  page,
}) => {
  await screen(page);
  await expect(page.getByTestId("control-off-line")).toHaveText(
    "Lets a phone, tablet or laptop on this network control the visuals",
  );
  const code = await switchOn(page);
  await expect(page.getByTestId("control-url")).toHaveText(
    `https://127.0.0.1:${server.controlPort}/control#code=${code}`,
  );
  await expect(page.getByTestId("control-address")).toHaveValue("127.0.0.1");
  const qr = page.getByTestId("control-qr");
  await expect(qr).toBeVisible();
  const box = (await qr.boundingBox())!;
  expect(box.width).toBeCloseTo(box.height, 0);
  expect((await qr.locator("path").getAttribute("d"))?.length ?? 0).toBeGreaterThan(100);
  expect(server.lines.some((l) => JSON.stringify(l).includes(code))).toBe(false);
});

test("with no private address, switching on says so and nothing listens (AC4)", async ({
  page,
}) => {
  server.setAddresses([]);
  await screen(page);
  await page.getByTestId("control-switch").click();
  await expect(page.getByTestId("control-error")).toHaveText("No local network address found");
  await expect(page.getByTestId("control-switch")).not.toBeChecked();
  expect(await lanRefused(server.controlPort)).toBe(true);
});

test("the trust block comes first: QR, URL, Install once per device, the fingerprint /trust shows (B-06 AC6, SD24)", async ({
  page,
  browser,
}) => {
  await screen(page);
  await switchOn(page);
  const block = page.getByTestId("control-trust");
  await expect(block).toBeVisible();
  await expect(block).toContainText("Install once per device");
  const trustUrl = `https://127.0.0.1:${server.controlPort}/trust`;
  await expect(page.getByTestId("control-trust-url")).toHaveText(trustUrl);
  await expect(page.getByTestId("control-trust-qr")).toBeVisible();
  const fingerprint = (await page.getByTestId("control-trust-fingerprint").textContent()) ?? "";
  expect(fingerprint).toMatch(/^[0-9A-F]{16}$/);
  // First of the section's content: before the control page's QR code, URL and code.
  const first = await page.evaluate(() => {
    const trust = document.querySelector('[data-testid="control-trust"]')!;
    return ["control-qr", "control-url", "control-code"].every(
      (id) =>
        trust.compareDocumentPosition(document.querySelector(`[data-testid="${id}"]`)!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });
  expect(first).toBe(true);
  // The same 16 characters on the page a device opens to trust the root.
  const context = await browser.newContext(LAN_CONTEXT);
  const device = await context.newPage();
  await device.goto(trustUrl);
  await expect(device.getByTestId("trust-fingerprint")).toHaveText(fingerprint);
  await context.close();
});

test("an unreadable certificate store: switching on says so, the switch reads off, nothing listens (B-06 AC4)", async ({
  page,
}) => {
  await screen(page);
  await switchOn(page); // the first switch-on creates the root in this server's DATA_DIR
  await page.getByTestId("control-switch").click();
  await expect(page.getByTestId("control-switch")).not.toBeChecked();
  const file = join(server.dataDir, "tls", "root.crt");
  writeFileSync(file, readFileSync(file).subarray(0, 60));
  await page.getByTestId("control-switch").click();
  await expect(page.getByTestId("control-error")).toHaveText(
    "Certificate store unreadable — see the runbook",
  );
  await expect(page.getByTestId("control-switch")).not.toBeChecked();
  expect(await lanRefused(server.controlPort)).toBe(true);
});

test("a device presenting the code appears with its hint, and Accept approves it (AC8, AC10)", async ({
  page,
}) => {
  await screen(page);
  const code = await switchOn(page);
  const device = await phone(page);
  await device.send({ type: "hello", code });
  await device.waitFor("waiting");
  const pending = page.getByTestId("control-pending");
  await expect(pending).toContainText("Safari on iPhone · Device 1");
  await pending.getByTestId("control-accept").click();
  const approved = await device.waitFor("approved");
  expect(approved.key).toMatch(/^[A-Za-z0-9_-]{22}$/);
  await expect(page.getByTestId("control-devices")).toContainText("Safari on iPhone · Device 1");
  await expect(page.getByTestId("control-pending")).toHaveCount(0);
});

test("Reject refuses the device (AC10)", async ({ page }) => {
  await screen(page);
  const code = await switchOn(page);
  const device = await phone(page);
  await device.send({ type: "hello", code });
  await page.getByTestId("control-reject").click();
  expect(await device.waitFor("refused")).toEqual({ type: "refused", reason: "rejected" });
});

test("New code changes the code and ends every device (AC13)", async ({ page }) => {
  await screen(page);
  const code = await switchOn(page);
  const device = await phone(page);
  await device.send({ type: "hello", code });
  await page.getByTestId("control-accept").click();
  await device.waitFor("approved");
  await page.getByTestId("control-new-code").click();
  await expect(page.getByTestId("control-code")).not.toHaveText(code);
  await expect(page.getByTestId("control-url")).not.toContainText(code);
  await device.waitFor("ended");
  await expect(page.getByTestId("control-devices")).toHaveText("none");
});

test("Disconnect ends that device only (AC14)", async ({ page }) => {
  await screen(page);
  const code = await switchOn(page);
  const first = await phone(page);
  await first.send({ type: "hello", code });
  await page.getByTestId("control-accept").click();
  await first.waitFor("approved");
  const second = await phone(page);
  await second.send({ type: "hello", code });
  await page.getByTestId("control-accept").click();
  await second.waitFor("approved");
  await page
    .locator('[data-testid=control-devices] li:has-text("Device 1")')
    .getByTestId("control-disconnect")
    .click();
  await first.waitFor("ended");
  await expect(page.getByTestId("control-devices")).toContainText("Device 2");
  await expect(page.getByTestId("control-devices")).not.toContainText("Device 1");
  expect(await second.closed()).toBe(false);
});

test("switching off ends the devices and goes back to the off line (AC6)", async ({ page }) => {
  await screen(page);
  const code = await switchOn(page);
  const device = await phone(page);
  await device.send({ type: "hello", code });
  await page.getByTestId("control-switch").click();
  await expect(page.getByTestId("control-switch")).not.toBeChecked();
  await expect(page.getByTestId("control-off-line")).toBeVisible();
  await device.waitFor("ended");
});

test("a second screen page takes over; the first says External control is on another screen tab (AC31)", async ({
  page,
  context,
}) => {
  await screen(page);
  const second = await context.newPage();
  await screen(second);
  await expect(page.getByTestId("control-other-tab")).toHaveText(
    "External control is on another screen tab",
  );
  await expect(second.getByTestId("control-switch")).toBeVisible();
});

test("a reload keeps External control on with the same code (AC30, SD13)", async ({ page }) => {
  await screen(page);
  const code = await switchOn(page);
  await page.reload();
  await expect(page.getByTestId("control-switch")).toBeChecked();
  await expect(page.getByTestId("control-code")).toHaveText(code);
});

// T18 (D-05, owner-added after H3): on the owner's machine the address picker listed Hyper-V and
// WSL adapters by name, and the 340 px panel scrolled sideways. The panel is wider and nothing in
// it may be wider than the panel, whatever the adapter names.
test("the panel is wider and never scrolls sideways, even with long adapter names and a waiting device (T18, D-05)", async ({
  page,
}) => {
  server.setAddresses([
    { address: "127.0.0.1", name: "vEthernet (WSL (Hyper-V firewall))" },
    { address: "127.0.0.2", name: "Ethernet 18 (Realtek USB GbE Family Controller #2)" },
  ]);
  await screen(page);
  const code = await switchOn(page);
  const device = await phone(page);
  await device.send({ type: "hello", code });
  await expect(page.getByTestId("control-pending")).toContainText("Safari on iPhone · Device 1");
  const panel = page.getByTestId("panel");
  const { scrollWidth, clientWidth } = await panel.evaluate((p) => ({
    scrollWidth: p.scrollWidth,
    clientWidth: p.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  expect((await panel.boundingBox())!.width).toBeGreaterThanOrEqual(400);
});

test("the QR code is in the panel, never on the output canvas, and gone when the panel closes (AC32, SD24)", async ({
  page,
}) => {
  await screen(page);
  const code = await switchOn(page);
  // The code is an SVG inside the panel: DOM over the canvas, never drawn into it. WebGL
  // cannot draw DOM, so the canvas holds the visuals alone; it has no children and is the only
  // canvas on the page.
  await expect(page.getByTestId("panel").getByTestId("control-qr")).toBeVisible();
  expect(await page.locator("canvas").count()).toBe(1);
  expect(await page.getByTestId("screen").evaluate((c) => c.childElementCount)).toBe(0);
  await page.keyboard.press("s");
  await expect(page.getByTestId("panel")).toHaveCount(0);
  expect(await page.locator("svg").count()).toBe(0);
  expect(await page.evaluate(() => document.body.innerText)).not.toContain(code);
  await expectCanvasChanging(page);
});
