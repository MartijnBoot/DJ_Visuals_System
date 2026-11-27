// B-19 T5 (spec SD1, SD5, SD6, SD9, AC9, AC12 to AC16, AC18; plan PD3, PD9, PD11): the page shell
// on a real paired `/control` — the status bar pinned at the top, the scrolling middle, the fader
// bank pinned at the bottom (horizontal) or the right edge (vertical) — against the in-process
// server. The four-fader budget is measured on the real page by cloning the bank's last fader
// into it, with no switch in the shipped page (PD9).
import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { LAN_CONTEXT, startControlServer, type ControlServer } from "./control-server.ts";
import { dragFader, setFader } from "./fader.ts";
import { createProfile, flat, twelveEffects } from "./fixtures/profiles.ts";
import { dropNetwork, keepSockets } from "./sockets.ts";

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

interface Phone {
  page: Page;
  dials(): unknown[];
  drop(): Promise<void>;
  back(): Promise<void>;
}

async function screen(page: Page): Promise<string> {
  await page.goto(`${server.origin}/`);
  await page.getByTestId("control-switch").click();
  await expect(page.getByTestId("control-switch")).toBeChecked();
  return (await page.getByTestId("control-url").textContent())!;
}

async function paired(page: Page, browser: Browser, viewport = PORTRAIT): Promise<Phone> {
  const url = await screen(page);
  const context = await browser.newContext({ viewport, ...LAN_CONTEXT });
  contexts.push(context);
  await keepSockets(context);
  const phone = await context.newPage();
  const sent: unknown[] = [];
  phone.on("websocket", (ws) =>
    ws.on("framesent", (frame) => {
      if ((JSON.parse(String(frame.payload)) as { type: string }).type === "dials")
        sent.push(frame);
    }),
  );
  await phone.goto(url);
  await expect(phone.getByTestId("link-line")).toHaveText("Waiting for approval");
  await page.getByTestId("control-accept").click();
  await expect(phone.getByTestId("link-line")).toHaveText("Connected");
  await expect(phone.getByTestId("profile-tile").first()).toBeEnabled();
  return {
    page: phone,
    dials: () => [...sent],
    drop: () => dropNetwork(phone),
    back: () => context.setOffline(false),
  };
}

const box = async (locator: Locator) => (await locator.boundingBox())!;

/** Whether the whole box lies inside the viewport. */
async function inView(phone: Page, locator: Locator): Promise<boolean> {
  const b = await box(locator);
  const { width, height } = phone.viewportSize()!;
  return (
    b.x >= -0.5 && b.y >= -0.5 && b.x + b.width <= width + 0.5 && b.y + b.height <= height + 0.5
  );
}

/** AC15: no horizontal scroll, and every visible target at least 48×48 (B-16 AC6: the disc too). */
async function fitProblems(phone: Page): Promise<string[]> {
  const problems: string[] = [];
  for (const id of ["controller", "control-scroll"]) {
    const { scrollWidth, clientWidth } = await phone
      .getByTestId(id)
      .evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
    if (scrollWidth > clientWidth)
      problems.push(`${id} scrolls sideways: ${scrollWidth} > ${clientWidth}`);
  }
  for (const target of await phone
    .locator("button, input, [role=slider], [role=application]")
    .all()) {
    if (!(await target.isVisible())) continue;
    const b = await box(target);
    if (b.width < 48 || b.height < 48) {
      problems.push(
        `${await target.evaluate((e) => e.outerHTML.slice(0, 80))} ${b.width}×${b.height}`,
      );
    }
  }
  return problems;
}

/** PD9: two copies of the bank's last fader, in the bank, with no React state change. */
const cloneFaders = (phone: Page) =>
  phone.evaluate(() => {
    const row = document.querySelector("[data-testid=fader-bank] .djv-bank-faders")!;
    const last = row.lastElementChild!;
    for (let i = 0; i < 2; i++) {
      const copy = last.cloneNode(true) as HTMLElement;
      copy.dataset.clone = "true";
      copy.querySelector("[data-testid]")?.setAttribute("data-testid", `clone-${i}`);
      row.append(copy);
    }
    return row.children.length;
  });

const removeClones = (phone: Page) =>
  phone.evaluate(() => document.querySelectorAll("[data-clone]").forEach((c) => c.remove()));

const scrollToEnd = (phone: Page) =>
  phone.getByTestId("control-scroll").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });

test("the bank is pinned at the bottom with horizontal faders in portrait, at the right edge with vertical faders otherwise (AC12)", async ({
  page,
  browser,
}) => {
  const phone = await paired(page, browser, PORTRAIT);
  const bank = phone.page.getByTestId("fader-bank");
  const faders = [
    phone.page.getByTestId("dial-recognisability"),
    phone.page.getByTestId("dial-reactivity"),
  ];
  await expect(phone.page.getByTestId("controller")).toHaveAttribute(
    "data-arrangement",
    "horizontal",
  );
  expect(Math.round((await box(bank)).y + (await box(bank)).height)).toBe(568);
  for (const fader of faders) {
    await expect(fader).toHaveAttribute("aria-orientation", "horizontal");
    expect((await box(fader)).width).toBeGreaterThanOrEqual(0.85 * 320);
  }

  for (const [viewport, travel] of [
    [LANDSCAPE, 180],
    [TABLET, 300],
  ] as const) {
    await phone.page.setViewportSize(viewport);
    await expect(phone.page.getByTestId("controller")).toHaveAttribute(
      "data-arrangement",
      "vertical",
    );
    const b = await box(bank);
    expect(Math.round(b.x + b.width)).toBe(viewport.width);
    // Under the status bar, down to the bottom edge.
    const bar = await box(phone.page.getByTestId("status-bar"));
    expect(Math.round(b.y)).toBe(Math.round(bar.y + bar.height));
    expect(Math.round(b.y + b.height)).toBe(viewport.height);
    for (const fader of faders) {
      await expect(fader).toHaveAttribute("aria-orientation", "vertical");
      expect((await box(fader)).height).toBeGreaterThanOrEqual(travel);
    }
  }
});

test("scrolled to its start or end, the status bar, the whole colour block and the whole bank stay in view, DJ and VJ, both arrangements (AC13, B-16 AC2)", async ({
  page,
  browser,
}) => {
  await createProfile(api, twelveEffects());
  const phone = await paired(page, browser, PORTRAIT);
  for (const viewport of [PORTRAIT, LANDSCAPE]) {
    await phone.page.setViewportSize(viewport);
    for (const mode of ["dj", "vj"] as const) {
      await phone.page.getByTestId(`mode-${mode}`).click();
      const where = `${viewport.width}×${viewport.height} ${mode}`;
      // B-16 AC2: the whole colour block too, at the scroll's start and at its end.
      await phone.page.getByTestId("control-scroll").evaluate((el) => (el.scrollTop = 0));
      for (const id of ["status-bar", "wheel", "fader-bank"]) {
        expect(await inView(phone.page, phone.page.getByTestId(id)), `${where} start ${id}`).toBe(
          true,
        );
      }
      await scrollToEnd(phone.page);
      expect(await inView(phone.page, phone.page.getByTestId("status-bar")), where).toBe(true);
      expect(await inView(phone.page, phone.page.getByTestId("wheel")), where).toBe(true);
      expect(await inView(phone.page, phone.page.getByTestId("fader-bank")), where).toBe(true);
      // Scrolled, something did move: the middle scrolls, not the page.
      expect(
        await phone.page.getByTestId("control-scroll").evaluate((el) => el.scrollTop),
        where,
      ).toBeGreaterThan(0);
      expect(await phone.page.evaluate(() => document.scrollingElement!.scrollTop)).toBe(0);
    }
  }
});

test("turning the device re-lays the page out without a reload, keeping the mode, the link, the values and the wheel's target (AC14, B-16 AC4)", async ({
  page,
  browser,
}) => {
  await createProfile(api, {
    ...flat("Three", "#112233"),
    palette: ["#112233", "#445566", "#778899"],
  });
  const phone = await paired(page, browser, PORTRAIT);
  await phone.page.getByTestId("mode-vj").click();
  const three = phone.page.getByTestId("profile-tile").filter({ hasText: "Three" });
  await three.click();
  await expect(three).toHaveAttribute("aria-pressed", "true");
  await phone.page.locator('[data-testid=swatch][data-slot="2"]').click();
  const wheel = phone.page.getByTestId("wheel");
  await expect(wheel).toHaveAttribute("data-slot", "2");
  await setFader(phone.page.getByTestId("dial-recognisability"), 0.42);
  await setFader(phone.page.getByTestId("dial-reactivity"), 0.77);
  await phone.page.evaluate(() => ((window as unknown as { __kept: boolean }).__kept = true));
  await phone.page.setViewportSize(LANDSCAPE);
  await expect(phone.page.getByTestId("controller")).toHaveAttribute(
    "data-arrangement",
    "vertical",
  );
  expect(await phone.page.evaluate(() => (window as unknown as { __kept?: boolean }).__kept)).toBe(
    true,
  );
  await expect(phone.page.getByTestId("mode-vj")).toHaveAttribute("aria-pressed", "true");
  await expect(phone.page.getByTestId("link-line")).toHaveText("Connected");
  await expect(phone.page.getByTestId("dial-recognisability")).toHaveAttribute(
    "aria-valuenow",
    "0.42",
  );
  await expect(phone.page.getByTestId("dial-reactivity")).toHaveAttribute("aria-valuenow", "0.77");
  await expect(wheel).toHaveAttribute("data-slot", "2");
  await expect(phone.page.getByTestId("wheel-current")).toHaveAttribute("data-colour", "#778899");
  await phone.page.setViewportSize(PORTRAIT);
  await expect(phone.page.getByTestId("controller")).toHaveAttribute(
    "data-arrangement",
    "horizontal",
  );
  await expect(phone.page.getByTestId("mode-vj")).toHaveAttribute("aria-pressed", "true");
  await expect(wheel).toHaveAttribute("data-slot", "2");
  await expect(phone.page.getByTestId("wheel-label")).toHaveText("Colour 3");
});

test("a re-layout mid-drag lets go: the screen's value shows and nothing follows the release (AC9)", async ({
  page,
  browser,
}) => {
  const phone = await paired(page, browser, PORTRAIT);
  const fader = phone.page.getByTestId("dial-recognisability");
  const panel = page.getByTestId("slider-recognisability");
  await setFader(fader, 0.5);
  await dragFader(phone.page, fader, { from: 0.8, by: 0.1, release: false });
  await expect(panel).toHaveValue("0.6");
  await panel.fill("0.2");
  await phone.page.waitForTimeout(300);
  await expect(fader).toHaveAttribute("aria-valuenow", "0.6");
  const sent = phone.dials().length;
  await phone.page.setViewportSize(LANDSCAPE);
  await expect(fader).toHaveAttribute("aria-orientation", "vertical");
  await expect(fader).toHaveAttribute("aria-valuenow", "0.2");
  await phone.page.mouse.move(400, 100, { steps: 4 });
  await phone.page.mouse.up();
  await phone.page.waitForTimeout(300);
  expect(phone.dials().length).toBe(sent);
  await expect(panel).toHaveValue("0.2");
});

test("a screen value off the 0.01 grid: a touch without a move keeps the cap at its exact position, the readout rounds (spec Edge cases)", async ({
  page,
  browser,
}) => {
  // The panel steps by 0.01; a profile's starting dials need not.
  const offGrid = await createProfile(
    api,
    flat("Off grid", "#ff0000", { recognisability: 0.425, reactivity: 0.5 }),
  );
  const phone = await paired(page, browser, PORTRAIT);
  const tile = phone.page.locator(`[data-testid=profile-tile][data-profile-id="${offGrid.id}"]`);
  await tile.click();
  await expect(tile).toHaveAttribute("aria-pressed", "true");
  const fader = phone.page.getByTestId("dial-recognisability");
  await expect(fader).toHaveAttribute("aria-valuenow", "0.425");
  const readout = String(Math.round(0.425 * 100));
  await expect(phone.page.getByTestId("dial-recognisability-readout")).toHaveText(readout);
  const sent = phone.dials().length;

  const b = await box(fader);
  await phone.page.mouse.move(b.x + b.width * 0.9, b.y + b.height / 2);
  await phone.page.mouse.down();
  await phone.page.waitForTimeout(300);
  await expect(fader).toHaveAttribute("aria-valuenow", "0.425");
  await expect(phone.page.getByTestId("dial-recognisability-readout")).toHaveText(readout);
  await phone.page.mouse.up();
  await phone.page.waitForTimeout(300);
  await expect(fader).toHaveAttribute("aria-valuenow", "0.425");
  expect(phone.dials().length).toBe(sent);
});

test("no sideways scroll and every target at least 48×48 at five sizes, DJ and VJ, started, with a long name (AC15)", async ({
  page,
  browser,
}) => {
  await createProfile(api, {
    ...twelveEffects(),
    name: "A very long profile name that wraps across the tile",
  });
  const phone = await paired(page, browser, PORTRAIT);
  await page.getByTestId("panel").getByRole("button", { name: "Start" }).click();
  await expect(phone.page.getByTestId("camera-tile").first()).toBeEnabled();
  const problems: string[] = [];
  for (const viewport of [
    PORTRAIT,
    { width: 320, height: 640 },
    LANDSCAPE,
    TABLET,
    { width: 1024, height: 768 },
  ]) {
    await phone.page.setViewportSize(viewport);
    for (const mode of ["dj", "vj"] as const) {
      await phone.page.getByTestId(`mode-${mode}`).click();
      await expect(phone.page.getByTestId(`mode-${mode}`)).toHaveAttribute("aria-pressed", "true");
      for (const p of await fitProblems(phone.page)) {
        problems.push(`${viewport.width}×${viewport.height} ${mode}: ${p}`);
      }
    }
  }
  expect(problems).toEqual([]);
});

// B-16 PD15: the colour block is pinned beside the bank too. At 568×320 four faders and the block
// leave the scrolling area about 70 px wide, which B-18 resolves (B-16 SD2, Out of scope), so the
// fit check runs there only on the bank's own budget; at 320×568 it still runs on the whole page.
test("four faders fit the budget: half the height at 320×568, half the width at 568×320, the colour block in view (AC16, B-16 PD15)", async ({
  page,
  browser,
}) => {
  const phone = await paired(page, browser, PORTRAIT);
  const bank = phone.page.getByTestId("fader-bank");
  for (const mode of ["dj", "vj"] as const) {
    await phone.page.getByTestId(`mode-${mode}`).click();

    await phone.page.setViewportSize(PORTRAIT);
    await expect(phone.page.getByTestId("controller")).toHaveAttribute(
      "data-arrangement",
      "horizontal",
    );
    expect(await cloneFaders(phone.page)).toBe(4);
    expect((await box(bank)).height).toBeLessThanOrEqual(284);
    expect(await fitProblems(phone.page)).toEqual([]);
    expect(await inView(phone.page, bank)).toBe(true);
    expect(await inView(phone.page, phone.page.getByTestId("wheel"))).toBe(true);
    await removeClones(phone.page);

    await phone.page.setViewportSize(LANDSCAPE);
    await expect(phone.page.getByTestId("controller")).toHaveAttribute(
      "data-arrangement",
      "vertical",
    );
    expect(await cloneFaders(phone.page)).toBe(4);
    expect((await box(bank)).width).toBeLessThanOrEqual(284);
    for (const slider of await bank.locator("[role=slider]").all()) {
      expect((await box(slider)).height).toBeGreaterThanOrEqual(180);
    }
    expect(await inView(phone.page, bank)).toBe(true);
    expect(await inView(phone.page, phone.page.getByTestId("wheel"))).toBe(true);
    await removeClones(phone.page);
  }
});

test("locked, every fader is disabled with the locked look and the bank says Locked; unlocked, both go (AC18)", async ({
  page,
  browser,
}) => {
  const phone = await paired(page, browser, PORTRAIT);
  const faders = phone.page.getByTestId("fader-bank").getByRole("slider");
  await expect(faders).toHaveCount(2);
  await expect(phone.page.getByTestId("bank-locked")).toHaveCount(0);
  await phone.drop();
  await expect(phone.page.getByTestId("link-line")).toHaveText("Reconnecting…");
  await expect(phone.page.getByTestId("bank-locked")).toBeVisible();
  await expect(phone.page.getByTestId("bank-locked")).toHaveText("Locked");
  for (const fader of await faders.all()) {
    await expect(fader).toHaveAttribute("aria-disabled", "true");
    await expect(fader).toBeDisabled();
    // The locked look: the track is hatched, not only recoloured.
    expect(await fader.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain(
      "repeating-linear-gradient",
    );
  }
  await phone.back();
  await expect(phone.page.getByTestId("link-line")).toHaveText("Connected");
  await expect(phone.page.getByTestId("bank-locked")).toHaveCount(0);
  for (const fader of await faders.all()) {
    await expect(fader).toBeEnabled();
    expect(await fader.evaluate((el) => getComputedStyle(el).backgroundImage)).toBe("none");
  }
});

// ---- B-16 T2b: the pinned colour block, measured (AC1, AC2, AC3, AC5, AC9) ----

const FIVE = [
  PORTRAIT,
  { width: 320, height: 640 },
  LANDSCAPE,
  TABLET,
  { width: 1024, height: 768 },
] as const;

test("at five sizes, DJ and VJ, the colour block is there with no dialog, no Primary colour key and no Done (B-16 AC1)", async ({
  page,
  browser,
}) => {
  const phone = await paired(page, browser, PORTRAIT);
  for (const viewport of FIVE) {
    await phone.page.setViewportSize(viewport);
    for (const mode of ["dj", "vj"] as const) {
      await phone.page.getByTestId(`mode-${mode}`).click();
      const where = `${viewport.width}×${viewport.height} ${mode}`;
      const wheel = phone.page.getByTestId("wheel");
      await expect(wheel, where).toBeVisible();
      expect(await wheel.evaluate((el) => el.tagName), where).toBe("SECTION");
      for (const id of [
        "wheel-disc",
        "wheel-brightness",
        "wheel-label",
        "wheel-current",
        "wheel-stored",
        "wheel-value",
        "wheel-reset",
      ]) {
        await expect(phone.page.getByTestId(id), `${where} ${id}`).toBeVisible();
      }
      await expect(phone.page.locator("dialog[open]"), where).toHaveCount(0);
      await expect(phone.page.getByTestId("primary-colour"), where).toHaveCount(0);
      await expect(phone.page.getByTestId("wheel-done"), where).toHaveCount(0);
    }
  }
});

test("the block is full width above the bank in portrait, a column left of the bank under the bar in landscape (B-16 AC2)", async ({
  page,
  browser,
}) => {
  const phone = await paired(page, browser, PORTRAIT);
  const wheel = phone.page.getByTestId("wheel");
  const bank = phone.page.getByTestId("fader-bank");
  const scroll = phone.page.getByTestId("control-scroll");
  for (const mode of ["dj", "vj"] as const) {
    await phone.page.getByTestId(`mode-${mode}`).click();

    await phone.page.setViewportSize(PORTRAIT);
    await expect(phone.page.getByTestId("controller")).toHaveAttribute(
      "data-arrangement",
      "horizontal",
    );
    let w = await box(wheel);
    let b = await box(bank);
    let s = await box(scroll);
    expect(Math.round(w.x), mode).toBe(0);
    expect(Math.round(w.width), mode).toBe(320);
    expect(Math.round(w.y + w.height), mode).toBe(Math.round(b.y));
    expect(Math.round(s.y + s.height), mode).toBe(Math.round(w.y));

    await phone.page.setViewportSize(LANDSCAPE);
    await expect(phone.page.getByTestId("controller")).toHaveAttribute(
      "data-arrangement",
      "vertical",
    );
    w = await box(wheel);
    b = await box(bank);
    s = await box(scroll);
    const bar = await box(phone.page.getByTestId("status-bar"));
    expect(Math.round(w.x + w.width), mode).toBe(Math.round(b.x));
    expect(Math.round(w.y), mode).toBe(Math.round(bar.y + bar.height));
    expect(Math.round(s.x + s.width), mode).toBe(Math.round(w.x));
    expect(await inView(phone.page, wheel), mode).toBe(true);
  }
});

test("the disc is 150 px at the phone sizes and 240 px at the tablet sizes, DJ and VJ alike, the brightness fader as tall beside it (B-16 AC3)", async ({
  page,
  browser,
}) => {
  const phone = await paired(page, browser, PORTRAIT);
  for (const viewport of FIVE) {
    await phone.page.setViewportSize(viewport);
    const expected = Math.min(viewport.width, viewport.height) >= 768 ? 240 : 150;
    for (const mode of ["dj", "vj"] as const) {
      await phone.page.getByTestId(`mode-${mode}`).click();
      const where = `${viewport.width}×${viewport.height} ${mode}`;
      const disc = await box(phone.page.getByTestId("wheel-disc"));
      expect(Math.abs(disc.width - expected), `${where} disc ${disc.width}`).toBeLessThanOrEqual(1);
      expect(Math.abs(disc.height - expected), `${where} disc ${disc.height}`).toBeLessThanOrEqual(
        1,
      );
      const brightness = phone.page.getByTestId("wheel-brightness");
      await expect(brightness).toHaveAttribute("aria-orientation", "vertical");
      const fader = await box(brightness);
      expect(
        Math.abs(fader.height - disc.height),
        `${where} fader ${fader.height}`,
      ).toBeLessThanOrEqual(1);
      // Beside the disc: level with it, to its right.
      expect(Math.abs(fader.y - disc.y), where).toBeLessThanOrEqual(1);
      expect(fader.x, where).toBeGreaterThanOrEqual(disc.x + disc.width);
    }
  }
});

test("with two faders the block keeps to 180 px of height at 320×568 and 240 px of width at 568×320, the scrolling area keeping 180 and 190 (B-16 AC5)", async ({
  page,
  browser,
}) => {
  const phone = await paired(page, browser, PORTRAIT);
  const wheel = phone.page.getByTestId("wheel");
  const scroll = phone.page.getByTestId("control-scroll");
  await expect(phone.page.getByTestId("fader-bank").getByRole("slider")).toHaveCount(2);
  for (const mode of ["dj", "vj"] as const) {
    await phone.page.getByTestId(`mode-${mode}`).click();
    await phone.page.setViewportSize(PORTRAIT);
    await expect(phone.page.getByTestId("controller")).toHaveAttribute(
      "data-arrangement",
      "horizontal",
    );
    expect((await box(wheel)).height, `${mode} block height`).toBeLessThanOrEqual(180);
    expect((await box(scroll)).height, `${mode} scroll height`).toBeGreaterThanOrEqual(180);
    await phone.page.setViewportSize(LANDSCAPE);
    await expect(phone.page.getByTestId("controller")).toHaveAttribute(
      "data-arrangement",
      "vertical",
    );
    expect((await box(wheel)).width, `${mode} block width`).toBeLessThanOrEqual(240);
    expect((await box(scroll)).width, `${mode} scroll width`).toBeGreaterThanOrEqual(190);
  }
});

// ---- B-18 T5 (spec SD9, AC18): a real profile with a DJ tick puts three faders in the bank; with
// VJ ticks too, the Effects section sits in the scrolling area in VJ mode. ----

test("with a DJ tick, the three-fader bank keeps its budget at five sizes, DJ and VJ: the bank, the scrolling area, everything pinned in view, no sideways scroll, 48×48 targets (B-18 AC18)", async ({
  page,
  browser,
}) => {
  const twelve = twelveEffects();
  const effects = twelve.effects.map((effect, i) =>
    i === 2 ? { ...effect, dj: true } : i < 7 ? { ...effect, vj: true } : effect,
  );
  const ticked = await createProfile(api, {
    ...twelve,
    name: "A very long profile name with a DJ fader that wraps",
    effects,
  });
  const phone = await paired(page, browser, PORTRAIT);
  const tile = phone.page.locator(`[data-testid=profile-tile][data-profile-id="${ticked.id}"]`);
  await tile.click();
  await expect(tile).toHaveAttribute("aria-pressed", "true");
  const bank = phone.page.getByTestId("fader-bank");
  const scroll = phone.page.getByTestId("control-scroll");
  const problems: string[] = [];
  for (const viewport of FIVE) {
    await phone.page.setViewportSize(viewport);
    for (const mode of ["dj", "vj"] as const) {
      await phone.page.getByTestId(`mode-${mode}`).click();
      await expect(phone.page.getByTestId(`mode-${mode}`)).toHaveAttribute("aria-pressed", "true");
      const where = `${viewport.width}×${viewport.height} ${mode}`;
      await expect(bank.getByRole("slider"), where).toHaveCount(3);
      await expect(phone.page.getByTestId("effects"), where).toHaveCount(mode === "vj" ? 1 : 0);
      for (const p of await fitProblems(phone.page)) problems.push(`${where}: ${p}`);
      for (const end of ["start", "end"] as const) {
        await scroll.evaluate((el, top) => (el.scrollTop = top), end === "start" ? 0 : 1e6);
        for (const id of ["status-bar", "wheel", "fader-bank"]) {
          if (!(await inView(phone.page, phone.page.getByTestId(id)))) {
            problems.push(`${where}: ${id} not in view at the ${end}`);
          }
        }
      }
      if (viewport === PORTRAIT) {
        const b = await box(bank);
        const s = await box(scroll);
        if (b.height > 216 + 1) problems.push(`${where}: bank ${b.height} tall`);
        if (s.height < 130) problems.push(`${where}: scrolling area ${s.height} tall`);
      }
      if (viewport === LANDSCAPE) {
        const b = await box(bank);
        const s = await box(scroll);
        if (b.width > 198 + 1) problems.push(`${where}: bank ${b.width} wide`);
        if (s.width < 130) problems.push(`${where}: scrolling area ${s.width} wide`);
      }
    }
  }
  expect(problems).toEqual([]);
});

test("in DJ mode the wheel aims at the primary slot and says so: Colour 2 · primary on the built-in (B-16 AC9)", async ({
  page,
  browser,
}) => {
  const phone = await paired(page, browser, PORTRAIT);
  await expect(phone.page.getByTestId("mode-dj")).toHaveAttribute("aria-pressed", "true");
  await expect(phone.page.getByTestId("wheel")).toHaveAttribute("data-slot", "1");
  await expect(phone.page.getByTestId("wheel-label")).toHaveText("Colour 2 · primary");
});

// B-07 T9 (AC35; plan PD18 g): VJ mode with a staged look and three scenes keeps the brief at the
// five sizes: no sideways scroll, every target at least 48×48, the colour block and the bank
// still pinned. The Scenes section's height at each size is recorded for the brief's Budget.
test("at five sizes, the Scenes section with a staged look and three scenes keeps the layout (B-07 AC35)", async ({
  page,
  browser,
}) => {
  const phone = await paired(page, browser, PORTRAIT);
  await phone.page.getByTestId("mode-vj").click();
  await phone.page.getByTestId("stage-live").click();
  for (const name of ["Warm crowd", "Booth abstract", "Dock"]) {
    await phone.page.getByTestId("scene-name").fill(name);
    await phone.page.getByTestId(/^scene-save(-new)?$/).click();
    await expect(phone.page.locator("[data-testid=scene-tile]", { hasText: name })).toBeVisible();
  }
  const heights: string[] = [];
  for (const viewport of FIVE) {
    await phone.page.setViewportSize(viewport);
    const where = `${viewport.width}×${viewport.height}`;
    expect(await fitProblems(phone.page), where).toEqual([]);
    expect(await inView(phone.page, phone.page.getByTestId("fader-bank")), where).toBe(true);
    expect(await inView(phone.page, phone.page.getByTestId("wheel")), where).toBe(true);
    const section = await box(phone.page.getByRole("region", { name: "Scenes" }));
    heights.push(`${where}: ${Math.round(section.width)}×${Math.round(section.height)}`);
  }
  test.info().annotations.push({ type: "scenes section", description: heights.join("; ") });
  console.log(`scenes section: ${heights.join("; ")}`);
});
