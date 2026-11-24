// B-09 T9 (spec SD5, SD7, AC22, AC24): transitions end to end against the in-process server — two
// real controllers, one in DJ mode and one in VJ mode, and the screen page's panel. The DJ
// controller has no transition control and its pick uses the choice the VJ one set; a change made
// anywhere shows everywhere.
import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { LAN_CONTEXT, startControlServer, type ControlServer } from "./control-server.ts";
import { BLUE_RGB, blue, createProfile, RED_RGB, red } from "./fixtures/profiles.ts";
import { near, patch, record, start } from "./helpers.ts";
import { keepSockets } from "./sockets.ts";

const PHONE = { width: 320, height: 568 }; // a first open below 600 px is DJ mode
const TABLET = { width: 1024, height: 768 }; // and above it VJ mode
const TOLERANCE = 12;

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
  await record(page, { cameraDenied: true });
  await page.goto(`${server.origin}/`);
  await page.getByTestId("control-switch").click();
  await expect(page.getByTestId("control-switch")).toBeChecked();
  return (await page.getByTestId("control-url").textContent())!;
}

async function paired(
  page: Page,
  browser: Browser,
  url: string,
  viewport: { width: number; height: number },
): Promise<Page> {
  const context = await browser.newContext({ viewport, ...LAN_CONTEXT });
  contexts.push(context);
  await keepSockets(context);
  const phone = await context.newPage();
  await phone.goto(url);
  await expect(phone.getByTestId("link-line")).toHaveText("Waiting for approval");
  await page.getByTestId("control-accept").click();
  await expect(phone.getByTestId("link-line")).toHaveText("Connected");
  return phone;
}

const centre = (page: Page) => {
  const { width, height } = page.viewportSize()!;
  return patch(page, width / 2, height / 2);
};

/** The centre pixel of every frame for `ms` of frame time; start it, make the pick, await it. */
function sampleCentre(page: Page, ms: number) {
  return page.evaluate(
    (duration) =>
      new Promise<number[][]>((resolve) => {
        const canvas = document.querySelector<HTMLCanvasElement>("[data-testid=screen]")!;
        const copy = document.createElement("canvas");
        copy.width = copy.height = 1;
        const g = copy.getContext("2d", { willReadFrequently: true })!;
        const out: number[][] = [];
        let first: number | null = null;
        requestAnimationFrame(function each(t) {
          first ??= t;
          const x = Math.floor(canvas.width / 2);
          const y = Math.floor(canvas.height / 2);
          g.drawImage(canvas, x, y, 1, 1, 0, 0, 1, 1);
          out.push(Array.from(g.getImageData(0, 0, 1, 1).data.slice(0, 3)));
          if (t - first < duration) requestAnimationFrame(each);
          else resolve(out);
        });
      }),
    ms,
  );
}

test("a DJ-mode controller shows no transition control, and its pick uses the VJ one's crossfade (AC22)", async ({
  page,
  browser,
}) => {
  const from = await createProfile(api, red());
  const to = await createProfile(api, blue());
  const url = await screen(page);
  await start(page);
  const dj = await paired(page, browser, url, PHONE);
  const vj = await paired(page, browser, url, TABLET);
  await expect(dj.getByTestId("mode-dj")).toHaveAttribute("aria-pressed", "true");
  await expect(vj.getByTestId("mode-vj")).toHaveAttribute("aria-pressed", "true");
  await expect(dj.getByRole("region", { name: "Transition" })).toHaveCount(0);
  await expect(dj.locator("[data-testid^=transition-]")).toHaveCount(0);

  const tile = (p: Page, id: string) =>
    p.locator(`[data-testid=profile-tile][data-profile-id="${id}"]`);
  await tile(dj, from.id).click();
  await expect.poll(async () => near(await centre(page), RED_RGB, TOLERANCE)).toBe(true);

  await vj.getByTestId("transition-crossfade").click();
  await expect(page.getByTestId("transition-kind")).toHaveValue("crossfade");
  const sampling = sampleCentre(page, 3500);
  await page.waitForTimeout(300);
  await tile(dj, to.id).click();
  const frames = await sampling;
  const mixed = frames.filter((c) => !near(c, RED_RGB, TOLERANCE) && !near(c, BLUE_RGB, TOLERANCE));
  expect(mixed.length, "intermediate frames of the crossfade").toBeGreaterThanOrEqual(3);
  for (const c of mixed)
    expect(c[1]!, `a mix of red and blue: ${c.join(",")}`).toBeLessThanOrEqual(TOLERANCE);
  expect(near(frames.at(-1)!, BLUE_RGB, TOLERANCE)).toBe(true);
  await expect(tile(dj, to.id)).toHaveAttribute("aria-pressed", "true");
});

test("a change on a controller shows in the panel and on the other; a panel change shows on both (AC24)", async ({
  page,
  browser,
}) => {
  const url = await screen(page);
  const a = await paired(page, browser, url, TABLET);
  const b = await paired(page, browser, url, PHONE);
  await b.getByTestId("mode-vj").click(); // the other controller, in VJ mode to show the section

  await a.getByTestId("transition-wipe").click();
  await expect(page.getByTestId("transition-kind")).toHaveValue("wipe");
  await expect(b.getByTestId("transition-wipe")).toHaveAttribute("aria-pressed", "true");
  const fader = a.getByTestId("transition-duration");
  await fader.focus();
  await fader.press("End");
  await expect(page.getByTestId("transition-duration-readout")).toHaveText("8.0 s");
  await expect(b.getByTestId("transition-duration-readout")).toHaveText("8.0 s");
  await a.getByTestId("transition-keep-colour").click();
  await expect(page.getByTestId("transition-keep-colour")).toBeChecked();
  await expect(b.getByTestId("transition-keep-colour")).toHaveAttribute("aria-pressed", "true");

  await page.getByTestId("transition-kind").selectOption("dip");
  await page.getByTestId("transition-duration").focus();
  await page.keyboard.press("Home");
  await page.getByTestId("transition-keep-colour").uncheck();
  for (const phone of [a, b]) {
    await expect(phone.getByTestId("transition-dip")).toHaveAttribute("aria-pressed", "true");
    await expect(phone.getByTestId("transition-duration-readout")).toHaveText("0.5 s");
    await expect(phone.getByTestId("transition-keep-colour")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  }
});
