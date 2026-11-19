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
import { createProfile, twelveEffects } from "./fixtures/profiles.ts";

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

type SocketWindow = { __sockets: WebSocket[] };

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
  await context.addInitScript(() => {
    const Base = window.WebSocket;
    const all: WebSocket[] = [];
    (window as unknown as SocketWindow).__sockets = all;
    window.WebSocket = class extends Base {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        all.push(this);
      }
    };
  });
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
    async drop() {
      await context.setOffline(true);
      await phone.evaluate(() =>
        (window as unknown as SocketWindow).__sockets.forEach((ws) => ws.close()),
      );
    },
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

/** AC15: no horizontal scroll, and every visible target at least 48×48. */
async function fitProblems(phone: Page): Promise<string[]> {
  const problems: string[] = [];
  for (const id of ["controller", "control-scroll"]) {
    const { scrollWidth, clientWidth } = await phone
      .getByTestId(id)
      .evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
    if (scrollWidth > clientWidth)
      problems.push(`${id} scrolls sideways: ${scrollWidth} > ${clientWidth}`);
  }
  for (const target of await phone.locator("button, input, [role=slider]").all()) {
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

test("scrolled to its end, the status bar and the whole bank stay in view, DJ and VJ, both arrangements (AC13)", async ({
  page,
  browser,
}) => {
  await createProfile(api, twelveEffects());
  const phone = await paired(page, browser, PORTRAIT);
  for (const viewport of [PORTRAIT, LANDSCAPE]) {
    await phone.page.setViewportSize(viewport);
    for (const mode of ["dj", "vj"] as const) {
      await phone.page.getByTestId(`mode-${mode}`).click();
      await scrollToEnd(phone.page);
      const where = `${viewport.width}×${viewport.height} ${mode}`;
      expect(await inView(phone.page, phone.page.getByTestId("status-bar")), where).toBe(true);
      expect(await inView(phone.page, phone.page.getByTestId("fader-bank")), where).toBe(true);
      // Scrolled, something did move: the middle scrolls, not the page.
      expect(await phone.page.evaluate(() => document.scrollingElement!.scrollTop)).toBe(0);
    }
  }
});

test("turning the device re-lays the page out without a reload, keeping the mode, the link and the values (AC14)", async ({
  page,
  browser,
}) => {
  const phone = await paired(page, browser, PORTRAIT);
  await phone.page.getByTestId("mode-vj").click();
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
  await phone.page.setViewportSize(PORTRAIT);
  await expect(phone.page.getByTestId("controller")).toHaveAttribute(
    "data-arrangement",
    "horizontal",
  );
  await expect(phone.page.getByTestId("mode-vj")).toHaveAttribute("aria-pressed", "true");
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

test("four faders fit the budget: half the height at 320×568, half the width at 568×320 (AC16)", async ({
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
    expect(await fitProblems(phone.page)).toEqual([]);
    expect(await inView(phone.page, bank)).toBe(true);
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
