// B-19 T4 (spec SD2, SD7, SD9, SD13, AC2 to AC11, AC21; plan PD4, PD5, PD7, PD8): the fader on a
// real paired `/control` at 320×568 against the in-process server. The screen page's panel
// sliders are the screen's dials; the controller's sent `dials` frames are counted on its socket.
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from "@playwright/test";
import { contrast } from "../contrast.ts";
import { LAN_CONTEXT, startControlServer, type ControlServer } from "./control-server.ts";
import { dragFader, faderValue, setFader } from "./fader.ts";
import { dropNetwork, keepSockets } from "./sockets.ts";

const PHONE = { width: 320, height: 568 };

let server: ControlServer;
const contexts: BrowserContext[] = [];

test.beforeEach(async () => {
  server = await startControlServer();
});

test.afterEach(async () => {
  for (const c of contexts.splice(0)) await c.close();
  await server.dispose();
});

interface Phone {
  page: Page;
  /** The `dials` frames this controller has sent so far. */
  dials(): unknown[];
  /** Ends the link as a Wi-Fi drop would: offline, every socket closed abnormally (D-17). */
  drop(): Promise<void>;
}

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
  options: BrowserContextOptions = {},
): Promise<Phone> {
  const context = await browser.newContext({ viewport: PHONE, ...LAN_CONTEXT, ...options });
  contexts.push(context);
  await keepSockets(context);
  const phone = await context.newPage();
  const sent: unknown[] = [];
  phone.on("websocket", (ws) =>
    ws.on("framesent", (frame) => {
      const message = JSON.parse(String(frame.payload)) as { type: string };
      if (message.type === "dials") sent.push(message);
    }),
  );
  await phone.goto(url);
  await expect(phone.getByTestId("link-line")).toHaveText("Waiting for approval");
  await page.getByTestId("control-accept").click();
  await expect(phone.getByTestId("link-line")).toHaveText("Connected");
  await expect(phone.getByTestId("dial-recognisability")).toBeEnabled();
  return {
    page: phone,
    dials: () => [...sent],
    drop: () => dropNetwork(phone),
  };
}

const panelValue = async (page: Page, dial: string) =>
  Number(await page.getByTestId(`slider-${dial}`).inputValue());

test("a tap on the track away from the cap changes nothing and sends nothing (AC2)", async ({
  page,
  browser,
}) => {
  const phone = await paired(page, browser, await screen(page));
  const fader = phone.page.getByTestId("dial-recognisability");
  const before = await panelValue(page, "recognisability");
  const box = (await fader.boundingBox())!;
  await phone.page.mouse.click(box.x + box.width * 0.92, box.y + box.height * 0.7);
  await phone.page.mouse.click(box.x + box.width * 0.05, box.y + box.height * 0.7);
  await phone.page.waitForTimeout(500);
  expect(phone.dials()).toEqual([]);
  expect(await panelValue(page, "recognisability")).toBe(before);
  await expect(fader).toHaveAttribute("aria-valuenow", String(before));
});

test("a drag that starts away from the cap moves the screen by the drag over the travel (AC3)", async ({
  page,
  browser,
}) => {
  const phone = await paired(page, browser, await screen(page));
  const fader = phone.page.getByTestId("dial-recognisability");
  await setFader(fader, 0.3);
  // The cap sits at 30 %; the finger lands at 90 % and drags back by a quarter of the track.
  await dragFader(phone.page, fader, { from: 0.9, by: -0.25 });
  await expect
    .poll(async () => Math.abs((await panelValue(page, "recognisability")) - 0.05))
    .toBeLessThanOrEqual(0.011);
  const moved = await panelValue(page, "recognisability");
  await expect(fader).toHaveAttribute("aria-valuenow", String(moved));
  // And from the far side of the cap, upward.
  await dragFader(phone.page, fader, { from: 0.02, by: 0.4 });
  await expect
    .poll(async () => Math.abs((await panelValue(page, "recognisability")) - (moved + 0.4)))
    .toBeLessThanOrEqual(0.011);
});

test("two touches drag both faders at once; the screen ends on both last values (AC6)", async ({
  page,
  browser,
}) => {
  const phone = await paired(page, browser, await screen(page), { hasTouch: true });
  const rec = phone.page.getByTestId("dial-recognisability");
  const react = phone.page.getByTestId("dial-reactivity");
  await setFader(rec, 0.2);
  await setFader(react, 0.5);
  const a = (await rec.boundingBox())!;
  const b = (await react.boundingBox())!;
  const cdp = await phone.page.context().newCDPSession(phone.page);
  const points = (t: number) => [
    { x: a.x + a.width * (0.6 + 0.3 * t), y: a.y + a.height * 0.7, id: 0 },
    { x: b.x + b.width * (0.6 - 0.3 * t), y: b.y + b.height * 0.7, id: 1 },
  ];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points(0) });
  for (let i = 1; i <= 10; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: points(i / 10) });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect
    .poll(async () => [
      Math.round((await panelValue(page, "recognisability")) * 100),
      Math.round((await panelValue(page, "reactivity")) * 100),
    ])
    .toEqual([50, 20]);
  await expect(rec).toHaveAttribute("aria-valuenow", "0.5");
  await expect(react).toHaveAttribute("aria-valuenow", "0.2");
});

test("the keys move by 0.01 and 0.1 and to the ends, one change per press (AC7)", async ({
  page,
  browser,
}) => {
  const phone = await paired(page, browser, await screen(page));
  const fader = phone.page.getByTestId("dial-reactivity");
  await setFader(fader, 0.5);
  const before = phone.dials().length;
  const steps: [string, string][] = [
    ["ArrowRight", "0.51"],
    ["ArrowUp", "0.52"],
    ["ArrowLeft", "0.51"],
    ["ArrowDown", "0.5"],
    ["PageUp", "0.6"],
    ["PageDown", "0.5"],
    ["End", "1"],
    ["Home", "0"],
  ];
  for (const [key, value] of steps) {
    await fader.press(key);
    await expect(page.getByTestId("slider-reactivity")).toHaveValue(value);
    await expect(fader).toHaveAttribute("aria-valuenow", value);
  }
  expect(phone.dials().length - before).toBe(steps.length);
});

test("the fader is a labelled slider with its readout as the value text (AC8, AC10)", async ({
  page,
  browser,
}) => {
  const phone = await paired(page, browser, await screen(page));
  const slider = phone.page.getByRole("slider", { name: "Recognisability" });
  await expect(slider).toHaveAttribute("data-testid", "dial-recognisability");
  await expect(phone.page.getByRole("slider", { name: "Audio reactivity" })).toHaveAttribute(
    "data-testid",
    "dial-reactivity",
  );
  await page.getByTestId("slider-recognisability").fill("0.42");
  await expect(slider).toHaveAttribute("aria-valuenow", "0.42");
  await expect(slider).toHaveAttribute("aria-valuemin", "0");
  await expect(slider).toHaveAttribute("aria-valuemax", "1");
  await expect(slider).toHaveAttribute("aria-valuetext", "42");
  await expect(slider).toHaveAttribute("aria-orientation", "horizontal");
  await expect(phone.page.getByTestId("dial-recognisability-readout")).toHaveText("42");
});

test("the screen's value shows after a release, a cancel, a blur and a lock, and nothing more is sent (AC9)", async ({
  page,
  browser,
}) => {
  const phone = await paired(page, browser, await screen(page));
  const fader = phone.page.getByTestId("dial-recognisability");
  const panel = page.getByTestId("slider-recognisability");
  await fader.evaluate((el) =>
    el.addEventListener("pointerdown", (e) => {
      (el as HTMLElement & { __pointer?: number }).__pointer = (e as PointerEvent).pointerId;
    }),
  );
  await setFader(fader, 0.5);

  /** Holds the fader at 0.6, then the panel moves the screen to `other`: the cap stays held. */
  const holdWhileScreenMoves = async (other: string) => {
    await dragFader(phone.page, fader, { from: 0.8, by: 0.1, release: false });
    await expect(panel).toHaveValue("0.6");
    await panel.fill(other);
    await phone.page.waitForTimeout(300);
    await expect(fader).toHaveAttribute("aria-valuenow", "0.6");
  };

  // Release.
  await holdWhileScreenMoves("0.2");
  await phone.page.mouse.up();
  await expect(fader).toHaveAttribute("aria-valuenow", "0.2");

  // A cancel (a touch the browser took for a scroll), the button still down.
  await setFader(fader, 0.5);
  await holdWhileScreenMoves("0.25");
  let sent = phone.dials().length;
  const pointerId = await fader.evaluate(
    (el) => (el as HTMLElement & { __pointer?: number }).__pointer,
  );
  expect(pointerId).toBeDefined();
  await fader.dispatchEvent("pointercancel", { pointerId });
  await expect(fader).toHaveAttribute("aria-valuenow", "0.25");
  await phone.page.mouse.move(10, 10, { steps: 3 });
  await phone.page.mouse.up();
  await phone.page.waitForTimeout(300);
  expect(phone.dials().length).toBe(sent);
  await expect(panel).toHaveValue("0.25");

  // A blur.
  await setFader(fader, 0.5);
  await holdWhileScreenMoves("0.3");
  sent = phone.dials().length;
  await fader.blur();
  await expect(fader).toHaveAttribute("aria-valuenow", "0.3");
  await phone.page.mouse.move(300, 10, { steps: 3 });
  await phone.page.mouse.up();
  await phone.page.waitForTimeout(300);
  expect(phone.dials().length).toBe(sent);
  await expect(panel).toHaveValue("0.3");

  // A lock mid-drag: the link drops, the cap returns, nothing more is sent.
  await setFader(fader, 0.5);
  await holdWhileScreenMoves("0.35");
  sent = phone.dials().length;
  await phone.drop();
  await expect(phone.page.getByTestId("link-line")).toHaveText("Reconnecting…");
  await expect(fader).toHaveAttribute("aria-disabled", "true");
  await expect(fader).toHaveAttribute("aria-valuenow", "0.35");
  await phone.page.mouse.move(300, 10, { steps: 3 });
  await phone.page.mouse.up();
  await phone.page.waitForTimeout(300);
  expect(phone.dials().length).toBe(sent);
  await expect(panel).toHaveValue("0.35");
});

test("the wheel's brightness is a fader, by keys and by a drag (AC11)", async ({
  page,
  browser,
}) => {
  const phone = await paired(page, browser, await screen(page));
  const current = phone.page.getByTestId("wheel-current");
  await expect(current).toHaveAttribute("data-colour", "#ffffff");
  const brightness = phone.page.getByTestId("wheel-brightness");
  await expect(brightness).toHaveAttribute("role", "slider");
  await brightness.focus();
  await phone.page.keyboard.press("PageDown");
  await expect(current).not.toHaveAttribute("data-colour", "#ffffff");
  await expect(brightness).toHaveAttribute("aria-valuenow", "0.9");
  const keyed = (await current.getAttribute("data-colour"))!;
  await dragFader(phone.page, brightness, { from: 0.2, by: -0.3 });
  await expect(current).not.toHaveAttribute("data-colour", keyed);
  expect(await faderValue(brightness)).toBeCloseTo(0.6, 1);
});

test("a fader focused by Tab shows a ring at least 3:1 against what is behind it (AC21)", async ({
  page,
  browser,
}) => {
  const phone = await paired(page, browser, await screen(page));
  const fader = phone.page.getByTestId("dial-recognisability");
  for (let i = 0; i < 40; i++) {
    await phone.page.keyboard.press("Tab");
    if (await fader.evaluate((el) => el === document.activeElement)) break;
  }
  await expect(fader).toBeFocused();
  const ring = await fader.evaluate((el) => {
    const style = getComputedStyle(el);
    let behind = el.parentElement;
    let background = "rgba(0, 0, 0, 0)";
    while (behind) {
      background = getComputedStyle(behind).backgroundColor;
      if (!/rgba\(.*, 0\)$/.test(background) && background !== "transparent") break;
      behind = behind.parentElement;
    }
    return {
      style: style.outlineStyle,
      width: parseFloat(style.outlineWidth),
      colour: style.outlineColor,
      background,
    };
  });
  expect(ring.style).toBe("solid");
  expect(ring.width).toBeGreaterThanOrEqual(2);
  expect(contrast(ring.colour, ring.background)).toBeGreaterThanOrEqual(3);
});
