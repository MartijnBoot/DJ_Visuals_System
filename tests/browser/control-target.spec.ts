// B-16 T4 (spec SD3, AC10, AC11, AC14, AC18; plan PD1, PD2, PD14): VJ mode's target on real
// paired controllers against the in-process server. A swatch tap aims the pinned wheel at its slot;
// exactly one swatch is pressed and carries the target mark, a bar apart from the primary's edge;
// a pick (any, by anyone), DJ mode, a reload and a palette without the slot send it back to the
// primary slot. AC14: a pinned-wheel colour reaches that slot only, with no new program and no
// request that writes a profile.
import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { contrast } from "../contrast.ts";
import { LAN_CONTEXT, startControlServer, type ControlServer } from "./control-server.ts";
import { createProfile, updateProfile, type Definition, type Stored } from "./fixtures/profiles.ts";
import { meanRgb, pixels } from "./helpers.ts";

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

/** Three distinct slots, the primary the first: the camera-less frame is slot 0 (dark). */
const three = (name: string, palette = ["#808080", "#336699", "#ffcc00"]): Definition => ({
  name,
  palette,
  primary: 0,
  dials: { recognisability: 0.5, reactivity: 0.5 },
  effects: [{ type: "paletteMap", amount: 1 }],
});

async function screen(page: Page): Promise<string> {
  await page.goto(`${server.origin}/`);
  await page.getByTestId("control-switch").click();
  await expect(page.getByTestId("control-switch")).toBeChecked();
  return (await page.getByTestId("control-url").textContent())!;
}

interface Controller {
  page: Page;
  /** The `colour` frames this controller has sent. */
  colours(): { slot: number; value: string }[];
}

async function paired(
  page: Page,
  browser: Browser,
  url: string,
  mode: "dj" | "vj",
  viewport = PHONE,
): Promise<Controller> {
  const context = await browser.newContext({ viewport, ...LAN_CONTEXT });
  contexts.push(context);
  const phone = await context.newPage();
  const sent: { slot: number; value: string }[] = [];
  phone.on("websocket", (ws) =>
    ws.on("framesent", (frame) => {
      const m = JSON.parse(String(frame.payload)) as { type: string; slot: number; value: string };
      if (m.type === "colour") sent.push({ slot: m.slot, value: m.value });
    }),
  );
  await phone.goto(url);
  await expect(phone.getByTestId("link-line")).toHaveText("Waiting for approval");
  await page.getByTestId("control-accept").click();
  await expect(phone.getByTestId("link-line")).toHaveText("Connected");
  await phone.getByTestId(`mode-${mode}`).click();
  await expect(phone.getByTestId("wheel")).toBeVisible();
  return { page: phone, colours: () => [...sent] };
}

const tileOf = (phone: Page, stored: Stored) =>
  phone.locator(`[data-testid=profile-tile][data-profile-id="${stored.id}"]`);
const swatch = (phone: Page, slot: number) =>
  phone.locator(`[data-testid=swatch][data-slot="${slot}"]`);

async function pick(phone: Page, stored: Stored) {
  await tileOf(phone, stored).click();
  await expect(tileOf(phone, stored)).toHaveAttribute("aria-pressed", "true");
}

/** What a swatch shows: pressed, the target bar (and its colour), the primary edge. */
const marks = (locator: Locator) =>
  locator.evaluate((el) => {
    const after = getComputedStyle(el, "::after");
    const own = getComputedStyle(el);
    return {
      pressed: el.getAttribute("aria-pressed"),
      bar: after.content !== "none" && after.content !== "normal",
      barColour: after.backgroundColor,
      barHeight: parseFloat(after.height),
      edge: own.borderTopWidth,
      edgeColour: own.borderTopColor,
    };
  });

/** Exactly one swatch pressed and barred, the one on `slot`; the label names it. */
async function expectAimedAt(phone: Page, slot: number, primary: number, where: string) {
  await expect(phone.getByTestId("wheel"), where).toHaveAttribute("data-slot", String(slot));
  await expect(phone.getByTestId("wheel-label"), where).toHaveText(
    `Colour ${slot + 1}${slot === primary ? " · primary" : ""}`,
  );
  await expect(phone.locator('[data-testid=swatch][aria-pressed="true"]'), where).toHaveCount(1);
  const count = await phone.getByTestId("swatch").count();
  for (let i = 0; i < count; i++) {
    const m = await marks(swatch(phone, i));
    expect(m.pressed, `${where} swatch ${i}`).toBe(i === slot ? "true" : "false");
    expect(m.bar, `${where} swatch ${i}`).toBe(i === slot);
    // The primary keeps its own mark beside the target's (PD2: both on one swatch).
    expect(m.edge, `${where} swatch ${i}`).toBe(i === primary ? "4px" : "2px");
  }
}

test("a VJ swatch tap aims the pinned wheel at its slot: label, pressed and marked, no dialog, colour for that slot (AC10)", async ({
  page,
  browser,
}) => {
  const stored = await createProfile(api, three("Three"));
  const url = await screen(page);
  const vj = await paired(page, browser, url, "vj");
  await pick(vj.page, stored);
  await expectAimedAt(vj.page, 0, 0, "entering VJ mode"); // PD2: the primary, both marks

  await swatch(vj.page, 2).click();
  await expectAimedAt(vj.page, 2, 0, "after swatch 3");
  await expect(vj.page.locator("dialog")).toHaveCount(0);
  await expect(vj.page.getByTestId("wheel-current")).toHaveAttribute("data-colour", "#ffcc00");
  await vj.page.getByTestId("wheel-disc").focus();
  await vj.page.keyboard.press("ArrowDown"); // less saturation
  await expect.poll(() => vj.colours().length).toBe(1);
  const sent = vj.colours()[0]!;
  expect(sent.slot).toBe(2);
  // The screen applied it to that slot: its state says so.
  await expect(swatch(vj.page, 2)).toHaveAttribute("data-colour", sent.value);
  await expect(swatch(vj.page, 0)).toHaveAttribute("data-colour", "#808080");
  await expect(swatch(vj.page, 1)).toHaveAttribute("data-colour", "#336699");

  // On the primary swatch the label says primary (AC10).
  await swatch(vj.page, 0).click();
  await expectAimedAt(vj.page, 0, 0, "after swatch 1");
});

test("the target mark differs from the primary mark and is at least 3:1 against the section (AC18)", async ({
  page,
  browser,
}) => {
  const stored = await createProfile(api, three("Three"));
  const url = await screen(page);
  const vj = await paired(page, browser, url, "vj");
  await pick(vj.page, stored);
  await swatch(vj.page, 2).click();
  const target = await marks(swatch(vj.page, 2));
  const primary = await marks(swatch(vj.page, 0));
  expect(target.bar).toBe(true);
  expect(target.barHeight).toBeGreaterThanOrEqual(3);
  // Not the primary's mark: no heavier edge, and another colour than the primary edge's.
  expect(target.edge).toBe("2px");
  expect(primary.edge).toBe("4px");
  expect(primary.bar).toBe(false);
  expect(target.barColour).not.toBe(primary.edgeColour);
  // The bar sits on the Palette section, outside the swatch, whatever the swatch's colour.
  const section = await vj.page
    .getByRole("region", { name: "Palette" })
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(contrast(target.barColour, section)).toBeGreaterThanOrEqual(3);
  const geometry = await swatch(vj.page, 2).evaluate((el) => {
    const box = el.getBoundingClientRect();
    const after = getComputedStyle(el, "::after");
    return { height: box.height, bottom: parseFloat(after.bottom) };
  });
  expect(geometry.bottom).toBeLessThan(0); // below the swatch, on the section
});

test("the target goes back to the primary slot on a re-pick, DJ and back, a reload, a shrunk palette and another controller's pick (AC11, PD1, PD2, PD14)", async ({
  page,
  browser,
}) => {
  const first = await createProfile(api, three("First"));
  const second = await createProfile(api, three("Second", ["#202020", "#a0a0a0", "#00ff88"]));
  const url = await screen(page);
  const vj = await paired(page, browser, url, "vj");
  const other = await paired(page, browser, url, "dj");
  await pick(vj.page, first);
  const aim3 = async () => {
    await swatch(vj.page, 2).click();
    await expectAimedAt(vj.page, 2, 0, "aimed at swatch 3");
  };

  await aim3();
  await pick(vj.page, first); // the active profile again
  await expectAimedAt(vj.page, 0, 0, "after a re-pick of the active profile");

  await aim3();
  await vj.page.getByTestId("mode-dj").click();
  await expect(vj.page.getByTestId("wheel")).toHaveAttribute("data-slot", "0");
  await vj.page.getByTestId("mode-vj").click();
  await expectAimedAt(vj.page, 0, 0, "after DJ and back");

  await aim3();
  await vj.page.reload();
  await expect(vj.page.getByTestId("link-line")).toHaveText("Connected");
  await expect(vj.page.getByTestId("mode-vj")).toHaveAttribute("aria-pressed", "true");
  await expectAimedAt(vj.page, 0, 0, "after a reload");

  // Another controller's pick of a different profile, from DJ mode, then from VJ mode (PD1).
  await aim3();
  await pick(other.page, second);
  await expect(tileOf(vj.page, second)).toHaveAttribute("aria-pressed", "true");
  await expectAimedAt(vj.page, 0, 0, "after another controller's pick in DJ mode");
  await aim3();
  await other.page.getByTestId("mode-vj").click();
  await pick(other.page, first);
  await expect(tileOf(vj.page, first)).toHaveAttribute("aria-pressed", "true");
  await expectAimedAt(vj.page, 0, 0, "after another controller's pick in VJ mode");

  // A palette that shrinks under the target (PD14), and then grows again: the target stays gone.
  // The screen keeps the palette it loaded until a pick (B-02 SD9), so the shrink arrives with
  // another controller's re-pick of the active profile, which leaves `activeId` as it was (PD1's
  // limit): only PD14 sends the wheel back here.
  await aim3();
  const shrunk = await updateProfile(api, first, { palette: ["#808080", "#336699"] });
  await pick(other.page, first);
  await expect(vj.page.getByTestId("swatch")).toHaveCount(2);
  await expectAimedAt(vj.page, 0, 0, "after the palette shrank");
  await updateProfile(api, shrunk, { palette: ["#808080", "#336699", "#ffcc00"] });
  await pick(other.page, first);
  await expect(vj.page.getByTestId("swatch")).toHaveCount(3);
  await expectAimedAt(vj.page, 0, 0, "after the palette grew again");
});

/** Red minus green over the middle of the screen's canvas, away from the panel. */
async function redness(page: Page): Promise<number> {
  const [r, g] = meanRgb(await pixels(page, 40, 120, 160, 120));
  return r! - g!;
}

/** Drags across the disc from its centre to the right edge: hue 0, full saturation. */
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

const palette = async (observer: Page) => {
  const colours: string[] = [];
  for (const s of await observer.getByTestId("swatch").all()) {
    colours.push((await s.getAttribute("data-colour"))!);
  }
  return colours;
};

test("a pinned-wheel colour reaches that slot only, the next frames, with no new program and no profile write (AC14)", async ({
  page,
  browser,
}) => {
  const stored = await createProfile(api, three("Three"));
  const url = await screen(page);
  const dj = await paired(page, browser, url, "dj");
  const observer = await paired(page, browser, url, "vj", TABLET);
  await pick(dj.page, stored);
  await page.keyboard.press("o");
  await expect(page.getByTestId("overlay-profile")).toHaveText("profile: Three");
  await expect.poll(() => palette(observer.page)).toEqual(["#808080", "#336699", "#ffcc00"]);
  // Recorded from before the first change.
  const requests: string[] = [];
  page.on("request", (r) => requests.push(`${r.method()} ${new URL(r.url()).pathname}`));
  const programs: string[] = [];
  page.on("console", (m) => {
    if (m.text().startsWith("profile")) programs.push(m.text());
  });
  const before = await redness(page);

  // DJ mode: the pinned wheel is on the primary slot; the screen's colour moves, nothing else.
  await expect(dj.page.getByTestId("wheel")).toHaveAttribute("data-slot", "0");
  await dragToRed(dj.page);
  const red = (await dj.page.getByTestId("wheel-value").textContent())!;
  await expect.poll(() => palette(observer.page)).toEqual([red, "#336699", "#ffcc00"]);
  await expect.poll(() => redness(page)).toBeGreaterThan(before + 20);

  // VJ mode, swatch 3: slot 3 only.
  await dj.page.getByTestId("mode-vj").click();
  await swatch(dj.page, 2).click();
  await expect(dj.page.getByTestId("wheel")).toHaveAttribute("data-slot", "2");
  await dragToRed(dj.page);
  const red3 = (await dj.page.getByTestId("wheel-value").textContent())!;
  expect(red3).not.toBe("#ffcc00");
  await expect.poll(() => palette(observer.page)).toEqual([red, "#336699", red3]);

  await page.waitForTimeout(500);
  await expect(page.getByTestId("overlay-profile")).toHaveText("profile: Three");
  expect(programs).toEqual([]);
  expect(requests.filter((r) => /^(POST|PUT|DELETE) /.test(r))).toEqual([]);
});
