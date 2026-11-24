// B-04 T13 (spec SD7, SD9, SD10, SD11, SD17, SD18, AC8, AC20, AC21, AC23, AC43): VJ mode, the
// colour wheel and the round-trip readout, against the in-process server with the address seam
// (PD13). Controllers are second browser contexts on the LAN listener's origin.
import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { LAN_CONTEXT, startControlServer, type ControlServer } from "./control-server.ts";
import { createProfile, flat, type Definition, type Stored } from "./fixtures/profiles.ts";
import { setFader } from "./fader.ts";
import { meanRgb, pixels } from "./helpers.ts";

const PHONE = { width: 390, height: 844 };
const TABLET = { width: 1024, height: 768 };
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";

let server: ControlServer;
let api: APIRequestContext;
const contexts: BrowserContext[] = [];

test.beforeEach(async ({ playwright }) => {
  server = await startControlServer();
  api = await playwright.request.newContext({ baseURL: server.origin });
});

test.afterEach(async () => {
  for (const c of contexts.splice(0)) await c.close();
  await api.dispose();
  await server.dispose();
});

async function screen(page: Page): Promise<string> {
  await page.goto(`${server.origin}/`);
  await page.getByTestId("control-switch").click();
  await expect(page.getByTestId("control-switch")).toBeChecked();
  return (await page.getByTestId("control-url").textContent())!;
}

async function controller(
  browser: Browser,
  url: string,
  options: { viewport?: { width: number; height: number }; userAgent?: string } = {},
): Promise<Page> {
  const context = await browser.newContext({ viewport: TABLET, ...LAN_CONTEXT, ...options });
  contexts.push(context);
  const phone = await context.newPage();
  await phone.goto(url);
  await expect(phone.getByTestId("link-line")).toHaveText("Waiting for approval");
  return phone;
}

/** A controller accepted from the panel, its tiles enabled. */
async function paired(page: Page, browser: Browser, url: string, viewport = TABLET) {
  const phone = await controller(browser, url, { viewport });
  await page.getByTestId("control-accept").click();
  await expect(phone.getByTestId("profile-tile").first()).toBeEnabled();
  return phone;
}

const tileOf = (phone: Page, stored: Stored) =>
  phone.locator(`[data-testid=profile-tile][data-profile-id="${stored.id}"]`);

/** Red minus green over the middle of the canvas, away from the panel. */
async function redness(page: Page): Promise<number> {
  const [r, g] = meanRgb(await pixels(page, 40, 120, 160, 120));
  return r! - g!;
}

/** Drags across the wheel's disc from its centre to the right edge: hue 0, full saturation. */
async function dragToRed(phone: Page) {
  const box = (await phone.getByTestId("wheel-disc").boundingBox())!;
  const y = box.y + box.height / 2;
  await phone.mouse.move(box.x + box.width / 2, y);
  await phone.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await phone.mouse.move(box.x + box.width / 2 + (box.width / 2 - 2) * (i / 8), y);
  }
  await phone.mouse.up();
}

test("dragging the wheel recolours the screen without a new program; Reset and a re-pick restore the stored colour (AC20, AC21, SD7)", async ({
  page,
  browser,
}) => {
  const grey = await createProfile(api, flat("Grey", "#808080"));
  const url = await screen(page);
  const vj = await paired(page, browser, url);
  const dj = await paired(page, browser, url, PHONE);
  await tileOf(vj, grey).click();
  await page.keyboard.press("o");
  await expect(page.getByTestId("overlay-profile")).toHaveText("profile: Grey");
  const picks: string[] = [];
  page.on("console", (m) => {
    if (m.text().startsWith("profile")) picks.push(m.text());
  });
  const before = await redness(page);

  await vj.locator('[data-testid=swatch][data-slot="0"]').click();
  await expect(vj.getByTestId("wheel")).toHaveAttribute("data-slot", "0");
  await dragToRed(vj);
  // The edge of the disc at the drag's last point: dark red, give or take a pixel of hue.
  const red = (await vj.getByTestId("wheel-value").textContent())!;
  expect(red).toMatch(/^#800[0-9a-f]0[0-9a-f]$/);
  const swatch = vj.locator('[data-testid=swatch][data-slot="0"]');
  await expect(swatch).toHaveAttribute("data-colour", red);
  await expect(vj.getByTestId("wheel-current")).toHaveAttribute("data-colour", red);
  await expect(vj.getByTestId("wheel-stored")).toHaveAttribute("data-colour", "#808080");
  // Every surface: the other controller's pinned wheel (DJ: slot 0, derived) shows it too.
  await expect(dj.getByTestId("wheel-current")).toHaveAttribute("data-colour", red);
  await expect.poll(() => redness(page)).toBeGreaterThan(before + 20);
  // No new program: the same profile, no pick.
  await expect(page.getByTestId("overlay-profile")).toHaveText("profile: Grey");
  expect(picks).toEqual([]);

  await vj.getByTestId("wheel-reset").click();
  await expect(swatch).toHaveAttribute("data-colour", "#808080");
  await dragToRed(vj);
  await expect(swatch).toHaveAttribute("data-colour", red);
  await tileOf(vj, grey).click(); // the same profile again: the stored palette (SD7)
  await expect(swatch).toHaveAttribute("data-colour", "#808080");
  await expect(dj.getByTestId("wheel-current")).toHaveAttribute("data-colour", "#808080");
});

test("DJ's pinned wheel aims at slot 1 for the built-in and at a stored primary (B-16 AC9, B-04 SD10)", async ({
  page,
  browser,
}) => {
  const marked: Definition = {
    ...flat("Marked", "#336699"),
    palette: ["#000000", "#336699", "#ffcc00"],
  };
  const stored = await createProfile(api, { ...marked, primary: 2 });
  const url = await screen(page);
  const phone = await paired(page, browser, url, PHONE);
  await expect(phone.getByTestId("mode-dj")).toHaveAttribute("aria-pressed", "true");
  await expect(phone.getByTestId("swatch")).toHaveCount(0); // swatches are VJ mode's
  await expect(phone.getByTestId("wheel")).toHaveAttribute("data-slot", "1");
  await expect(phone.getByTestId("wheel-label")).toHaveText("Colour 2 · primary");
  await expect(phone.getByTestId("wheel-current")).toHaveAttribute("data-colour", "#ffffff");
  await tileOf(phone, stored).click();
  await expect(tileOf(phone, stored)).toHaveAttribute("aria-pressed", "true");
  await expect(phone.getByTestId("wheel")).toHaveAttribute("data-slot", "2");
  await expect(phone.getByTestId("wheel-label")).toHaveText("Colour 3 · primary");
  await expect(phone.getByTestId("wheel-current")).toHaveAttribute("data-colour", "#ffcc00");
});

test("the arrow keys and the brightness slider change the colour without a mouse (UI, Accessibility)", async ({
  page,
  browser,
}) => {
  const url = await screen(page);
  const phone = await paired(page, browser, url);
  await phone.locator('[data-testid=swatch][data-slot="1"]').click();
  const current = phone.getByTestId("wheel-current");
  await expect(current).toHaveAttribute("data-colour", "#ffffff");
  await phone.getByTestId("wheel-disc").focus();
  for (let i = 0; i < 6; i++) await phone.keyboard.press("ArrowUp"); // more saturation
  await expect(current).not.toHaveAttribute("data-colour", "#ffffff");
  const saturated = await current.getAttribute("data-colour");
  await phone.keyboard.press("ArrowRight"); // another hue
  await expect(current).not.toHaveAttribute("data-colour", saturated!);
  const hued = await current.getAttribute("data-colour");
  await phone.getByTestId("wheel-brightness").focus();
  for (let i = 0; i < 10; i++) await phone.keyboard.press("ArrowLeft");
  await expect(current).not.toHaveAttribute("data-colour", hued!);
});

test("the status strip shows the round trip, last and p95, after a change (AC43, SD17)", async ({
  page,
  browser,
}) => {
  const url = await screen(page);
  const phone = await paired(page, browser, url);
  await expect(phone.getByTestId("status-strip")).toBeVisible();
  await expect(phone.getByTestId("round-trip")).toHaveText("round trip –");
  await expect(phone.getByTestId("status-started")).toHaveText("not started");
  await expect(phone.getByTestId("status-camera")).toHaveText("camera: idle");
  await setFader(phone.getByTestId("dial-reactivity"), 0.33);
  await expect(phone.getByTestId("round-trip")).toHaveText(/^round trip \d+ ms \/ p95 \d+ ms$/);
});

test("the round trip updates while states arrive faster than it refreshes, as during a drag (AC43)", async ({
  page,
  browser,
}) => {
  const url = await screen(page);
  const phone = await paired(page, browser, url);
  const readout = phone.getByTestId("round-trip");
  await expect(readout).toHaveText("round trip –");
  // A change every 100 ms, each answered by a state: the 500 ms refresh must still come round.
  let shown = false;
  for (let i = 0; i < 30 && !shown; i++) {
    await setFader(phone.getByTestId("dial-reactivity"), 0.1 + i * 0.02);
    await phone.waitForTimeout(100);
    shown = (await readout.textContent()) !== "round trip –";
  }
  expect(shown).toBe(true);
});

test("a second device's request shows inline in VJ mode with its hint, and Accept there approves it (AC8, SD18)", async ({
  page,
  browser,
}) => {
  const url = await screen(page);
  const vj = await paired(page, browser, url);
  const second = await controller(browser, url, { viewport: PHONE, userAgent: IPHONE });
  const request = vj.getByTestId("approvals").locator("li");
  await expect(request).toHaveText(/Safari on iPhone · Device 2/);
  await request.getByTestId("approve").click();
  await expect(second.getByTestId("profile-tile").first()).toBeEnabled();
  await expect(vj.getByTestId("approvals")).toHaveCount(0);
});
