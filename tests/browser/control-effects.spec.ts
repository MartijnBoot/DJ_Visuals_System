// B-18 T3 (spec SD1, SD8, SD10, SD12, AC4, AC8, AC9, AC16, AC17): the effect strength faders on
// a real paired `/control` against the in-process server. Profiles carry their ticks through the
// real API; the controller shows what the screen's state lists.
import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { contrast } from "../contrast.ts";
import { LAN_CONTEXT, startControlServer, type ControlServer } from "./control-server.ts";
import { customEffect } from "./fixtures/custom-profiles.ts";
import { createProfile, flat, type Definition, type Stored } from "./fixtures/profiles.ts";

const PHONE = { width: 320, height: 568 };
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

/** zoom (VJ), palette map (no tick), brightness (DJ), a custom effect (VJ), grain (no tick). */
const ticked = (name = "Ticked"): Definition => ({
  name,
  palette: ["#000000", "#ffffff"],
  dials: { recognisability: 0.5, reactivity: 0.5 },
  effects: [
    { type: "zoom", amount: 0.2, vj: true },
    { type: "paletteMap", amount: 1 },
    { type: "brightness", amount: 0.4, dj: true },
    customEffect("  Glow  ", "return source(uv);", { amount: 0.6, vj: true }),
    { type: "grain", amount: 0.1, colourSlot: 1 },
  ],
});

async function screen(page: Page): Promise<string> {
  await page.goto(`${server.origin}/`);
  await page.getByTestId("control-switch").click();
  await expect(page.getByTestId("control-switch")).toBeChecked();
  return (await page.getByTestId("control-url").textContent())!;
}

async function paired(page: Page, browser: Browser, url: string, viewport = PHONE) {
  const context = await browser.newContext({ viewport, ...LAN_CONTEXT });
  contexts.push(context);
  const phone = await context.newPage();
  await phone.goto(url);
  await expect(phone.getByTestId("link-line")).toHaveText("Waiting for approval");
  await page.getByTestId("control-accept").click();
  await expect(phone.getByTestId("profile-tile").first()).toBeEnabled();
  return phone;
}

const tileOf = (phone: Page, stored: Stored) =>
  phone.locator(`[data-testid=profile-tile][data-profile-id="${stored.id}"]`);

async function pick(phone: Page, stored: Stored) {
  await tileOf(phone, stored).click();
  await expect(tileOf(phone, stored)).toHaveAttribute("aria-pressed", "true");
}

const mode = (phone: Page, which: "dj" | "vj") => phone.getByTestId(`mode-${which}`).click();

/** The test ids of the bank's sliders, in order. */
const bankIds = (phone: Page) =>
  phone
    .getByTestId("fader-bank")
    .getByRole("slider")
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));

test("a profile without ticks shows a two-fader bank and no Effects section, in both modes (AC4)", async ({
  page,
  browser,
}) => {
  const plain = await createProfile(api, flat("Plain", "#808080"));
  const url = await screen(page);
  const phone = await paired(page, browser, url, TABLET);
  await pick(phone, plain);
  for (const which of ["dj", "vj"] as const) {
    await mode(phone, which);
    expect(await bankIds(phone)).toEqual(["dial-recognisability", "dial-reactivity"]);
    await expect(phone.getByTestId("effects")).toHaveCount(0);
    await expect(phone.locator("[data-testid^=effect-]")).toHaveCount(0);
  }
});

test("the DJ-ticked effect is the bank's third fader, named, in DJ and VJ mode (AC8)", async ({
  page,
  browser,
}) => {
  const profile = await createProfile(api, ticked());
  const url = await screen(page);
  const phone = await paired(page, browser, url);
  await pick(phone, profile);
  for (const which of ["dj", "vj"] as const) {
    await mode(phone, which);
    await expect
      .poll(() => bankIds(phone))
      .toEqual(["dial-recognisability", "dial-reactivity", "effect-2"]);
    const fader = phone
      .getByTestId("fader-bank")
      .getByRole("slider", { name: "brightness", exact: true });
    await expect(fader).toHaveAttribute("data-testid", "effect-2");
    await expect(fader).toHaveAttribute("aria-valuenow", "0.4");
    await expect(fader).toHaveAttribute("aria-valuetext", "40");
    // Orientation as the bank's: horizontal at 320×568, like the dials.
    const dial = phone.getByTestId("dial-reactivity");
    await expect(fader).toHaveAttribute(
      "aria-orientation",
      (await dial.getAttribute("aria-orientation"))!,
    );
  }
  // Turned to landscape, the bank stands at the right edge and the effect fader with it.
  await phone.setViewportSize({ width: 568, height: 320 });
  await expect(phone.getByTestId("effect-2")).toHaveAttribute("aria-orientation", "vertical");
});

test("VJ mode lists the VJ-ticked effects under Transition, in stack order; DJ mode has none (AC9)", async ({
  page,
  browser,
}) => {
  const profile = await createProfile(api, ticked());
  const url = await screen(page);
  const phone = await paired(page, browser, url, TABLET);
  await pick(phone, profile);
  await mode(phone, "vj");
  const section = phone.getByTestId("effects");
  await expect(section).toBeVisible();
  await expect(section).toHaveAttribute("aria-label", "Effects");
  await expect(section.locator(".djv-legend")).toHaveText("Effects");
  await expect(section.getByRole("slider")).toHaveCount(2);
  await expect(section.getByRole("slider").nth(0)).toHaveAttribute("data-testid", "effect-0");
  await expect(section.getByRole("slider").nth(1)).toHaveAttribute("data-testid", "effect-3");
  await expect(section.getByRole("slider", { name: "zoom" })).toHaveAttribute(
    "aria-valuenow",
    "0.2",
  );
  await expect(section.getByRole("slider", { name: "Glow" })).toHaveAttribute(
    "aria-valuetext",
    "60",
  );
  for (const id of ["effect-0", "effect-3"]) {
    await expect(phone.getByTestId(id)).toHaveAttribute("aria-orientation", "horizontal");
  }
  // Under Transition: the section right after it.
  const order = await phone
    .locator("section[aria-label]")
    .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
  expect(order.indexOf("Effects")).toBe(order.indexOf("Transition") + 1);

  await mode(phone, "dj");
  await expect(phone.getByTestId("effects")).toHaveCount(0);
  await expect(phone.getByTestId("effect-0")).toHaveCount(0);
  await expect(phone.getByTestId("effect-2")).toBeVisible();
});

test("an effect ticked both shows once, in the bank (AC9, SD8)", async ({ page, browser }) => {
  const both = ticked("Both");
  both.effects[2] = { ...both.effects[2]!, vj: true };
  const profile = await createProfile(api, both);
  const url = await screen(page);
  const phone = await paired(page, browser, url, TABLET);
  await pick(phone, profile);
  await mode(phone, "vj");
  await expect(phone.getByTestId("effects").getByRole("slider")).toHaveCount(2);
  await expect(phone.getByTestId("effect-2")).toHaveCount(1);
  await expect(phone.getByTestId("fader-bank").getByTestId("effect-2")).toHaveCount(1);
});

test("each effect fader is a keyboard slider named for its effect (AC16)", async ({
  page,
  browser,
}) => {
  const profile = await createProfile(api, ticked());
  const url = await screen(page);
  const phone = await paired(page, browser, url, TABLET);
  await pick(phone, profile);
  await mode(phone, "vj");
  for (const [id, name, from] of [
    ["effect-2", "brightness", 40],
    ["effect-0", "zoom", 20],
    ["effect-3", "Glow", 60],
  ] as const) {
    const fader = phone.getByRole("slider", { name, exact: true });
    await expect(fader).toHaveAttribute("data-testid", id);
    await fader.focus();
    await fader.press("ArrowRight");
    await expect(fader).toHaveAttribute("aria-valuenow", String((from + 1) / 100));
    await expect(fader).toHaveAttribute("aria-valuetext", String(from + 1));
    await fader.press("PageDown");
    await expect(fader).toHaveAttribute("aria-valuetext", String(from - 9));
    await fader.press("Home");
    await expect(fader).toHaveAttribute("aria-valuetext", "0");
  }
});

test("the stored value is a tick on the track, 3:1 against it and a shape, not a colour (AC17)", async ({
  page,
  browser,
}) => {
  const profile = await createProfile(api, ticked());
  const url = await screen(page);
  const phone = await paired(page, browser, url, TABLET);
  await pick(phone, profile);
  await mode(phone, "vj");
  for (const id of ["effect-2", "effect-0"]) {
    const fader = phone.getByTestId(id);
    const mark = phone.getByTestId(`${id}-mark`);
    await expect(mark).toBeVisible();
    const look = await mark.evaluate((el) => {
      const own = getComputedStyle(el);
      const notch = getComputedStyle(el, "::after");
      const track = getComputedStyle(el.parentElement!);
      return {
        colour: own.backgroundColor,
        track: track.backgroundColor,
        width: el.getBoundingClientRect().width,
        height: el.getBoundingClientRect().height,
        notch: notch.content,
        notchColour: notch.backgroundColor,
      };
    });
    expect(contrast(look.colour, look.track)).toBeGreaterThanOrEqual(3);
    expect(Math.min(look.width, look.height)).toBe(2);
    expect(Math.max(look.width, look.height)).toBeGreaterThan(30);
    expect(look.notch).not.toBe("none");
    expect(contrast(look.notchColour, look.track)).toBeGreaterThanOrEqual(3);
    // The dials carry no tick: they have no stored value on the controller.
    await expect(phone.getByTestId("dial-recognisability-mark")).toHaveCount(0);
    // It stays at the stored value while the value moves. B-07 (owner, 2026-11-26): the Scenes
    // section above can put the fader below the fold, and focusing it would then scroll the page;
    // it is scrolled into view first, so the box compares the tick on the track, not the scroll.
    await fader.scrollIntoViewIfNeeded();
    const before = (await mark.boundingBox())!;
    await fader.focus();
    await fader.press("End");
    await expect(fader).toHaveAttribute("aria-valuenow", "1");
    expect((await mark.boundingBox())!).toEqual(before);
  }
});
