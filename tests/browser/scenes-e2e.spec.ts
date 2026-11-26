// B-07 T14 (spec AC3, AC14, AC26, AC28, AC29, AC34, AC39, AC40, Verification 1): scenes end to end,
// in order, with no source change — the screen page and real `/control` pages against the
// in-process server with the address seam. Stage from live, edit the staged look (a profile, a
// colour, a strength) while the output holds still, the preview on the controller, Go with a
// Crossfade; save, save as new, rename, delete; a server restart and a screen reload; the preview
// moving to a second controller; a scene holding a custom effect staged and made live. Every
// request, every console line, every peer connection's configuration and every server log line
// of the run is kept and checked at the end.
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { setFader } from "./fader.ts";
import { LAN_CONTEXT, startControlServer, type ControlServer } from "./control-server.ts";
import {
  BLUE_RGB,
  createProfile,
  red,
  RED_RGB,
  redOverGreen,
  type Definition,
  type Stored,
} from "./fixtures/profiles.ts";
import { near, patch } from "./helpers.ts";

const TABLET = { width: 768, height: 1024 };
/** A colour only the blue profile's definition holds: one in a log line is a definition leaking. */
const MARKER = "#0000fe";
const SCENE = "Warm crowd";
const SPARE = "Spare two";
const CODE_TEXT = "return vec3(1.0, 0.0, 0.0);";

let server: ControlServer;
const contexts: BrowserContext[] = [];

test.beforeEach(async () => {
  server = await startControlServer();
});

test.afterEach(async () => {
  for (const c of contexts.splice(0)) await c.close();
  await server.dispose();
});

interface Evidence {
  console: string[];
  peers: RTCConfiguration[];
  /** "METHOD /path" or "WS /path" of the screen page. */
  screen: string[];
  /** The same for every controller page. */
  controllers: string[];
}

/** Every console line and peer configuration of a context, through bindings that outlive a reload. */
async function watch(context: BrowserContext, evidence: Evidence) {
  await context.exposeBinding("__e2ePeer", (_source, config: RTCConfiguration) => {
    evidence.peers.push(config);
  });
  await context.addInitScript(() => {
    const w = window as unknown as { __e2ePeer(config: RTCConfiguration): void };
    const Base = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends Base {
      constructor(config?: RTCConfiguration) {
        super(config);
        void w.__e2ePeer(JSON.parse(JSON.stringify(config ?? {})) as RTCConfiguration);
      }
    };
  });
  context.on("console", (message) => evidence.console.push(message.text()));
}

const requestLine = (method: string, url: string) => `${method} ${new URL(url).pathname}`;

/** A paired controller in VJ mode on a tablet, every request it makes recorded. */
async function controller(page: Page, evidence: Evidence): Promise<Page> {
  const url = (await page.getByTestId("control-url").textContent())!;
  const context = await page
    .context()
    .browser()!
    .newContext({ ...LAN_CONTEXT, viewport: TABLET });
  contexts.push(context);
  await watch(context, evidence);
  context.on("request", (r) => evidence.controllers.push(requestLine(r.method(), r.url())));
  const phone = await context.newPage();
  phone.on("websocket", (ws) => evidence.controllers.push(`WS ${new URL(ws.url()).pathname}`));
  await phone.goto(url);
  await expect(phone.getByTestId("link-line")).toHaveText("Waiting for approval");
  await page.getByTestId("control-accept").click();
  await expect(phone.getByTestId("profile-tile").first()).toBeEnabled();
  await phone.getByTestId("mode-vj").click();
  await expect(phone.getByTestId("stage-live")).toBeEnabled();
  return phone;
}

async function switchOn(page: Page): Promise<string> {
  await page.getByTestId("control-switch").click();
  await expect(page.getByTestId("control-switch")).toBeChecked();
  return (await page.getByTestId("control-code").textContent())!;
}

/** The output's colour, away from the panel (top right). */
const output = (page: Page) => patch(page, 100, page.viewportSize()!.height - 100);
const showing = (page: Page, rgb: readonly number[]) =>
  expect.poll(async () => near(await output(page), rgb, 12), { timeout: 15_000 }).toBe(true);
/** The output holds `rgb` for a second: five reads 200 ms apart. */
async function holds(page: Page, rgb: readonly number[]) {
  for (let i = 0; i < 5; i++) {
    expect(near(await output(page), rgb, 12), "the output moved").toBe(true);
    await page.waitForTimeout(200);
  }
}

/** The controller's preview picture: its size and the colour at its centre, or null. */
const previewOf = (phone: Page) =>
  phone.evaluate(() => {
    const video = document.querySelector<HTMLVideoElement>("[data-testid=preview-video]");
    if (!video || video.videoWidth === 0) return null;
    const canvas = document.createElement("canvas");
    canvas.width = 8;
    canvas.height = 8;
    const g = canvas.getContext("2d")!;
    g.drawImage(video, 0, 0, 8, 8);
    const d = g.getImageData(4, 4, 1, 1).data;
    return { width: video.videoWidth, height: video.videoHeight, rgb: [d[0]!, d[1]!, d[2]!] };
  });
const previewShows = (phone: Page, rgb: readonly number[]) =>
  expect
    .poll(
      async () => {
        const p = await previewOf(phone);
        return p !== null && p.width <= 320 && near(p.rgb, rgb, 24);
      },
      { timeout: 20_000 },
    )
    .toBe(true);

const tile = (phone: Page, name: string): Locator =>
  phone.locator("[data-testid=scene-tile]", { hasText: name });
const profileTile = (phone: Page, stored: Stored) =>
  phone.locator(`[data-testid=profile-tile][data-profile-id="${stored.id}"]`);

/** The screen page's output carries no text: the overlay and the panel aside (AC34). */
async function expectNoTextOnOutput(page: Page) {
  const text = await page.evaluate(() => {
    const body = document.body.cloneNode(true) as HTMLElement;
    body.querySelectorAll("[data-testid=overlay], [data-testid=panel]").forEach((e) => e.remove());
    return body.textContent?.trim() ?? "";
  });
  expect(text).toBe("");
  expect(await page.locator("canvas").count()).toBe(1); // the preview's canvas is never in the page
}

test("stage, edit, preview, Go; save, rename, delete; restart and reload; the preview moves; a custom scene goes — nothing written, nothing private logged (AC14, AC26, AC28, AC29, AC34, AC39, AC40)", async ({
  page,
  playwright,
}) => {
  const api = await playwright.request.newContext({ baseURL: server.origin });
  const blueDef: Definition = {
    name: "Bbb Blue",
    palette: ["#0000ff", MARKER],
    dials: { recognisability: 0.5, reactivity: 0.5 },
    effects: [{ type: "paletteMap", amount: 1, vj: true }],
  };
  const redP = await createProfile(api, red());
  const blueP = await createProfile(api, blueDef);
  const customP = await createProfile(api, redOverGreen("Ccc Custom red"));
  await api.dispose();

  const evidence: Evidence = { console: [], peers: [], screen: [], controllers: [] };
  await watch(page.context(), evidence);
  page.on("request", (r) => evidence.screen.push(requestLine(r.method(), r.url())));
  page.on("websocket", (ws) => evidence.screen.push(`WS ${new URL(ws.url()).pathname}`));
  const codes: string[] = [];
  const keys: string[] = [];
  await page.setViewportSize(TABLET);
  await page.goto(`${server.origin}/`);
  codes.push(await switchOn(page));
  const first = await controller(page, evidence);

  await test.step("stage from live, then a profile, a colour and a strength: the output holds, the preview follows (Verification 1, AC28, AC34)", async () => {
    await profileTile(first, redP).click();
    await expect(profileTile(first, redP)).toHaveAttribute("aria-pressed", "true");
    await showing(page, RED_RGB);
    await first.getByTestId("transition-crossfade").click();
    await expect(first.getByTestId("transition-crossfade")).toHaveAttribute("aria-pressed", "true");

    await first.getByTestId("stage-live").click();
    await expect(first.getByTestId("editing-staged")).toHaveAttribute("aria-pressed", "true");
    await previewShows(first, RED_RGB); // the staged copy of the live look
    const size = (await previewOf(first))!;
    expect(size.width).toBeGreaterThan(0);
    expect(size.width).toBeLessThanOrEqual(320);
    expect(size.height).toBeLessThanOrEqual(180);

    await profileTile(first, blueP).click(); // a staged pick
    await expect(profileTile(first, blueP)).toHaveAttribute("aria-pressed", "true");
    await previewShows(first, BLUE_RGB); // the preview changed
    await holds(page, RED_RGB);

    await first.getByTestId("wheel-disc").focus();
    await first.keyboard.press("ArrowRight");
    await setFader(first.getByTestId("effect-0"), 0.5);
    await expect(first.getByTestId("effect-0")).toHaveAttribute("aria-valuenow", "0.5");
    await holds(page, RED_RGB);
    await first.getByTestId("wheel-reset").click();
    await setFader(first.getByTestId("effect-0"), 1);
    await expect(first.getByTestId("effect-0")).toHaveAttribute("aria-valuenow", "1");
    await previewShows(first, BLUE_RGB);
    await holds(page, RED_RGB);
    await expectNoTextOnOutput(page);
  });

  await test.step("Go with a Crossfade: the output reaches the staged look", async () => {
    await first.getByTestId("scene-go").click();
    await showing(page, BLUE_RGB);
    // Live again, the profile tile reads the live look.
    await first.getByTestId("editing-live").click();
    await expect(profileTile(first, blueP)).toHaveAttribute("aria-pressed", "true");
    await first.getByTestId("editing-staged").click();
  });

  await test.step("save, save as new, rename that one, delete it", async () => {
    await first.getByTestId("scene-name").fill(SCENE);
    await first.getByTestId("scene-save").click();
    await expect(tile(first, SCENE)).toHaveAttribute("aria-pressed", "true");
    await first.getByTestId("scene-name").fill("Spare");
    await first.getByTestId("scene-save-new").click();
    await expect(tile(first, "Spare")).toHaveAttribute("aria-pressed", "true");
    await first.getByTestId("scene-name").fill(SPARE);
    await first.getByTestId("scene-rename").click();
    await expect(tile(first, SPARE)).toBeVisible();
    await first.getByTestId("scene-delete").click();
    await first
      .getByRole("dialog", { name: "Delete scene" })
      .getByRole("button", { name: "Delete" })
      .click();
    await expect(first.getByTestId("scene-tile")).toHaveText([SCENE]);
    keys.push((await first.evaluate(() => localStorage.getItem("djv.controlKey")))!);
  });

  await test.step("restart the server: the list remains; reload the screen: nothing staged, the scenes listed, the remembered profile drawn (AC14)", async () => {
    await server.close();
    await server.restart();
    await expect(page.getByTestId("control-switch")).not.toBeChecked({ timeout: 15_000 });
    await expect(page.getByTestId("panel-scene-picker").locator("option")).toHaveText([SCENE], {
      timeout: 15_000,
    });
    await page.reload();
    codes.push(await switchOn(page));
    const second = await controller(page, evidence); // a controller connecting lists the profiles
    await showing(page, BLUE_RGB);
    await expect(second.getByTestId("editing-staged")).toHaveCount(0);
    await expect(second.getByTestId("scene-go")).toBeDisabled();
    await expect(second.getByTestId("scene-tile")).toHaveText([SCENE]);
    await expect(page.getByTestId("panel-scene-picker").locator("option")).toHaveText([SCENE]);

    await test.step("a second controller asks for the preview: the stream moves, the first says so (AC29, PD16)", async () => {
      const third = await controller(page, evidence);
      await tile(second, SCENE).click();
      await expect(tile(second, SCENE)).toHaveAttribute("aria-pressed", "true");
      await previewShows(second, BLUE_RGB);
      await expect(third.getByTestId("preview-line")).toHaveText(
        "Preview is on another controller",
      );
      await third.getByTestId("preview-show-here").click();
      await previewShows(third, BLUE_RGB);
      await expect(second.getByTestId("preview-line")).toHaveText(
        "Preview is on another controller",
      );
      await expect(second.getByTestId("preview-video")).toHaveCount(0);
      await expectNoTextOnOutput(page);
      keys.push((await third.evaluate(() => localStorage.getItem("djv.controlKey")))!);
    });

    await test.step("a scene whose copy holds a custom effect stages and goes (AC26)", async () => {
      await profileTile(second, customP).click(); // a staged pick
      await expect(profileTile(second, customP)).toHaveAttribute("aria-pressed", "true");
      await second.getByTestId("scene-name").fill("Custom paint");
      await second.getByTestId("scene-save-new").click();
      await expect(tile(second, "Custom paint")).toHaveAttribute("aria-pressed", "true");
      await second.getByTestId("scene-unstage").click();
      await expect(second.getByTestId("editing-staged")).toHaveCount(0);
      await tile(second, "Custom paint").click();
      await expect(tile(second, "Custom paint")).toHaveAttribute("aria-pressed", "true");
      await second.getByTestId("scene-go").click();
      await showing(page, RED_RGB);
    });
  });

  await test.step("the screen page requested only the allow-list, wrote nothing, one screen socket per load; controllers only theirs; no ICE server anywhere (AC39)", async () => {
    const allowed =
      /^(GET (\/|\/assets\/[^/]+|\/api\/health|\/api\/profiles|\/api\/profiles\/[^/]+)|WS \/api\/control\/screen)$/;
    expect(evidence.screen.filter((r) => !allowed.test(r))).toEqual([]);
    expect(evidence.screen.filter((r) => /^(POST|PUT|DELETE) /.test(r))).toEqual([]);
    // One socket at a time: the first load's, its reconnect after the restart, the reload's.
    expect(evidence.screen.filter((r) => r.startsWith("WS "))).toEqual([
      "WS /api/control/screen",
      "WS /api/control/screen",
      "WS /api/control/screen",
    ]);
    expect(evidence.controllers).toContain("WS /api/control/device");
    expect(
      evidence.controllers.filter(
        (r) => !/^(GET \/control|GET \/assets\/[^/]+|WS \/api\/control\/device)$/.test(r),
      ),
    ).toEqual([]);
    expect(evidence.peers.length).toBeGreaterThanOrEqual(4); // two each side of two streams
    for (const config of evidence.peers) expect(config.iceServers ?? []).toEqual([]);
  });

  await test.step("no server or browser log line holds a scene's name, a definition, an SDP, a candidate, a key, a code or the User-Agent (AC26, AC40)", async () => {
    const agent = await page.evaluate(() => navigator.userAgent);
    expect(codes.every((c) => /^[A-Z2-9]{6}$/.test(c))).toBe(true);
    expect(keys.every((k) => /^[A-Za-z0-9_-]{22}$/.test(k))).toBe(true);
    const secrets = [
      SCENE,
      SPARE,
      "Custom paint",
      MARKER,
      CODE_TEXT,
      "v=0",
      "candidate:",
      agent,
      ...codes,
      ...keys,
    ];
    const serverText = JSON.stringify(server.lines);
    const browserText = JSON.stringify(evidence.console);
    for (const secret of secrets) {
      expect(serverText, `server log: ${secret}`).not.toContain(secret);
      expect(browserText, `browser console: ${secret}`).not.toContain(secret);
    }
    for (const msg of ["scene saved", "scene renamed", "scene deleted", "preview stream opened"]) {
      expect(
        server.lines.map((l) => l.msg),
        msg,
      ).toContain(msg);
    }
  });
});
