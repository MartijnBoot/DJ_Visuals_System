// B-07 T10 (SD8, SD9, SD10, AC6, AC22, AC25; plan PD9, PD19): the panel's scene row on the real
// screen page against the in-process server. Scenes are saved by a device on the socket directly
// (the panel has no Save, SD10); everything else is done from the panel: Stage, Go, Rename through
// a prompt, Delete through a confirm, Export and Import.
import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  deviceClient,
  LAN_CONTEXT,
  startControlServer,
  type ControlServer,
  type DeviceClient,
} from "./control-server.ts";
import { BLUE_RGB, blue, createProfile, red, RED_RGB, type Stored } from "./fixtures/profiles.ts";
import { near, patch } from "./helpers.ts";
import { stateWhere } from "./remote-fixtures.ts";

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

interface Rig {
  device: DeviceClient;
  red: Stored;
  blue: Stored;
  /** Sends a control and waits for its acknowledgement. */
  control(message: Record<string, unknown>): Promise<void>;
}

/** The screen with External control on, one approved device, a red and a blue profile. */
async function rig(page: Page): Promise<Rig> {
  const profiles = { red: await createProfile(api, red()), blue: await createProfile(api, blue()) };
  await page.goto(`${server.origin}/`);
  await page.getByTestId("control-switch").click();
  await expect(page.getByTestId("control-switch")).toBeChecked();
  const code = (await page.getByTestId("control-code").textContent())!;
  const context = await page
    .context()
    .browser()!
    .newContext({ ...LAN_CONTEXT });
  contexts.push(context);
  const device = await deviceClient(context, server);
  await device.send({ type: "hello", code });
  await device.waitFor("waiting");
  await page.getByTestId("control-accept").click();
  await device.waitFor("approved");
  await stateWhere(device, (s) => s.profiles.some((p) => p.id === profiles.blue.id));
  let seq = 0;
  const control = async (message: Record<string, unknown>) => {
    const mine = ++seq;
    await device.send({ ...message, seq: mine });
    await expect
      .poll(async () =>
        (await device.messages()).some((m) => m.type === "applied" && m.seq === mine),
      )
      .toBe(true);
  };
  return { device, ...profiles, control };
}

/** Puts `profile` live, stages it and saves it as `name`. */
async function saveScene({ device, control }: Rig, profile: Stored, name: string) {
  await control({ type: "pick", id: profile.id });
  await stateWhere(device, (s) => s.activeId === profile.id);
  await control({ type: "stage", from: "live" });
  await stateWhere(device, (s) => s.staged?.id === profile.id && s.staged.settled);
  await control({ type: "saveScene", name });
  await stateWhere(device, (s) => s.scenes?.some((e) => e.name === name) ?? false);
  await control({ type: "unstage" });
  await stateWhere(device, (s) => s.staged === null);
}

/** The output's colour, away from the panel. */
async function output(page: Page) {
  const { height } = page.viewportSize()!;
  return patch(page, 100, height - 100);
}

const showing = (page: Page, rgb: readonly number[]) =>
  expect.poll(async () => near(await output(page), rgb, 12), { timeout: 10_000 }).toBe(true);

const picker = (page: Page) => page.getByTestId("panel-scene-picker");
const names = (page: Page) =>
  picker(page)
    .locator("option:not([disabled])")
    .evaluateAll((all) => all.map((o) => o.textContent));

test("Stage from the panel stages the scene without moving the output (AC6), Go makes it live, and the row fits the panel", async ({
  page,
}) => {
  const r = await rig(page);
  await saveScene(r, r.red, "Red scene");
  await r.control({ type: "pick", id: r.blue.id });
  await showing(page, BLUE_RGB);
  await expect(page.getByTestId("panel-scene-go")).toBeDisabled();

  await picker(page).selectOption({ label: "Red scene" });
  await page.getByTestId("panel-scene-stage").click();
  const state = await stateWhere(r.device, (s) => s.staged?.fromScene?.name === "Red scene");
  expect(state.staged).toMatchObject({ palette: ["#ff0000", "#ff0000"], settled: true });
  await expect(page.getByTestId("panel-scene-staged")).toHaveText("staged: Red scene");
  // The output holds the live look for a second after staging (AC6).
  for (let i = 0; i < 5; i++) {
    expect(near(await output(page), BLUE_RGB, 12)).toBe(true);
    await page.waitForTimeout(200);
  }

  await page.getByTestId("panel-scene-go").click();
  await showing(page, RED_RGB);
  await stateWhere(r.device, (s) => s.activeId.startsWith("scene:"));

  const panel = page.getByTestId("panel");
  const { scrollWidth, clientWidth } = await panel.evaluate((p) => ({
    scrollWidth: p.scrollWidth,
    clientWidth: p.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
});

test("Delete asks first and Cancel keeps the scene; Rename goes through a prompt and a taken name is refused (AC22, PD19)", async ({
  page,
}) => {
  const r = await rig(page);
  await saveScene(r, r.red, "Alpha");
  await saveScene(r, r.blue, "Beta");
  await expect.poll(() => names(page)).toEqual(["Alpha", "Beta"]);

  await picker(page).selectOption({ label: "Alpha" });
  const asked: string[] = [];
  page.once("dialog", (d) => {
    asked.push(`${d.type()} ${d.message()}`);
    void d.dismiss();
  });
  await page.getByTestId("panel-scene-delete").click();
  await expect.poll(() => asked).toEqual(["confirm Delete Alpha?"]);
  await page.waitForTimeout(300);
  await expect.poll(() => names(page)).toEqual(["Alpha", "Beta"]);

  page.once("dialog", (d) => void d.accept("beta"));
  await page.getByTestId("panel-scene-rename").click();
  await expect(page.getByTestId("panel-scene-status")).toHaveText("That name is taken");
  await expect.poll(() => names(page)).toEqual(["Alpha", "Beta"]);

  page.once("dialog", (d) => {
    expect(d.type()).toBe("prompt");
    expect(d.defaultValue()).toBe("Alpha");
    void d.accept("Gamma");
  });
  await page.getByTestId("panel-scene-rename").click();
  await expect.poll(() => names(page)).toEqual(["Beta", "Gamma"]);
  await stateWhere(r.device, (s) => s.scenes?.map((e) => e.name).join() === "Beta,Gamma");

  await picker(page).selectOption({ label: "Gamma" });
  page.once("dialog", (d) => void d.accept());
  await page.getByTestId("panel-scene-delete").click();
  await expect.poll(() => names(page)).toEqual(["Beta"]);
  await stateWhere(r.device, (s) => s.scenes?.map((e) => e.name).join() === "Beta");
});

test("export, delete all, import gives the same names and the same pixels at Go; a second import gives 'Name (2)' (AC25)", async ({
  page,
}) => {
  const r = await rig(page);
  await saveScene(r, r.red, "Red scene");
  await saveScene(r, r.blue, "Blue scene");
  await expect.poll(() => names(page)).toEqual(["Blue scene", "Red scene"]);

  const downloading = page.waitForEvent("download");
  await page.getByTestId("panel-scene-export").click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("djv-scenes.djv-scenes.json");
  const text = readFileSync((await download.path())!, "utf8");
  const file = JSON.parse(text) as { formatVersion: number; scenes: { name: string }[] };
  expect(file.formatVersion).toBe(1);
  expect(file.scenes.map((s) => s.name)).toEqual(["Blue scene", "Red scene"]);
  await expect(page.getByTestId("panel-scene-status")).toHaveText("Exported 2 scenes");

  for (const name of ["Blue scene", "Red scene"]) {
    await picker(page).selectOption({ label: name });
    page.once("dialog", (d) => void d.accept());
    await page.getByTestId("panel-scene-delete").click();
    await stateWhere(r.device, (s) => !(s.scenes?.some((e) => e.name === name) ?? true));
  }
  await expect(picker(page)).toContainText("No scenes yet");

  const upload = { name: "djv-scenes.djv-scenes.json", mimeType: "application/json" };
  await page
    .getByTestId("panel-scene-import")
    .setInputFiles({ ...upload, buffer: Buffer.from(text) });
  await expect(page.getByTestId("panel-scene-status")).toHaveText("Imported 2 scenes");
  await expect.poll(() => names(page)).toEqual(["Blue scene", "Red scene"]);

  await showing(page, BLUE_RGB);
  await picker(page).selectOption({ label: "Red scene" });
  await page.getByTestId("panel-scene-stage").click();
  await stateWhere(r.device, (s) => s.staged?.fromScene?.name === "Red scene");
  await page.getByTestId("panel-scene-go").click();
  await showing(page, RED_RGB);

  await page
    .getByTestId("panel-scene-import")
    .setInputFiles({ ...upload, buffer: Buffer.from(text) });
  await expect
    .poll(() => names(page))
    .toEqual(["Blue scene", "Blue scene (2)", "Red scene", "Red scene (2)"]);
});

test("a file with one bad scene stores nothing and names the scene and the field (AC25)", async ({
  page,
}) => {
  const r = await rig(page);
  await saveScene(r, r.red, "Red scene");
  const downloading = page.waitForEvent("download");
  await page.getByTestId("panel-scene-export").click();
  const good = JSON.parse(readFileSync((await (await downloading).path())!, "utf8")) as {
    scenes: Record<string, unknown>[];
  };
  const scene = good.scenes[0]!;
  const bad = {
    formatVersion: 1,
    scenes: [
      { ...scene, name: "Fine" },
      { ...scene, name: "Broken", transition: { kind: "spin", duration: 1 } },
    ],
  };
  await page.getByTestId("panel-scene-import").setInputFiles({
    name: "bad.djv-scenes.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(bad)),
  });
  await expect(page.getByTestId("panel-scene-status")).toContainText("Broken: transition.kind — ");
  await page.waitForTimeout(300);
  await expect.poll(() => names(page)).toEqual(["Red scene"]);
  expect(server.lines.some((l) => l.msg === "scenes imported")).toBe(false);
});
