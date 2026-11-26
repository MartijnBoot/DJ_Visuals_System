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

// ---- B-07 T13 (SD13, SD15, AC29, AC33; plan PD16): the preview's frame and lines. A raw screen —
// a page on the screen's origin that runs no app code and speaks the screen socket itself — sends
// the state, so each `preview` value can be shown exactly. ----

const STAGED = {
  id: "builtin",
  name: "Built-in",
  palette: ["#000000", "#ffffff"],
  storedPalette: ["#000000", "#ffffff"],
  primary: 1,
  dials: { recognisability: 0.5, reactivity: 0.5 },
  effects: [],
  feed: null,
  transition: { kind: "cut", duration: 2 },
  fromScene: null,
  settled: true,
  reason: null,
};

const STATE = {
  profiles: [{ id: "builtin", name: "Built-in" }],
  activeId: "builtin",
  palette: ["#000000", "#ffffff"],
  storedPalette: ["#000000", "#ffffff"],
  primary: 1,
  dials: { recognisability: 0.5, reactivity: 0.5 },
  cameras: [],
  cameraId: null,
  camera: "idle",
  audio: "idle",
  started: false,
  reason: null,
  mainAudio: null,
  transition: { kind: "cut", duration: 2, keepColour: false },
  effects: [],
  staged: STAGED,
  scenes: [],
  preview: "off",
};

type RawWindow = {
  __screen: { ws: WebSocket; messages: { type: string; [k: string]: unknown }[] };
};

/** A raw screen with External control on, one paired VJ controller, and a way to set the state. */
async function rawScreen(page: Page, browser: Browser, clock = false) {
  await page.goto(`${server.origin}/api/health`);
  await page.evaluate(
    (url) =>
      new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(url);
        const state = { ws, messages: [] as unknown[] };
        (window as unknown as RawWindow).__screen = state as RawWindow["__screen"];
        ws.onmessage = (e) => state.messages.push(JSON.parse(String(e.data)));
        ws.onopen = () => resolve();
        ws.onerror = () => reject(new Error("screen socket failed"));
      }),
    `ws://127.0.0.1:${server.port}/api/control/screen`,
  );
  const sendRaw = (message: unknown) =>
    page.evaluate(
      (m) => (window as unknown as RawWindow).__screen.ws.send(JSON.stringify(m)),
      message,
    );
  const statusWhere = async (pred: string) =>
    (
      await page.waitForFunction(
        (p) =>
          (window as unknown as RawWindow).__screen.messages
            .filter((m) => m.type === "status")
            .map((m) => m.status as { code: string | null; pending: { deviceId: string }[] })
            .find((s) => (p === "code" ? s.code !== null : s.pending.length > 0)),
        pred,
      )
    ).jsonValue() as Promise<{ code: string; pending: { deviceId: string }[] }>;
  await sendRaw({ type: "enable" });
  const { code } = await statusWhere("code");
  const context = await browser.newContext({ viewport: PHONE, ...LAN_CONTEXT });
  contexts.push(context);
  await keepSockets(context);
  await recordSends(context);
  const phone = await context.newPage();
  if (clock) await phone.clock.install();
  await phone.goto(`${server.lanOrigin}/control#code=${code}`);
  const { pending } = await statusWhere("pending");
  await sendRaw({ type: "accept", deviceId: pending[0]!.deviceId });
  const setState = (changes: Record<string, unknown>) =>
    sendRaw({ type: "state", state: { ...STATE, ...changes } });
  await setState({});
  await expect(phone.getByTestId("profile-tile").first()).toBeEnabled();
  await phone.getByTestId("mode-vj").click();
  await expect(phone.getByTestId("stage-live")).toBeEnabled();
  const screenGot = (type: string) =>
    page.evaluate(
      (t) => (window as unknown as RawWindow).__screen.messages.filter((m) => m.type === t),
      type,
    );
  return { phone, setState, screenGot };
}

const line = (phone: Page) => phone.getByTestId("preview-line");
const showHere = (phone: Page) => phone.getByTestId("preview-show-here");

test("each preview value shows its line: another controller's stream, nobody's, paused (AC29, PD16)", async ({
  page,
  browser,
}) => {
  const { phone, setState, screenGot } = await rawScreen(page, browser);
  // Someone else holds it (the screen says on or paused, and this controller is not the holder).
  await setState({ preview: "on" });
  await expect(line(phone)).toHaveText("Preview is on another controller");
  await expect(showHere(phone)).toBeEnabled();
  await setState({ preview: "paused" });
  await expect(line(phone)).toHaveText("Preview is on another controller");
  // Nobody holds it: only the key, no line.
  await setState({ preview: "off" });
  await expect(line(phone)).toHaveCount(0);
  await expect(showHere(phone)).toBeVisible();
  await expect(phone.getByTestId("preview-video")).toHaveCount(0);

  // "Show preview here" asks for the stream; the server makes this controller the holder.
  await showHere(phone).click();
  await expect
    .poll(async () => (await screenGot("preview")).at(-1))
    .toMatchObject({
      deviceId: expect.any(String),
    });
  await expect(showHere(phone)).toHaveCount(0);
  await expect(phone.getByTestId("preview-video")).toBeVisible();
  await expect(phone.getByTestId("preview-video")).toHaveAttribute(
    "aria-label",
    "Preview of the staged look",
  );
  // The brief's frame at 320×568: 16:9, capped at 112 px tall, about 199×112 (PD18 f, g).
  const frame = (await phone.getByTestId("preview-video").boundingBox())!;
  expect(Math.round(frame.height)).toBe(112);
  expect(Math.abs(frame.width - 199)).toBeLessThanOrEqual(1);
  await setState({ preview: "paused" });
  await expect(line(phone)).toHaveText("Preview paused — busy");
  await setState({ preview: "on" });
  await expect(line(phone)).toHaveCount(0);
  expect((await sentOf(phone, "previewStream")).map((m) => m.watching)).toEqual([true]);

  // Unstage stops watching.
  await phone.getByTestId("scene-unstage").click();
  await expect
    .poll(async () => (await sentOf(phone, "previewStream")).map((m) => m.watching))
    .toEqual([true, false]);
});

test("Preview unavailable 10 s after watching began with no offer, and Go still sends (AC33)", async ({
  page,
  browser,
}) => {
  const { phone, setState } = await rawScreen(page, browser, true);
  await setState({ preview: "off" });
  await showHere(phone).click();
  await expect(phone.getByTestId("preview-video")).toBeVisible();
  await phone.clock.fastForward(9_000);
  await expect(line(phone)).toHaveCount(0);
  await phone.clock.fastForward(1_100);
  await expect(line(phone)).toHaveText("Preview unavailable");
  await phone.getByTestId("scene-go").click();
  await expect.poll(async () => (await sentOf(phone, "go")).length).toBe(1);
});
