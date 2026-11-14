// The Start flow and the `s` panel in a real browser on the fake devices (B-01 AC1 to AC5, AC9,
// AC14; plan PD11, PD12, T7). The recorder from `helpers.ts` logs every media request and
// AudioContext, and can make the system-audio share fail.
import { expect, test } from "@playwright/test";
import { cameraColours, meter, near, patch, record, recorded, slide, start } from "./helpers.ts";

const OFF = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };

test("on load: the idle look, the panel open with Start, pickers disabled, nothing asked (AC1, PD12)", async ({
  page,
}) => {
  await record(page);
  await page.goto("/");
  await expect(page.getByTestId("panel")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start" })).toBeEnabled();
  await expect(page.getByTestId("camera-picker")).toBeDisabled();
  await expect(page.getByTestId("audio-picker")).toBeDisabled();
  await expect(page.getByTestId("panel-audio-state")).toHaveText("audio: idle");
  await expect(page.getByTestId("panel-camera-state")).toHaveText("camera: idle");
  await page.waitForTimeout(500);
  expect(await recorded(page)).toEqual({ calls: [], contexts: 0 });
});

test("s toggles the panel", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("panel")).toBeVisible();
  await page.keyboard.press("s");
  await expect(page.getByTestId("panel")).toHaveCount(0);
  await page.keyboard.press("s");
  await expect(page.getByTestId("panel")).toBeVisible();
});

test("Start asks with processing off, starts the context and the meters move (AC2)", async ({
  page,
}) => {
  await record(page);
  await page.goto("/");
  await start(page);
  const { calls, contexts } = await recorded(page);
  expect(contexts).toBe(1);
  const audio = calls.find((c) => (c.constraints as { audio?: unknown }).audio);
  expect((audio!.constraints as { audio: object }).audio).toMatchObject(OFF);
  expect(calls.some((c) => (c.constraints as { video?: unknown }).video)).toBe(true);
  await expect(page.getByTestId("panel-audio-state")).toHaveText("audio: ok");
  await expect(page.getByTestId("panel-camera-state")).toHaveText("camera: ok");
  await expect
    .poll(() => meter(page, "level"), { timeout: 3000, intervals: [25] })
    .toBeGreaterThan(0.05);
});

test("the pickers list the fake devices and offer system audio (AC3)", async ({ page }) => {
  await page.goto("/");
  await start(page);
  await expect(page.getByTestId("camera-picker")).toBeEnabled();
  const audioOptions = await page.getByTestId("audio-picker").locator("option").allTextContents();
  expect(audioOptions.filter((t) => /Fake.*Audio/i.test(t)).length).toBeGreaterThanOrEqual(2);
  expect(audioOptions).toContain("System audio");
  expect(await page.getByTestId("camera-picker").locator("option").count()).toBeGreaterThanOrEqual(
    1,
  );
});

test("without getDisplayMedia there is no system audio option (AC3)", async ({ page }) => {
  await record(page, { display: "absent" });
  await page.goto("/");
  await start(page);
  const audioOptions = await page.getByTestId("audio-picker").locator("option").allTextContents();
  expect(audioOptions).not.toContain("System audio");
});

for (const [mode, reason] of [
  ["reject", /cancelled/],
  ["video-only", /no audio/],
] as const) {
  test(`a system share that ${mode === "reject" ? "is cancelled" : "has no audio"} keeps the previous source (AC4)`, async ({
    page,
  }) => {
    await record(page, { display: mode });
    await page.goto("/");
    await start(page);
    await page.getByTestId("audio-picker").selectOption({ label: "System audio" });
    await expect(page.getByTestId("panel-reason")).toHaveText(reason);
    await expect(page.getByTestId("panel-audio-state")).toHaveText("audio: ok");
    await expect
      .poll(() => meter(page, "level"), { timeout: 3000, intervals: [25] })
      .toBeGreaterThan(0.05);
  });
}

test("chosen devices are remembered and asked for after a reload (AC5, PD11)", async ({ page }) => {
  await record(page);
  await page.goto("/");
  await start(page);
  const startValue = await page.getByTestId("audio-picker").inputValue();
  const input2 = await page
    .getByTestId("audio-picker")
    .locator("option", { hasText: "Fake Audio Input 2" })
    .getAttribute("value");
  expect(input2).toMatch(/^input:.+/);
  expect(input2, "Start already used Input 2, so the switch proves nothing").not.toBe(startValue);
  await page.getByTestId("audio-picker").selectOption(input2!);
  // The picker is controlled: it holds the old device until the session has switched, so this
  // wait, not `audio: ok` (true before the switch), is what proves setAudio ran.
  await expect(page.getByTestId("audio-picker")).toHaveValue(input2!);
  await expect(page.getByTestId("panel-audio-state")).toHaveText("audio: ok");
  const audioValue = input2!;
  const cameraValue = await page.getByTestId("camera-picker").inputValue();
  expect(cameraValue).not.toBe("");
  const exactOf = (c: unknown) =>
    (c as Record<string, { deviceId?: { exact?: string } }>).audio?.deviceId?.exact;
  expect(
    (await recorded(page)).calls.map((c) => exactOf(c.constraints)),
    "choosing the device made no request for it",
  ).toContain(audioValue.slice("input:".length));

  await page.reload();
  await expect(page.getByTestId("audio-picker")).toBeDisabled();
  await expect(page.getByTestId("audio-picker")).toHaveValue(audioValue);
  await expect(page.getByTestId("camera-picker")).toHaveValue(cameraValue);
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByTestId("panel")).toHaveCount(0);
  const { calls } = await recorded(page);
  const exactId = (c: unknown, kind: "audio" | "video") =>
    (c as Record<string, { deviceId?: { exact?: string } }>)[kind]?.deviceId?.exact ?? null;
  expect(calls.map((c) => exactId(c.constraints, "audio")).filter(Boolean)).toEqual([
    audioValue.slice("input:".length),
  ]);
  expect(calls.map((c) => exactId(c.constraints, "video")).filter(Boolean)).toEqual([cameraValue]);
});

test("o, s and f typed into a focused picker do not toggle the page or switch the source (review)", async ({
  page,
}) => {
  // Chromium does type-ahead on a focused <select>: `s` would pick "System audio" and open the
  // share dialog mid-set. The page keys must leave a focused form control alone.
  await record(page);
  await page.goto("/");
  await start(page);
  for (const picker of ["audio-picker", "camera-picker"]) {
    const select = page.getByTestId(picker);
    const before = await select.inputValue();
    await select.focus();
    for (const key of ["o", "s", "f"]) await page.keyboard.press(key);
    await expect(page.getByTestId("overlay")).toHaveCount(0);
    await expect(page.getByTestId("panel")).toBeVisible();
    expect(await page.evaluate(() => document.fullscreenElement === null)).toBe(true);
    await page.waitForTimeout(300);
    expect(await select.inputValue()).toBe(before);
  }
  const { calls } = await recorded(page);
  expect(calls.some((c) => JSON.stringify(c.fn).includes("getDisplayMedia"))).toBe(false);
});

test("moving a dial changes the next frame and asks for nothing (AC9)", async ({ page }) => {
  await record(page);
  await page.goto("/");
  await start(page);
  await page.getByTestId("quality-cap").selectOption("1"); // 100%, the default
  const before = (await recorded(page)).calls.length;
  const { width, height } = page.viewportSize()!;
  // The middle of the left half: one fixture colour or the other (the halves swap).
  const x = width / 4;
  const y = height / 2;
  // As this browser decodes the fixture (D-01), read before the dial moves are counted from.
  const [leftRgb, rightRgb] = await cameraColours(page);
  const fixture = (p: number[]) => near(p, leftRgb, 12) || near(p, rightRgb, 12);

  await slide(page, "reactivity", "Home");
  await slide(page, "recognisability", "Home");
  await expect.poll(async () => fixture(await patch(page, x, y)), { timeout: 3000 }).toBe(true);

  // Recognisability 1: posterised and smeared.
  await page.keyboard.press("End");
  // At 0 the picture is always a fixture colour. At 1 it posterises and smears, so after each
  // swap of the camera halves it passes through colours that are not the fixture's.
  await expect
    .poll(async () => fixture(await patch(page, x, y)), { timeout: 3000, intervals: [20] })
    .toBe(false);

  // Back to 0, then reactivity 1: the beat flashes the picture away from the fixture colours.
  await page.keyboard.press("Home");
  await expect.poll(async () => fixture(await patch(page, x, y)), { timeout: 3000 }).toBe(true);
  await page.getByTestId("slider-reactivity").focus();
  await page.keyboard.press("End");
  await expect
    .poll(async () => fixture(await patch(page, x, y, 4)), { timeout: 3000, intervals: [20] })
    .toBe(false);

  expect((await recorded(page)).calls.length).toBe(before);
});

test("a suspended audio context asks for a click, and the click resumes it (AC14, PD15)", async ({
  page,
}) => {
  await record(page);
  await page.goto("/");
  await start(page);
  await page.evaluate(() => {
    const w = window as unknown as { __media: { contexts: AudioContext[] }; __resumed: number };
    const context = w.__media.contexts[0]!;
    w.__resumed = 0;
    Object.defineProperty(context, "state", { get: () => "suspended", configurable: true });
    context.resume = async () => {
      w.__resumed += 1;
    };
    context.dispatchEvent(new Event("statechange"));
  });
  await expect(page.getByTestId("panel-reason")).toHaveText(/click anywhere to resume/);
  await expect(page.getByTestId("panel-audio-state")).toHaveText("audio: lost");
  await page.mouse.click(5, 300);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __resumed: number }).__resumed))
    .toBe(1);
});
