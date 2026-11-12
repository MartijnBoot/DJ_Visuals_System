// The fake media devices the browser check runs on (B-01 SD17; plan PD14, T5): Chromium's fake
// camera and microphones, fed by the fixtures `fixtures/media.ts` writes at config load.
import { expect, test, type Page } from "@playwright/test";

/**
 * Runs `body` inside a real click, so it has the user activation `getDisplayMedia` and a
 * running `AudioContext` need, and returns what it resolves to.
 */
async function inClick<T>(page: Page, body: string): Promise<T> {
  await page.evaluate((source) => {
    const w = window as unknown as { __clickResult: Promise<unknown> };
    document.addEventListener(
      "click",
      () => {
        w.__clickResult = new Function(`return (async () => { ${source} })();`)();
      },
      { once: true },
    );
  }, body);
  await page.mouse.click(5, 5);
  return page.evaluate(() => (window as unknown as { __clickResult: Promise<T> }).__clickResult);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("the fake devices are listed with labels after a media request", async ({ page }) => {
  const devices = await page.evaluate(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    const list = await navigator.mediaDevices.enumerateDevices();
    for (const track of stream.getTracks()) track.stop();
    return list.map(({ kind, label }) => ({ kind, label }));
  });
  const cameras = devices.filter((d) => d.kind === "videoinput");
  const microphones = devices.filter((d) => d.kind === "audioinput");
  expect(cameras.length).toBeGreaterThanOrEqual(1);
  expect(microphones.length).toBeGreaterThanOrEqual(2);
  for (const d of [...cameras, ...microphones]) expect(d.label).not.toBe("");
});

test("the fake microphone plays the click track: loud bursts and silence", async ({ page }) => {
  const rms = await inClick<number[]>(
    page,
    `
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    context.createMediaStreamSource(stream).connect(analyser);
    const buffer = new Float32Array(analyser.fftSize);
    const reads = [];
    const end = performance.now() + 2000;
    while (performance.now() < end) {
      await new Promise((r) => setTimeout(r, 10));
      analyser.getFloatTimeDomainData(buffer);
      reads.push(Math.sqrt(buffer.reduce((s, v) => s + v * v, 0) / buffer.length));
    }
    for (const track of stream.getTracks()) track.stop();
    await context.close();
    return reads;
  `,
  );
  expect(
    rms.filter((r) => r > 0.3).length,
    `reads: ${rms.map((r) => r.toFixed(2))}`,
  ).toBeGreaterThanOrEqual(2);
  expect(rms.filter((r) => r < 0.01).length).toBeGreaterThanOrEqual(2);
});

test("system audio: getDisplayMedia resolves with an audio track", async ({ page }) => {
  const kinds = await inClick<string[]>(
    page,
    `
    const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
    const kinds = stream.getTracks().map((t) => t.kind);
    for (const track of stream.getTracks()) track.stop();
    return kinds;
  `,
  );
  expect(kinds).toContain("audio");
});

test("the browser check runs at 640×360 (SD17)", async ({ page }) => {
  expect(page.viewportSize()).toEqual({ width: 640, height: 360 });
});
