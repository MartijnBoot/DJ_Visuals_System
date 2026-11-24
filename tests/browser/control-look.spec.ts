// B-19 T6, T7 (spec SD4, SD8, SD10, SD11, AC11, AC16, AC17, AC19, AC20, AC21; plan PD10, PD11):
// the look of a real `/control` against the in-process server — the pinned status bar coloured by
// the link's group with its text at least 4.5:1 on it, DJ mode's waiting badge in it, the active
// choices marked by more than colour, a focus ring on every control, and the wheel by keyboard.
import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Locator,
  type Page,
} from "@playwright/test";
import { contrast } from "../contrast.ts";
import { LAN_CONTEXT, startControlServer, type ControlServer } from "./control-server.ts";
import { createProfile, flat } from "./fixtures/profiles.ts";
import { start } from "./helpers.ts";
import { remote, type Remote } from "./remote-fixtures.ts";
import { dropNetwork, keepSockets } from "./sockets.ts";

const PHONE = { width: 320, height: 568 };

let server: ControlServer;
let api: APIRequestContext;
let r: Remote;
const contexts: BrowserContext[] = [];

test.beforeEach(async ({ playwright }) => {
  server = await startControlServer();
  api = await playwright.request.newContext({ baseURL: server.origin });
  r = remote(server);
});

test.afterEach(async () => {
  for (const c of contexts.splice(0)) await c.close();
  await r.dispose();
  await api.dispose();
  await server.dispose();
});

async function screen(page: Page): Promise<string> {
  await page.goto(`${server.origin}/`);
  await page.getByTestId("control-switch").click();
  await expect(page.getByTestId("control-switch")).toBeChecked();
  return (await page.getByTestId("control-url").textContent())!;
}

async function open(browser: Browser, url: string, options: BrowserContextOptions = {}) {
  const context = await browser.newContext({ viewport: PHONE, ...LAN_CONTEXT, ...options });
  contexts.push(context);
  await keepSockets(context);
  const phone = await context.newPage();
  await phone.goto(url);
  return phone;
}

/** The bar's group, and its text's contrast against the bar's computed colour. */
async function barReads(phone: Page) {
  const bar = phone.getByTestId("status-bar");
  const background = await bar.evaluate((el) => getComputedStyle(el).backgroundColor);
  const colour = await phone.getByTestId("link-line").evaluate((el) => getComputedStyle(el).color);
  return {
    group: await bar.getAttribute("data-link-group"),
    ratio: contrast(colour, background),
  };
}

async function expectBar(phone: Page, text: string, group: string) {
  await expect(phone.getByTestId("link-line")).toHaveText(text);
  // The link line stays inside the bar (D-10's watcher reads it there).
  await expect(phone.getByTestId("status-bar").getByTestId("link-line")).toHaveCount(1);
  const reads = await barReads(phone);
  expect(reads.group, text).toBe(group);
  expect(reads.ratio, text).toBeGreaterThanOrEqual(4.5);
}

test("the status bar takes its group's colour, the text always shown and legible on it (AC17)", async ({
  page,
  browser,
}) => {
  const url = await screen(page);
  const phone = await open(browser, url);
  await expectBar(phone, "Waiting for approval", "attention");
  await page.getByTestId("control-accept").click();
  await expectBar(phone, "Connected", "ok");

  // A Wi-Fi drop: Reconnecting…, attention.
  await dropNetwork(phone);
  await expectBar(phone, "Reconnecting…", "attention");
  await phone.context().setOffline(false);
  await expectBar(phone, "Connected", "ok");

  // External control switched off ends the pairing: stop.
  await page.getByTestId("control-switch").click();
  await expectBar(phone, "Pairing ended — scan the code again", "stop");

  // A wrong code: stop.
  await page.getByTestId("control-switch").click();
  await expect(page.getByTestId("control-switch")).toBeChecked();
  const code = (await page.getByTestId("control-code").textContent())!;
  const typing = await open(browser, `${server.lanOrigin}/control`);
  await expectBar(typing, "Scan the code on the screen machine", "attention");
  await typing.getByTestId("code-input").fill(code === "222222" ? "333333" : "222222");
  await typing.getByTestId("code-submit").click();
  await expectBar(typing, "Wrong code", "stop");
});

/** PD9's clones, as in control-layout.spec.ts: two copies of the bank's last fader. */
const cloneFaders = (phone: Page) =>
  phone.evaluate(() => {
    const row = document.querySelector("[data-testid=fader-bank] .djv-bank-faders")!;
    for (let i = 0; i < 2; i++) {
      const copy = row.lastElementChild!.cloneNode(true) as HTMLElement;
      copy.dataset.clone = "true";
      copy.querySelector("[data-testid]")?.setAttribute("data-testid", `clone-${i}`);
      row.append(copy);
    }
  });

const inView = async (phone: Page, locator: Locator) => {
  const b = (await locator.boundingBox())!;
  const { width, height } = phone.viewportSize()!;
  return (
    b.x >= -0.5 && b.y >= -0.5 && b.x + b.width <= width + 0.5 && b.y + b.height <= height + 0.5
  );
};

test("in DJ mode the waiting badge is in the status bar, opens the approvals and Accept approves (AC19, AC16, AC21)", async ({
  page,
  browser,
}) => {
  const url = await screen(page);
  const phone = await open(browser, url);
  await page.getByTestId("control-accept").click();
  await expect(phone.getByTestId("link-line")).toHaveText("Connected");
  await expect(phone.getByTestId("mode-dj")).toHaveAttribute("aria-pressed", "true");
  const second = await open(browser, url);
  await expect(second.getByTestId("link-line")).toHaveText("Waiting for approval");

  const bar = phone.getByTestId("status-bar");
  const badge = bar.getByTestId("waiting-badge");
  await expect(badge).toHaveText("1 waiting");
  expect(await inView(phone, badge)).toBe(true);

  // Its focus ring stays on screen at the bar's top right corner, 3:1 against what it lands on.
  for (let i = 0; i < 20 && !(await badge.evaluate((el) => el === document.activeElement)); i++) {
    await phone.keyboard.press("Tab");
  }
  await expect(badge).toBeFocused();
  const ring = await badge.evaluate((el) => {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const reach = parseFloat(s.outlineOffset) + parseFloat(s.outlineWidth);
    return {
      style: s.outlineStyle,
      colour: s.outlineColor,
      reach,
      top: r.top - reach,
      right: r.right + reach,
      inside: reach <= 0 ? s.backgroundColor : getComputedStyle(el.parentElement!).backgroundColor,
      width: window.innerWidth,
    };
  });
  expect(ring.style).toBe("solid");
  expect(ring.top).toBeGreaterThanOrEqual(0);
  expect(ring.right).toBeLessThanOrEqual(ring.width);
  expect(contrast(ring.colour, ring.inside)).toBeGreaterThanOrEqual(3);

  // The longest status text beside the badge wraps the bar; the four-fader bank still fits.
  const line = phone.getByTestId("link-line");
  await line.evaluate((el) => (el.textContent = "Too many wrong codes — try again in a minute"));
  await cloneFaders(phone);
  const bank = phone.getByTestId("fader-bank");
  expect((await bank.boundingBox())!.height).toBeLessThanOrEqual(284);
  expect(await inView(phone, bank)).toBe(true);
  expect(await inView(phone, bar)).toBe(true);
  expect(await inView(phone, badge)).toBe(true);
  expect((await badge.boundingBox())!.width).toBeGreaterThanOrEqual(48);
  const sideways = await phone
    .getByTestId("controller")
    .evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(sideways).toBe(false);
  await phone.evaluate(() => document.querySelectorAll("[data-clone]").forEach((c) => c.remove()));
  await line.evaluate((el) => (el.textContent = "Connected"));

  await badge.click();
  await expect(phone.getByRole("dialog", { name: "Devices waiting for approval" })).toBeVisible();
  await phone.getByTestId("approve").click();
  await expect(second.getByTestId("profile-tile").first()).toBeEnabled();
  await expect(phone.getByTestId("waiting-badge")).toHaveCount(0);
});

/**
 * A started screen with two profiles, a remote sender of video and audio (so main audio and a
 * second camera tile show) and a real `/control` paired from the panel, in VJ mode.
 */
async function everything(page: Page, browser: Browser): Promise<Page> {
  await createProfile(api, flat("Second", "#336699"));
  const { code, url } = await r.screen(page);
  await r.pairedSender(page, code, ["video", "audio"]);
  const phone = await r.phone(page, browser, url);
  await start(page);
  await expect(phone.getByTestId("main-audio")).toBeVisible();
  await expect(phone.getByTestId("camera-tile")).toHaveCount(2, { timeout: 20_000 });
  await expect(phone.getByTestId("camera-tile").first()).toBeEnabled();
  await phone.getByTestId("mode-vj").click();
  return phone;
}

const look = (locator: Locator) =>
  locator.evaluate((el) => {
    const s = getComputedStyle(el);
    return { border: s.borderTopWidth, weight: s.fontWeight, background: s.backgroundColor };
  });

test("the active profile, camera, mode, main audio and transition are marked by more than colour, the mark 3:1 against an inactive tile (AC20)", async ({
  page,
  browser,
}) => {
  const phone = await everything(page, browser);
  const groups: [string, Locator][] = [
    ["profile", phone.getByTestId("profile-tile")],
    ["camera", phone.getByTestId("camera-tile")],
    ["mode", phone.getByRole("group", { name: "Mode" }).getByRole("button")],
    ["main audio", phone.getByTestId("main-audio").getByRole("button")],
    // B-09 T7: the transition type tiles.
    ["transition", phone.getByRole("region", { name: "Transition" }).locator(".djv-tile")],
  ];
  for (const [name, all] of groups) {
    const active = all.and(phone.locator('[aria-pressed="true"]'));
    const inactive = all.and(phone.locator('[aria-pressed="false"]')).first();
    await expect(active, name).toHaveCount(1);
    const lit = await look(active);
    const rest = await look(inactive);
    // More than colour: the edge is three times heavier and the type heavier (the brief).
    expect(lit.border, name).toBe("3px");
    expect(rest.border, name).toBe("1px");
    expect(Number(lit.weight), name).toBeGreaterThan(Number(rest.weight));
    expect(contrast(lit.background, rest.background), name).toBeGreaterThanOrEqual(3);
  }
});

/** What the focused element shows: its ring, and the colour the ring lands on. */
const focusRing = (phone: Page) =>
  phone.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    const s = getComputedStyle(el);
    const opaque = (c: string) => c !== "transparent" && !/rgba\(.*,\s*0\)$/.test(c);
    const reach = parseFloat(s.outlineOffset) + parseFloat(s.outlineWidth);
    // A ring drawn inside lands on the element; one outside on what is behind it.
    let behind: Element | null = reach <= 0 ? el : el.parentElement;
    let background = "rgb(0, 0, 0)";
    while (behind) {
      const c = getComputedStyle(behind).backgroundColor;
      if (opaque(c)) {
        background = c;
        break;
      }
      behind = behind.parentElement;
    }
    return {
      what: el.dataset.testid ?? el.getAttribute("aria-label") ?? el.textContent?.slice(0, 30),
      style: s.outlineStyle,
      width: parseFloat(s.outlineWidth),
      colour: s.outlineColor,
      background,
    };
  });

type Ring = NonNullable<Awaited<ReturnType<typeof focusRing>>>;

/** Tabs forward until the focus comes round again; every element it rested on, in order. */
async function tabThrough(phone: Page, max: number): Promise<Ring[]> {
  const seen: Ring[] = [];
  for (let i = 0; i < max; i++) {
    await phone.keyboard.press("Tab");
    const ring = await focusRing(phone);
    if (!ring) continue;
    const index = await phone.evaluate(() => {
      const w = window as unknown as { __tabbed?: Element[] };
      w.__tabbed ??= [];
      const at = w.__tabbed.indexOf(document.activeElement!);
      if (at < 0) w.__tabbed.push(document.activeElement!);
      return at;
    });
    if (index >= 0) break;
    seen.push(ring);
  }
  await phone.evaluate(() => delete (window as unknown as { __tabbed?: Element[] }).__tabbed);
  return seen;
}

test("every control shows a focus ring 3:1 against its surroundings, the wheel's too (AC21)", async ({
  page,
  browser,
}) => {
  const phone = await everything(page, browser);
  const seen = await tabThrough(phone, 80);
  expect(seen.map((s) => s.what)).toEqual(
    expect.arrayContaining([
      "mode-dj",
      "profile-tile",
      "refresh",
      "camera-tile",
      "main-audio-remote",
      "primary-colour",
      "swatch",
      "dial-recognisability",
      "dial-reactivity",
    ]),
  );
  for (const ring of seen) {
    expect(ring.style, ring.what).toBe("solid");
    expect(ring.width, ring.what).toBeGreaterThanOrEqual(2);
    expect(contrast(ring.colour, ring.background), ring.what).toBeGreaterThanOrEqual(3);
  }

  await phone.locator('[data-testid=swatch][data-slot="0"]').click();
  await expect(phone.getByTestId("wheel")).toBeVisible();
  const inWheel = await tabThrough(phone, 12);
  expect(inWheel.map((s) => s.what)).toEqual(
    expect.arrayContaining(["wheel-disc", "wheel-brightness", "wheel-reset", "wheel-done"]),
  );
  for (const ring of inWheel) {
    expect(ring.style, ring.what).toBe("solid");
    expect(contrast(ring.colour, ring.background), ring.what).toBeGreaterThanOrEqual(3);
  }
});

test("the wheel works by keyboard alone: disc, brightness, Reset and Done as before (AC11)", async ({
  page,
  browser,
}) => {
  const phone = await everything(page, browser);
  const swatch = phone.locator('[data-testid=swatch][data-slot="1"]');
  const stored = (await swatch.getAttribute("data-colour"))!;
  await swatch.focus();
  await phone.keyboard.press("Enter");
  await expect(phone.getByTestId("wheel")).toHaveAttribute("data-slot", "1");
  const current = phone.getByTestId("wheel-current");
  const focusOn = async (id: string) => {
    for (let i = 0; i < 12; i++) {
      if (await phone.getByTestId(id).evaluate((el) => el === document.activeElement)) return;
      await phone.keyboard.press("Tab");
    }
    await expect(phone.getByTestId(id)).toBeFocused();
  };
  await focusOn("wheel-disc");
  for (let i = 0; i < 6; i++) await phone.keyboard.press("ArrowUp"); // more saturation
  await phone.keyboard.press("ArrowRight"); // another hue
  await expect(current).not.toHaveAttribute("data-colour", stored);
  const disc = (await current.getAttribute("data-colour"))!;
  await focusOn("wheel-brightness");
  await phone.keyboard.press("PageDown");
  await expect(current).not.toHaveAttribute("data-colour", disc);
  await expect(swatch).toHaveAttribute("data-colour", (await current.getAttribute("data-colour"))!);
  await focusOn("wheel-reset");
  await phone.keyboard.press("Enter");
  await expect(current).toHaveAttribute("data-colour", stored);
  await expect(swatch).toHaveAttribute("data-colour", stored);
  await focusOn("wheel-done");
  await phone.keyboard.press("Enter");
  await expect(phone.getByTestId("wheel")).toHaveCount(0);
});
