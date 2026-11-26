// B-07 T9 (SD4, SD9, SD10, SD11, AC9, AC12, AC21, AC22, AC35, AC36; plan PD18, PD20): the Scenes
// section on a real paired /control against the in-process server and a real screen page.
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { LAN_CONTEXT, startControlServer, type ControlServer } from "./control-server.ts";
import { dropNetwork, keepSockets, recordSends, sentFrames } from "./sockets.ts";

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

async function screen(page: Page): Promise<string> {
  await page.goto(`${server.origin}/`);
  await page.getByTestId("control-switch").click();
  await expect(page.getByTestId("control-switch")).toBeChecked();
  return (await page.getByTestId("control-url").textContent())!;
}

async function paired(page: Page, browser: Browser, url: string): Promise<Page> {
  const context = await browser.newContext({ viewport: PHONE, ...LAN_CONTEXT });
  contexts.push(context);
  await keepSockets(context);
  await recordSends(context);
  const phone = await context.newPage();
  await phone.goto(url);
  await expect(phone.getByTestId("link-line")).toHaveText("Waiting for approval");
  await page.getByTestId("control-accept").click();
  await expect(phone.getByTestId("profile-tile").first()).toBeEnabled();
  await phone.getByTestId("mode-vj").click();
  return phone;
}

const section = (phone: Page) => phone.getByRole("region", { name: "Scenes" });
const sentOf = async (phone: Page, type: string) =>
  (await sentFrames(phone)).map((f) => f.message).filter((m) => m.type === type);

async function stageFromLive(phone: Page) {
  await phone.getByTestId("stage-live").click();
  await expect(phone.getByTestId("editing-staged")).toHaveAttribute("aria-pressed", "true");
}

async function save(phone: Page, name: string, key = "scene-save") {
  await phone.getByTestId("scene-name").fill(name);
  await phone.getByTestId(key).click();
  await expect(phone.locator(`[data-testid=scene-tile]`, { hasText: name })).toBeVisible();
}

const tile = (phone: Page, name: string): Locator =>
  phone.locator("[data-testid=scene-tile]", { hasText: name });

test("VJ mode shows the Scenes section first, with each element; DJ mode shows none (AC35)", async ({
  page,
  browser,
}) => {
  const phone = await paired(page, browser, await screen(page));
  const labels = await phone
    .locator("section[aria-label]")
    .evaluateAll((all) => all.map((s) => s.getAttribute("aria-label")));
  expect(labels[0]).toBe("Scenes");
  await expect(section(phone).getByRole("heading", { name: "Scenes" })).toBeVisible();
  await expect(phone.getByTestId("scenes-empty")).toHaveText("No scenes yet");
  await expect(phone.getByTestId("stage-live")).toBeEnabled();
  // No staged look: Go, Unstage and Save off, the switch hidden (UI States, AC12).
  await expect(phone.getByTestId("scene-go")).toBeDisabled();
  await expect(phone.getByTestId("scene-unstage")).toBeDisabled();
  await expect(phone.getByTestId("scene-save")).toBeDisabled();
  await expect(phone.getByTestId("editing-staged")).toHaveCount(0);

  await stageFromLive(phone);
  for (const id of [
    "editing-staged",
    "editing-live",
    "stage-live",
    "scene-go",
    "scene-unstage",
    "scene-name",
    "scene-save",
    "scene-rename",
    "scene-delete",
  ]) {
    await expect(section(phone).getByTestId(id), id).toBeVisible();
  }
  await phone.getByTestId("mode-dj").click();
  await expect(section(phone)).toHaveCount(0);
});

test("a staged look sets the switch to Staged; a profile tap sends target staged, Live sends none (AC9)", async ({
  page,
  browser,
}) => {
  const phone = await paired(page, browser, await screen(page));
  await stageFromLive(phone);
  await expect(phone.getByTestId("editing-note")).toHaveText(
    "The controls below edit the staged look",
  );
  const builtin = phone.getByTestId("profile-tile").first();
  await builtin.click();
  await expect
    .poll(async () => (await sentOf(phone, "pick")).at(-1))
    .toMatchObject({
      target: "staged",
    });
  await phone.getByTestId("editing-live").click();
  await expect(phone.getByTestId("editing-note")).toHaveText(
    "The controls below edit the live look",
  );
  await builtin.click();
  await expect.poll(async () => (await sentOf(phone, "pick")).length).toBe(2);
  expect((await sentOf(phone, "pick")).at(-1)).not.toHaveProperty("target");
  // DJ mode always edits the live look.
  await phone.getByTestId("mode-dj").click();
  await builtin.click();
  await expect.poll(async () => (await sentOf(phone, "pick")).length).toBe(3);
  expect((await sentOf(phone, "pick")).at(-1)).not.toHaveProperty("target");
});

test("Save lists the scene; its look offers Update and Save as new, only Save as new after Delete (AC21, AC22)", async ({
  page,
  browser,
}) => {
  const phone = await paired(page, browser, await screen(page));
  await stageFromLive(phone);
  await save(phone, "Warm crowd");
  await expect(tile(phone, "Warm crowd")).toHaveAttribute("aria-pressed", "true");
  await expect(phone.getByTestId("scene-update")).toHaveText("Update Warm crowd");
  await expect(phone.getByTestId("scene-save-new")).toHaveText("Save as new");
  await expect(phone.getByTestId("scene-save")).toHaveCount(0);

  // Delete asks first; Cancel sends nothing.
  await phone.getByTestId("scene-delete").click();
  const confirm = phone.getByRole("dialog", { name: "Delete scene" });
  await expect(confirm).toContainText("Delete Warm crowd?");
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toBeHidden();
  expect(await sentOf(phone, "deleteScene")).toEqual([]);
  await expect(tile(phone, "Warm crowd")).toBeVisible();

  await phone.getByTestId("scene-delete").click();
  await confirm.getByRole("button", { name: "Delete" }).click();
  await expect(tile(phone, "Warm crowd")).toHaveCount(0);
  await expect(phone.getByTestId("scene-update")).toHaveCount(0);
  await expect(phone.getByTestId("scene-save-new")).toHaveText("Save as new");
  // The screen's panel lists what the controller lists (SD9): nothing here.
  await expect(phone.getByTestId("scenes-empty")).toHaveText("No scenes yet");
});

test("a taken rename is refused with the reason (AC22)", async ({ page, browser }) => {
  const phone = await paired(page, browser, await screen(page));
  await stageFromLive(phone);
  await save(phone, "Booth");
  await stageFromLive(phone); // a fresh look, no scene: Save again
  await save(phone, "Warm crowd");
  await phone.getByTestId("scene-name").fill("booth");
  await phone.getByTestId("scene-rename").click();
  await expect(phone.getByTestId("scenes-reason")).toHaveText("That name is taken");
  await expect(tile(phone, "Warm crowd")).toBeVisible();
});

test("locked, nothing in the section sends; the switch stays live (AC36)", async ({
  page,
  browser,
}) => {
  const phone = await paired(page, browser, await screen(page));
  await stageFromLive(phone);
  await save(phone, "Warm crowd");
  await dropNetwork(phone);
  await expect(phone.getByTestId("link-line")).not.toHaveText("Connected");
  for (const id of ["stage-live", "scene-go", "scene-unstage", "scene-rename", "scene-delete"]) {
    await expect(phone.getByTestId(id), id).toBeDisabled();
  }
  await expect(phone.getByTestId("scene-update")).toBeDisabled();
  await expect(tile(phone, "Warm crowd")).toBeDisabled();
  await expect(phone.getByTestId("editing-live")).toBeEnabled();
  const before = (await sentFrames(phone)).length;
  await phone.getByTestId("editing-live").click();
  await expect(phone.getByTestId("editing-live")).toHaveAttribute("aria-pressed", "true");
  expect((await sentFrames(phone)).length).toBe(before);
});

test("the keyboard reaches every key; the staged tile is marked by more than colour (SD21, B-19 SD11)", async ({
  page,
  browser,
}) => {
  const phone = await paired(page, browser, await screen(page));
  await stageFromLive(phone);
  await save(phone, "Warm crowd");
  await save(phone, "Booth", "scene-save-new");
  const lit = tile(phone, "Booth");
  const rest = tile(phone, "Warm crowd");
  await expect(lit).toHaveAttribute("aria-pressed", "true");
  const look = (l: Locator) =>
    l.evaluate((el) => {
      const s = getComputedStyle(el);
      return { border: s.borderTopWidth, weight: s.fontWeight };
    });
  expect(await look(lit)).toEqual({ border: "3px", weight: "800" });
  expect(await look(rest)).toEqual({ border: "1px", weight: "600" });

  const wanted = [
    "editing-staged",
    "editing-live",
    "stage-live",
    "scene-go",
    "scene-unstage",
    "scene-name",
    "scene-update",
    "scene-save-new",
    "scene-rename",
    "scene-delete",
  ];
  const reached = new Set<string>();
  await phone.getByTestId("mode-vj").focus();
  for (let i = 0; i < 40 && reached.size < wanted.length + 2; i++) {
    await phone.keyboard.press("Tab");
    const id = await phone.evaluate(() => document.activeElement?.getAttribute("data-testid"));
    if (id) reached.add(id);
  }
  for (const id of [...wanted, "scene-tile"]) expect(reached, id).toContain(id);
});
