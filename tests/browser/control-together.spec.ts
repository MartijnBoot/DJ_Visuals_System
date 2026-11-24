// B-16 T5 (spec SD4, AC4, AC7, AC8, AC15, Verification 2 and 3; plan PD16): the colour and the
// dials together on a real paired `/control` against the in-process server, driven by CDP touch
// with two and three fingers. Every frame is stamped inside the page's `WebSocket.send`
// (`recordSends`), so the send budget's bounds — 10 ms between two frames, 100 in any second — are
// checked exactly; a loaded machine only spreads the frames further apart.
import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type CDPSession,
  type Locator,
  type Page,
} from "@playwright/test";
import { LAN_CONTEXT, startControlServer, type ControlServer } from "./control-server.ts";
import { createProfile, type Stored } from "./fixtures/profiles.ts";
import {
  dropNetwork,
  keepSockets,
  markClose,
  pageNow,
  recordSends,
  sentFrames,
  type SentFrame,
} from "./sockets.ts";
import { discKeys } from "./wheel.ts";

const PORTRAIT = { width: 320, height: 568 };
const LANDSCAPE = { width: 568, height: 320 };
const TABLET = { width: 768, height: 1024 };

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

async function paired(
  page: Page,
  browser: Browser,
  url: string,
  mode: "dj" | "vj",
  options: BrowserContextOptions = {},
): Promise<Page> {
  const context = await browser.newContext({
    viewport: PORTRAIT,
    hasTouch: true,
    ...LAN_CONTEXT,
    ...options,
  });
  contexts.push(context);
  await keepSockets(context);
  await recordSends(context);
  const phone = await context.newPage();
  await phone.goto(url);
  await expect(phone.getByTestId("link-line")).toHaveText("Waiting for approval");
  await page.getByTestId("control-accept").click();
  await expect(phone.getByTestId("link-line")).toHaveText("Connected");
  await phone.getByTestId(`mode-${mode}`).click();
  await expect(phone.getByTestId("wheel")).toBeVisible();
  return phone;
}

const panelValue = async (page: Page, dial: string) =>
  Number(await page.getByTestId(`slider-${dial}`).inputValue());

const box = async (locator: Locator) => (await locator.boundingBox())!;

/** Whether the whole box lies inside the viewport. */
async function inView(phone: Page, locator: Locator): Promise<boolean> {
  const b = await box(locator);
  const { width, height } = phone.viewportSize()!;
  return (
    b.x >= -0.5 && b.y >= -0.5 && b.x + b.width <= width + 0.5 && b.y + b.height <= height + 0.5
  );
}

/** AC8: every gap at least 10 ms and no 1000 ms window over 100 frames. */
function budgetProblems(frames: readonly SentFrame[]): string[] {
  const problems: string[] = [];
  for (let i = 1; i < frames.length; i++) {
    const gap = frames[i]!.t - frames[i - 1]!.t;
    if (gap < 10) problems.push(`gap ${gap.toFixed(2)} ms before frame ${i}`);
  }
  for (let i = 0; i < frames.length; i++) {
    const n = frames.filter((f) => f.t >= frames[i]!.t && f.t < frames[i]!.t + 1000).length;
    if (n > 100) problems.push(`${n} frames in the second from frame ${i}`);
  }
  return problems;
}

const ofType = (frames: readonly SentFrame[], type: string) =>
  frames.filter((f) => f.message.type === type);

/** The disc's centre and radius, and a point on it at `t` of the way round an arc. */
async function discPath(phone: Page) {
  const b = await box(phone.getByTestId("wheel-disc"));
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  const r = b.width / 2 - 6;
  return (t: number) => {
    const a = Math.PI * 2 * t;
    return { x: cx + Math.cos(a) * r * (0.4 + 0.5 * t), y: cy + Math.sin(a) * r * (0.4 + 0.5 * t) };
  };
}

/** A point along a fader at `t` (0 to 1 of its travel, from 20 % to 80 %), by its axis. */
async function faderPath(fader: Locator) {
  const b = await box(fader);
  const vertical = (await fader.getAttribute("aria-orientation")) === "vertical";
  return (t: number) => {
    const along = 0.2 + 0.6 * t;
    return vertical
      ? { x: b.x + b.width / 2, y: b.y + b.height * (1 - along) }
      : { x: b.x + b.width * along, y: b.y + b.height * 0.7 };
  };
}

const touch = (
  cdp: CDPSession,
  type: "touchStart" | "touchMove" | "touchEnd" | "touchCancel",
  points: { x: number; y: number }[],
) =>
  cdp.send("Input.dispatchTouchEvent", {
    type,
    touchPoints: points.map((p, id) => ({ x: p.x, y: p.y, id })),
  });

test("320×568, DJ: the disc and Recognisability together send throughout and the screen ends on both last values; the block stays pinned and turns with the page (AC7, AC4, Verification 2)", async ({
  page,
  browser,
}) => {
  const url = await screen(page);
  const phone = await paired(page, browser, url, "dj");
  await expect(phone.getByTestId("controller")).toHaveAttribute("data-arrangement", "horizontal");
  await expect(phone.locator("dialog[open]")).toHaveCount(0);
  expect(Math.round((await box(phone.getByTestId("wheel-disc"))).width)).toBe(150);
  const fader = phone.getByTestId("dial-recognisability");
  const disc = await discPath(phone);
  const dial = await faderPath(fader);
  const cdp = await phone.context().newCDPSession(phone);
  const from = await pageNow(phone);

  await touch(cdp, "touchStart", [disc(0), dial(0)]);
  const moves = 24;
  for (let i = 1; i <= moves; i++) {
    await touch(cdp, "touchMove", [disc(i / moves), dial(i / moves)]);
    await phone.waitForTimeout(20);
  }
  const shown = (await phone.getByTestId("wheel-value").textContent())!;
  await touch(cdp, "touchEnd", []);
  await phone.waitForTimeout(300);

  const frames = (await sentFrames(phone)).filter((f) => f.t >= from);
  const colours = ofType(frames, "colour");
  const dials = ofType(frames, "dials");
  expect(colours.length).toBeGreaterThanOrEqual(5);
  expect(dials.length).toBeGreaterThanOrEqual(5);
  // Throughout: each kind in the first half of the drag and in the second.
  const mid = (frames[0]!.t + frames.at(-1)!.t) / 2;
  for (const kind of [colours, dials]) {
    expect(kind.some((f) => f.t < mid)).toBe(true);
    expect(kind.some((f) => f.t >= mid)).toBe(true);
  }
  expect(budgetProblems(frames)).toEqual([]);
  const lastColour = colours.at(-1)!.message.value as string;
  const lastDial = dials.at(-1)!.message.recognisability as number;
  expect(lastColour).toBe(shown);
  await expect(phone.getByTestId("wheel-current")).toHaveAttribute("data-colour", lastColour);
  await expect.poll(() => panelValue(page, "recognisability")).toBe(lastDial);
  await expect(fader).toHaveAttribute("aria-valuenow", String(lastDial));

  await phone.getByTestId("control-scroll").evaluate((el) => (el.scrollTop = el.scrollHeight));
  for (const id of ["status-bar", "wheel", "fader-bank"]) {
    expect(await inView(phone, phone.getByTestId(id)), id).toBe(true);
  }

  // AC4: the turn moves the block to a column left of the bank, still on the primary slot.
  const primary = await phone.getByTestId("wheel").getAttribute("data-slot");
  await phone.setViewportSize(LANDSCAPE);
  await expect(phone.getByTestId("controller")).toHaveAttribute("data-arrangement", "vertical");
  const block = await box(phone.getByTestId("wheel"));
  const bank = await box(phone.getByTestId("fader-bank"));
  expect(Math.round(block.x + block.width)).toBe(Math.round(bank.x));
  await expect(phone.getByTestId("wheel")).toHaveAttribute("data-slot", primary!);
  await expect(phone.getByTestId("wheel-current")).toHaveAttribute("data-colour", lastColour);
  await expect(phone.getByTestId("link-line")).toHaveText("Connected");
});

test("three fingers for two seconds — the disc and both faders — keep 10 ms between frames and 100 a second, and each control's last value lands (AC8)", async ({
  page,
  browser,
}) => {
  const url = await screen(page);
  const phone = await paired(page, browser, url, "dj");
  const rec = phone.getByTestId("dial-recognisability");
  const react = phone.getByTestId("dial-reactivity");
  const disc = await discPath(phone);
  const one = await faderPath(rec);
  const two = await faderPath(react);
  const cdp = await phone.context().newCDPSession(phone);
  const from = await pageNow(phone);

  await touch(cdp, "touchStart", [disc(0), one(0), two(1)]);
  const started = Date.now();
  let step = 0;
  while (Date.now() - started < 2000) {
    step++;
    // Back and forth, so every move changes each control's value.
    const t = (Math.sin(step / 6) + 1) / 2;
    await touch(cdp, "touchMove", [disc(t), one(t), two(1 - t)]);
  }
  await touch(cdp, "touchEnd", []);
  await phone.waitForTimeout(500);

  const frames = (await sentFrames(phone)).filter((f) => f.t >= from);
  expect(ofType(frames, "colour").length).toBeGreaterThan(10);
  expect(budgetProblems(frames)).toEqual([]);
  const last = (key: "recognisability" | "reactivity") =>
    ofType(frames, "dials")
      .filter((f) => key in f.message)
      .at(-1)!.message[key] as number;
  await expect.poll(() => panelValue(page, "recognisability")).toBe(last("recognisability"));
  await expect.poll(() => panelValue(page, "reactivity")).toBe(last("reactivity"));
  const lastColour = ofType(frames, "colour").at(-1)!.message.value as string;
  await expect(phone.getByTestId("wheel-current")).toHaveAttribute("data-colour", lastColour);
  await expect(phone.getByTestId("wheel-value")).toHaveText(lastColour);
});

/** A colour's hue in degrees, as `hexToHsv` gives it (`web/src/control/wheel-math.ts`). */
function hueOf(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255) as [
    number,
    number,
    number,
  ];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

test("the disc and the brightness fader moved in one touch event: the screen ends on the disc's last hue, not the one before (AC12, AC8)", async ({
  page,
  browser,
}) => {
  const url = await screen(page);
  const phone = await paired(page, browser, url, "dj");
  const brightness = phone.getByTestId("wheel-brightness");
  // Full brightness first, so every hue below is a distinct colour.
  await brightness.focus();
  await phone.keyboard.press("End");
  await expect(phone.getByTestId("wheel-current")).toHaveAttribute(
    "data-colour",
    (await phone.getByTestId("wheel-value").textContent())!,
  );
  const b = await box(phone.getByTestId("wheel-disc"));
  const r = (b.width / 2) * 0.8;
  /** The disc at hue `deg` (the canvas's y grows downward, as `pointToHueSat` reads it). */
  const atHue = (deg: number) => ({
    x: b.x + b.width / 2 + Math.cos((deg * Math.PI) / 180) * r,
    y: b.y + b.height / 2 + Math.sin((deg * Math.PI) / 180) * r,
  });
  const bright = await faderPath(brightness);
  const cdp = await phone.context().newCDPSession(phone);
  const from = await pageNow(phone);

  await touch(cdp, "touchStart", [atHue(0), bright(0.8)]);
  await phone.waitForTimeout(50);
  await touch(cdp, "touchMove", [atHue(5), bright(0.7)]);
  await phone.waitForTimeout(50);
  // The last move of both in one event: each sends from the same frame.
  await touch(cdp, "touchMove", [atHue(180), bright(0.6)]);
  await phone.waitForTimeout(50);
  await touch(cdp, "touchEnd", []);
  await phone.waitForTimeout(300);

  const colours = ofType(
    (await sentFrames(phone)).filter((f) => f.t >= from),
    "colour",
  );
  const last = colours.at(-1)!.message.value as string;
  expect(Math.abs(hueOf(last) - 180), `last colour ${last}`).toBeLessThan(10);
  await expect(phone.getByTestId("wheel-current")).toHaveAttribute("data-colour", last);
  await expect(phone.getByTestId("wheel-value")).toHaveText(last);
});

type FrameWindow = { __held: Map<number, FrameRequestCallback>; __release(): void };

/**
 * Holds the page's animation frames until `releaseFrames`, so a throttle's waiting value stays
 * waiting while the page changes under it. Playwright's own checks run in another world and keep
 * their frames.
 */
const holdFrames = (phone: Page) =>
  phone.evaluate(() => {
    const w = window as unknown as FrameWindow;
    const request = window.requestAnimationFrame.bind(window);
    const cancel = window.cancelAnimationFrame.bind(window);
    let next = -1;
    w.__held = new Map();
    window.requestAnimationFrame = (fn) => {
      w.__held.set(next, fn);
      return next--;
    };
    window.cancelAnimationFrame = (id) => {
      if (!w.__held.delete(id)) cancel(id);
    };
    w.__release = () => {
      window.requestAnimationFrame = request;
      window.cancelAnimationFrame = (id) => {
        if (!w.__held.delete(id)) cancel(id);
      };
      const due = [...w.__held.values()];
      w.__held.clear();
      for (const fn of due) fn(performance.now());
    };
  });
const releaseFrames = (phone: Page) =>
  phone.evaluate(() => (window as unknown as FrameWindow).__release());

const tileOf = (phone: Page, stored: Stored) =>
  phone.locator(`[data-testid=profile-tile][data-profile-id="${stored.id}"]`);

test("the wheel's slot changes under a held brightness drag: the old slot's waiting value is never sent (AC11, PD11)", async ({
  page,
  browser,
}) => {
  const stored = await createProfile(api, {
    name: "First primary",
    palette: ["#808080", "#336699", "#ffcc00"],
    primary: 0,
    dials: { recognisability: 0.5, reactivity: 0.5 },
    effects: [{ type: "paletteMap", amount: 1 }],
  });
  const url = await screen(page);
  const phone = await paired(page, browser, url, "dj");
  const other = await paired(page, browser, url, "dj");
  await expect(phone.getByTestId("wheel")).toHaveAttribute("data-slot", "1"); // the built-in
  const brightness = phone.getByTestId("wheel-brightness");
  const before = await brightness.getAttribute("aria-valuenow");
  const bright = await faderPath(brightness);
  const cdp = await phone.context().newCDPSession(phone);
  const from = await pageNow(phone);

  await touch(cdp, "touchStart", [bright(0.5)]);
  await holdFrames(phone);
  await touch(cdp, "touchMove", [bright(0.2)]);
  // The move is in: the cap shows it, and its send waits for a frame.
  await expect(brightness).not.toHaveAttribute("aria-valuenow", before!);
  // Another controller's pick moves this wheel to the new profile's primary slot.
  await tileOf(other, stored).click();
  await expect(phone.getByTestId("wheel")).toHaveAttribute("data-slot", "0");
  await releaseFrames(phone);
  await touch(cdp, "touchEnd", []);
  await phone.waitForTimeout(300);

  const stale = ofType(
    (await sentFrames(phone)).filter((f) => f.t >= from),
    "colour",
  ).filter((f) => f.message.slot === 1);
  expect(stale).toEqual([]);
});

test("768×1024, VJ: a 240 px disc, swatch 3 recolours slot 3, a re-pick goes back to the primary, another controller moves the marker, and a drop mid-drag locks with nothing after (Verification 3, AC15)", async ({
  page,
  browser,
}) => {
  const stored = await createProfile(api, {
    name: "Three",
    palette: ["#808080", "#336699", "#ffcc00"],
    primary: 0,
    dials: { recognisability: 0.5, reactivity: 0.5 },
    effects: [{ type: "paletteMap", amount: 1 }],
  });
  const url = await screen(page);
  const vj = await paired(page, browser, url, "vj", { viewport: TABLET });
  const other = await paired(page, browser, url, "dj");
  await tileOf(vj, stored).click();
  await expect(tileOf(vj, stored)).toHaveAttribute("aria-pressed", "true");
  expect(Math.round((await box(vj.getByTestId("wheel-disc"))).width)).toBe(240);

  const swatch3 = vj.locator('[data-testid=swatch][data-slot="2"]');
  await swatch3.click();
  await expect(vj.getByTestId("wheel-label")).toHaveText("Colour 3");
  await expect(swatch3).toHaveAttribute("aria-pressed", "true");
  const cdp = await vj.context().newCDPSession(vj);
  const disc = await discPath(vj);
  await touch(cdp, "touchStart", [disc(0)]);
  for (let i = 1; i <= 10; i++) await touch(cdp, "touchMove", [disc(i / 10)]);
  await touch(cdp, "touchEnd", []);
  const dragged = (await vj.getByTestId("wheel-value").textContent())!;
  expect(dragged).not.toBe("#ffcc00");
  await expect(swatch3).toHaveAttribute("data-colour", dragged);
  await expect(vj.locator('[data-testid=swatch][data-slot="0"]')).toHaveAttribute(
    "data-colour",
    "#808080",
  );

  await tileOf(vj, stored).click(); // the same profile again
  await expect(vj.getByTestId("wheel")).toHaveAttribute("data-slot", "0");
  await expect(vj.getByTestId("wheel-label")).toHaveText("Colour 1 · primary");
  await expect(swatch3).toHaveAttribute("data-colour", "#ffcc00");

  // A second controller changes the primary colour: the first one's marker follows.
  await expect(other.getByTestId("wheel")).toHaveAttribute("data-slot", "0");
  const fromOther = await discKeys(other, "ArrowUp", 6);
  expect(fromOther).not.toBe("#808080");
  await expect(vj.getByTestId("wheel-value")).toHaveText(fromOther);

  // A drop in the middle of a drag: Locked, and no frame after it.
  await touch(cdp, "touchStart", [disc(0)]);
  for (let i = 1; i <= 5; i++) await touch(cdp, "touchMove", [disc(i / 10)]);
  const closedAt = await markClose(vj);
  await dropNetwork(vj);
  await expect(vj.getByTestId("wheel-locked")).toHaveText("Locked");
  for (let i = 6; i <= 10; i++) await touch(cdp, "touchMove", [disc(i / 10)]);
  await touch(cdp, "touchEnd", []);
  await vj.context().setOffline(false);
  await expect(vj.getByTestId("link-line")).toHaveText("Connected", { timeout: 20_000 });
  await vj.waitForTimeout(500);
  const droppedAt = await closedAt();
  expect(droppedAt).toBeLessThan(Infinity);
  const after = (await sentFrames(vj)).filter(
    (f) => f.t > droppedAt && (f.message.type === "colour" || f.message.type === "resetColour"),
  );
  expect(after).toEqual([]);
});
