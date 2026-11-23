// B-09 T8 (spec SD8, SD9, AC19, AC24; plan PD14, PD19): the `s` panel's transition, duration and
// keep colour rows against the in-process server — remembered under `djv.transition` across a
// reload, the default for anything that does not validate, and each change mirrored to a paired
// controller in the next state.
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type { ScreenState } from "../../shared/src/control.ts";
import {
  deviceClient,
  LAN_CONTEXT,
  startControlServer,
  type ControlServer,
  type DeviceClient,
} from "./control-server.ts";

let server: ControlServer;
const contexts: BrowserContext[] = [];

test.beforeEach(async () => {
  server = await startControlServer();
});

test.afterEach(async () => {
  for (const c of contexts.splice(0)) await c.close();
  await server.dispose();
});

const kind = (page: Page) => page.getByTestId("transition-kind");
const duration = (page: Page) => page.getByTestId("transition-duration");
const readout = (page: Page) => page.getByTestId("transition-duration-readout");
const keep = (page: Page) => page.getByTestId("transition-keep-colour");

async function expectChoice(page: Page, choice: string, seconds: string, keepColour: boolean) {
  await expect(kind(page)).toHaveValue(choice);
  await expect(readout(page)).toHaveText(seconds);
  if (keepColour) await expect(keep(page)).toBeChecked();
  else await expect(keep(page)).not.toBeChecked();
}

test("a fresh page shows Cut, 2.0 s and Keep colour off, the slider off for Cut (AC19)", async ({
  page,
}) => {
  await page.goto(`${server.origin}/`);
  await expectChoice(page, "cut", "2.0 s", false);
  await expect(duration(page)).toBeDisabled();
  await expect(kind(page).locator("option")).toHaveText([
    "Cut",
    "Crossfade",
    "Dissolve",
    "Wipe",
    "Beat cut",
    "Dip to colour",
  ]);
});

test("the choice is remembered across a reload (AC19)", async ({ page }) => {
  await page.goto(`${server.origin}/`);
  await kind(page).selectOption("dissolve");
  await expect(duration(page)).toBeEnabled();
  await duration(page).focus();
  await page.keyboard.press("End");
  await expect(readout(page)).toHaveText("8.0 s");
  await keep(page).check();
  await page.reload();
  await expectChoice(page, "dissolve", "8.0 s", true);
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem("djv.transition")))!)).toEqual({
    kind: "dissolve",
    duration: 8,
    keepColour: true,
  });
});

test("a remembered value that does not validate loads as Cut, 2.0 s, off (AC19)", async ({
  page,
}) => {
  await page.goto(`${server.origin}/`);
  await page.evaluate(() => localStorage.setItem("djv.transition", '{"kind":"zoom"}'));
  await page.reload();
  await expectChoice(page, "cut", "2.0 s", false);
});

test("the slider is off for Cut and Beat cut and on for the four others (SD6)", async ({
  page,
}) => {
  await page.goto(`${server.origin}/`);
  for (const [choice, on] of [
    ["crossfade", true],
    ["beatCut", false],
    ["dissolve", true],
    ["wipe", true],
    ["dip", true],
    ["cut", false],
  ] as const) {
    await kind(page).selectOption(choice);
    if (on) await expect(duration(page), choice).toBeEnabled();
    else await expect(duration(page), choice).toBeDisabled();
  }
});

/** A device paired to the page, speaking the socket directly. */
async function paired(page: Page): Promise<DeviceClient> {
  await page.getByTestId("control-switch").click();
  await expect(page.getByTestId("control-switch")).toBeChecked();
  const code = (await page.getByTestId("control-code").textContent())!;
  const context = await page.context().browser()!.newContext(LAN_CONTEXT);
  contexts.push(context);
  const device = await deviceClient(context, server);
  await device.send({ type: "hello", code });
  await page.getByTestId("control-accept").click();
  await device.waitFor("approved");
  return device;
}

/** The newest state a device has received. */
async function latest(device: DeviceClient): Promise<ScreenState["transition"] | undefined> {
  const states = (await device.messages()).filter((m) => m.type === "state");
  const last = states.at(-1);
  return last?.type === "state" ? last.state.transition : undefined;
}

test("each panel change reaches a paired controller in the next state (AC24)", async ({ page }) => {
  await page.goto(`${server.origin}/`);
  const device = await paired(page);
  await expect.poll(() => latest(device)).toEqual({ kind: "cut", duration: 2, keepColour: false });
  await kind(page).selectOption("wipe");
  await expect.poll(async () => (await latest(device))?.kind).toBe("wipe");
  await duration(page).focus();
  await page.keyboard.press("Home");
  await expect.poll(async () => (await latest(device))?.duration).toBe(0.5);
  await keep(page).check();
  await expect
    .poll(() => latest(device))
    .toEqual({ kind: "wipe", duration: 0.5, keepColour: true });
});
