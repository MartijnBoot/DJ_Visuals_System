// B-03 in the builder (spec AC13, AC15, SD4, SD9; plan PD14, T10, T11): custom effect rows on a
// profile created through the real API and read back through it.
import { expect, test, type Page } from "@playwright/test";
import { createProfile, deleteAll, flat, listStored, type Stored } from "./fixtures/profiles.ts";
import { patch } from "./helpers.ts";

test.beforeEach(async ({ request }) => {
  await deleteAll(request);
});

/** A flat colour, so the preview is one steady colour whatever the time. */
const FLAT = "#336699";
const FLAT_RGB = [0x33, 0x66, 0x99];

async function open(page: Page, stored: Stored) {
  await page.goto("/builder");
  await page.getByTestId(`profile-name-${stored.id}`).click();
  await expect(page.getByTestId("editor")).toBeVisible();
}

async function previewCentre(page: Page) {
  const box = (await page.getByTestId("preview").boundingBox())!;
  return patch(page, box.width / 2, box.height / 2, 8, "preview");
}

const near = (got: number[], want: number[], tolerance: number) =>
  got.every((v, i) => Math.abs(v - want[i]!) <= tolerance);

const showing = (page: Page, rgb: number[]) =>
  expect.poll(async () => near(await previewCentre(page), rgb, 3), { timeout: 8000 }).toBe(true);

test("Add an effect offers Custom; it comes from the template and changes nothing at strength 0 (AC13, AC15)", async ({
  page,
  request,
}) => {
  const one = await createProfile(request, flat("One", FLAT));
  await open(page, one);
  await showing(page, FLAT_RGB);
  await page.getByTestId("effect-add").selectOption("custom");

  const row = page.getByTestId("effect-row-custom-0");
  await expect(row).toBeVisible();
  await expect(page.getByTestId("custom-label-custom-0")).toHaveValue("Custom");
  await expect(page.getByTestId("custom-code-custom-0")).toHaveValue(/source\(uv\)/);
  await expect(page.getByTestId("custom-param-name-custom-0-0")).toHaveValue("amount");
  await expect(page.getByTestId("custom-abstraction-custom-0")).not.toBeChecked();
  await expect(page.getByTestId("effect-amount-custom-0")).toBeVisible();
  await expect(page.getByTestId("effect-feature-custom-0")).toBeVisible();
  await expect(page.getByTestId("editor-issues")).toHaveCount(0);

  await page.getByTestId("effect-amount-custom-0").fill("0");
  await showing(page, FLAT_RGB);
  // At strength 1 with the parameter at 1 the template turns the picture to its negative.
  await page.getByTestId("effect-amount-custom-0").fill("1");
  await page.getByTestId("custom-param-value-custom-0-0").fill("1");
  await showing(
    page,
    FLAT_RGB.map((c) => 255 - c),
  );
});

test("label, flag, a parameter and the code are saved and come back after a reload (AC13)", async ({
  page,
  request,
}) => {
  const one = await createProfile(request, flat("One", FLAT));
  await open(page, one);
  await page.getByTestId("effect-add").selectOption("custom");
  await page.getByTestId("custom-label-custom-0").fill("Swirl");
  await page.getByTestId("custom-abstraction-custom-0").check();
  await page.getByTestId("custom-param-add-custom-0").click();
  await page.getByTestId("custom-param-name-custom-0-1").fill("speed");
  await page.getByTestId("custom-param-value-custom-0-1").fill("0.75");
  const code = "vec3 c = source(uv);\nreturn c * (0.5 + 0.5 * param[1]);";
  await page.getByTestId("custom-code-custom-0").fill(code);
  await page.getByTestId("editor-save").click();
  await expect(page.getByTestId("editor-save")).toBeDisabled();

  const [saved] = await listStored(request);
  expect(saved!.effects.at(-1)).toEqual({
    type: "custom",
    label: "Swirl",
    amount: 0.5,
    abstraction: true,
    params: [
      { name: "amount", value: 0 },
      { name: "speed", value: 0.75 },
    ],
    code,
  });

  await page.reload();
  await page.getByTestId(`profile-name-${one.id}`).click();
  await expect(page.getByTestId("custom-label-custom-0")).toHaveValue("Swirl");
  await expect(page.getByTestId("custom-abstraction-custom-0")).toBeChecked();
  await expect(page.getByTestId("custom-param-name-custom-0-1")).toHaveValue("speed");
  await expect(page.getByTestId("custom-param-value-custom-0-1")).toHaveValue("0.75");
  await expect(page.getByTestId("custom-code-custom-0")).toHaveValue(code);
});

test("two custom rows can be reordered, and a fifth parameter is not offered (SD4, PD14)", async ({
  page,
  request,
}) => {
  const one = await createProfile(request, flat("One", FLAT));
  await open(page, one);
  const add = page.getByTestId("effect-add");
  await add.selectOption("custom");
  await add.selectOption("custom");
  await expect(page.getByTestId("custom-label-custom-0")).toHaveValue("Custom");
  await expect(page.getByTestId("custom-label-custom-1")).toHaveValue("Custom 2");
  await page.getByTestId("effect-up-custom-1").click();
  await expect(page.getByTestId("custom-label-custom-0")).toHaveValue("Custom 2");
  await expect(page.getByTestId("custom-label-custom-1")).toHaveValue("Custom");
  await page.getByTestId("effect-up-custom-0").click(); // above the palette map
  const labels = page.locator("[data-testid^=effect-row-] strong");
  await expect(labels.first()).toContainText("Custom 2");

  for (let i = 0; i < 3; i++) await page.getByTestId("custom-param-add-custom-0").click();
  await expect(page.getByTestId("custom-param-add-custom-0")).toBeDisabled();
  await expect(page.locator("[data-testid^=custom-param-name-custom-0-]")).toHaveCount(4);
});

test("o, s and f typed in the code box stay text", async ({ page, request }) => {
  const one = await createProfile(request, flat("One", FLAT));
  await open(page, one);
  await page.getByTestId("effect-add").selectOption("custom");
  const box = page.getByTestId("custom-code-custom-0");
  await box.fill("");
  await box.pressSequentially("// osf");
  await expect(box).toHaveValue("// osf");
});

// B-03 T11 (spec AC13, AC14, AC16, SD9; plan PD10): live compile, the error line, the Save gate
// and the frame time.

/** Holds the engine's link back while `__holdCompile` is set; nothing of the app changes. */
async function holdableCompile(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __holdCompile: boolean };
    w.__holdCompile = false;
    const COMPLETION = 0x91b1; // COMPLETION_STATUS_KHR
    const proto = WebGL2RenderingContext.prototype;
    const getExtension = proto.getExtension as (this: unknown, name: string) => unknown;
    const getProgramParameter = proto.getProgramParameter;
    proto.getExtension = function (this: WebGL2RenderingContext, name: string) {
      const real = getExtension.call(this, name) as unknown;
      if (name !== "KHR_parallel_shader_compile") return real;
      return real ?? { COMPLETION_STATUS_KHR: COMPLETION };
    } as typeof proto.getExtension;
    proto.getProgramParameter = function (
      this: WebGL2RenderingContext,
      program: WebGLProgram,
      pname: number,
    ) {
      if (pname !== COMPLETION) return getProgramParameter.call(this, program, pname) as unknown;
      if (w.__holdCompile) return false;
      return (getProgramParameter.call(this, program, pname) as unknown) ?? true;
    } as typeof proto.getProgramParameter;
  });
}

const setHold = (page: Page, hold: boolean) =>
  page.evaluate((h) => ((window as unknown as { __holdCompile: boolean }).__holdCompile = h), hold);

async function withCustom(page: Page, request: Parameters<typeof createProfile>[0], code: string) {
  const one = await createProfile(request, flat("One", FLAT));
  await open(page, one);
  await page.getByTestId("effect-add").selectOption("custom");
  await page.getByTestId("effect-amount-custom-0").fill("1");
  await page.getByTestId("custom-code-custom-0").fill(code);
  return one;
}

test("an edit to the code reaches the preview; broken code shows its line, keeps the last good look and blocks Save (AC13, AC14)", async ({
  page,
  request,
}) => {
  const one = await withCustom(page, request, "return source(uv) * 0.5;");
  const half = FLAT_RGB.map((c) => Math.round(c * 0.5));
  await showing(page, half);
  await expect(page.getByTestId("custom-compile-custom-0")).toHaveText("ok");

  await page.getByTestId("custom-code-custom-0").fill("return source(uv) * 0.25;");
  await showing(
    page,
    FLAT_RGB.map((c) => Math.round(c * 0.25)),
  );

  const broken = "vec3 c = source(uv);\nc *= 0.5;\nreturn c * undeclaredName;";
  await page.getByTestId("custom-code-custom-0").fill(broken);
  await expect(page.getByTestId("custom-compile-custom-0")).toHaveText(/^line 3: .*undeclaredName/);
  await expect(page.getByTestId("editor-save")).toBeDisabled();
  await expect(page.getByTestId("editor-save-reason")).toHaveText(
    'custom effect "Custom" does not compile',
  );
  // The last version that compiled keeps drawing.
  await showing(
    page,
    FLAT_RGB.map((c) => Math.round(c * 0.25)),
  );

  const fixed = "vec3 c = source(uv);\nc *= 0.5;\nreturn c;";
  await page.getByTestId("custom-code-custom-0").fill(fixed);
  await expect(page.getByTestId("custom-compile-custom-0")).toHaveText("ok");
  await expect(page.getByTestId("editor-save")).toBeEnabled();
  await expect(page.getByTestId("editor-save-reason")).toHaveCount(0);
  await page.getByTestId("editor-save").click();
  await expect(page.getByTestId("editor-save")).toBeDisabled();
  const [saved] = await listStored(request);
  expect(saved!.id).toBe(one.id);
  expect(saved!.effects.at(-1)).toMatchObject({ code: fixed });
});

test("with two custom effects and one broken, only that row shows the error (AC14)", async ({
  page,
  request,
}) => {
  await withCustom(page, request, "return source(uv);");
  await page.getByTestId("effect-add").selectOption("custom");
  await page.getByTestId("custom-code-custom-1").fill("return source(uv) * missing;");
  await expect(page.getByTestId("custom-compile-custom-1")).toHaveText(/^line 1: .*missing/);
  await expect(page.getByTestId("custom-compile-custom-0")).toHaveText("ok");
  await expect(page.getByTestId("editor-save-reason")).toHaveText(
    'custom effect "Custom 2" does not compile',
  );
});

test("one character typed into code that compiled disables Save until its compile result arrives (PD10)", async ({
  page,
  request,
}) => {
  await holdableCompile(page);
  await withCustom(page, request, "return source(uv);");
  await expect(page.getByTestId("custom-compile-custom-0")).toHaveText("ok");
  await expect(page.getByTestId("editor-save")).toBeEnabled();

  await setHold(page, true);
  await page.getByTestId("custom-code-custom-0").press("End");
  await page.getByTestId("custom-code-custom-0").press(" ");
  await expect(page.getByTestId("editor-save")).toBeDisabled();
  await expect(page.getByTestId("editor-save-reason")).toHaveText("checking the code…");
  await page.waitForTimeout(800); // past the debounce: the compile is held, Save stays off
  await expect(page.getByTestId("editor-save")).toBeDisabled();
  await setHold(page, false);
  await expect(page.getByTestId("editor-save")).toBeEnabled();
  await expect(page.getByTestId("custom-compile-custom-0")).toHaveText("ok");
});

test("the preview shows its frame time, a number above 0 that changes (AC16)", async ({
  page,
  request,
}) => {
  const one = await createProfile(request, flat("One", FLAT));
  await open(page, one);
  const frameTime = page.getByTestId("preview-frame-time");
  await expect(frameTime).toHaveText(/^frame \d+\.\d ms$/);
  const read = async () => Number((await frameTime.textContent())!.match(/[\d.]+/)![0]);
  await expect.poll(read).toBeGreaterThan(0);
  const seen = new Set<number>();
  await expect
    .poll(async () => {
      seen.add(await read());
      return seen.size;
    })
    .toBeGreaterThan(1);
});
