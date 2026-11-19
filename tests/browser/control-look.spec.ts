// B-19 T6 (spec SD4, SD10, SD11, AC16, AC17, AC19, AC21; plan PD10, PD11): the pinned status bar
// on a real `/control` — its colour by the link's group, its text at least 4.5:1 on it — and DJ
// mode's waiting badge in it, against the in-process server.
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Locator,
  type Page,
} from "@playwright/test";
import { contrast } from "../contrast.ts";
import { LAN_CONTEXT, startControlServer, type ControlServer } from "./control-server.ts";

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

type SocketWindow = { __sockets: WebSocket[] };

async function screen(page: Page): Promise<string> {
  await page.goto(`${server.origin}/`);
  await page.getByTestId("control-switch").click();
  await expect(page.getByTestId("control-switch")).toBeChecked();
  return (await page.getByTestId("control-url").textContent())!;
}

async function open(browser: Browser, url: string, options: BrowserContextOptions = {}) {
  const context = await browser.newContext({ viewport: PHONE, ...LAN_CONTEXT, ...options });
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
  await phone.context().setOffline(true);
  await phone.evaluate(() =>
    (window as unknown as SocketWindow).__sockets.forEach((ws) => ws.close()),
  );
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
