// The overlay's B-01 lines, fullscreen and the wake lock in a real browser on the fake devices
// (B-01 AC10 display, AC12/AC13 words, AC15 display, AC16, SD18; plan PD16, PD19, T8).
import { expect, test, type Page } from "@playwright/test";

async function start(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByTestId("panel")).toHaveCount(0);
}

test("before Start the overlay reads idle, no latency and the lock off (PD19)", async ({
  page,
}) => {
  await page.goto("/");
  await page.keyboard.press("s"); // the panel out of the way; the overlay does not need it
  await page.keyboard.press("o");
  await expect(page.getByTestId("overlay-audio")).toHaveText("audio: idle");
  await expect(page.getByTestId("overlay-camera")).toHaveText("camera: idle");
  await expect(page.getByTestId("overlay-latency")).toHaveText("latency ms – / p95 – / worst –");
  await expect(page.getByTestId("overlay-wake-lock")).toHaveText("wake lock: off");
  await expect(page.getByTestId("overlay-scale")).toHaveText(/^scale (100|75|50)%$/);
});

test("after Start the overlay shows latency, scale, both sources ok and the lock (SD18)", async ({
  page,
}) => {
  await start(page);
  await page.keyboard.press("o");
  await expect(page.getByTestId("overlay-audio")).toHaveText("audio: ok");
  await expect(page.getByTestId("overlay-camera")).toHaveText("camera: ok");
  await expect(page.getByTestId("overlay-scale")).toHaveText(/^scale (100|75|50)%$/);
  await expect(page.getByTestId("overlay-wake-lock")).toHaveText(/^wake lock: (held|unavailable)$/);
  await expect(page.getByTestId("overlay-latency")).toHaveText(
    /^latency ms \d+\.\d \/ p95 \d+\.\d \/ worst \d+\.\d$/,
  );
  // Phase 0's lines are still there.
  await expect(page.getByTestId("overlay-fps")).toHaveText(/^fps \d+\.\d$/);
  await expect(page.getByTestId("overlay-server")).toHaveText("server: ok");
});

test("without the Wake Lock API the overlay says unavailable (AC16, PD16)", async ({ page }) => {
  await page.addInitScript(() => {
    delete (Navigator.prototype as { wakeLock?: unknown }).wakeLock;
  });
  await start(page);
  await page.keyboard.press("o");
  await expect(page.getByTestId("overlay-wake-lock")).toHaveText("wake lock: unavailable");
});

test("f toggles fullscreen (AC16)", async ({ page }) => {
  await start(page);
  const fullscreen = () => page.evaluate(() => document.fullscreenElement?.tagName ?? null);
  await page.keyboard.press("f");
  await expect.poll(fullscreen).toBe("HTML");
  await page.keyboard.press("f");
  await expect.poll(fullscreen).toBeNull();
});
