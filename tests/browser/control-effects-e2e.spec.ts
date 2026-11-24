// B-18 T6 (spec SD6, SD7, SD11, AC10, AC12 to AC15, AC20, AC21, Verification 3 and 4): the effect
// strength faders end to end on a real paired `/control` against the in-process server. Every
// frame a controller sends is stamped inside its `WebSocket.send` (`recordSends`), so the page's
// send budget is checked exactly, as `control-together.spec.ts` does for the colour and dials. The
// screen's strength is read through the state a controller mirrors, and once through the canvas.
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
import type { ToDevice } from "../../shared/src/control.ts";
import {
  deviceClient,
  LAN_CONTEXT,
  startControlServer,
  type ControlServer,
  type DeviceClient,
} from "./control-server.ts";
import { setFader } from "./fader.ts";
import { createProfile, flat, type Definition, type Stored } from "./fixtures/profiles.ts";
import { meanRgb, pixels } from "./helpers.ts";
import {
  dropNetwork,
  keepSockets,
  markClose,
  pageNow,
  recordSends,
  sentFrames,
  type SentFrame,
} from "./sockets.ts";

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

/**
 * Brightness ticked DJ at 0, so pushing it up lights the picture; zoom ticked VJ at 0.2. No
 * reactivity, so the audio adds nothing on top (SD5).
 */
const strength = (name = "Strength"): Definition => ({
  name,
  palette: ["#000000", "#ffffff"],
  dials: { recognisability: 1, reactivity: 0 },
  effects: [
    { type: "brightness", amount: 0, dj: true },
    { type: "zoom", amount: 0.2, vj: true },
  ],
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
  await expect(phone.getByTestId("profile-tile").first()).toBeEnabled();
  await phone.getByTestId(`mode-${mode}`).click();
  return phone;
}

const tileOf = (phone: Page, stored: Stored) =>
  phone.locator(`[data-testid=profile-tile][data-profile-id="${stored.id}"]`);

async function pick(phone: Page, stored: Stored) {
  await tileOf(phone, stored).click();
  await expect(tileOf(phone, stored)).toHaveAttribute("aria-pressed", "true");
}

const box = async (locator: Locator) => (await locator.boundingBox())!;

/** Every request a page makes, as `METHOD /path`, and its sockets as `WS /path`. */
function requestsOf(page: Page): string[] {
  const requests: string[] = [];
  page.on("request", (r) => requests.push(`${r.method()} ${new URL(r.url()).pathname}`));
  page.on("websocket", (ws) => requests.push(`WS ${new URL(ws.url()).pathname}`));
  return requests;
}

const writes = (requests: readonly string[]) =>
  requests.filter((r) => /^(POST|PUT|DELETE) /.test(r));

/** The screen's `profile` console lines: one per successful pick, never for a value swap. */
function picksOf(page: Page): string[] {
  const lines: string[] = [];
  page.on("console", (m) => {
    if (m.text().startsWith("profile")) lines.push(m.text());
  });
  return lines;
}

/** The picture's mean light over the middle of the screen's canvas, away from the panel. */
async function light(page: Page): Promise<number> {
  const [r, g, b] = meanRgb(await pixels(page, 40, 120, 160, 120));
  return r! + g! + b!;
}

/** B-16 AC8: every gap at least 10 ms and no 1000 ms window over 100 frames. */
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

/** A point on the disc at `t` of the way round a widening arc. */
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

test("320×568 then 568×320, DJ: the effect fader dragged with a dial and the disc sends the profile, the index and the value under the budget, the last value lands, the screen brightens with no new program and nothing written (AC10, AC11, AC14, Verification 3)", async ({
  page,
  browser,
}) => {
  const stored = await createProfile(api, strength());
  const url = await screen(page);
  const phone = await paired(page, browser, url, "dj");
  await pick(phone, stored);
  const requests = requestsOf(page);
  const picks = picksOf(page);
  const fader = phone.getByTestId("effect-0");
  await expect(fader).toHaveAttribute("aria-valuenow", "0");

  // The screen's strength follows: brightness at 1 lights the picture.
  const dark = await light(page);
  await fader.focus();
  await phone.keyboard.press("End");
  await expect(fader).toHaveAttribute("aria-valuenow", "1");
  // How soon the canvas shows it depends on the frame rate; a loaded machine slows it (B-08).
  await expect.poll(() => light(page), { timeout: 60_000 }).toBeGreaterThan(dark + 30);

  for (const viewport of [PORTRAIT, LANDSCAPE]) {
    await phone.setViewportSize(viewport);
    const where = `${viewport.width}×${viewport.height}`;
    await expect(fader).toHaveAttribute(
      "aria-orientation",
      viewport === PORTRAIT ? "horizontal" : "vertical",
    );
    const disc = await discPath(phone);
    const dial = await faderPath(phone.getByTestId("dial-recognisability"));
    const effect = await faderPath(fader);
    const cdp = await phone.context().newCDPSession(phone);
    const from = await pageNow(phone);

    // Recognisability starts at 1, so it is dragged down; it scales no effect of this profile.
    // The effect goes down from 1 in portrait, then back up in landscape.
    const along = (t: number) => (viewport === PORTRAIT ? 1 - t : t);
    await touch(cdp, "touchStart", [disc(0), dial(1), effect(along(0))]);
    const moves = 24;
    for (let i = 1; i <= moves; i++) {
      const t = i / moves;
      await touch(cdp, "touchMove", [disc(t), dial(1 - t), effect(along(t))]);
      await phone.waitForTimeout(20);
    }
    await touch(cdp, "touchEnd", []);
    await phone.waitForTimeout(300);

    const frames = (await sentFrames(phone)).filter((f) => f.t >= from);
    const effects = ofType(frames, "effect");
    const counts = JSON.stringify(
      frames.reduce<Record<string, number>>((c, f) => {
        c[f.message.type] = (c[f.message.type] ?? 0) + 1;
        return c;
      }, {}),
    );
    expect(effects.length, `${where} ${counts}`).toBeGreaterThanOrEqual(5);
    expect(ofType(frames, "dials").length, `${where} ${counts}`).toBeGreaterThanOrEqual(5);
    expect(ofType(frames, "colour").length, `${where} ${counts}`).toBeGreaterThanOrEqual(5);
    for (const f of effects) {
      expect(f.message, where).toMatchObject({ type: "effect", profile: stored.id, index: 0 });
    }
    expect(budgetProblems(frames), where).toEqual([]);
    // The last value of the drag was sent, and it is what the screen applied and reports.
    const last = effects.at(-1)!.message.value as number;
    await expect(fader).toHaveAttribute("aria-valuenow", String(last));
  }

  await page.waitForTimeout(300);
  expect(picks).toEqual([]); // no pick, so no new program: the same effect list swapped values
  expect(writes(requests)).toEqual([]);
});

test("768×1024, VJ: a second controller moves an effect fader and the first follows — cap, readout and value — while the tick stays at the stored value (AC13, Verification 4)", async ({
  page,
  browser,
}) => {
  const stored = await createProfile(api, strength());
  const url = await screen(page);
  const first = await paired(page, browser, url, "vj", { viewport: TABLET });
  const second = await paired(page, browser, url, "vj", { viewport: TABLET });
  await pick(first, stored);
  for (const [id, to] of [
    ["effect-0", 0.37],
    ["effect-1", 0.55],
  ] as const) {
    const mark = first.getByTestId(`${id}-mark`);
    const tick = await box(mark);
    await setFader(second.getByTestId(id), to);
    const fader = first.getByTestId(id);
    await expect(fader).toHaveAttribute("aria-valuenow", String(to));
    await expect(first.getByTestId(`${id}-readout`)).toHaveText(String(Math.round(to * 100)));
    await expect(fader.locator("..")).toHaveAttribute("style", new RegExp(`--level: ${to}`));
    expect(await box(mark), id).toEqual(tick);
  }
});

/** Waits until the device has heard `applied` for `seq`. */
async function applied(device: DeviceClient, seq: number) {
  await expect
    .poll(async () => (await device.messages()).some((m) => m.type === "applied" && m.seq === seq))
    .toBe(true);
}

/** The effects the screen's latest state lists. */
async function stateEffects(device: DeviceClient) {
  const states = (await device.messages()).filter(
    (m): m is Extract<ToDevice, { type: "state" }> => m.type === "state",
  );
  return states.at(-1)!.state;
}

test("a stale effect — another profile, index 11 of a two-effect profile, one during a pick — changes nothing, and each is acknowledged (AC12, Verification 4)", async ({
  page,
  browser,
}) => {
  const stored = await createProfile(api, strength());
  const gone = await createProfile(api, flat("Gone", "#808080"));
  const url = await screen(page);
  const phone = await paired(page, browser, url, "vj", { viewport: TABLET });
  await pick(phone, stored);
  const code = (await page.getByTestId("control-code").textContent())!;
  const context = await browser.newContext({ ...LAN_CONTEXT });
  contexts.push(context);
  const device = await deviceClient(context, server);
  await device.send({ type: "hello", code });
  await device.waitFor("waiting");
  await page.getByTestId("control-accept").click();
  await device.waitFor("approved");
  await expect
    .poll(async () => (await stateEffects(device)).effects.map((e) => e.value))
    .toEqual([0, 0.2]);

  await device.send({ type: "effect", seq: 1, profile: gone.id, index: 0, value: 1 });
  await device.send({ type: "effect", seq: 2, profile: stored.id, index: 11, value: 1 });
  await applied(device, 1);
  await applied(device, 2);

  // A pick still pending — its profile slow to come, then gone — drops an effect sent meanwhile.
  expect((await api.delete(`/api/profiles/${gone.id}`)).status()).toBe(204);
  await page.route(`**/api/profiles/${gone.id}`, async (route) => {
    await new Promise((r) => setTimeout(r, 1000));
    await route.continue();
  });
  await device.send({ type: "pick", seq: 3, id: gone.id });
  await device.send({ type: "effect", seq: 4, profile: stored.id, index: 0, value: 1 });
  await applied(device, 4);
  await applied(device, 3); // at the pick's end: it failed, the current look kept
  await expect
    .poll(async () => (await stateEffects(device)).reason)
    .toBe("that profile no longer exists; keeping the current look");

  const state = await stateEffects(device);
  expect(state.activeId).toBe(stored.id);
  expect(state.effects.map((e) => [e.index, e.value])).toEqual([
    [0, 0],
    [1, 0.2],
  ]);
  // The controller shows the screen's values.
  await expect(phone.getByTestId("effect-0")).toHaveAttribute("aria-valuenow", "0");
  await expect(phone.getByTestId("effect-1")).toHaveAttribute("aria-valuenow", "0.2");
});

test("after a drag, a re-pick of the active profile and a screen reload each bring every effect back to its stored strength, and nothing is written (AC14)", async ({
  page,
  browser,
}) => {
  const stored = await createProfile(api, strength());
  const url = await screen(page);
  const phone = await paired(page, browser, url, "vj", { viewport: TABLET });
  await pick(phone, stored);
  const requests = requestsOf(page);
  const picks = picksOf(page);
  const bank = phone.getByTestId("effect-0");
  const section = phone.getByTestId("effect-1");

  await setFader(bank, 0.8);
  await setFader(section, 0.9);
  await page.waitForTimeout(300);
  expect(picks).toEqual([]); // the strengths alone pick nothing

  await tileOf(phone, stored).click(); // the active profile again
  await expect(bank).toHaveAttribute("aria-valuenow", "0");
  await expect(section).toHaveAttribute("aria-valuenow", "0.2");

  await setFader(bank, 0.6);
  await page.reload();
  await expect(page.getByTestId("control-switch")).toBeChecked();
  await expect(phone.getByTestId("link-line")).toHaveText("Connected");
  // The reloaded page draws the remembered profile again, from its stored strengths.
  await expect(tileOf(phone, stored)).toHaveAttribute("aria-pressed", "true");
  await expect(bank).toHaveAttribute("aria-valuenow", "0");
  await expect(section).toHaveAttribute("aria-valuenow", "0.2");
  expect(writes(requests)).toEqual([]);
});

test("a drop mid-drag shows Locked with every effect fader disabled, and nothing is sent after it or after the link returns (AC15)", async ({
  page,
  browser,
}) => {
  const stored = await createProfile(api, strength());
  const url = await screen(page);
  const phone = await paired(page, browser, url, "vj", { viewport: TABLET });
  await pick(phone, stored);
  const effect = await faderPath(phone.getByTestId("effect-1"));
  const cdp = await phone.context().newCDPSession(phone);

  await touch(cdp, "touchStart", [effect(0)]);
  for (let i = 1; i <= 5; i++) await touch(cdp, "touchMove", [effect(i / 10)]);
  const closedAt = await markClose(phone);
  await dropNetwork(phone);
  await expect(phone.getByTestId("bank-locked")).toHaveText("Locked");
  for (const id of ["effect-0", "effect-1"]) {
    await expect(phone.getByTestId(id)).toHaveAttribute("aria-disabled", "true");
    expect(
      await phone.getByTestId(id).evaluate((el) => getComputedStyle(el).backgroundImage),
    ).toContain("repeating-linear-gradient");
  }
  for (let i = 6; i <= 10; i++) await touch(cdp, "touchMove", [effect(i / 10)]);
  await touch(cdp, "touchEnd", []);
  await phone.context().setOffline(false);
  await expect(phone.getByTestId("link-line")).toHaveText("Connected", { timeout: 20_000 });
  await phone.waitForTimeout(500);
  const droppedAt = await closedAt();
  expect(droppedAt).toBeLessThan(Infinity);
  const after = ofType(await sentFrames(phone), "effect").filter((f) => f.t > droppedAt);
  expect(after).toEqual([]);
  await expect(phone.getByTestId("effect-1")).toHaveAttribute("aria-disabled", "false");
});

test("with the effect faders in use the screen requests only its allow-list and the controller only /control, /assets/* and its socket (AC20)", async ({
  page,
  browser,
}) => {
  const stored = await createProfile(api, strength());
  const screenRequests = requestsOf(page);
  const url = await screen(page);
  const context = await browser.newContext({ ...LAN_CONTEXT, viewport: PORTRAIT });
  contexts.push(context);
  const controllerRequests: string[] = [];
  context.on("request", (r) =>
    controllerRequests.push(`${r.method()} ${new URL(r.url()).pathname}`),
  );
  const phone = await context.newPage();
  phone.on("websocket", (ws) => controllerRequests.push(`WS ${new URL(ws.url()).pathname}`));
  await phone.goto(url);
  await expect(phone.getByTestId("link-line")).toHaveText("Waiting for approval");
  await page.getByTestId("control-accept").click();
  await expect(phone.getByTestId("profile-tile").first()).toBeEnabled();
  await pick(phone, stored);
  await setFader(phone.getByTestId("effect-0"), 0.3);
  await phone.getByTestId("mode-vj").click();
  await setFader(phone.getByTestId("effect-1"), 0.7);
  await phone.setViewportSize(LANDSCAPE);
  await setFader(phone.getByTestId("effect-0"), 0.5);
  await page.waitForTimeout(500);

  expect(controllerRequests).toContain("WS /api/control/device");
  expect(
    controllerRequests.filter(
      (r) => !/^(GET \/control|GET \/assets\/[^/]+|WS \/api\/control\/device)$/.test(r),
    ),
  ).toEqual([]);
  const allowed =
    /^(GET (\/|\/assets\/[^/]+|\/api\/health|\/api\/profiles|\/api\/profiles\/[^/]+)|WS \/api\/control\/screen)$/;
  expect(screenRequests.filter((r) => !allowed.test(r))).toEqual([]);
  expect(writes(screenRequests)).toEqual([]);
});
