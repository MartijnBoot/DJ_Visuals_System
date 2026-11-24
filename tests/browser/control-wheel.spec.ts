// B-16 T3 (spec SD7, SD8, AC12, AC13, AC15, AC16; plan PD6, PD7, PD11, PD12): the pinned wheel as
// a long-lived control on two paired controllers at 320×568 against the in-process server. It
// shows the screen's colour except while held, lets go of a drag on a cancel, a blur, a turn or a
// lock, and locked ignores input with the locked look. Sends are stamped inside the page's own
// `WebSocket.send`, and so are the let-go events, so "nothing after it" needs no tolerance.
import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from "@playwright/test";
import { LAN_CONTEXT, startControlServer, type ControlServer } from "./control-server.ts";
import { createProfile, flat, type Stored } from "./fixtures/profiles.ts";
import { dropNetwork, keepSockets } from "./sockets.ts";
import { discKeys } from "./wheel.ts";

const PHONE = { width: 320, height: 568 };
const LANDSCAPE = { width: 568, height: 320 };

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

interface Sent {
  t: number;
  type: string;
}

interface WheelWindow {
  __sent: Sent[];
  __mark: number;
}

async function screen(page: Page): Promise<string> {
  await page.goto(`${server.origin}/`);
  await page.getByTestId("control-switch").click();
  await expect(page.getByTestId("control-switch")).toBeChecked();
  return (await page.getByTestId("control-url").textContent())!;
}

/** A controller accepted from the panel, its sends stamped inside the page. */
async function paired(
  page: Page,
  browser: Browser,
  url: string,
  options: BrowserContextOptions = {},
): Promise<Page> {
  const context = await browser.newContext({ viewport: PHONE, ...LAN_CONTEXT, ...options });
  contexts.push(context);
  await keepSockets(context);
  await context.addInitScript(() => {
    const w = window as unknown as WheelWindow;
    w.__sent = [];
    w.__mark = Infinity;
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
      const type = (JSON.parse(String(data)) as { type: string }).type;
      send.call(this, data);
      w.__sent.push({ t: performance.now(), type });
    };
    // The moment of a let-go, taken in the page before the wheel hears it.
    const mark = () => (w.__mark = Math.min(w.__mark, performance.now()));
    window.addEventListener("pointercancel", mark, true);
    window.addEventListener("focusout", mark, true);
    window.addEventListener("resize", mark, true);
  });
  const phone = await context.newPage();
  await phone.goto(url);
  await expect(phone.getByTestId("link-line")).toHaveText("Waiting for approval");
  await page.getByTestId("control-accept").click();
  await expect(phone.getByTestId("link-line")).toHaveText("Connected");
  await expect(phone.getByTestId("wheel-disc")).toBeVisible();
  return phone;
}

/** Colour and Reset sends so far, and those after the page's mark. */
const colourSends = (phone: Page) =>
  phone.evaluate(() => {
    const w = window as unknown as WheelWindow;
    const colour = w.__sent.filter((s) => s.type === "colour" || s.type === "resetColour");
    return { all: colour.length, after: colour.filter((s) => s.t > w.__mark).length };
  });

/**
 * Marks the first moment one of the page's sockets hears `close`: the link locks right there, so
 * a frame a throttle still had waiting may go before it, and none may go after it.
 */
const markAtClose = (phone: Page) =>
  phone.evaluate(() => {
    const w = window as unknown as WheelWindow & { __sockets: WebSocket[] };
    w.__mark = Infinity;
    for (const ws of w.__sockets) {
      ws.addEventListener("close", () => (w.__mark = Math.min(w.__mark, performance.now())), {
        once: true,
      });
    }
  });
const clearMark = (phone: Page) =>
  phone.evaluate(() => ((window as unknown as WheelWindow).__mark = Infinity));

const tileOf = (phone: Page, stored: Stored) =>
  phone.locator(`[data-testid=profile-tile][data-profile-id="${stored.id}"]`);

const value = (phone: Page) => phone.getByTestId("wheel-value");
const onScreen = (phone: Page) => phone.getByTestId("wheel-current");

/** The wheel's hex value equals the screen's colour for its slot. */
async function expectOnScreenValue(phone: Page) {
  await expect
    .poll(async () => {
      const shown = await value(phone).textContent();
      const screen = await onScreen(phone).getAttribute("data-colour");
      return shown === screen ? "same" : `${shown} ≠ ${screen}`;
    })
    .toBe("same");
}

/** Presses `key` on the disc `n` times at once, waiting for nothing: for a locked disc. */
async function pressDisc(phone: Page, key: string, n: number) {
  await phone.getByTestId("wheel-disc").focus();
  for (let i = 0; i < n; i++) await phone.keyboard.press(key);
}

/** The disc's centre and radius on the page. */
async function discGeometry(phone: Page) {
  const box = (await phone.getByTestId("wheel-disc").boundingBox())!;
  return { cx: box.x + box.width / 2, cy: box.y + box.height / 2, r: box.width / 2 - 4 };
}

/** Mouse down at the disc's centre and a few moves toward `angle` (degrees), the button held. */
async function holdDisc(phone: Page, angle: number) {
  const { cx, cy, r } = await discGeometry(phone);
  const rad = (angle * Math.PI) / 180;
  await phone.mouse.move(cx, cy);
  await phone.mouse.down();
  for (let i = 1; i <= 6; i++) {
    await phone.mouse.move(cx + Math.cos(rad) * r * (i / 6), cy + Math.sin(rad) * r * (i / 6));
  }
}

test("another controller's change, its Reset and a pick each show on the wheel that is not held (AC12, AC13)", async ({
  page,
  browser,
}) => {
  const grey = await createProfile(api, flat("Grey", "#808080"));
  const blue = await createProfile(api, flat("Blue", "#0000ff"));
  const url = await screen(page);
  const a = await paired(page, browser, url);
  const b = await paired(page, browser, url);
  await tileOf(b, grey).click();
  await expect(tileOf(a, grey)).toHaveAttribute("aria-pressed", "true");
  await expect(value(a)).toHaveText("#808080");

  // B changes the primary colour by keys; A follows.
  const changed = await discKeys(b, "ArrowUp", 6);
  expect(changed).not.toBe("#808080");
  await expect(onScreen(a)).toHaveAttribute("data-colour", changed);
  await expect(value(a)).toHaveText(changed);

  // B presses Reset: A shows the stored colour (AC13).
  await b.getByTestId("wheel-reset").click();
  await expect(onScreen(a)).toHaveAttribute("data-colour", "#808080");
  await expect(value(a)).toHaveText("#808080");
  await expect(value(b)).toHaveText("#808080");

  // A pick of another profile shows that profile's primary.
  await tileOf(b, blue).click();
  await expect(tileOf(a, blue)).toHaveAttribute("aria-pressed", "true");
  await expect(value(a)).toHaveText("#0000ff");
  await expect(value(b)).toHaveText("#0000ff");
});

test("with Keep colour on, a pick shows the carried colour (AC12, B-09 SD4)", async ({
  page,
  browser,
}) => {
  const grey = await createProfile(api, flat("Grey", "#808080"));
  const blue = await createProfile(api, flat("Blue", "#0000ff"));
  const url = await screen(page);
  const a = await paired(page, browser, url);
  const b = await paired(page, browser, url);
  await tileOf(b, grey).click();
  await expect(value(a)).toHaveText("#808080");
  const carried = await discKeys(b, "ArrowUp", 6);
  expect(carried).not.toBe("#808080");
  await expect(value(a)).toHaveText(carried);

  await b.getByTestId("mode-vj").click();
  await b.getByTestId("transition-keep-colour").click();
  await expect(b.getByTestId("transition-keep-colour")).toHaveAttribute("aria-pressed", "true");
  await tileOf(b, blue).click();
  await expect(tileOf(a, blue)).toHaveAttribute("aria-pressed", "true");
  await expect(onScreen(a)).toHaveAttribute("data-colour", carried);
  await expect(value(a)).toHaveText(carried);
  await expect(a.getByTestId("wheel-stored")).toHaveAttribute("data-colour", "#0000ff");
});

test("while A holds the disc, B's change does not move A's marker; after the release A shows the screen's value (AC12)", async ({
  page,
  browser,
}) => {
  const grey = await createProfile(api, flat("Grey", "#808080"));
  const url = await screen(page);
  const a = await paired(page, browser, url);
  const b = await paired(page, browser, url);
  await tileOf(b, grey).click();
  await expect(value(a)).toHaveText("#808080");

  await holdDisc(a, 0); // toward red, the button held
  await expect(onScreen(b)).not.toHaveAttribute("data-colour", "#808080");
  const heldValue = (await value(a).textContent())!;
  await expect(onScreen(b)).toHaveAttribute("data-colour", heldValue);

  const fromB = await discKeys(b, "ArrowLeft", 24); // another hue, 120° away
  expect(fromB).not.toBe(heldValue);
  await expect(onScreen(a)).toHaveAttribute("data-colour", fromB);
  await a.waitForTimeout(200);
  await expect(value(a)).toHaveText(heldValue);

  await a.mouse.up();
  await expectOnScreenValue(a);
  await expect(value(a)).toHaveText(fromB);
});

test("offline the block is locked: keys, a drag, brightness and Reset send nothing, and a lock mid-drag sends nothing later (AC15)", async ({
  page,
  browser,
}) => {
  const url = await screen(page);
  const a = await paired(page, browser, url);
  await expect(a.getByTestId("wheel-locked")).toHaveCount(0);

  // A lock in the middle of a held disc drag.
  await holdDisc(a, 90);
  await expect.poll(async () => (await colourSends(a)).all).toBeGreaterThan(0);
  await markAtClose(a);
  await dropNetwork(a);
  await expect(a.getByTestId("link-line")).toHaveText("Reconnecting…");
  await expect(a.getByTestId("wheel-locked")).toHaveText("Locked");
  await expect(a.getByTestId("wheel-label")).toHaveCount(0);
  expect(await a.evaluate(() => (window as unknown as WheelWindow).__mark)).toBeLessThan(Infinity);
  // The locked look: hatching over the disc, not only a colour.
  expect(
    await a
      .getByTestId("wheel-disc")
      .evaluate((el) => getComputedStyle(el.parentElement!, "::after").backgroundImage),
  ).toContain("repeating-linear-gradient");
  await expect(a.getByTestId("wheel-brightness")).toHaveAttribute("aria-disabled", "true");
  await expect(a.getByTestId("wheel-reset")).toBeDisabled();
  const { cx, cy, r } = await discGeometry(a);
  await a.mouse.move(cx - r, cy, { steps: 4 });
  await a.mouse.up();

  // Every input while locked.
  await pressDisc(a, "ArrowRight", 3);
  await a.mouse.move(cx, cy);
  await a.mouse.down();
  await a.mouse.move(cx, cy - r, { steps: 4 });
  await a.mouse.up();
  await a.getByTestId("wheel-brightness").focus();
  await a.keyboard.press("PageDown");
  await a.getByTestId("wheel-reset").click({ force: true });
  await a.waitForTimeout(300);
  expect((await colourSends(a)).after).toBe(0);

  // The link comes back: still nothing from before the lock.
  await a.context().setOffline(false);
  await expect(a.getByTestId("link-line")).toHaveText("Connected", { timeout: 20_000 });
  await expect(a.getByTestId("wheel-locked")).toHaveCount(0);
  await a.waitForTimeout(500);
  expect((await colourSends(a)).after).toBe(0);
});

test("a pointer cancel mid-drag lets go: nothing after it, the screen's value back (AC16)", async ({
  page,
  browser,
}) => {
  const url = await screen(page);
  const a = await paired(page, browser, url, { hasTouch: true });
  const b = await paired(page, browser, url);
  const { cx, cy, r } = await discGeometry(a);
  const cdp = await a.context().newCDPSession(a);
  const at = (t: number) => [{ x: cx + r * t, y: cy + r * 0.3 * t, id: 0 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at(0) });
  for (let i = 1; i <= 8; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: at(i / 8) });
  }
  await expect.poll(async () => (await colourSends(a)).all).toBeGreaterThan(0);
  const held = (await value(a).textContent())!;
  await expect(onScreen(b)).toHaveAttribute("data-colour", held);
  // While A's finger still holds the disc, B moves the slot elsewhere.
  const fromB = await discKeys(b, "ArrowLeft", 24);
  expect(fromB).not.toBe(held);
  await expect(onScreen(a)).toHaveAttribute("data-colour", fromB);
  await expect(value(a)).toHaveText(held);
  await clearMark(a);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
  await a.waitForTimeout(300);
  expect(await a.evaluate(() => (window as unknown as WheelWindow).__mark)).toBeLessThan(Infinity);
  expect((await colourSends(a)).after).toBe(0);
  await expect(value(a)).toHaveText(fromB);
  await expectOnScreenValue(a);
});

test("a blur mid-drag lets go: nothing after it, the screen's value back (AC16)", async ({
  page,
  browser,
}) => {
  const url = await screen(page);
  const a = await paired(page, browser, url);
  await holdDisc(a, 200);
  await expect(a.getByTestId("wheel-disc")).toBeFocused();
  await expect.poll(async () => (await colourSends(a)).all).toBeGreaterThan(0);
  await clearMark(a);
  await a.keyboard.press("Tab");
  await expect(a.getByTestId("wheel-disc")).not.toBeFocused();
  const { cx, cy, r } = await discGeometry(a);
  await a.mouse.move(cx, cy + r, { steps: 4 });
  await a.mouse.up();
  await a.waitForTimeout(300);
  expect((await colourSends(a)).after).toBe(0);
  await expectOnScreenValue(a);
});

test("a turn to 568×320 mid-drag lets go: nothing after it, the screen's value back (AC16)", async ({
  page,
  browser,
}) => {
  const url = await screen(page);
  const a = await paired(page, browser, url);
  await holdDisc(a, 300);
  await expect.poll(async () => (await colourSends(a)).all).toBeGreaterThan(0);
  await clearMark(a);
  await a.setViewportSize(LANDSCAPE);
  await expect(a.getByTestId("controller")).toHaveAttribute("data-arrangement", "vertical");
  const { cx, cy, r } = await discGeometry(a);
  await a.mouse.move(cx - r, cy, { steps: 4 });
  await a.mouse.up();
  await a.waitForTimeout(300);
  expect((await colourSends(a)).after).toBe(0);
  await expectOnScreenValue(a);
});
