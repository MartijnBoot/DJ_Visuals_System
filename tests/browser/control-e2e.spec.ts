// B-04 T15, T16 (spec Verification 1): External control end to end, against the in-process
// server with the address seam (PD13). Part 1 (T15): limits, lifecycle and privacy. Part 2 (T16):
// the spec's scenario in order, the server restart included. No source change rides on these.
import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { connect } from "node:net";
import { deviceClient, startControlServer, type ControlServer } from "./control-server.ts";
import { createProfile, flat, twelveEffects } from "./fixtures/profiles.ts";
import { meanRgb, pixels, record, recorded, start } from "./helpers.ts";

const PHONE = { width: 390, height: 844 };
const TABLET = { width: 1024, height: 768 };
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";

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
  await page.goto(`${server.origin}/`);
  await page.getByTestId("control-switch").click();
  await expect(page.getByTestId("control-switch")).toBeChecked();
  return (await page.getByTestId("control-url").textContent())!;
}

interface ContextOptions {
  viewport?: { width: number; height: number };
  userAgent?: string;
  /** Keep the page's WebSockets reachable, so a test can drop them (`dropSockets`). */
  dropSockets?: boolean;
}

type SocketWindow = { __sockets: WebSocket[] };

async function context(
  browser: Browser,
  { dropSockets: keep = false, ...options }: ContextOptions = {},
): Promise<BrowserContext> {
  const made = await browser.newContext({ viewport: PHONE, ...options });
  contexts.push(made);
  if (keep) {
    await made.addInitScript(() => {
      const Base = window.WebSocket;
      const all: WebSocket[] = [];
      (window as unknown as SocketWindow).__sockets = all;
      window.WebSocket = class extends Base {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols);
          all.push(this);
        }
      };
    });
  }
  return made;
}

/** Closes every socket the page holds, as a dropped network would end them. */
const dropSockets = (phone: Page) =>
  phone.evaluate(() => (window as unknown as SocketWindow).__sockets.forEach((ws) => ws.close()));

async function controller(
  browser: Browser,
  url: string,
  options: ContextOptions = {},
): Promise<Page> {
  const phone = await (await context(browser, options)).newPage();
  await phone.goto(url);
  return phone;
}

/** A controller opened from the QR URL and accepted from the panel, its tiles enabled. */
async function paired(
  page: Page,
  browser: Browser,
  url: string,
  options: ContextOptions = {},
): Promise<Page> {
  const phone = await controller(browser, url, options);
  await expect(phone.getByTestId("link-line")).toHaveText("Waiting for approval");
  await page.getByTestId("control-accept").click();
  await expect(phone.getByTestId("profile-tile").first()).toBeEnabled();
  return phone;
}

test.describe("part 1: limits, lifecycle and privacy (T15)", () => {
  test("two controllers on the same dial: every surface ends on the value the screen applied last (AC25)", async ({
    page,
    browser,
  }) => {
    const url = await screen(page);
    const a = await paired(page, browser, url);
    const b = await paired(page, browser, url);
    for (let i = 0; i < 5; i++) {
      await a.getByTestId("dial-recognisability").fill(String(0.1 + i * 0.02));
      await b.getByTestId("dial-recognisability").fill(String(0.9 - i * 0.02));
    }
    await a.getByTestId("dial-recognisability").fill("0.42");
    await b.getByTestId("dial-recognisability").fill("0.77");
    // The screen applied b's last; every surface ends there.
    await expect(page.getByTestId("slider-recognisability")).toHaveValue("0.77");
    for (const phone of [a, b]) {
      await phone.getByTestId("dial-recognisability").blur();
      await expect(phone.getByTestId("dial-recognisability")).toHaveValue("0.77");
    }
  });

  test("a screen reload keeps External control on with the same code and devices; controllers wait, then get the starting values (AC29, AC30, SD13)", async ({
    page,
    browser,
  }) => {
    const warm = await createProfile(api, {
      ...flat("Warm", "#c2410c"),
      dials: { recognisability: 0.2, reactivity: 0.9 },
    });
    const url = await screen(page);
    const code = (await page.getByTestId("control-code").textContent())!;
    const phone = await paired(page, browser, url);
    const tile = phone.locator(`[data-testid=profile-tile][data-profile-id="${warm.id}"]`);
    await tile.click();
    // The pick lands at its swap and applies the profile's starting dials (B-02 SD15, B-04
    // SD6); a dial moved before then is overwritten by them, on every surface alike (AC25).
    await expect(tile).toHaveAttribute("aria-pressed", "true");
    await phone.getByTestId("dial-recognisability").fill("0.66");
    await expect(page.getByTestId("slider-recognisability")).toHaveValue("0.66");

    const reloading = page.reload();
    await expect(phone.getByTestId("link-line")).toHaveText("Screen not connected");
    await expect(phone.getByTestId("dial-recognisability")).toBeDisabled();
    await reloading;
    await expect(page.getByTestId("control-switch")).toBeChecked();
    await expect(page.getByTestId("control-code")).toHaveText(code);
    await expect(page.getByTestId("control-devices")).toContainText("Device 1");
    await expect(phone.getByTestId("link-line")).toHaveText("Connected");
    // The page starts again from the remembered profile's starting values (SD5, SD13).
    await expect(phone.getByTestId("dial-recognisability")).toHaveValue("0.2");
    await expect(
      phone.locator(`[data-testid=profile-tile][data-profile-id="${warm.id}"]`),
    ).toHaveAttribute("aria-pressed", "true");
  });

  test("offline: Reconnecting…, locked, nothing sent later; back online the state arrives (AC27, SD12)", async ({
    page,
    browser,
  }) => {
    const url = await screen(page);
    const phone = await paired(page, browser, url, { dropSockets: true });
    await page.getByTestId("slider-reactivity").fill("0.3");
    await expect(phone.getByTestId("dial-reactivity")).toHaveValue("0.3");
    // A Wi-Fi drop: the network goes, and the open socket with it.
    await phone.context().setOffline(true);
    await dropSockets(phone);
    await expect(phone.getByTestId("link-line")).toHaveText("Reconnecting…");
    await expect(phone.getByTestId("dial-reactivity")).toBeDisabled();
    await expect(phone.getByTestId("profile-tile").first()).toBeDisabled();
    // Nothing can be moved meanwhile, and the screen goes on without the controller.
    await page.getByTestId("slider-reactivity").fill("0.55");
    await page.waitForTimeout(1500); // past a few reconnect attempts, all refused offline
    await expect(phone.getByTestId("link-line")).toHaveText("Reconnecting…");
    await phone.context().setOffline(false);
    // Back online: at once (the `online` event), the state first, then the controls.
    await expect(phone.getByTestId("link-line")).toHaveText("Connected");
    await expect(phone.getByTestId("dial-reactivity")).toHaveValue("0.55");
    await expect(phone.getByTestId("dial-reactivity")).toBeEnabled();
    await expect(page.getByTestId("slider-reactivity")).toHaveValue("0.55");
    // Reconnected with its key: no new approval.
    await expect(page.getByTestId("control-pending")).toHaveCount(0);
    await expect(page.getByTestId("control-devices").locator("li")).toHaveCount(1);
  });

  test("five wrong codes from one device refuse the right code too (AC9, SD19)", async ({
    page,
    browser,
  }) => {
    await screen(page);
    const code = (await page.getByTestId("control-code").textContent())!;
    const wrong = code === "222222" ? "333333" : "222222";
    const phone = await controller(browser, `${server.lanOrigin}/control`);
    for (let i = 0; i < 5; i++) {
      await phone.getByTestId("code-input").fill(wrong);
      await phone.getByTestId("code-submit").click();
      await expect(phone.getByTestId("link-line")).toHaveText("Wrong code");
      await expect(phone.getByTestId("code-submit")).toBeVisible();
      // Each attempt is a new socket; the text stays "Wrong code" between them.
      await page.waitForTimeout(100);
    }
    await phone.getByTestId("code-input").fill(code);
    await phone.getByTestId("code-submit").click();
    await expect(phone.getByTestId("link-line")).toHaveText(
      "Too many wrong codes — try again in a minute",
    );
    await expect(page.getByTestId("control-pending")).toHaveCount(0);
  });

  test("a waiting device's controls change nothing on the screen (AC34)", async ({
    page,
    browser,
  }) => {
    await screen(page);
    const code = (await page.getByTestId("control-code").textContent())!;
    const before = await page.getByTestId("slider-recognisability").inputValue();
    const device = await deviceClient(await context(browser), server);
    await device.send({ type: "hello", code });
    await device.waitFor("waiting");
    await device.send({ type: "dials", seq: 1, recognisability: 0.99, reactivity: 0.01 });
    await device.send({ type: "pick", seq: 2, id: "builtin" });
    await device.send({ type: "colour", seq: 3, slot: 0, value: "#ff00ff" });
    await page.waitForTimeout(1000);
    await expect(page.getByTestId("slider-recognisability")).toHaveValue(before);
    expect((await device.messages()).map((m) => m.type)).toEqual(["waiting"]);
    expect(server.lines.some((l) => l.msg === "device accepted")).toBe(false);
  });

  test("a request beyond eight approved devices is refused with Too many devices (AC15, SD21)", async ({
    page,
    browser,
  }) => {
    await screen(page);
    const code = (await page.getByTestId("control-code").textContent())!;
    const devices = await context(browser);
    for (let i = 0; i < 8; i++) {
      const device = await deviceClient(devices, server);
      await device.send({ type: "hello", code });
      await device.waitFor("waiting");
      await page.getByTestId("control-accept").click();
      await device.waitFor("approved");
    }
    await expect(page.getByTestId("control-devices").locator("li")).toHaveCount(8);
    const ninth = await controller(browser, `${server.lanOrigin}/control#code=${code}`);
    await expect(ninth.getByTestId("link-line")).toHaveText("Too many devices");
  });

  test("the screen requests only the allow-list during a controlled run, and writes nothing (AC22, AC36)", async ({
    page,
    browser,
  }) => {
    const twelve = await createProfile(api, twelveEffects());
    const requests: string[] = [];
    page.on("request", (r) => {
      const { pathname } = new URL(r.url());
      requests.push(`${r.method()} ${pathname}`);
    });
    page.on("websocket", (ws) => requests.push(`WS ${new URL(ws.url()).pathname}`));
    const url = await screen(page);
    const phone = await paired(page, browser, url, { viewport: TABLET });
    const tile = phone.locator(`[data-testid=profile-tile][data-profile-id="${twelve.id}"]`);
    await tile.click();
    await expect(tile).toHaveAttribute("aria-pressed", "true"); // the pick has landed
    await phone.getByTestId("dial-reactivity").fill("0.8");
    await phone.locator('[data-testid=swatch][data-slot="1"]').click();
    await phone.getByTestId("wheel-disc").focus();
    await phone.keyboard.press("ArrowRight");
    await phone.getByTestId("wheel-reset").click();
    await phone.getByTestId("wheel-done").click();
    await phone.getByTestId("refresh").click();
    await page.waitForTimeout(1500);
    const allowed =
      /^(GET (\/|\/assets\/[^/]+|\/api\/health|\/api\/profiles|\/api\/profiles\/[^/]+)|WS \/api\/control\/screen)$/;
    expect(requests.filter((r) => !allowed.test(r))).toEqual([]);
    expect(requests.filter((r) => /^(POST|PUT|DELETE) /.test(r))).toEqual([]);
    expect(requests).toContain(`GET /api/profiles/${twelve.id}`);
    expect(requests.filter((r) => r.startsWith("WS "))).toEqual(["WS /api/control/screen"]);
  });

  test("the server's log never carries the code, a key, the User-Agent, the hint, a camera label or a colour (AC7, AC35)", async ({
    page,
    browser,
  }) => {
    const url = await screen(page);
    const code = (await page.getByTestId("control-code").textContent())!;
    const phone = await paired(page, browser, url, { viewport: TABLET, userAgent: IPHONE });
    // After Start the screen's state carries the camera's label to the controller (SD8).
    await start(page);
    await expect(phone.getByTestId("camera-tile").first()).toBeEnabled();
    const cameraLabel = (await phone.getByTestId("camera-tile").first().textContent())!;
    expect(cameraLabel.length).toBeGreaterThan(3);
    const key = await phone.evaluate(() => localStorage.getItem("djv.controlKey"));
    expect(key).toMatch(/^[A-Za-z0-9_-]{22}$/);
    await phone.locator('[data-testid=swatch][data-slot="0"]').click();
    await phone.getByTestId("wheel-disc").focus();
    await phone.keyboard.press("ArrowUp");
    await phone.getByTestId("wheel-done").click();
    await page.getByTestId("control-devices").getByTestId("control-disconnect").click();
    await expect(phone.getByTestId("link-line")).toHaveText("Pairing ended — scan the code again");
    await page.getByTestId("control-new-code").click();
    await page.getByTestId("control-switch").click();

    const text = JSON.stringify(server.lines);
    // The request line for the page carries no fragment, so no code (AC7).
    expect(server.lines.some((l) => JSON.stringify(l).includes("/control"))).toBe(true);
    // The sequence label ("Device 1") is what the log names a device by (SD27); a device label
    // in SD8's and SD27's sense is a camera's, which never reaches the log.
    for (const secret of [code, key!, IPHONE, "Safari on iPhone", cameraLabel]) {
      expect(text, secret).not.toContain(secret);
    }
    expect(text).not.toMatch(/#[0-9a-fA-F]{6}/);
    // The steps are logged, by sequence label only (SD27).
    for (const msg of [
      "external control on",
      "device requested",
      "device accepted",
      "device disconnected",
      "new code issued",
      "external control off",
    ]) {
      expect(
        server.lines.map((l) => l.msg),
        msg,
      ).toContain(msg);
    }
  });
});

/**
 * Two reads of the canvas itself 500 ms apart differ: the picture runs. Read from the canvas,
 * left of the panel, so the open panel cannot hide it (a screenshot of the window would).
 */
async function expectCanvasChanging(page: Page) {
  const first = await pixels(page, 40, 120, 160, 120);
  await page.waitForTimeout(500);
  const second = await pixels(page, 40, 120, 160, 120);
  expect(second, "the canvas did not change in 500 ms").not.toEqual(first);
}

/** Green minus red over the middle of the canvas. */
async function greenness(page: Page): Promise<number> {
  const [r, g] = meanRgb(await pixels(page, 40, 120, 160, 120));
  return g! - r!;
}

/** True when nothing accepts a TCP connection on 127.0.0.1:`port`. */
function refused(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(true));
  });
}

test.describe("part 2: the spec's scenario (T16, Verification 1)", () => {
  test("pair, pick, dials, wheel, camera, offline, disconnect, new code, off, restart (AC1, AC6, AC11, AC13, AC14, AC28, SD1)", async ({
    page,
    browser,
  }) => {
    const twelve = await createProfile(api, twelveEffects());
    await record(page);
    let url = "";
    let vj!: Page;

    await test.step("Start, switch on, open /control from the QR URL, accept from the panel", async () => {
      await page.goto(`${server.origin}/`);
      await start(page);
      await page.getByTestId("control-switch").click();
      await expect(page.getByTestId("control-switch")).toBeChecked();
      url = (await page.getByTestId("control-url").textContent())!;
      vj = await controller(browser, url, { viewport: TABLET, dropSockets: true });
      await expect(vj.getByTestId("link-line")).toHaveText("Waiting for approval");
      await page.getByTestId("control-accept").click();
      await expect(vj.getByTestId("link-line")).toHaveText("Connected");
      await expectCanvasChanging(page);
    });

    await test.step("pick the twelve-effect profile", async () => {
      const tile = vj.locator(`[data-testid=profile-tile][data-profile-id="${twelve.id}"]`);
      await tile.click();
      await expect(tile).toHaveAttribute("aria-pressed", "true");
      await page.keyboard.press("o");
      await expect(page.getByTestId("overlay-profile")).toHaveText("profile: Twelve effects");
      await expect(page.getByTestId("profile-picker")).toHaveValue(twelve.id);
      await expect(page.getByTestId("slider-recognisability")).toHaveValue("0.5");
      await expectCanvasChanging(page);
    });

    await test.step("move both dials", async () => {
      await vj.getByTestId("dial-recognisability").fill("0.8");
      await vj.getByTestId("dial-reactivity").fill("0.25");
      await expect(page.getByTestId("slider-recognisability")).toHaveValue("0.8");
      await expect(page.getByTestId("slider-reactivity")).toHaveValue("0.25");
      await vj.getByTestId("dial-reactivity").blur();
      await expect(vj.getByTestId("dial-reactivity")).toHaveValue("0.25");
      await expectCanvasChanging(page);
    });

    await test.step("drag the wheel on slot 1 toward green: the screen turns greener", async () => {
      await vj.getByTestId("dial-recognisability").fill("0"); // the palette shows most
      await expect(page.getByTestId("slider-recognisability")).toHaveValue("0");
      const before = await greenness(page);
      await vj.locator('[data-testid=swatch][data-slot="1"]').click();
      const box = (await vj.getByTestId("wheel-disc").boundingBox())!;
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      const r = box.width / 2 - 3;
      await vj.mouse.move(cx, cy);
      await vj.mouse.down();
      for (let i = 1; i <= 8; i++) {
        const t = i / 8; // toward hue 120: down and to the left
        await vj.mouse.move(cx - 0.5 * r * t, cy + 0.866 * r * t);
      }
      await vj.mouse.up();
      const value = (await vj.getByTestId("wheel-value").textContent())!;
      await expect(vj.locator('[data-testid=swatch][data-slot="1"]')).toHaveAttribute(
        "data-colour",
        value,
      );
      await vj.getByTestId("wheel-done").click();
      // The swatch above shows the screen applied the colour. How soon the canvas reads show it
      // depends on the frame rate, which a loaded machine slows to a few frames a second: the
      // wait gets a minute, not `expect.poll`'s five seconds (B-08: no wall-clock assertion).
      await expect.poll(() => greenness(page), { timeout: 60_000 }).toBeGreaterThan(before + 10);
      await expect(page.getByTestId("overlay-profile")).toHaveText("profile: Twelve effects");
    });

    await test.step("tap a camera", async () => {
      const tile = vj.getByTestId("camera-tile").first();
      await expect(tile).toBeEnabled();
      const id = (await tile.getAttribute("data-camera-id"))!;
      const before = (await recorded(page)).calls.length;
      await tile.click();
      await expect
        .poll(async () =>
          (await recorded(page)).calls
            .slice(before)
            .some((c) => JSON.stringify(c.constraints).includes(`"exact":${JSON.stringify(id)}`)),
        )
        .toBe(true);
      await expect(tile).toHaveAttribute("aria-pressed", "true");
      await expectCanvasChanging(page);
    });

    await test.step("offline, then online: Reconnecting…, then the state, no new approval", async () => {
      await vj.context().setOffline(true);
      await dropSockets(vj);
      await expect(vj.getByTestId("link-line")).toHaveText("Reconnecting…");
      await expect(vj.getByTestId("dial-reactivity")).toBeDisabled();
      await page.getByTestId("slider-reactivity").fill("0.6");
      await vj.context().setOffline(false);
      await expect(vj.getByTestId("link-line")).toHaveText("Connected");
      await expect(vj.getByTestId("dial-reactivity")).toHaveValue("0.6");
      await expect(page.getByTestId("control-pending")).toHaveCount(0);
    });

    await test.step("a second device; Disconnect it: it ends, the first stays", async () => {
      const dj = await controller(browser, url);
      await page.getByTestId("control-accept").click();
      await expect(dj.getByTestId("link-line")).toHaveText("Connected");
      await page
        .locator('[data-testid=control-devices] li:has-text("Device 2")')
        .getByTestId("control-disconnect")
        .click();
      await expect(dj.getByTestId("link-line")).toHaveText("Pairing ended — scan the code again");
      await expect(vj.getByTestId("link-line")).toHaveText("Connected");
      await vj.getByTestId("dial-reactivity").fill("0.35");
      await expect(page.getByTestId("slider-reactivity")).toHaveValue("0.35");
    });

    await test.step("New code: the first ends too, its key is removed", async () => {
      const old = (await page.getByTestId("control-code").textContent())!;
      await page.getByTestId("control-new-code").click();
      await expect(page.getByTestId("control-code")).not.toHaveText(old);
      await expect(vj.getByTestId("link-line")).toHaveText("Pairing ended — scan the code again");
      expect(await vj.evaluate(() => localStorage.getItem("djv.controlKey"))).toBeNull();
      url = (await page.getByTestId("control-url").textContent())!;
    });

    await test.step("switch off ends a device paired after the new code", async () => {
      const last = await controller(browser, url);
      await page.getByTestId("control-accept").click();
      await expect(last.getByTestId("link-line")).toHaveText("Connected");
      await page.getByTestId("control-switch").click();
      await expect(page.getByTestId("control-switch")).not.toBeChecked();
      await expect(last.getByTestId("link-line")).toHaveText("Pairing ended — scan the code again");
      expect(await refused(server.controlPort)).toBe(true);
    });

    await test.step("restart: nothing on CONTROL_PORT; switched on, the controller ends on Pairing ended (PD4)", async () => {
      await page.getByTestId("control-switch").click();
      await expect(page.getByTestId("control-switch")).toBeChecked();
      url = (await page.getByTestId("control-url").textContent())!;
      const survivor = await controller(browser, url);
      await page.getByTestId("control-accept").click();
      await expect(survivor.getByTestId("link-line")).toHaveText("Connected");

      await server.close();
      await expect(survivor.getByTestId("link-line")).toHaveText("Reconnecting…");
      await server.restart(); // the same ports; everything in memory is gone
      expect(await refused(server.controlPort)).toBe(true); // AC1
      // The screen page reconnects on its own and shows the new server's state: off.
      await expect(page.getByTestId("control-switch")).not.toBeChecked({ timeout: 15_000 });
      await expect(survivor.getByTestId("link-line")).toHaveText("Reconnecting…");
      await page.getByTestId("control-switch").click();
      await expect(page.getByTestId("control-switch")).toBeChecked();
      await expect(survivor.getByTestId("link-line")).toHaveText(
        "Pairing ended — scan the code again",
        { timeout: 15_000 },
      );
    });
  });
});
