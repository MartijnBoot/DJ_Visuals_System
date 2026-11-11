// The Start flow and the `s` panel in a real browser on the fake devices (B-01 AC1 to AC5, AC9,
// AC14; plan PD11, PD12, T7). The recorder from `helpers.ts` logs every media request and
// AudioContext, and can make the system-audio share fail.
import { expect, test } from "@playwright/test";
import { LEFT_RGB, RIGHT_RGB } from "./fixtures/media.ts";
import { meter, near, patch, record, recorded, slide, start } from "./helpers.ts";

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
  await expect.poll(() => meter(page, "level"), { timeout: 3000 }).toBeGreaterThan(0.05);
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
    await expect.poll(() => meter(page, "level"), { timeout: 3000 }).toBeGreaterThan(0.05);
  });
}

test("chosen devices are remembered and asked for after a reload (AC5, PD11)", async ({ page }) => {
  await record(page);
  await page.goto("/");
  await start(page);
  await page.getByTestId("audio-picker").selectOption({ label: "Fake Audio Input 2" });
  await expect(page.getByTestId("panel-audio-state")).toHaveText("audio: ok");
  const audioValue = await page.getByTestId("audio-picker").inputValue();
  const cameraValue = await page.getByTestId("camera-picker").inputValue();
  expect(audioValue).toMatch(/^input:.+/);
  expect(cameraValue).not.toBe("");

  await page.reload();
  await expect(page.getByTestId("audio-picker")).toBeDisabled();
  await expect(page.getByTestId("audio-picker")).toHaveValue(audioValue);
  await expect(page.getByTestId("camera-picker")).toHaveValue(cameraValue);
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByTestId("panel")).toHaveCount(0);
  const { calls } = await recorded(page);
  const ideal = (c: unknown, kind: "audio" | "video") =>
    (c as Record<string, { deviceId?: { ideal?: string } }>)[kind]?.deviceId?.ideal ?? null;
  expect(calls.map((c) => ideal(c.constraints, "audio")).filter(Boolean)).toEqual([
    audioValue.slice("input:".length),
  ]);
  expect(calls.map((c) => ideal(c.constraints, "video")).filter(Boolean)).toEqual([cameraValue]);
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
  const fixture = (p: number[]) => near(p, LEFT_RGB, 12) || near(p, RIGHT_RGB, 12);

  await slide(page, "reactivity", "Home");
  await slide(page, "recognisability", "Home");
  await expect.poll(async () => fixture(await patch(page, x, y)), { timeout: 3000 }).toBe(true);

  // Recognisability 1: 4 posterise levels, every channel a multiple of 85.
  await page.keyboard.press("End");
  const posterised = (p: number[]) => p.every((v) => Math.abs(v - Math.round(v / 85) * 85) <= 2);
  await expect.poll(async () => posterised(await patch(page, x, y)), { timeout: 3000 }).toBe(true);

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
