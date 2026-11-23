// B-09 T6 (spec SD3, SD4, SD12 to SD14, SD16, SD18, AC1 to AC5, AC17, AC20, AC26; plan PD7 to PD10):
// the six transitions as pixels on the real screen page against the in-process server. The choice
// is seeded through `djv.transition` before load, or set in the panel; flat profiles make a pixel
// say which look it shows. Every frame is read in a `requestAnimationFrame` callback registered
// after the engine's, so it reads that frame's drawing with that frame's timestamp — the engine's
// own clock for progress. Nothing here is a wall-clock bound (B-08): progress is checked by
// consistency between frames, never against how long a step took.
import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import type { ScreenState } from "../../shared/src/control.ts";
import {
  deviceClient,
  LAN_CONTEXT,
  startControlServer,
  type ControlServer,
  type DeviceClient,
} from "./control-server.ts";
import {
  BLUE_RGB,
  blue,
  createProfile,
  GREEN_RGB,
  primaryBlue,
  RED_RGB,
  red,
  redOverGreen,
} from "./fixtures/profiles.ts";
import { near, patch, record, start } from "./helpers.ts";

/** Small, so each frame can be read whole: Dissolve's blocks are 10 px, 32 across, 18 down. */
const SIZE = { width: 320, height: 180 };
test.use({ viewport: SIZE });

/** The gate's colour tolerance (`profiles.spec.ts`). */
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

type Rgb = number[];
interface Frame {
  /** The frame's `requestAnimationFrame` timestamp: the engine's clock. */
  t: number;
  /** The colour at each sampled point. */
  px: Rgb[];
}

/** The screen page with `choice` remembered, the generative input (no camera). */
async function screen(page: Page, choice: { kind: string; duration: number; keepColour: boolean }) {
  await record(page, { cameraDenied: true });
  await page.addInitScript(
    (c) => localStorage.setItem("djv.transition", JSON.stringify(c)),
    choice,
  );
  await page.goto(`${server.origin}/`);
}

const picker = (page: Page) => page.getByTestId("profile-picker");
const centre = (page: Page) => patch(page, SIZE.width / 2, SIZE.height / 2);
const showing = (page: Page, rgb: readonly number[]) =>
  expect.poll(async () => near(await centre(page), rgb, TOLERANCE), { timeout: 15_000 }).toBe(true);

/**
 * Reads `points` from every frame for `ms` of frame time; returns once done. Start it, make the
 * pick, then await it.
 */
function sample(page: Page, points: readonly (readonly [number, number])[], ms: number) {
  return page.evaluate(
    ([pts, duration]) =>
      new Promise<{ t: number; px: number[][] }[]>((resolve) => {
        const canvas = document.querySelector<HTMLCanvasElement>("[data-testid=screen]")!;
        const copy = document.createElement("canvas");
        const g = copy.getContext("2d", { willReadFrequently: true })!;
        const out: { t: number; px: number[][] }[] = [];
        let first: number | null = null;
        requestAnimationFrame(function each(t) {
          first ??= t;
          if (copy.width !== canvas.width || copy.height !== canvas.height) {
            copy.width = canvas.width;
            copy.height = canvas.height;
          }
          g.drawImage(canvas, 0, 0);
          const d = g.getImageData(0, 0, copy.width, copy.height).data;
          out.push({
            t,
            px: pts.map(([x, y]) => {
              const i = (y! * copy.width + x!) * 4;
              return [d[i]!, d[i + 1]!, d[i + 2]!];
            }),
          });
          if (t - first < duration) requestAnimationFrame(each);
          else resolve(out);
        });
      }),
    [points, ms] as const,
  );
}

const CENTRE = [[SIZE.width / 2, SIZE.height / 2]] as const;
const isNear = (rgb: readonly number[]) => (c: Rgb) => near(c, rgb, TOLERANCE);
const luma = ([r, g, b]: Rgb) => 0.299 * r! + 0.587 * g! + 0.114 * b!;

/** No frame of any type is black (the `profiles.spec.ts` rule, AD6). */
function expectNeverBlack(frames: Frame[]) {
  for (const f of frames) {
    const mean = f.px.reduce((sum, c) => sum + luma(c), 0) / f.px.length;
    expect(mean, `frame at ${f.t}`).toBeGreaterThanOrEqual(2);
  }
}

const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;

/**
 * AC1's law on the centre pixel between two flat colours: monotonic, each intermediate frame a mix
 * of the two at one progress `w` (the `to` channel's share), every `w` explained by one start time
 * and the duration, and only `to` from the end on. Returns the start time.
 */
function expectCrossfade(
  frames: Frame[],
  from: { rgb: readonly number[]; channel: number },
  to: { rgb: readonly number[]; channel: number },
  durationMs: number,
) {
  const colours = frames.map((f) => f.px[0]!);
  for (let i = 1; i < colours.length; i++) {
    expect(colours[i]![from.channel]!, `frame ${i}`).toBeLessThanOrEqual(
      colours[i - 1]![from.channel]! + 4,
    );
    expect(colours[i]![to.channel]!, `frame ${i}`).toBeGreaterThanOrEqual(
      colours[i - 1]![to.channel]! - 4,
    );
  }
  const mids = frames.filter((f) => !isNear(from.rgb)(f.px[0]!) && !isNear(to.rgb)(f.px[0]!));
  expect(mids.length, "intermediate frames").toBeGreaterThanOrEqual(5);
  const other = [0, 1, 2].find((c) => c !== from.channel && c !== to.channel)!;
  for (const f of mids) {
    const c = f.px[0]!;
    expect(c[other]!, `frame at ${f.t}`).toBeLessThanOrEqual(TOLERANCE);
    expect(
      Math.abs(c[from.channel]! + c[to.channel]! - 255),
      `frame at ${f.t}`,
    ).toBeLessThanOrEqual(16);
  }
  // Each intermediate frame's share of the new look, at its own frame time, names one start.
  const starts = mids.map((f) => f.t - (f.px[0]![to.channel]! / 255) * durationMs);
  expect(Math.max(...starts) - Math.min(...starts)).toBeLessThanOrEqual(120);
  const t0 = median(starts);
  for (const f of frames) {
    if (f.t >= t0 + durationMs + 60) expect(isNear(to.rgb)(f.px[0]!), `frame at ${f.t}`).toBe(true);
  }
  expect(isNear(to.rgb)(frames.at(-1)!.px[0]!)).toBe(true);
  return t0;
}

/** A device paired to the screen, speaking the socket directly; `send` numbers each control. */
async function paired(page: Page) {
  await page.getByTestId("control-switch").click();
  await expect(page.getByTestId("control-switch")).toBeChecked();
  const code = (await page.getByTestId("control-code").textContent())!;
  const context = await page.context().browser()!.newContext(LAN_CONTEXT);
  contexts.push(context);
  const device: DeviceClient = await deviceClient(context, server);
  await device.send({ type: "hello", code });
  await page.getByTestId("control-accept").click();
  await device.waitFor("approved");
  let seq = 0;
  return {
    send: (control: Record<string, unknown>) => device.send({ ...control, seq: ++seq }),
    async state(): Promise<ScreenState | undefined> {
      const states = (await device.messages()).filter((m) => m.type === "state");
      const last = states.at(-1);
      return last?.type === "state" ? last.state : undefined;
    },
  };
}

test("Crossfade mixes the old look into the new one by frame time over its duration (AC1)", async ({
  page,
}) => {
  await createProfile(api, red());
  const to = await createProfile(api, blue());
  await screen(page, { kind: "crossfade", duration: 2, keepColour: false });
  await start(page);
  await picker(page).selectOption({ label: "Aaa Red" });
  await showing(page, RED_RGB);
  const sampling = sample(page, CENTRE, 3500);
  await page.waitForTimeout(300);
  await picker(page).selectOption(to.id);
  const frames = await sampling;
  expectCrossfade(frames, { rgb: RED_RGB, channel: 0 }, { rgb: BLUE_RGB, channel: 2 }, 2000);
  expectNeverBlack(frames);
});

test("Dissolve flips whole blocks a 32nd of the width wide, never back, all by the end (AC2)", async ({
  page,
}) => {
  await createProfile(api, red());
  const to = await createProfile(api, blue());
  await screen(page, { kind: "dissolve", duration: 2, keepColour: false });
  await start(page);
  await picker(page).selectOption({ label: "Aaa Red" });
  await showing(page, RED_RGB);
  const centres: [number, number][] = [];
  for (let j = 0; j < 18; j++) for (let i = 0; i < 32; i++) centres.push([10 * i + 5, 10 * j + 5]);
  const sampling = sample(page, centres, 3500);
  await page.waitForTimeout(300);
  await picker(page).selectOption(to.id);
  const frames = await sampling;
  // Checked in plain code and asserted once: an `expect` per block per frame is over 100 000
  // stack captures, which stalls the runner in synchronous code no timeout can interrupt.
  const problems: string[] = [];
  let before: number[] | null = null;
  const counts: number[] = [];
  for (const f of frames) {
    const flipped: number[] = f.px.map((c, k) => {
      if (isNear(BLUE_RGB)(c)) return 1;
      if (!isNear(RED_RGB)(c)) problems.push(`block ${k} at ${f.t} is ${c.join(",")}`);
      return 0;
    });
    if (before) {
      flipped.forEach((v, k) => {
        if (v < before![k]!) problems.push(`block ${k} went back at ${f.t}`);
      });
    }
    before = flipped;
    counts.push(flipped.reduce((a, b) => a + b, 0));
  }
  expect(problems.slice(0, 10)).toEqual([]);
  expect(
    counts.filter((n) => n > 0 && n < centres.length).length,
    "partial frames",
  ).toBeGreaterThanOrEqual(3);
  expect(counts.at(-1)).toBe(centres.length);
  expectNeverBlack(frames);
});

test("Wipe sweeps left to right with a soft edge 4% wide, the frame all new at the end (AC3)", async ({
  page,
}) => {
  await createProfile(api, red());
  const to = await createProfile(api, blue());
  await screen(page, { kind: "wipe", duration: 2, keepColour: false });
  await start(page);
  await picker(page).selectOption({ label: "Aaa Red" });
  await showing(page, RED_RGB);
  const row = Array.from(
    { length: SIZE.width },
    (_, x) => [x, SIZE.height / 2] as [number, number],
  );
  const sampling = sample(page, row, 3500);
  await page.waitForTimeout(300);
  await picker(page).selectOption(to.id);
  const frames = await sampling;
  const edge = 0.04 * SIZE.width;
  const halves: { t: number; x: number }[] = [];
  const problems: string[] = []; // asserted once, as in the Dissolve test
  for (const f of frames) {
    const share = f.px.map((c) => c[2]! / 255); // the new look's share at each x
    for (let x = 1; x < share.length; x++) {
      // Never new right of old.
      if (share[x]! > share[x - 1]! + 0.05) problems.push(`x ${x} at ${f.t} newer than x ${x - 1}`);
    }
    const soft = share.flatMap((w, x) => (w > 0.1 && w < 0.9 ? [x] : []));
    if (soft.length === 0) continue;
    const [left, right] = [Math.min(...soft), Math.max(...soft)];
    if (right - left > edge + 2) problems.push(`edge ${right - left} px wide at ${f.t}`);
    for (let x = 0; x < left; x++) {
      if (share[x]! < 0.9) problems.push(`x ${x} left of the edge not new at ${f.t}`);
    }
    for (let x = right + 1; x < share.length; x++) {
      if (share[x]! > 0.1) problems.push(`x ${x} right of the edge not old at ${f.t}`);
    }
    const half = share.findIndex((w) => w < 0.5);
    if (half > 0 && half < 0.9 * SIZE.width) halves.push({ t: f.t, x: half });
  }
  expect(problems.slice(0, 10)).toEqual([]);
  expect(halves.length, "frames with the edge on screen").toBeGreaterThanOrEqual(5);
  for (let i = 1; i < halves.length; i++)
    expect(halves[i]!.x).toBeGreaterThanOrEqual(halves[i - 1]!.x);
  // The edge's half-way point sits 2% behind p: one start time explains every frame.
  const starts = halves.map((h) => h.t - ((h.x + 0.5) / SIZE.width + 0.02) * 2000);
  expect(Math.max(...starts) - Math.min(...starts)).toBeLessThanOrEqual(120);
  expect(frames.at(-1)!.px.every(isNear(BLUE_RGB))).toBe(true);
  expectNeverBlack(frames);
});

test("Dip passes through the outgoing primary at half way, whatever colour comes during it (AC4)", async ({
  page,
}) => {
  await createProfile(api, redOverGreen());
  const to = await createProfile(api, blue());
  await screen(page, { kind: "cut", duration: 2, keepColour: false });
  await start(page);
  const device = await paired(page);
  await picker(page).selectOption({ label: "Aaa Red over green" });
  await showing(page, RED_RGB);
  await page.getByTestId("transition-kind").selectOption("dip");
  await page.getByTestId("transition-duration").focus();
  await page.keyboard.press("End");
  await expect(page.getByTestId("transition-duration-readout")).toHaveText("8.0 s");
  const sampling = sample(page, CENTRE, 10_000);
  await page.waitForTimeout(300);
  await picker(page).selectOption(to.id);
  await expect.poll(async () => (await device.state())?.activeId).toBe(to.id);
  // A colour during the dip, before half way: the incoming look's, never the dip's (SD12).
  await device.send({ type: "colour", slot: 0, value: "#ffff00" });
  const frames = await sampling;
  const distance = (c: Rgb) => Math.max(...c.map((v, i) => Math.abs(v - GREEN_RGB[i]!)));
  const greenest = frames.reduce((a, b) => (distance(b.px[0]!) < distance(a.px[0]!) ? b : a));
  expect(near(greenest.px[0]!, GREEN_RGB, TOLERANCE), `nearest green: ${greenest.px[0]}`).toBe(
    true,
  );
  // The colour reached the incoming look: it no longer draws its stored blue.
  expect(isNear(BLUE_RGB)(frames.at(-1)!.px[0]!)).toBe(false);
  expectNeverBlack(frames);
});

test("before Start, Beat cut cuts with no intermediate frame and a Crossfade runs (AC5, AC26)", async ({
  page,
}) => {
  const from = await createProfile(api, red());
  const to = await createProfile(api, blue());
  await screen(page, { kind: "beatCut", duration: 2, keepColour: false });
  // The panel lists the profiles on opening, before Start (B-02 AC11).
  await expect(page.getByTestId("panel")).toBeVisible();
  await page.keyboard.press("s");
  await expect(page.getByTestId("panel")).toHaveCount(0);
  await page.keyboard.press("s");
  await expect(picker(page)).toBeEnabled();
  await picker(page).selectOption(from.id);
  await showing(page, RED_RGB);
  const cutting = sample(page, CENTRE, 2500);
  await page.waitForTimeout(300);
  await picker(page).selectOption(to.id);
  const cut = await cutting;
  for (const f of cut) {
    const c = f.px[0]!;
    expect(isNear(RED_RGB)(c) || isNear(BLUE_RGB)(c), `frame at ${f.t}: ${c.join(",")}`).toBe(true);
  }
  expect(isNear(BLUE_RGB)(cut.at(-1)!.px[0]!)).toBe(true);
  await expect(page.getByRole("button", { name: "Start" })).toBeVisible(); // still before Start

  await page.getByTestId("transition-kind").selectOption("crossfade");
  const fading = sample(page, CENTRE, 3500);
  await page.waitForTimeout(300);
  await picker(page).selectOption(from.id);
  const frames = await fading;
  expectCrossfade(frames, { rgb: BLUE_RGB, channel: 2 }, { rgb: RED_RGB, channel: 0 }, 2000);
  expectNeverBlack([...cut, ...frames]);
});

test("Keep colour carries the live primary across a Cut; Reset restores it; a re-pick fades back (AC17, AC20)", async ({
  page,
}) => {
  await createProfile(api, redOverGreen());
  const to = await createProfile(api, primaryBlue());
  await screen(page, { kind: "cut", duration: 2, keepColour: true });
  await start(page);
  const device = await paired(page);
  await picker(page).selectOption({ label: "Aaa Red over green" });
  await showing(page, RED_RGB);
  // A live edit of the outgoing primary: invisible on it, which paints red by code.
  await device.send({ type: "colour", slot: 0, value: "#ff00ff" });
  await expect.poll(async () => (await device.state())?.palette[0]).toBe("#ff00ff");
  await showing(page, RED_RGB);

  await picker(page).selectOption(to.id);
  await showing(page, [255, 0, 255]);
  await expect.poll(async () => (await device.state())?.activeId).toBe(to.id);
  const carried = (await device.state())!;
  expect(carried.palette[carried.primary]).toBe("#ff00ff");
  expect(carried.storedPalette[carried.primary]).toBe("#0000ff");
  await device.send({ type: "resetColour", slot: carried.primary });
  await showing(page, BLUE_RGB);

  // Live green, then a re-pick of the same profile with Crossfade and Keep colour off.
  await device.send({ type: "colour", slot: 0, value: "#00ff00" });
  await showing(page, GREEN_RGB);
  await page.getByTestId("transition-kind").selectOption("crossfade");
  await page.getByTestId("transition-keep-colour").uncheck();
  await expect
    .poll(async () => (await device.state())?.transition)
    .toEqual({
      kind: "crossfade",
      duration: 2,
      keepColour: false,
    });
  const sampling = sample(page, CENTRE, 3500);
  await page.waitForTimeout(300);
  await device.send({ type: "pick", id: to.id });
  const frames = await sampling;
  expectCrossfade(frames, { rgb: GREEN_RGB, channel: 1 }, { rgb: BLUE_RGB, channel: 2 }, 2000);
  await expect.poll(async () => (await device.state())?.palette[0]).toBe("#0000ff");
  expectNeverBlack(frames);
});
