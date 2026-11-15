// B-04 T12 (spec SD8, SD9, SD12, SD22, SD23, AC8, AC10, AC18, AC19, AC24, AC26, AC29, AC42): the
// `/control` page in DJ mode against the in-process server with the address seam (PD13). The
// controller is a second browser context, 390×844 like a phone, on the LAN listener's origin.
import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { startControlServer, type ControlServer } from "./control-server.ts";
import { createProfile, twelveEffects, type Stored } from "./fixtures/profiles.ts";
import { record, recorded, start } from "./helpers.ts";

const PHONE = { width: 390, height: 844 };

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

async function screen(page: Page): Promise<string> {
  await record(page);
  await page.goto(`${server.origin}/`);
  await page.getByTestId("control-switch").click();
  await expect(page.getByTestId("control-switch")).toBeChecked();
  return (await page.getByTestId("control-url").textContent())!;
}

async function controller(browser: Browser, url: string, viewport = PHONE): Promise<Page> {
  const context = await browser.newContext({ viewport });
  contexts.push(context);
  const phone = await context.newPage();
  await phone.goto(url);
  return phone;
}

/** Opens `/control` from the QR URL and accepts it from the panel. */
async function paired(page: Page, browser: Browser, viewport = PHONE): Promise<Page> {
  const url = await screen(page);
  const phone = await controller(browser, url, viewport);
  await expect(phone.getByTestId("link-line")).toHaveText("Waiting for approval");
  await page.getByTestId("control-accept").click();
  await expect(phone.getByTestId("profile-tile").first()).toBeEnabled();
  return phone;
}

test("pairs from the QR URL: waiting, accepted from the panel, the state before the tiles enable (AC8, AC10)", async ({
  page,
  browser,
}) => {
  const url = await screen(page);
  const phone = await controller(browser, url);
  await expect(phone.getByTestId("link-line")).toHaveText("Waiting for approval");
  expect(new URL(phone.url()).hash).toBe(""); // the code left the address bar at once (SD19)
  await expect(phone.getByTestId("profile-tile")).toHaveCount(0); // no state, no controls
  await page.getByTestId("control-accept").click();
  await expect(phone.getByTestId("profile-tile").first()).toBeEnabled();
  await expect(phone.getByTestId("profile-tile")).toHaveText(["Built-in"]);
  await expect(phone.getByTestId("profile-tile").first()).toHaveAttribute("aria-pressed", "true");
  await expect(phone.getByTestId("link-line")).toHaveText("Connected");
});

test("a profile tile switches the screen as the panel does, and every surface agrees (AC18)", async ({
  page,
  browser,
}) => {
  const stored: Stored = await createProfile(api, twelveEffects());
  const phone = await paired(page, browser);
  // A controller connecting lists the profiles on the screen (SD22).
  const tile = phone.locator(`[data-testid=profile-tile][data-profile-id="${stored.id}"]`);
  await expect(tile).toHaveText("Twelve effects");
  await tile.click();
  await expect(tile).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("o");
  await expect(page.getByTestId("overlay-profile")).toHaveText("profile: Twelve effects");
  await expect(page.getByTestId("profile-picker")).toHaveValue(stored.id);
  // The profile's starting dials are applied and mirrored (AC18).
  await expect(page.getByTestId("slider-recognisability")).toHaveValue("0.5");
  await expect(phone.getByTestId("dial-recognisability")).toHaveValue("0.5");
});

test("a slider moves the screen's dial and the panel's slider (AC19)", async ({
  page,
  browser,
}) => {
  const phone = await paired(page, browser);
  await phone.getByTestId("dial-recognisability").fill("0.9");
  await expect(page.getByTestId("slider-recognisability")).toHaveValue("0.9");
  await phone.getByTestId("dial-reactivity").fill("0.15");
  await expect(page.getByTestId("slider-reactivity")).toHaveValue("0.15");
  await expect(page.getByTestId("slider-recognisability")).toHaveValue("0.9");
  // And the other way: the panel's move reaches the controller.
  await page.getByTestId("slider-recognisability").fill("0.2");
  await expect(phone.getByTestId("dial-recognisability")).toHaveValue("0.2");
});

test("camera tiles are disabled before Start, then switch the screen's camera (AC24, SD23)", async ({
  page,
  browser,
}) => {
  const phone = await paired(page, browser);
  await expect(phone.getByTestId("camera-note")).toHaveText("Start on the screen machine");
  for (const tile of await phone.getByTestId("camera-tile").all())
    await expect(tile).toBeDisabled();
  await start(page);
  await expect(phone.getByTestId("camera-note")).toHaveCount(0);
  const tile = phone.getByTestId("camera-tile").first();
  await expect(tile).toBeEnabled();
  const id = (await tile.getAttribute("data-camera-id"))!;
  expect(id).not.toBe("");
  const before = (await recorded(page)).calls.length;
  await tile.click();
  await expect
    .poll(async () =>
      (await recorded(page)).calls
        .slice(before)
        .some(
          (c) =>
            c.fn === "getUserMedia" &&
            JSON.stringify(c.constraints).includes(`"exact":${JSON.stringify(id)}`),
        ),
    )
    .toBe(true);
  await expect(tile).toHaveAttribute("aria-pressed", "true");
});

test("a second device's request shows the waiting badge in DJ mode, and Accept there approves it (AC8, SD18)", async ({
  page,
  browser,
}) => {
  const phone = await paired(page, browser);
  const url = (await page.getByTestId("control-url").textContent())!;
  const second = await controller(browser, url);
  await expect(second.getByTestId("link-line")).toHaveText("Waiting for approval");
  await expect(phone.getByTestId("waiting-badge")).toHaveText("1 waiting");
  await phone.getByTestId("waiting-badge").click();
  await phone.getByTestId("approve").click();
  await expect(second.getByTestId("profile-tile").first()).toBeEnabled();
  await expect(phone.getByTestId("waiting-badge")).toHaveCount(0);
});

test("a failed list shows the panel's reason on the controller; Refresh fetches once, nothing polls (AC26)", async ({
  page,
  browser,
}) => {
  const lists: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/profiles") lists.push(r.method());
  });
  await page.route("**/api/profiles", (route) => route.fulfill({ status: 500, body: "{}" }));
  const phone = await paired(page, browser);
  const reason = page.getByTestId("profile-reason");
  await expect(reason).toBeVisible();
  const text = (await reason.textContent())!;
  await expect(phone.getByTestId("controller-reason")).toHaveText(text);
  const before = lists.length;
  await phone.getByTestId("refresh").click();
  await expect.poll(() => lists.length).toBe(before + 1);
  await page.waitForTimeout(3000);
  expect(lists.length).toBe(before + 1);
});

test("with no screen page the controller says Screen not connected and is locked (AC29)", async ({
  page,
  browser,
}) => {
  const phone = await paired(page, browser);
  await page.close();
  await expect(phone.getByTestId("link-line")).toHaveText("Screen not connected");
  await expect(phone.getByTestId("profile-tile").first()).toBeDisabled();
  await expect(phone.getByTestId("dial-recognisability")).toBeDisabled();
});

test("opened without a code or key, it asks for the code and takes one typed in", async ({
  page,
  browser,
}) => {
  await screen(page);
  const code = (await page.getByTestId("control-code").textContent())!;
  const phone = await controller(browser, `${server.lanOrigin}/control`);
  await expect(phone.getByTestId("link-line")).toHaveText("Scan the code on the screen machine");
  await phone.getByTestId("code-input").fill(code.toLowerCase());
  await phone.getByTestId("code-submit").click();
  await expect(phone.getByTestId("link-line")).toHaveText("Waiting for approval");
});

test("starts in DJ mode at 390 px and VJ at 1024 px, and keeps a choice across reloads (AC42)", async ({
  page,
  browser,
}) => {
  const url = await screen(page);
  const narrow = await controller(browser, url);
  await expect(narrow.getByTestId("mode-dj")).toHaveAttribute("aria-pressed", "true");
  const wide = await controller(browser, `${server.lanOrigin}/control`, {
    width: 1024,
    height: 768,
  });
  await expect(wide.getByTestId("mode-vj")).toHaveAttribute("aria-pressed", "true");
  await narrow.getByTestId("mode-vj").click();
  await narrow.reload();
  await expect(narrow.getByTestId("mode-vj")).toHaveAttribute("aria-pressed", "true");
});

test("no horizontal scroll at 320 px, and every target at least 48×48 (UI, Non-functional)", async ({
  page,
  browser,
}) => {
  await createProfile(api, { ...twelveEffects(), name: "A very long profile name that wraps" });
  const phone = await paired(page, browser, { width: 320, height: 640 });
  await page.getByTestId("panel").getByRole("button", { name: "Start" }).click();
  await expect(phone.getByTestId("camera-tile").first()).toBeEnabled();
  const main = phone.getByTestId("controller");
  const { scrollWidth, clientWidth } = await main.evaluate((m) => ({
    scrollWidth: m.scrollWidth,
    clientWidth: m.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  const small: string[] = [];
  for (const target of await phone.locator("button, input").all()) {
    if (!(await target.isVisible())) continue;
    const box = (await target.boundingBox())!;
    if (box.width < 48 || box.height < 48) {
      small.push(
        `${await target.evaluate((e) => e.outerHTML.slice(0, 80))} ${box.width}×${box.height}`,
      );
    }
  }
  expect(small).toEqual([]);
});
