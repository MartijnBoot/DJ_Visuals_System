// B-06 T19 (spec AC12, AC19, AC23, AC25, AC26, AC34, SD18, SD25, SD27): the spec's scenario end to
// end, in order, with no source change — the screen page, one real `/control` page and two real
// `/send` pages (the gate's fake camera and microphone), against the in-process server with the
// address seam. Trust page, pairing, approval from the controller, Start, remote audio as main,
// the remote camera picked from the controller, the audio lost and restored, the camera lost with
// another picked in between, a screen reload, New code, a server restart. Throughout, every server
// log line (debug) and every console line of every page is kept for AC34, every request on
// CONTROL_PORT for AC5, and every peer connection's configuration for AC12.
//
// The `/send` pages capture the same fixture media as the screen, so what is drawn and analysed
// is told apart by state the pages show and log, never by colour or level. A loss is made by
// pausing the sender's encodings in its own page (the PD8 stall, as a Wi-Fi drop looks). The
// fallback and return are state changes logged in the screen page with their time, as `watchLink`
// does for D-10: AC19's "not before 3 s" is a lower bound on the rule, never a latency figure.
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { LAN_CONTEXT, startControlServer, type ControlServer } from "./control-server.ts";
import { record, start } from "./helpers.ts";

let server: ControlServer;
const contexts: BrowserContext[] = [];

test.beforeEach(async () => {
  server = await startControlServer();
});

test.afterEach(async () => {
  for (const c of contexts.splice(0)) await c.close();
  await server.dispose();
});

const PHONE = { width: 390, height: 844 };
const ENDED = "Pairing ended — scan the code again";

interface Logged {
  /** The page's URL path when it logged. */
  path: string;
  text: string;
  /** `performance.timeOrigin + performance.now()` in the page. */
  t: number;
}

/** What every page of the run left behind, collected outside the pages so a reload keeps it. */
interface Evidence {
  logs: Logged[];
  /** Playwright's own view of each console line, browser messages included. */
  console: string[];
  peers: RTCConfiguration[];
  /** "METHOD /path" or "WS /path", for every request to CONTROL_PORT. */
  lan: string[];
}

/**
 * Every console call, timed, and every peer connection's configuration, from each page of the
 * context, through bindings that outlive a reload; and every request it makes to CONTROL_PORT.
 */
async function watch(context: BrowserContext, evidence: Evidence) {
  await context.exposeBinding("__e2eLog", ({ page }, text: string, t: number) => {
    evidence.logs.push({ path: new URL(page.url()).pathname, text, t });
  });
  await context.exposeBinding("__e2ePeer", (_source, config: RTCConfiguration) => {
    evidence.peers.push(config);
  });
  await context.addInitScript(() => {
    type Hooks = {
      __e2eLog(text: string, t: number): void;
      __e2ePeer(config: RTCConfiguration): void;
      __pcs: RTCPeerConnection[];
    };
    const w = window as unknown as Hooks;
    const show = (a: unknown) => {
      if (typeof a === "string") return a;
      if (a instanceof Error) return `${a.name}: ${a.message}`;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    };
    for (const level of ["log", "info", "warn", "error", "debug"] as const) {
      const original = console[level].bind(console);
      console[level] = (...args: unknown[]) => {
        original(...args);
        void w.__e2eLog(args.map(show).join(" "), performance.timeOrigin + performance.now());
      };
    }
    w.__pcs = [];
    const Base = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends Base {
      constructor(config?: RTCConfiguration) {
        super(config);
        w.__pcs.push(this);
        void w.__e2ePeer(JSON.parse(JSON.stringify(config ?? {})) as RTCConfiguration);
      }
    };
  });
  context.on("console", (message) => evidence.console.push(message.text()));
  const onLan = (url: string) => new URL(url).port === String(server.controlPort);
  context.on("request", (r) => {
    if (onLan(r.url())) evidence.lan.push(`${r.method()} ${new URL(r.url()).pathname}`);
  });
  context.on("page", (page) =>
    page.on("websocket", (ws) => {
      if (onLan(ws.url())) evidence.lan.push(`WS ${new URL(ws.url()).pathname}`);
    }),
  );
}

async function lanContext(page: Page, evidence: Evidence, options = {}) {
  const context = await page
    .context()
    .browser()!
    .newContext({ ...LAN_CONTEXT, ...options });
  contexts.push(context);
  await watch(context, evidence);
  return context;
}

/** A `/send` page from the code's link, its media recorded. */
async function sendPage(
  page: Page,
  evidence: Evidence,
  code: string,
  sends: ("video" | "audio")[],
) {
  const sender = await (await lanContext(page, evidence)).newPage();
  await record(sender);
  await sender.goto(`${server.lanOrigin}/send#code=${code}`);
  const video = sender.getByTestId("send-video");
  const audio = sender.getByTestId("send-audio");
  if (sends.includes("video")) await video.check();
  else await video.uncheck();
  if (sends.includes("audio")) await audio.check();
  else await audio.uncheck();
  await sender.getByTestId("send-button").click();
  await expect(sender.getByTestId("link-line")).toHaveText("Waiting for approval");
  return sender;
}

/** Pauses or resumes the encoding of one kind on the sender's current connection (a stall). */
async function setSending(sender: Page, kind: "audio" | "video", on: boolean) {
  await sender.evaluate(
    async ({ kind, on }) => {
      const pc = (window as unknown as { __pcs: RTCPeerConnection[] }).__pcs.at(-1)!;
      for (const s of pc.getSenders()) {
        if (s.track?.kind !== kind) continue;
        const parameters = s.getParameters();
        for (const e of parameters.encodings ?? []) e.active = on;
        await s.setParameters(parameters);
      }
    },
    { kind, on },
  );
}

const tracks = (sender: Page) =>
  sender.evaluate(() =>
    (window as unknown as { __media: { tracks: MediaStreamTrack[] } }).__media.tracks.map(
      (t) => `${t.kind}:${t.id}:${t.readyState}`,
    ),
  );

/** Every status the link line shows from now on, in order, recorded in the page. */
async function watchLinkLine(sender: Page) {
  await sender.evaluate(() => {
    const w = window as unknown as { __lines: string[] };
    w.__lines = [];
    const line = document.querySelector("[data-testid=link-line]")!;
    new MutationObserver(() => w.__lines.push(line.textContent ?? "")).observe(line, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  });
  return () => sender.evaluate(() => (window as unknown as { __lines: string[] }).__lines);
}

/** Labels of every capture device the page can see, once it holds a permission. */
const deviceLabels = (p: Page) =>
  p.evaluate(async () =>
    (await navigator.mediaDevices.enumerateDevices()).map((d) => d.label).filter((l) => l),
  );

test("the spec's scenario end to end: pair, approve, Start, audio and camera fallback, reload, New code, restart — and nothing private in any log (AC12, AC19, AC23, AC25, AC26, AC34)", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const evidence: Evidence = { logs: [], console: [], peers: [], lan: [] };
  await watch(page.context(), evidence);
  const codes: string[] = [];
  const keys: string[] = [];
  const labels = new Set<string>();
  /** The first screen-page log line after `after` whose text holds every part. */
  const screenLog = (parts: string[], after = 0) =>
    evidence.logs.find(
      (l) => l.path === "/" && l.t > after && parts.every((p) => l.text.includes(p)),
    );
  const logged = async (parts: string[], after = 0) => {
    await expect.poll(() => screenLog(parts, after) !== undefined, { timeout: 20_000 }).toBe(true);
    return screenLog(parts, after)!;
  };

  await record(page);
  await page.goto(`${server.origin}/`);
  await page.getByTestId("control-switch").click();
  await expect(page.getByTestId("control-switch")).toBeChecked();
  codes.push((await page.getByTestId("control-code").textContent())!);
  const controlUrl = (await page.getByTestId("control-url").textContent())!;

  let phone!: Page;
  await test.step("the trust page is reachable on the LAN listener (AC6)", async () => {
    phone = await (await lanContext(page, evidence, { viewport: PHONE })).newPage();
    await phone.goto(`${server.lanOrigin}/trust`);
    await expect(phone.getByTestId("trust-fingerprint")).toHaveText(
      (await page.getByTestId("control-trust-fingerprint").textContent())!,
    );
    const download = await phone.request.get(`${server.lanOrigin}/trust?download`);
    expect(download.status()).toBe(200);
    expect(download.headers()["content-type"]).toBe("application/x-x509-ca-cert");
  });

  let both!: Page; // Device 2: video and audio
  let video!: Page; // Device 3: video
  await test.step("pair: the controller from the panel, the senders approved from the controller", async () => {
    await phone.goto(controlUrl);
    await expect(phone.getByTestId("link-line")).toHaveText("Waiting for approval");
    await page.getByTestId("control-accept").click();
    await expect(phone.getByTestId("link-line")).toHaveText("Connected");
    keys.push((await phone.evaluate(() => localStorage.getItem("djv.controlKey")))!);

    await phone.getByTestId("mode-vj").click();
    both = await sendPage(page, evidence, codes[0]!, ["video", "audio"]);
    video = await sendPage(page, evidence, codes[0]!, ["video"]);
    for (const [sender, n] of [
      [both, 2],
      [video, 3],
    ] as const) {
      const request = phone.locator(`[data-testid=approvals] li:has-text("Device ${n} wants")`);
      await request.getByTestId("approve").click();
      await expect(sender.getByTestId("send-line-video")).toHaveText("Standing by", {
        timeout: 20_000,
      });
      keys.push((await sender.evaluate(() => localStorage.getItem("djv.sendKey")))!);
      for (const l of await deviceLabels(sender)) labels.add(l);
    }
    await expect(both.getByTestId("send-line-audio")).toHaveText("Standing by");
    await phone.getByTestId("mode-dj").click();
  });

  const remoteTile = (n: number) =>
    phone.locator(`[data-testid=camera-tile][data-camera-id^="remote:"]:has-text("Device ${n}")`);

  await test.step("Start: the remote audio becomes main", async () => {
    await start(page, { reopen: false });
    await page.keyboard.press("o");
    await expect(page.getByTestId("overlay-audio")).toHaveText("audio: remote (Device 2) ok", {
      timeout: 20_000,
    });
    await expect(phone.getByTestId("main-audio-line")).toHaveText("audio: remote (Device 2) ok");
    await expect(both.getByTestId("send-line-audio")).toHaveText("Sending audio");
    for (const l of await deviceLabels(page)) labels.add(l);
  });

  await test.step("the remote camera picked from the controller (AC15)", async () => {
    await expect(remoteTile(2)).toBeEnabled({ timeout: 20_000 });
    await remoteTile(2).click();
    await expect(remoteTile(2)).toHaveAttribute("aria-pressed", "true", { timeout: 20_000 });
    await expect(page.getByTestId("overlay-camera")).toHaveText("camera: remote (Device 2) ok", {
      timeout: 20_000,
    });
    await expect(both.getByTestId("send-line-video")).toHaveText("On screen");
    await expect(video.getByTestId("send-line-video")).toHaveText("Standing by");
  });

  await test.step("the sender's audio stops: local at once; back, remote again after 3 s and not before (AC18, AC19)", async () => {
    const before = Date.now() - 60_000;
    await setSending(both, "audio", false);
    const lost = await logged(["remote audio lost", "Device 2"], before);
    const fallback = await logged(["fallback local", "Device 2"], before);
    expect(fallback.t).toBeGreaterThanOrEqual(lost.t);
    await expect(page.getByTestId("overlay-audio")).toHaveText(
      "audio: local (fallback: remote lost)",
    );

    await setSending(both, "audio", true);
    const flowing = await logged(["audio flowing", "Device 2"], fallback.t);
    const restored = await logged(["restored remote", "Device 2"], fallback.t);
    expect(restored.t - flowing.t).toBeGreaterThanOrEqual(3000);
    await expect(page.getByTestId("overlay-audio")).toHaveText("audio: remote (Device 2) ok");
  });

  await test.step("the camera is lost, another is picked in between, and that pick stands when it is back (AC22, AC23)", async () => {
    const before = Date.now() - 60_000;
    await setSending(both, "video", false);
    await logged(["video stalled", "Device 2"], before);
    await expect(page.getByTestId("overlay-camera")).toHaveText("camera: ok", {
      timeout: 10_000,
    });
    await remoteTile(3).click();
    await expect(remoteTile(3)).toHaveAttribute("aria-pressed", "true", { timeout: 20_000 });
    await expect(page.getByTestId("overlay-camera")).toHaveText("camera: remote (Device 3) ok", {
      timeout: 20_000,
    });
    await expect(video.getByTestId("send-line-video")).toHaveText("On screen");

    const stalled = screenLog(["video stalled", "Device 2"], before)!;
    await setSending(both, "video", true);
    const back = await logged(["video flowing", "Device 2"], stalled.t);
    // Past the 3 s after which the lost camera would have returned had nothing been picked.
    await page.waitForFunction(
      (t) => performance.timeOrigin + performance.now() > t + 3500,
      back.t,
    );
    await expect(page.getByTestId("overlay-camera")).toHaveText("camera: remote (Device 3) ok");
    await expect(remoteTile(3)).toHaveAttribute("aria-pressed", "true");
    await expect(remoteTile(2)).toHaveAttribute("aria-pressed", "false");
  });

  await test.step("a screen reload: Screen reconnecting…, then connected again with the same capture, paused until Start (AC24, AC25)", async () => {
    const lines = [await watchLinkLine(both), await watchLinkLine(video)];
    const held = [await tracks(both), await tracks(video)];
    await page.reload();
    for (const sender of [both, video]) {
      await expect(sender.getByTestId("link-line")).toHaveText("Connected", { timeout: 20_000 });
      await expect(sender.getByTestId("send-line-video")).toHaveText("Standing by", {
        timeout: 20_000,
      });
    }
    for (const read of lines) {
      const shown = await read();
      expect(shown).toContain("Screen reconnecting…");
      expect(shown.at(-1)).toBe("Connected");
    }
    expect([await tracks(both), await tracks(video)]).toEqual(held);
    expect(held.flat().every((t) => t.endsWith(":live"))).toBe(true);
    await expect(both.getByTestId("send-line-audio")).toHaveText("Standing by");

    await start(page);
    await expect(both.getByTestId("send-line-audio")).toHaveText("Sending audio", {
      timeout: 20_000,
    });
    await expect(phone.getByTestId("main-audio-line")).toHaveText("audio: remote (Device 2) ok", {
      timeout: 20_000,
    });
  });

  await test.step("New code: every sender's pairing ends and its capture stops (AC26)", async () => {
    await page.getByTestId("control-new-code").click();
    await expect(page.getByTestId("control-code")).not.toHaveText(codes[0]!);
    codes.push((await page.getByTestId("control-code").textContent())!);
    for (const p of [both, video, phone]) {
      await expect(p.getByTestId("link-line")).toHaveText(ENDED, { timeout: 15_000 });
    }
    for (const sender of [both, video]) {
      await expect
        .poll(async () => (await tracks(sender)).every((t) => t.endsWith(":ended")))
        .toBe(true);
      expect(await sender.evaluate(() => localStorage.getItem("djv.sendKey"))).toBeNull();
    }
  });

  await test.step("a server restart ends a sender's pairing and stops its capture (AC26)", async () => {
    const last = await sendPage(page, evidence, codes[1]!, ["video"]);
    await page.getByTestId("control-accept").click();
    await expect(last.getByTestId("send-line-video")).toHaveText("Standing by", {
      timeout: 20_000,
    });
    keys.push((await last.evaluate(() => localStorage.getItem("djv.sendKey")))!);

    await server.close();
    await expect(last.getByTestId("link-line")).toHaveText("Reconnecting…", { timeout: 15_000 });
    await server.restart();
    await expect(page.getByTestId("control-switch")).not.toBeChecked({ timeout: 15_000 });
    await page.getByTestId("control-switch").click();
    await expect(page.getByTestId("control-switch")).toBeChecked();
    codes.push((await page.getByTestId("control-code").textContent())!);
    await expect(last.getByTestId("link-line")).toHaveText(ENDED, { timeout: 15_000 });
    await expect
      .poll(async () => (await tracks(last)).every((t) => t.endsWith(":ended")))
      .toBe(true);
  });

  await test.step("no ICE server on any peer connection, and only AC5's routes on CONTROL_PORT (AC5, AC12)", async () => {
    expect(evidence.peers.length).toBeGreaterThan(4);
    for (const config of evidence.peers) expect(config.iceServers ?? []).toEqual([]);
    const allowed = /^(GET \/(control|send|trust)|GET \/assets\/[^/]+|WS \/api\/control\/device)$/;
    expect(evidence.lan.filter((r) => !allowed.test(r))).toEqual([]);
    expect(evidence.lan).toContain("GET /send");
    expect(evidence.lan).toContain("GET /trust");
  });

  await test.step("no server or browser log line holds an SDP, a candidate, a key, a code, the User-Agent or a device label (AC34, SD25)", async () => {
    const agent = await page.evaluate(() => navigator.userAgent);
    const secrets = [
      "v=0",
      "candidate:",
      "PRIVATE KEY",
      agent,
      ...codes,
      ...keys,
      ...[...labels].filter((l) => l.length > 3),
    ];
    expect(codes.every((c) => /^[A-Z2-9]{6}$/.test(c))).toBe(true);
    expect(keys.every((k) => /^[A-Za-z0-9_-]{22}$/.test(k))).toBe(true);
    expect(labels.size).toBeGreaterThan(0);
    const server_ = JSON.stringify(server.lines);
    const browser = JSON.stringify([evidence.logs.map((l) => l.text), evidence.console]);
    for (const secret of secrets) {
      expect(server_, `server log: ${secret}`).not.toContain(secret);
      expect(browser, `browser console: ${secret}`).not.toContain(secret);
    }
    // The steps are logged, by sequence label and role only (SD25).
    for (const msg of ["sender requested", "sender accepted"]) {
      expect(
        server.lines.map((l) => l.msg),
        msg,
      ).toContain(msg);
    }
  });
});
