// B-09 T7 (spec SD6, SD7, AC21, AC23; plan PD1, PD2, PD16, PD17): the Transition section on a real
// paired `/control` against the in-process server. The screen's choice is read where the screen
// keeps it, `djv.transition` on the screen page, which it saves on every change it applies.
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from "@playwright/test";
import { LAN_CONTEXT, startControlServer, type ControlServer } from "./control-server.ts";
import { dropNetwork, keepSockets } from "./sockets.ts";

const PHONE = { width: 320, height: 568 };
const KINDS = ["cut", "crossfade", "dissolve", "wipe", "beatCut", "dip"] as const;

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
  /** The `transition` frames this controller has sent so far. */
  sent(): unknown[];
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
      if (message.type === "transition") sent.push(message);
    }),
  );
  await phone.goto(url);
  await expect(phone.getByTestId("link-line")).toHaveText("Waiting for approval");
  await page.getByTestId("control-accept").click();
  await expect(phone.getByTestId("link-line")).toHaveText("Connected");
  await phone.getByTestId("mode-vj").click();
  await expect(phone.getByTestId("transition-cut")).toBeEnabled();
  return { page: phone, sent: () => [...sent] };
}

/** The screen's current choice, as it saved it. */
const screenChoice = (page: Page) =>
  page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("djv.transition") ?? "null") as {
        kind: string;
        duration: number;
        keepColour: boolean;
      } | null,
  );

test("VJ mode shows the Transition section under Profiles: Cut pressed, 2.0 s, the fader off (AC21)", async ({
  page,
  browser,
}) => {
  const phone = (await paired(page, browser, await screen(page))).page;
  const sections = await phone
    .locator("section[aria-label]")
    .evaluateAll((all) => all.map((s) => s.getAttribute("aria-label")));
  expect(sections.slice(0, 2)).toEqual(["Profiles", "Transition"]);
  const section = phone.getByRole("region", { name: "Transition" });
  await expect(section.getByRole("heading", { name: "Transition" })).toBeVisible();
  for (const kind of KINDS) {
    await expect(phone.getByTestId(`transition-${kind}`)).toHaveAttribute(
      "aria-pressed",
      kind === "cut" ? "true" : "false",
    );
  }
  await expect(section.getByRole("button")).toHaveText([
    "Cut",
    "Crossfade",
    "Dissolve",
    "Wipe",
    "Beat cut",
    "Dip to colour",
    "Keep colour",
  ]);
  const fader = phone.getByTestId("transition-duration");
  await expect(phone.getByTestId("transition-duration-readout")).toHaveText("2.0 s");
  await expect(fader).toHaveAttribute("aria-valuetext", "2.0 s");
  await expect(fader).toHaveAttribute("aria-disabled", "true");
  await expect(phone.getByTestId("transition-keep-colour")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});

test("a type tile, the duration fader by keys and Keep colour each reach the screen (AC21)", async ({
  page,
  browser,
}) => {
  const phone = (await paired(page, browser, await screen(page))).page;
  const fader = phone.getByTestId("transition-duration");
  const readout = phone.getByTestId("transition-duration-readout");

  await phone.getByTestId("transition-crossfade").click();
  await expect(phone.getByTestId("transition-crossfade")).toHaveAttribute("aria-pressed", "true");
  await expect(phone.getByTestId("transition-cut")).toHaveAttribute("aria-pressed", "false");
  await expect(fader).toHaveAttribute("aria-disabled", "false");
  await expect.poll(async () => (await screenChoice(page))?.kind).toBe("crossfade");

  await fader.focus();
  await fader.press("Home");
  await expect(readout).toHaveText("0.5 s");
  await expect.poll(async () => (await screenChoice(page))?.duration).toBe(0.5);
  await fader.press("End");
  await expect(readout).toHaveText("8.0 s");
  await expect.poll(async () => (await screenChoice(page))?.duration).toBe(8);
  for (let i = 0; i < 5; i++) {
    const before = await fader.getAttribute("aria-valuenow");
    await fader.press("PageDown");
    await expect(fader).not.toHaveAttribute("aria-valuenow", before!);
  }
  await expect(readout).toHaveText("2.0 s");
  await expect.poll(async () => (await screenChoice(page))?.duration).toBeCloseTo(2, 6);

  await phone.getByTestId("transition-beatCut").click();
  await expect(fader).toHaveAttribute("aria-disabled", "true");
  await expect.poll(async () => (await screenChoice(page))?.kind).toBe("beatCut");

  const keep = phone.getByTestId("transition-keep-colour");
  await keep.click();
  await expect(keep).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await screenChoice(page))?.keepColour).toBe(true);
  await keep.click();
  await expect(keep).toHaveAttribute("aria-pressed", "false");
  await expect.poll(async () => (await screenChoice(page))?.keepColour).toBe(false);
});

for (const viewport of [PHONE, { width: 568, height: 320 }]) {
  test(`every target in the section is at least 48×48 and nothing scrolls sideways at ${viewport.width}×${viewport.height} (AC21)`, async ({
    page,
    browser,
  }) => {
    const phone = (await paired(page, browser, await screen(page), { viewport })).page;
    const section = phone.getByRole("region", { name: "Transition" });
    const targets = section.locator('button, [role="slider"]');
    await expect(targets).toHaveCount(8);
    for (const box of await targets.evaluateAll((all) =>
      all.map((el) => {
        const r = el.getBoundingClientRect();
        return { what: el.getAttribute("data-testid"), width: r.width, height: r.height };
      }),
    )) {
      expect(box.width, box.what!).toBeGreaterThanOrEqual(48);
      expect(box.height, box.what!).toBeGreaterThanOrEqual(48);
    }
    const scroll = phone.getByTestId("control-scroll");
    const fits = await scroll.evaluate((el) => el.scrollWidth <= el.clientWidth);
    expect(fits).toBe(true);
    const whole = await phone.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    );
    expect(whole).toBe(true);
  });
}

test("while the link is down the section is locked and a tap sends nothing (AC23)", async ({
  page,
  browser,
}) => {
  const phone = await paired(page, browser, await screen(page));
  await phone.page.getByTestId("transition-crossfade").click();
  await expect(phone.page.getByTestId("transition-duration")).toHaveAttribute(
    "aria-disabled",
    "false",
  );
  const before = phone.sent().length;
  await dropNetwork(phone.page);
  await expect(phone.page.getByTestId("link-line")).not.toHaveText("Connected");
  for (const kind of KINDS)
    await expect(phone.page.getByTestId(`transition-${kind}`)).toBeDisabled();
  await expect(phone.page.getByTestId("transition-keep-colour")).toBeDisabled();
  const fader = phone.page.getByTestId("transition-duration");
  await expect(fader).toHaveAttribute("aria-disabled", "true");
  await phone.page.getByTestId("transition-wipe").click({ force: true });
  await phone.page.getByTestId("transition-keep-colour").click({ force: true });
  await fader.focus();
  await fader.press("End");
  await phone.page.waitForTimeout(300);
  expect(phone.sent()).toHaveLength(before);
});

test("DJ mode shows no transition control (AC22)", async ({ page, browser }) => {
  const phone = (await paired(page, browser, await screen(page))).page;
  await phone.getByTestId("mode-dj").click();
  await expect(phone.getByRole("region", { name: "Transition" })).toHaveCount(0);
  for (const kind of KINDS) await expect(phone.getByTestId(`transition-${kind}`)).toHaveCount(0);
  await expect(phone.getByTestId("transition-duration")).toHaveCount(0);
  await expect(phone.getByTestId("transition-keep-colour")).toHaveCount(0);
});
