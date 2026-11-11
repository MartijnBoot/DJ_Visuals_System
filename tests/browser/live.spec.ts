// The live chain in a real browser on the fake devices (B-01 AC6, AC7, AC8, AC10, AC12, AC13,
// AC15, AC17; plan PD8, PD13, PD21, PD22, T9): the click track's beats, the dials in pixels,
// the latency number, loss and reattachment, and render scaling. Measured values are attached
// to the report next to the thresholds they are held to.
import { expect, test, type Page } from "@playwright/test";
import { LEFT_RGB, RIGHT_RGB } from "./fixtures/media.ts";
import {
  expectCanvasChanging,
  meanRgb,
  near,
  patch,
  pixels,
  record,
  setFailing,
  slide,
  start,
  unplug,
} from "./helpers.ts";

const PERIOD_MS = 500; // the fixture's 120 BPM

function note(name: string, value: unknown) {
  test.info().annotations.push({ type: name, description: JSON.stringify(value) });
  console.log(`${name}: ${JSON.stringify(value)}`);
}

/** Samples a panel meter every `everyMs` in the page, for `forMs`. */
async function sampleMeter(page: Page, name: string, forMs: number, everyMs: number) {
  return page.evaluate(
    ([n, total, every]) =>
      new Promise<{ t: number; v: number }[]>((resolve) => {
        const el = document.querySelector(`[data-testid=meter-${n}]`)!;
        const out: { t: number; v: number }[] = [];
        const t0 = performance.now();
        const id = setInterval(() => {
          const t = performance.now() - t0;
          out.push({ t, v: Number(el.getAttribute("data-value")) });
          if (t >= (total as number)) {
            clearInterval(id);
            resolve(out);
          }
        }, every as number);
      }),
    [name, forMs, everyMs] as const,
  );
}

test("the beat fires on each click of the track and not between (AC6)", async ({ page }) => {
  await record(page);
  await page.goto("/");
  await start(page);
  await page.waitForTimeout(1000); // past the first second: the adaptive threshold has history
  const samples = await sampleMeter(page, "beat", 3000, 50);
  const rises = samples.filter((s, i) => s.v >= 0.5 && (i === 0 || samples[i - 1]!.v < 0.5));
  const gaps = rises.slice(1).map((r, i) => Math.round(r.t - rises[i]!.t));
  // The last 200 ms of each gap, measured from the meter's rise and stopping short of the next
  // click (owner's decision of 2026-11-11: PD7's 120 ms decay is kept, so a gap's middle still
  // carries the tail of the pulse; its end must not).
  const ends = rises.map((r) =>
    samples.filter((s) => s.t >= r.t + 280 && s.t <= r.t + 480).map((s) => s.v),
  );
  const worstEnd = Math.max(...ends.flat());
  note(
    "AC6 rises (ms)",
    rises.map((r) => Math.round(r.t)),
  );
  note("AC6 rise spacing (ms)", gaps);
  note("AC6 worst beat in a gap's last 200 ms (threshold ≤ 0.1)", worstEnd);
  expect(rises.length).toBeGreaterThanOrEqual(5);
  for (const gap of gaps) expect(Math.abs(gap - PERIOD_MS)).toBeLessThanOrEqual(100);
  expect(worstEnd).toBeLessThanOrEqual(0.1);
});

test("reactivity 0 ignores the beat; at 0.7 a click changes the picture (AC7)", async ({
  page,
}) => {
  await record(page, { cameraDenied: true }); // the generative input: audio and the tint only
  await page.goto("/");
  await start(page);
  await expect(page.getByTestId("panel-camera-state")).toHaveText("camera: none");
  const { width, height } = page.viewportSize()!;

  /** Frame-by-frame centre 16×16 means with the beat meter, for 3 s. */
  const frames = () =>
    page.evaluate(
      ([cx, cy]) =>
        new Promise<{ t: number; rgb: number[]; beat: number }[]>((resolve) => {
          const canvas = document.querySelector<HTMLCanvasElement>("[data-testid=screen]")!;
          const beat = document.querySelector("[data-testid=meter-beat]")!;
          const copy = document.createElement("canvas");
          copy.width = copy.height = 16;
          const g = copy.getContext("2d", { willReadFrequently: true })!;
          const out: { t: number; rgb: number[]; beat: number }[] = [];
          const t0 = performance.now();
          requestAnimationFrame(function each(now) {
            g.drawImage(canvas, cx! - 8, cy! - 8, 16, 16, 0, 0, 16, 16);
            const d = g.getImageData(0, 0, 16, 16).data;
            const sum = [0, 0, 0];
            for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) sum[c]! += d[i + c]!;
            out.push({
              t: now,
              rgb: sum.map((v) => v / 256),
              beat: Number(beat.getAttribute("data-value")),
            });
            if (now - t0 < 3000) requestAnimationFrame(each);
            else resolve(out);
          });
        }),
      [width / 2, height / 2] as const,
    );
  /** For each frame at a click (meter ≥ 0.5), the mean channel difference to 100 ms before. */
  const atClicks = (run: Awaited<ReturnType<typeof frames>>) =>
    run
      .filter((f) => f.beat >= 0.5)
      .map((f) => {
        const before = run.reduce((best, g) =>
          Math.abs(g.t - (f.t - 100)) < Math.abs(best.t - (f.t - 100)) ? g : best,
        );
        return f.rgb.reduce((s, v, c) => s + Math.abs(v - before.rgb[c]!), 0) / 3;
      });

  await slide(page, "reactivity", "Home");
  const still = atClicks(await frames());
  await slide(page, "reactivity", "End"); // 1.0, then back down to 0.7 with the arrow keys
  for (let i = 0; i < 30; i++) await page.keyboard.press("ArrowLeft");
  await expect(page.getByTestId("slider-reactivity")).toHaveValue("0.7");
  const moving = atClicks(await frames());
  note(
    "AC7 reactivity 0: frame-to-100-ms-before differences at clicks (≤ 4)",
    still.map(Math.round),
  );
  note("AC7 reactivity 0.7: differences at clicks (max ≥ 16)", moving.map(Math.round));
  expect(still.length).toBeGreaterThan(0);
  expect(Math.max(...still)).toBeLessThanOrEqual(4);
  expect(Math.max(...moving)).toBeGreaterThanOrEqual(16);
});

test("recognisability 0 shows the camera; at 1 nothing finer than a block (AC8, PD8, PD22)", async ({
  page,
}) => {
  await record(page);
  await page.goto("/");
  await start(page);
  const { width, height } = page.viewportSize()!;
  const block = width / 32; // in canvas pixels at any render scale

  // Recognisability 1 at the default reactivity 0.7 (PD22): every block is flat.
  await slide(page, "recognisability", "End");
  await page.waitForTimeout(500);
  const blocks = [
    [3, 4],
    [10, 9],
    [20, 3],
    [28, 14],
  ];
  let worstSpread = 0;
  for (let read = 0; read < 3; read++) {
    for (const [bx, by] of blocks) {
      const margin = 2; // the scaled blit blends the outermost pixel of a block
      const data = await pixels(
        page,
        bx! * block + margin,
        by! * block + margin,
        block - 2 * margin,
        block - 2 * margin,
      );
      for (let i = 0; i < data.length; i += 4) {
        for (let c = 0; c < 3; c++)
          worstSpread = Math.max(worstSpread, Math.abs(data[i + c]! - data[c]!));
      }
    }
  }
  note("AC8 worst channel spread inside a block at recognisability 1 (≤ 1)", worstSpread);
  expect(worstSpread).toBeLessThanOrEqual(1);

  // ...and still follows the camera: the halves swap twice a second.
  const left: number[][] = [];
  for (let i = 0; i < 12; i++) {
    left.push(meanRgb(await pixels(page, width / 4 - 2, height / 2 - 2, 4, 4)));
    await page.waitForTimeout(100);
  }
  const range = Math.max(
    ...[0, 1, 2].map(
      (c) => Math.max(...left.map((p) => p[c]!)) - Math.min(...left.map((p) => p[c]!)),
    ),
  );
  note("AC8 largest channel range of the left half over 1.2 s at recognisability 1", range);
  expect(range).toBeGreaterThan(40);

  // Both dials at 0: the camera image unchanged within ±12 per channel (PD8).
  await slide(page, "recognisability", "Home");
  await slide(page, "reactivity", "Home");
  await expect
    .poll(
      async () => {
        const l = await patch(page, width / 4, height / 2);
        const r = await patch(page, (3 * width) / 4, height / 2);
        return (
          (near(l, LEFT_RGB, 12) && near(r, RIGHT_RGB, 12)) ||
          (near(l, RIGHT_RGB, 12) && near(r, LEFT_RGB, 12))
        );
      },
      { timeout: 3000 },
    )
    .toBe(true);
});

test("the overlay's in-app latency p95 is at most 50 ms once start-up has left the window (AC10, PD13)", async ({
  page,
}) => {
  await record(page);
  await page.goto("/");
  await start(page, { reopen: false });
  await page.keyboard.press("o");
  // The window is 10 s. Start-up (module loading, the first frames, the refresh estimate) is
  // inside it for the first 10 s; the owner decided (2026-11-11) to read it once that has
  // left, so the number is the set's, not the page load's.
  await page.waitForTimeout(20_000);
  const line = (await page.getByTestId("overlay-latency").textContent())!;
  const match = /latency ms ([\d.]+) \/ p95 ([\d.]+) \/ worst ([\d.]+)/.exec(line);
  note("AC10 overlay after 20 s", line);
  note("AC10 scale and fps", [
    await page.getByTestId("overlay-scale").textContent(),
    await page.getByTestId("overlay-fps").textContent(),
  ]);
  expect(match, line).not.toBeNull();
  expect(Number(match![2])).toBeLessThanOrEqual(50);
});

/**
 * In the page, over 2 s from now: the last time any meter read 0.01 or more, polled every
 * 10 ms. The click track is silent between bursts, so the first zero proves nothing; staying
 * at zero through the bursts that follow does.
 */
function metersZeroAfter(): Promise<number> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    let lastNonZero = 0;
    const id = setInterval(() => {
      const elapsed = performance.now() - t0;
      const values = [...document.querySelectorAll("[data-testid^=meter-]")].map((m) =>
        Number(m.getAttribute("data-value")),
      );
      if (values.length !== 5 || values.some((v) => v >= 0.01)) lastNonZero = elapsed;
      if (elapsed >= 2000) {
        clearInterval(id);
        resolve(lastNonZero);
      }
    }, 10);
  });
}

/** The page shows no text outside the overlay and the panel: the output carries none (SD7). */
async function expectNoTextOnOutput(page: Page) {
  const text = await page.evaluate(() => {
    const body = document.body.cloneNode(true) as HTMLElement;
    body.querySelectorAll("[data-testid=overlay], [data-testid=panel]").forEach((e) => e.remove());
    return body.textContent?.trim() ?? "";
  });
  expect(text).toBe("");
}

for (const [kind, track, label] of [
  ["audio", "audio", "AC12"],
  ["camera", "video", "AC13"],
] as const) {
  test(`${kind} lost: the picture goes on, the overlay says lost, and it comes back without a click (${label})`, async ({
    page,
  }) => {
    const logs: string[] = [];
    page.on("console", (m) => logs.push(m.text()));
    await record(page);
    await page.goto("/");
    await start(page);
    await page.keyboard.press("o");
    await expect(page.getByTestId(`overlay-${kind}`)).toHaveText(`${kind}: ok`);

    await setFailing(page, track, true); // unplugged: asking again finds nothing
    // Watch the meters from inside the page, starting with the unplug itself.
    const zeroAfterMs = kind === "audio" ? page.evaluate(metersZeroAfter) : Promise.resolve(0);
    await unplug(page, track);
    await expect(page.getByTestId(`overlay-${kind}`)).toHaveText(`${kind}: lost`, {
      timeout: 1000,
    });
    await expect(page.getByTestId(`panel-${kind}-state`)).toHaveText(`${kind}: lost`);
    if (kind === "audio") {
      const ms = await zeroAfterMs;
      note("AC12 last non-zero meter after the unplug (ms, ≤ 1000)", Math.round(ms));
      expect(ms).toBeLessThanOrEqual(1000);
    }
    await expectCanvasChanging(page);
    await expectNoTextOnOutput(page);

    await setFailing(page, track, false); // plugged back in
    await expect(page.getByTestId(`overlay-${kind}`)).toHaveText(`${kind}: ok`, { timeout: 2500 });
    expect(logs.some((l) => /capture/.test(l) && /lost/.test(l))).toBe(true);
    expect(logs.some((l) => /capture/.test(l) && /restored/.test(l))).toBe(true);
  });
}

test("a denied camera is none, and the generative look renders (AC13)", async ({ page }) => {
  await record(page, { cameraDenied: true });
  await page.goto("/");
  await start(page, { reopen: false });
  await page.keyboard.press("o");
  await expect(page.getByTestId("overlay-camera")).toHaveText("camera: none");
  await expect(page.getByTestId("overlay-audio")).toHaveText("audio: ok");
  await expectCanvasChanging(page);
  await expectNoTextOnOutput(page);
});

test("slow frames step the render scale down to 50% and headroom steps it back up (AC15)", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __slowFrames: boolean };
    w.__slowFrames = false;
    const raf = window.requestAnimationFrame.bind(window);
    // While slow, every frame callback waits 60 ms first: about 15 frames a second.
    window.requestAnimationFrame = (cb) =>
      w.__slowFrames ? (setTimeout(() => raf(cb), 60) as unknown as number) : raf(cb);
  });
  await record(page);
  await page.goto("/");
  await start(page, { reopen: false });
  await page.keyboard.press("o");
  await page.waitForTimeout(2000); // the first 60 frames at the display's rate: the estimate (PD6)
  const scale = () => page.getByTestId("overlay-scale").textContent();
  const seen: string[] = [];
  const watch = setInterval(() => void scale().then((s) => seen.push(s ?? "")), 200);

  await page.evaluate(() => ((window as unknown as { __slowFrames: boolean }).__slowFrames = true));
  await expect(page.getByTestId("overlay-scale"))
    .toHaveText("scale 75%", { timeout: 4000 })
    .catch(
      () => undefined, // it may already be at 75% from the software renderer, or past it
    );
  await expect(page.getByTestId("overlay-scale")).toHaveText("scale 50%", { timeout: 8000 });
  await page.waitForTimeout(3000);
  await expect(page.getByTestId("overlay-scale")).toHaveText("scale 50%");

  await page.evaluate(
    () => ((window as unknown as { __slowFrames: boolean }).__slowFrames = false),
  );
  const recovered = await expect(page.getByTestId("overlay-scale"))
    .toHaveText("scale 75%", { timeout: 12_000 })
    .then(() => true)
    .catch(() => false);
  clearInterval(watch);
  note("AC15 scale readings every 200 ms", seen);
  note(
    "AC15 frame ms after the wrap was removed",
    await page.getByTestId("overlay-frame-ms").textContent(),
  );
  expect(seen.every((s) => /^scale (100|75|50)%$/.test(s))).toBe(true);
  expect(recovered, "no step up within 12 s of headroom").toBe(true);
});

test("with the cap at 75% the scale never reads 100% (AC15)", async ({ page }) => {
  await record(page);
  await page.goto("/");
  await start(page);
  await page.getByTestId("quality-cap").selectOption("0.75");
  await page.keyboard.press("o");
  const seen: string[] = [];
  for (let i = 0; i < 25; i++) {
    seen.push((await page.getByTestId("overlay-scale").textContent()) ?? "");
    await page.waitForTimeout(200);
  }
  expect(seen.filter((s) => s === "scale 100%")).toEqual([]);
});

test("nothing but the page, its assets and health is ever requested (AC17)", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (r) => requests.push(`${r.method()} ${new URL(r.url()).pathname}`));
  page.on("websocket", (ws) => requests.push(`WS ${ws.url()}`));
  await record(page);
  await page.goto("/");
  await start(page);
  await page.keyboard.press("o");
  await page.waitForTimeout(6000); // past one health poll after the first
  note("AC17 requests", [...new Set(requests)]);
  const allowed = /^GET (\/|\/assets\/[^/]+|\/api\/health)$/;
  expect(requests.filter((r) => !allowed.test(r))).toEqual([]);
});
