// The screen page in a real browser, against `pnpm start` (spec SD9): AC10, AC11, AC12, AC13.
import { expect, test, type Page } from "@playwright/test";

const HEALTH = "**/api/health";

/** A few pixels from the middle of the canvas, away from the overlay in the top-left corner. */
async function sample(page: Page): Promise<Buffer> {
  const viewport = page.viewportSize()!;
  return page.screenshot({
    clip: { x: viewport.width / 2, y: viewport.height / 2, width: 4, height: 4 },
  });
}

/** Two canvas reads 500 ms apart (the interval the spec names) differ. */
async function expectCanvasChanging(page: Page): Promise<void> {
  const first = await sample(page);
  await page.waitForTimeout(500);
  const second = await sample(page);
  expect(second.equals(first), "the canvas did not change in 500 ms").toBe(false);
}

async function openScreen(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("screen")).toBeVisible();
}

test("WebGL2 is available in this browser", async ({ page }) => {
  await page.goto("/");
  const hasWebGL2 = await page.evaluate(
    () => document.createElement("canvas").getContext("webgl2") !== null,
  );
  expect(hasWebGL2, "WebGL2 is not available in headless Chromium (software WebGL flags)").toBe(
    true,
  );
});

test("the canvas fills the window (AC10)", async ({ page }) => {
  await openScreen(page);
  const box = await page.getByTestId("screen").boundingBox();
  expect(box).toEqual({ x: 0, y: 0, ...page.viewportSize()! });
});

test("the canvas changes colour between two reads 500 ms apart (AC11)", async ({ page }) => {
  await openScreen(page);
  await expectCanvasChanging(page);
});

test("the overlay is hidden on load, asks nothing, and toggles with o (AC12)", async ({ page }) => {
  const healthRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/health") healthRequests.push(request.url());
  });
  await openScreen(page);
  await expect(page.getByTestId("overlay")).toHaveCount(0);
  expect(healthRequests).toHaveLength(0);

  await page.keyboard.press("o");
  await expect(page.getByTestId("overlay-server")).toHaveText("server: ok");
  await expect(page.getByTestId("overlay-fps")).toHaveText(/^fps \d+\.\d$/);
  await expect(page.getByTestId("overlay-frame-ms")).toHaveText(/^frame ms \d+\.\d$/);
  expect(healthRequests.length).toBeGreaterThanOrEqual(1);

  await page.keyboard.press("o");
  await expect(page.getByTestId("overlay")).toHaveCount(0);
});

test("a failed health request reads unreachable and the engine keeps rendering (AC13)", async ({
  page,
}) => {
  await page.route(HEALTH, (route) => route.abort());
  await openScreen(page);
  await page.keyboard.press("o");
  await expect(page.getByTestId("overlay-server")).toHaveText("server: unreachable");
  await expectCanvasChanging(page);
});

test("an invalid health body reads unreachable and the engine keeps rendering (AC13)", async ({
  page,
}) => {
  await page.route(HEALTH, (route) => route.fulfill({ status: 200, json: { status: "ok" } }));
  await openScreen(page);
  await page.keyboard.press("o");
  await expect(page.getByTestId("overlay-server")).toHaveText("server: unreachable");
  await expectCanvasChanging(page);
});

test("without WebGL2 the page shows one line in place of the canvas", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    // @ts-expect-error -- a stub over the overloaded signature, for this test only.
    HTMLCanvasElement.prototype.getContext = function (type: string, ...rest: unknown[]) {
      if (type === "webgl2") return null;
      return original.call(this, type, ...rest);
    };
  });
  await page.goto("/");
  await expect(page.getByTestId("screen")).toHaveCount(0);
  await expect(page.getByTestId("engine-error")).toHaveText(/WebGL2 is not available/);
});
