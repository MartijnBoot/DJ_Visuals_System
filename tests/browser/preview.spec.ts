// The builder's preview canvas (B-02 AC4, SD5, SD19; plan T14, AD3): the profile being edited,
// driven by the synthetic loop and the generative input until Start, then by the real camera and
// audio. Profiles are created through the real API and edited in the real editor.
import { expect, test, type Page } from "@playwright/test";
import { createProfile, deleteAll, type Definition, type Stored } from "./fixtures/profiles.ts";
import { cameraColours, near, patch, pixels, record, recorded } from "./helpers.ts";

test.beforeEach(async ({ request }) => {
  await deleteAll(request);
});

const preview = (page: Page) => page.getByTestId("preview");

/** Creates `definition`, opens the builder and selects it. */
async function open(
  page: Page,
  request: Parameters<typeof createProfile>[0],
  definition: Definition,
) {
  const stored: Stored = await createProfile(request, definition);
  await page.goto("/builder");
  await page.getByTestId(`profile-name-${stored.id}`).click();
  await expect(preview(page)).toBeVisible();
  return stored;
}

async function size(page: Page) {
  const box = (await preview(page).boundingBox())!;
  return { width: Math.round(box.width), height: Math.round(box.height) };
}

async function centre(page: Page, rgbSize = 16) {
  const { width, height } = await size(page);
  return patch(page, width / 2, height / 2, rgbSize, "preview");
}

/** Mean luma of the whole preview once per frame for `ms`, with the page clock of each. */
async function lumaSeries(page: Page, ms: number) {
  return page.evaluate(
    (total) =>
      new Promise<{ t: number; luma: number }[]>((resolve) => {
        const canvas = document.querySelector<HTMLCanvasElement>("[data-testid=preview]")!;
        const copy = document.createElement("canvas");
        copy.width = copy.height = 16;
        const g = copy.getContext("2d", { willReadFrequently: true })!;
        const out: { t: number; luma: number }[] = [];
        const t0 = performance.now();
        requestAnimationFrame(function each() {
          g.drawImage(canvas, 0, 0, 16, 16);
          const d = g.getImageData(0, 0, 16, 16).data;
          let sum = 0;
          for (let i = 0; i < d.length; i += 4) {
            sum += 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!;
          }
          out.push({ t: performance.now(), luma: sum / 256 });
          if (performance.now() - t0 < total) requestAnimationFrame(each);
          else resolve(out);
        });
      }),
    ms,
  );
}

const flashOnBeat: Definition = {
  name: "Flash",
  palette: ["#000000", "#ffffff"],
  dials: { recognisability: 0, reactivity: 1 },
  effects: [{ type: "flash", amount: 0, binding: { feature: "beat", amount: 1 }, colourSlot: 1 }],
};

const palette = (name: string, colours: string[]): Definition => ({
  name,
  palette: colours,
  dials: { recognisability: 0, reactivity: 0 },
  effects: [{ type: "paletteMap", amount: 1 }],
});

test("with no media request the preview changes, and brightens on the synthetic beat when flash follows beat (AC4)", async ({
  page,
  request,
}) => {
  await record(page);
  await open(page, request, flashOnBeat);
  const series = await lumaSeries(page, 3000);
  expect(series.length).toBeGreaterThan(20);
  expect(Math.min(...series.map((s) => s.luma)), "a black frame was shown").toBeGreaterThanOrEqual(
    2,
  );

  // The synthetic loop is a pure function of performance.now(): a kick every 500 ms. The frames
  // just after a kick are lit by the flash, the frames half a beat later are not.
  const phase = (t: number) => ((t % 500) + 500) % 500;
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const after = series.filter((s) => phase(s.t) >= 20 && phase(s.t) < 90).map((s) => s.luma);
  const between = series.filter((s) => phase(s.t) >= 250 && phase(s.t) < 350).map((s) => s.luma);
  expect(after.length).toBeGreaterThan(3);
  expect(between.length).toBeGreaterThan(3);
  expect(mean(after) - mean(between), "no brightening on the beat").toBeGreaterThan(8);

  const calls = (await recorded(page)).calls;
  expect(calls, "the preview asked for media before Start").toEqual([]);
});

test("changing a palette colour with paletteMap at 1 changes the patch by the next sample (AC4)", async ({
  page,
  request,
}) => {
  await record(page);
  await open(page, request, palette("Pal", ["#000000", "#ff0000"]));
  const before = await centre(page);
  expect(before[0]!).toBeGreaterThan(before[1]! + 20); // red-ish
  await page.getByTestId("palette-colour-1").fill("#00ff00");
  await expect
    .poll(async () => {
      const now = await centre(page);
      return now[1]! > now[0]! + 20;
    })
    .toBe(true);
});

test("adding mirror changes the picture without a blank frame (AC4, AD3)", async ({
  page,
  request,
}) => {
  await record(page);
  await open(page, request, palette("Pal", ["#102030", "#f0e0d0"]));
  const { width, height } = await size(page);
  const region = () => pixels(page, 0, 0, Math.round(width / 2), height, "preview");
  const before = await region();

  const sampling = lumaSeries(page, 2500);
  await page.waitForTimeout(300);
  await page.getByTestId("effect-add").selectOption("mirror");
  const series = await sampling;
  expect(Math.min(...series.map((s) => s.luma)), "a blank frame was shown").toBeGreaterThanOrEqual(
    2,
  );

  const after = await region();
  let diff = 0;
  for (let i = 0; i < before.length; i++) diff += Math.abs(before[i]! - after[i]!);
  expect(diff / before.length, "mirror did not change the picture").toBeGreaterThan(1.5);
});

test("after Start the three constraints are off and the picture follows the fake camera at dials 0/0 (AC4)", async ({
  page,
  request,
}) => {
  await record(page);
  await open(page, request, {
    name: "Plain",
    palette: ["#000000", "#ffffff"],
    dials: { recognisability: 0, reactivity: 0 },
    effects: [],
  });
  await page.getByTestId("preview-start").click();
  await expect(page.getByTestId("preview-camera-state")).toHaveText("camera: ok");
  await expect(page.getByTestId("preview-audio-state")).toHaveText("audio: ok");

  const { calls } = await recorded(page);
  const audio = calls.find((c) => (c.constraints as { audio?: unknown }).audio);
  expect((audio!.constraints as { audio: object }).audio).toMatchObject({
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  });

  const { width, height } = await size(page);
  const [leftRgb, rightRgb] = await cameraColours(page); // as this browser decodes them (D-01)
  await expect
    .poll(
      async () => {
        const l = await patch(page, width / 4, height / 2, 8, "preview");
        const r = await patch(page, (3 * width) / 4, height / 2, 8, "preview");
        return (
          (near(l, leftRgb, 12) && near(r, rightRgb, 12)) ||
          (near(l, rightRgb, 12) && near(r, leftRgb, 12))
        );
      },
      { timeout: 15_000 },
    )
    .toBe(true);
});

test("with the camera denied the preview stays generative (AC4)", async ({ page, request }) => {
  await record(page, { cameraDenied: true });
  await open(page, request, {
    name: "Plain",
    palette: ["#000000", "#ffffff"],
    dials: { recognisability: 0, reactivity: 0 },
    effects: [],
  });
  await page.getByTestId("preview-start").click();
  await expect(page.getByTestId("preview-camera-state")).toHaveText("camera: none");
  const series = await lumaSeries(page, 1500);
  expect(Math.min(...series.map((s) => s.luma))).toBeGreaterThanOrEqual(2);
  const { width, height } = await size(page);
  const [leftRgb, rightRgb] = await cameraColours(page);
  const l = await patch(page, width / 4, height / 2, 8, "preview");
  expect(near(l, leftRgb, 12) || near(l, rightRgb, 12)).toBe(false);
});

test("the output screen has no preview, and the builder has no screen canvas (AC4)", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("screen")).toBeVisible();
  await expect(page.getByTestId("preview")).toHaveCount(0);
  await page.goto("/builder");
  await expect(page.getByTestId("builder")).toBeVisible();
  await expect(page.getByTestId("screen")).toHaveCount(0);
});
