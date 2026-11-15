// B-03 on the screen page (spec AC7, SD5; plan PD2, PD3, PD4): a profile with custom code never
// changes a pixel's luminance by more than 0.35 between two frames, whatever the code does.
// Profiles are stored through the real API and picked in the real panel; frames are read in
// the page, once per frame, after the engine's draw.
import { expect, test, type Page } from "@playwright/test";
import {
  BLUE_RGB,
  blue,
  createProfile,
  deleteAll,
  RED_RGB,
  red,
  type Definition,
} from "./fixtures/profiles.ts";
import { near, patch, record, start } from "./helpers.ts";

async function centre(page: Page) {
  const { width, height } = page.viewportSize()!;
  return patch(page, width / 2, height / 2);
}

/** The limiter's step on 8-bit targets: 0.35 of full scale, plus rounding (PD3). */
const BOUND = 0.35 * 255 + 2;

/** Starting dials no other profile has, so the panel's slider says the swap happened. */
const DIALS = { recognisability: 0.37, reactivity: 0 };

const coded = (name: string, code: string): Definition => ({
  name,
  palette: ["#000000", "#ffffff"],
  dials: DIALS,
  effects: [{ type: "custom", label: "Body", amount: 1, abstraction: false, params: [], code }],
});

const LUMA = "float y = dot(lastFrame(uv), vec3(0.299, 0.587, 0.114));";
/** Every other frame white then black: a full-scale strobe if nothing limited it. */
const STROBE = `${LUMA}\nreturn vec3(y < 0.5 ? 1.0 : 0.0);`;
/** The strobe, with frames that return NaN (0/0 at run time) in between. */
const NAN = `${LUMA}\nfloat zero = strength - 1.0;\nif (mod(floor(time * 30.0), 2.0) < 1.0) return vec3(zero / zero);\nreturn vec3(y < 0.5 ? 1.0 : 0.0);`;
/** The strobe, with frames that discard every pixel in between. */
const DISCARD = `${LUMA}\nif (mod(floor(time * 30.0), 2.0) < 1.0) discard;\nreturn vec3(y < 0.5 ? 1.0 : 0.0);`;
/** A steady near-white picture: from black it would take three limited steps to reach. */
const STEADY = "return vec3(0.95);";

test.beforeEach(async ({ page, request }) => {
  await deleteAll(request);
  await record(page, { cameraDenied: true });
});

/** Stores the profile, starts the screen page and picks it; resolves once it is on screen. */
async function play(
  page: Page,
  request: Parameters<typeof createProfile>[0],
  definition: Definition,
) {
  const stored = await createProfile(request, definition);
  await page.goto("/");
  await start(page);
  await page.getByTestId("profile-picker").selectOption(stored.id);
  await expect(page.getByTestId("slider-recognisability")).toHaveValue(
    String(DIALS.recognisability),
  );
}

/** One read of the canvas: the luma of each sampled point, and whether the engine drew it. */
interface Frame {
  lumas: number[];
  /**
   * The engine's output is opaque (alpha 1 everywhere). Now and then a read in the page finds
   * the canvas's buffer empty (alpha 0 at every point), with the built-in profile as with
   * custom code; such a read is not a frame the engine drew, so it is not compared.
   */
  drawn: boolean;
}

/**
 * The luma of a 3×3 grid of canvas points (at 1/4, 1/2 and 3/4 of each side) on `count`
 * consecutive frames, read in a frame callback queued after the engine's.
 */
function sample(page: Page, count: number): Promise<Frame[]> {
  return page.evaluate(
    (count) =>
      new Promise<Frame[]>((resolve) => {
        const canvas = document.querySelector<HTMLCanvasElement>("[data-testid=screen]")!;
        const copy = document.createElement("canvas");
        const g = copy.getContext("2d", { willReadFrequently: true })!;
        const frames: Frame[] = [];
        requestAnimationFrame(function each() {
          copy.width = canvas.width;
          copy.height = canvas.height;
          g.drawImage(canvas, 0, 0);
          const lumas: number[] = [];
          let drawn = true;
          for (const fy of [0.25, 0.5, 0.75])
            for (const fx of [0.25, 0.5, 0.75]) {
              const d = g.getImageData(
                Math.floor(fx * copy.width),
                Math.floor(fy * copy.height),
                1,
                1,
              ).data;
              lumas.push(0.299 * d[0]! + 0.587 * d[1]! + 0.114 * d[2]!);
              if (d[3] !== 255) drawn = false;
            }
          frames.push({ lumas, drawn });
          if (frames.length < count) requestAnimationFrame(each);
          else resolve(frames);
        });
      }),
    count,
  );
}

/**
 * The largest luma change of any sampled point between two consecutive frames the engine drew;
 * a pair with an empty read in it is skipped, never bridged.
 */
function largestStep(frames: Frame[]): number {
  let largest = 0;
  for (let f = 1; f < frames.length; f++) {
    const [a, b] = [frames[f - 1]!, frames[f]!];
    if (!a.drawn || !b.drawn) continue;
    b.lumas.forEach((luma, p) => {
      largest = Math.max(largest, Math.abs(luma - a.lumas[p]!));
    });
  }
  return largest;
}

/** Most reads must be frames the engine drew, or the test has measured nothing. */
function expectMostDrawn(frames: Frame[]) {
  const drawn = frames.filter((f) => f.drawn).length;
  expect(drawn, `only ${drawn} of ${frames.length} reads were drawn frames`).toBeGreaterThanOrEqual(
    frames.length - 3,
  );
}

for (const [label, code] of [
  ["alternates black and white every frame", STROBE],
  ["returns NaN on alternate frames", NAN],
  ["discards on alternate frames", DISCARD],
] as const) {
  test(`code that ${label} pulses and never flashes harder than 0.35 a frame (AC7)`, async ({
    page,
    request,
  }) => {
    await play(page, request, coded(`Limited ${label}`, code));
    const frames = await sample(page, 40);
    expectMostDrawn(frames);
    const step = largestStep(frames);
    expect(step, "a pixel moved by more than the limiter allows").toBeLessThanOrEqual(BOUND);
    expect(step, "the picture did not pulse at all").toBeGreaterThan(40);
  });
}

test("a scale step or a resize mid-run shows no frame darker than its neighbours by more than the bound (PD4)", async ({
  page,
  request,
}) => {
  await play(page, request, coded("Steady", STEADY));
  // Let the look settle at its colour (three limited steps from the built-in).
  await expect
    .poll(async () => Math.min(...(await sample(page, 1))[0]!.lumas), { timeout: 8000 })
    .toBeGreaterThan(230);
  const sampling = sample(page, 60);
  await page.waitForTimeout(150);
  await page.getByTestId("quality-cap").selectOption("0.5");
  await page.waitForTimeout(150);
  // A resize always recreates the targets, whatever scale the GPU had already stepped to.
  await page.setViewportSize({ width: 560, height: 320 });
  const frames = await sampling;
  expectMostDrawn(frames);
  expect(largestStep(frames)).toBeLessThanOrEqual(BOUND);
  for (const frame of frames.filter((f) => f.drawn)) {
    expect(Math.min(...frame.lumas)).toBeGreaterThan(230);
  }
});

// B-03 T6 (spec AC21, SD17; plan PD9): stored code that does not compile keeps the current look,
// names the effect in the panel and puts nothing on the output.
test("a stored profile whose code does not compile keeps the look and names the effect (AC21)", async ({
  page,
  request,
}) => {
  const good = await createProfile(request, red("Good red"));
  const broken = await createProfile(request, {
    ...coded("Broken", "vec3 c = source(uv);\nreturn c * undeclaredName;"),
    effects: [
      { type: "zoom", amount: 0 },
      {
        type: "custom",
        label: "Broken swirl",
        amount: 1,
        abstraction: false,
        params: [],
        code: "vec3 c = source(uv);\nreturn c * undeclaredName;",
      },
    ],
  });
  const other = await createProfile(request, blue("Good blue"));
  await page.goto("/");
  await start(page);
  const picker = page.getByTestId("profile-picker");
  await picker.selectOption(good.id);
  await expect
    .poll(async () => near(await centre(page), RED_RGB, 12), { timeout: 8000 })
    .toBe(true);

  await picker.selectOption(broken.id);
  await expect(page.getByTestId("profile-reason")).toHaveText(
    'that profile could not be prepared: custom effect "Broken swirl" does not compile; keeping the current look',
  );
  // The output is still the red look, everywhere: no text, no half-built frame.
  for (const frame of (await sample(page, 10)).filter((f) => f.drawn)) {
    for (const luma of frame.lumas) expect(Math.abs(luma - 0.299 * 255)).toBeLessThanOrEqual(6);
  }

  await picker.selectOption(other.id);
  await expect
    .poll(async () => near(await centre(page), BLUE_RGB, 12), { timeout: 8000 })
    .toBe(true);
  await expect(page.getByTestId("profile-reason")).toHaveCount(0);
});
