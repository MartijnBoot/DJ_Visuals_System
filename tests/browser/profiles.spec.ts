// The profile picker on the screen page (B-02 AC11 to AC14, AC18; plan PD1, PD16, AD6): profiles
// are created through the real API and picked in the real panel. A flat-colour profile paints
// the whole frame, so a patch of the canvas says which look is showing.
import { expect, test, type Page } from "@playwright/test";
import {
  BLUE_RGB,
  RED_RGB,
  blue,
  createProfile,
  deleteAll,
  listStored,
  red,
  updateProfile,
} from "./fixtures/profiles.ts";
import { expectCanvasChanging, near, patch, record, slide, start } from "./helpers.ts";

test.beforeEach(async ({ page, request }) => {
  await deleteAll(request);
  await record(page, { cameraDenied: true }); // the generative input: the built-in is never flat
});

const picker = (page: Page) => page.getByTestId("profile-picker");

async function centre(page: Page) {
  const { width, height } = page.viewportSize()!;
  return patch(page, width / 2, height / 2);
}

const showing = (page: Page, rgb: readonly number[]) =>
  expect.poll(async () => near(await centre(page), rgb, 12), { timeout: 8000 }).toBe(true);

function profileRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on("request", (r) => {
    const path = new URL(r.url()).pathname;
    if (path.startsWith("/api/profiles")) seen.push(`${r.method()} ${path}`);
  });
  return seen;
}

test("on load no profile request is made and the picker waits (AC12, PD1)", async ({
  page,
  request,
}) => {
  await createProfile(request, blue());
  const seen = profileRequests(page);
  await page.goto("/");
  await expect(picker(page)).toBeDisabled();
  await page.waitForTimeout(1500);
  expect(seen).toEqual([]);
});

test("after Start the panel lists Built-in then the stored names, and a pick cuts the picture without a black frame (AC11)", async ({
  page,
  request,
}) => {
  await createProfile(request, red());
  const stored = await createProfile(request, blue());
  await page.goto("/");
  await start(page);
  await expect(picker(page)).toBeEnabled();
  expect(await picker(page).locator("option").allTextContents()).toEqual([
    "Built-in",
    "Aaa Red",
    "Bbb Blue",
  ]);
  expect(near(await centre(page), BLUE_RGB, 12)).toBe(false);

  // Mean luma of the whole canvas once per frame across the pick: never black (AD6).
  const sampling = page.evaluate(
    () =>
      new Promise<number[]>((resolve) => {
        const canvas = document.querySelector<HTMLCanvasElement>("[data-testid=screen]")!;
        const copy = document.createElement("canvas");
        copy.width = copy.height = 16;
        const g = copy.getContext("2d", { willReadFrequently: true })!;
        const lumas: number[] = [];
        const t0 = performance.now();
        requestAnimationFrame(function each(now) {
          g.drawImage(canvas, 0, 0, 16, 16);
          const d = g.getImageData(0, 0, 16, 16).data;
          let sum = 0;
          for (let i = 0; i < d.length; i += 4) {
            sum += 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!;
          }
          lumas.push(sum / 256);
          if (now - t0 < 2500) requestAnimationFrame(each);
          else resolve(lumas);
        });
      }),
  );
  await page.waitForTimeout(600);
  await picker(page).selectOption(stored.id);
  const lumas = await sampling;
  expect(lumas.length).toBeGreaterThan(20);
  expect(Math.min(...lumas), "a black or half-built frame was shown").toBeGreaterThanOrEqual(2);

  await showing(page, BLUE_RGB);
  await expect(page.getByTestId("slider-recognisability")).toHaveValue("0.1");
  await expect(page.getByTestId("slider-reactivity")).toHaveValue("0.4");
  await expect(picker(page)).toHaveValue(stored.id);
});

test("moving a dial sends no request and never changes the stored profile (AC11)", async ({
  page,
  request,
}) => {
  const stored = await createProfile(request, blue());
  await page.goto("/");
  await start(page);
  await expect(picker(page)).toBeEnabled();
  await picker(page).selectOption(stored.id);
  await expect(page.getByTestId("slider-reactivity")).toHaveValue("0.4");
  const seen = profileRequests(page);
  await slide(page, "reactivity", "End");
  await slide(page, "recognisability", "Home");
  await page.waitForTimeout(600);
  expect(seen).toEqual([]);
  const [now] = await listStored(request);
  expect(now!.dials).toEqual({ recognisability: 0.1, reactivity: 0.4 });
  expect(now!.revision).toBe(1);
  // Re-picking re-fetches and restores the stored starting dials.
  await picker(page).selectOption("builtin");
  await picker(page).selectOption(stored.id);
  await expect(page.getByTestId("slider-reactivity")).toHaveValue("0.4");
});

test("an edit or a delete elsewhere changes nothing on screen until the profile is picked again (AC14)", async ({
  page,
  request,
}) => {
  const aaa = await createProfile(request, red());
  const bbb = await createProfile(request, blue());
  await page.goto("/");
  await start(page);
  await expect(picker(page)).toBeEnabled();
  await picker(page).selectOption(bbb.id);
  await showing(page, BLUE_RGB);

  await updateProfile(request, bbb, { palette: ["#ff0000", "#ff0000"] });
  await page.waitForTimeout(800);
  expect(near(await centre(page), BLUE_RGB, 12)).toBe(true);

  expect((await request.delete(`/api/profiles/${bbb.id}`)).status()).toBe(204);
  await page.waitForTimeout(800);
  expect(near(await centre(page), BLUE_RGB, 12)).toBe(true);

  await page.keyboard.press("s"); // close
  await page.keyboard.press("s"); // open: the list is fetched again
  await expect(picker(page)).toBeEnabled();
  expect(await picker(page).locator("option").allTextContents()).toContain("Aaa Red");
  await picker(page).selectOption(aaa.id);
  await showing(page, RED_RGB);
});

test("the remembered profile is selected after Start, and Built-in once it is deleted (AC12)", async ({
  page,
  request,
}) => {
  const stored = await createProfile(request, blue());
  await page.goto("/");
  await start(page);
  await expect(picker(page)).toBeEnabled();
  await picker(page).selectOption(stored.id);
  await showing(page, BLUE_RGB);

  await page.reload();
  await expect(picker(page)).toBeDisabled();
  await start(page);
  await expect(picker(page)).toBeEnabled();
  await expect(picker(page)).toHaveValue(stored.id);
  await showing(page, BLUE_RGB);

  await request.delete(`/api/profiles/${stored.id}`);
  await page.reload();
  await start(page);
  await expect(picker(page)).toBeEnabled();
  await expect(picker(page)).toHaveValue("builtin");
  await expect(page.getByTestId("profile-reason")).toHaveCount(0); // an empty database is no error (AD2)
});

test("with the profile API failing, the panel says why and the canvas keeps changing (AC13)", async ({
  page,
}) => {
  await page.route("**/api/profiles**", (route) => route.abort());
  await page.goto("/");
  await start(page);
  await expect(page.getByTestId("profile-reason")).toContainText(/profiles unavailable/i);
  await expectCanvasChanging(page);
  await expect(page.getByTestId("engine-error")).toHaveCount(0);
  await expect(picker(page)).toHaveValue("builtin");
});

test("with the profile API answering a body that fails the schema, the built-in stays and the panel says why (AC13)", async ({
  page,
}) => {
  await page.route("**/api/profiles**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: '{"profiles":[{"nope":1}]}',
    }),
  );
  await page.goto("/");
  await start(page);
  await expect(page.getByTestId("profile-reason")).toContainText(/could not be read/i);
  await expectCanvasChanging(page);
  await expect(picker(page)).toHaveValue("builtin");
});

test("a profile that cannot be fetched at pick time keeps the current look and says why (AC13)", async ({
  page,
  request,
}) => {
  const stored = await createProfile(request, blue());
  await page.goto("/");
  await start(page);
  await expect(picker(page)).toBeEnabled();
  await page.route(`**/api/profiles/${stored.id}`, (route) => route.abort());
  await picker(page).selectOption(stored.id);
  await expect(page.getByTestId("profile-reason")).toContainText(/could not be fetched/i);
  await expect(picker(page)).toHaveValue("builtin");
  await page.waitForTimeout(500);
  expect(near(await centre(page), BLUE_RGB, 12)).toBe(false);
  await expectCanvasChanging(page);
});

test("the overlay names the profile on screen", async ({ page, request }) => {
  const stored = await createProfile(request, blue());
  await page.goto("/");
  await start(page);
  await expect(picker(page)).toBeEnabled();
  await page.keyboard.press("o");
  await expect(page.getByTestId("overlay-profile")).toHaveText("profile: Built-in");
  await picker(page).selectOption(stored.id);
  await expect(page.getByTestId("overlay-profile")).toHaveText("profile: Bbb Blue");
});

test("the panel links to the builder in the same tab", async ({ page }) => {
  await page.goto("/");
  const link = page.getByTestId("open-builder");
  await expect(link).toHaveAttribute("href", "/builder");
  await expect(link).not.toHaveAttribute("target", /.+/);
});
