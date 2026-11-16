// B-03 T9 (spec AC11, AC12, AC25, SD8; plan PD8): the runtime guard on the screen page. A look
// too heavy for the GPU loses its custom effects and the panel and a paired controller say why;
// a lost WebGL context comes back drawing. Profiles are stored through the real API and picked
// in the real panel; the context is lost through `WEBGL_lose_context`.
import { expect, test, type Browser, type Page } from "@playwright/test";
import { LAN_CONTEXT, startControlServer } from "./control-server.ts";
import { createProfile, deleteAll, type Definition } from "./fixtures/profiles.ts";
import { expectCanvasChanging, near, patch, record, start } from "./helpers.ts";

const SLOW =
  "custom effects are off: this look is too heavy for this GPU; pick the profile again to retry";
const LOST_CUSTOM =
  "the graphics context was lost and restored; custom effects are off; pick the profile again to retry";
const LOST = "the graphics context was lost and restored";

const MAGENTA = [255, 0, 255] as const;

/**
 * 120 samples of the picture before it per pixel: about 130 to 270 ms a frame at 100% on
 * SwiftShader at the gate's viewport (measured 2026-11-15), above budget even at 50%, and far
 * from the GPU watchdog. It paints the marker colour; the samples change it by nothing visible.
 */
const HEAVY = `vec3 acc = vec3(0.0);
for (int i = 0; i < 120; i++) {
  acc += source(uv + vec2(float(i) * 0.0007, 0.0));
}
return vec3(1.0, 0.0, 1.0) + acc * 0.000001;`;

/** Light: half the picture, half the marker colour. */
const LIGHT = "return mix(source(uv), vec3(1.0, 0.0, 1.0), 0.5);";

const coded = (name: string, code: string): Definition => ({
  name,
  palette: ["#000000", "#ffffff"],
  dials: { recognisability: 0.37, reactivity: 0 },
  effects: [{ type: "custom", label: "Marker", amount: 1, abstraction: false, params: [], code }],
});

async function centre(page: Page) {
  const { width, height } = page.viewportSize()!;
  return patch(page, width / 2, height / 2);
}

const showingMarker = async (page: Page) => near(await centre(page), MAGENTA, 16);

/** Every request the page makes, and every WebSocket it opens. */
function requestsOf(page: Page): string[] {
  const seen: string[] = [];
  page.on("request", (r) => seen.push(`${r.method()} ${new URL(r.url()).pathname}`));
  page.on("websocket", (ws) => seen.push(`WS ${new URL(ws.url()).pathname}`));
  return seen;
}

/** B-04 AC36's allow-list (`live.spec.ts`): no new endpoint (AC25). */
function expectOnlyAllowed(requests: string[]) {
  const allowed = /^GET (\/|\/assets\/[^/]+|\/api\/health|\/api\/profiles|\/api\/profiles\/[^/]+)$/;
  const sockets = requests.filter((r) => r.startsWith("WS "));
  expect(requests.filter((r) => !r.startsWith("WS ") && !allowed.test(r))).toEqual([]);
  expect([...new Set(sockets)]).toEqual(["WS /api/control/screen"]);
}

async function pairedController(page: Page, browser: Browser): Promise<Page> {
  await page.getByTestId("control-switch").click();
  await expect(page.getByTestId("control-switch")).toBeChecked();
  const url = (await page.getByTestId("control-url").textContent())!;
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    ...LAN_CONTEXT,
  });
  const phone = await context.newPage();
  await phone.goto(url);
  await expect(phone.getByTestId("link-line")).toHaveText("Waiting for approval");
  await page.getByTestId("control-accept").click();
  await expect(phone.getByTestId("profile-tile").first()).toBeEnabled();
  return phone;
}

test("a look too heavy for the GPU loses its custom effects, says why on the panel and the controller, and a pick retries (AC11)", async ({
  page,
  browser,
  playwright,
}) => {
  const server = await startControlServer();
  const api = await playwright.request.newContext({ baseURL: server.origin });
  try {
    const heavy = await createProfile(api, coded("Heavy", HEAVY));
    await record(page, { cameraDenied: true });
    const requests = requestsOf(page);
    await page.goto(`${server.origin}/`);
    await start(page);
    const phone = await pairedController(page, browser);
    const picker = page.getByTestId("profile-picker");
    await picker.selectOption(heavy.id);
    await expect.poll(() => showingMarker(page), { timeout: 30_000 }).toBe(true);

    // The scale steps to 50%, then 3 s later the custom effect goes off. No time is asserted.
    await expect(page.getByTestId("profile-reason")).toHaveText(SLOW, { timeout: 120_000 });
    await expect(phone.getByTestId("controller-reason")).toHaveText(SLOW);
    expect(await showingMarker(page)).toBe(false);
    await expectCanvasChanging(page); // the camera input and the built-ins keep drawing

    // Picking it again runs the custom effect again.
    await picker.selectOption("builtin");
    await picker.selectOption(heavy.id);
    await expect.poll(() => showingMarker(page), { timeout: 30_000 }).toBe(true);
    expectOnlyAllowed(requests);
    await phone.context().close();
  } finally {
    await api.dispose();
    await server.dispose();
  }
});

/** Loses the screen's WebGL context, waits for the loss to land, restores it; returns at once. */
async function loseAndRestore(page: Page) {
  await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("[data-testid=screen]")!;
    const ext = canvas.getContext("webgl2")!.getExtension("WEBGL_lose_context")!;
    (window as unknown as { __lose: WEBGL_lose_context }).__lose = ext;
    ext.loseContext();
  });
  await page.waitForTimeout(300);
  await page.evaluate(() =>
    (window as unknown as { __lose: WEBGL_lose_context }).__lose.restoreContext(),
  );
}

for (const [label, definition, reason] of [
  ["a custom profile", coded("Light", LIGHT), LOST_CUSTOM],
  ["the built-in profile", null, LOST],
] as const) {
  test(`after a lost context ${label} draws again within 1 s, with the reason in the panel only (AC12)`, async ({
    page,
    request,
  }) => {
    await deleteAll(request);
    const stored = definition ? await createProfile(request, definition) : null;
    await record(page, { cameraDenied: true });
    const requests = requestsOf(page);
    await page.goto("/");
    await start(page);
    if (stored) {
      await page.getByTestId("profile-picker").selectOption(stored.id);
      await expect(page.getByTestId("slider-recognisability")).toHaveValue("0.37");
    }
    await page.keyboard.press("s"); // the panel closed: nothing but the output on screen
    await expect(page.getByTestId("panel")).toHaveCount(0);

    await loseAndRestore(page);
    await expect
      .poll(async () => Math.max(...(await centre(page))), { timeout: 1000 })
      .toBeGreaterThan(20);
    await expect(page.getByText(reason)).toHaveCount(0); // no text over the output
    await expectCanvasChanging(page);
    await page.keyboard.press("s");
    await expect(page.getByTestId("profile-reason")).toHaveText(reason);
    expectOnlyAllowed(requests);
  });
}
