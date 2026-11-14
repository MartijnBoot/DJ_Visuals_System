// Helpers for the B-01 browser specs (plan T7, T9). A recorder installed before the page loads
// logs every media request and AudioContext, can make requests fail, and can end a track as if
// its device went away. Canvas reads happen in a frame callback queued after the engine's, so
// the WebGL drawing buffer still holds the frame just drawn. No test code ships in the page.
import { expect, type Page } from "@playwright/test";
import { CAMERA, LEFT_RGB } from "./fixtures/media.ts";

export interface Recorded {
  calls: { fn: string; constraints: unknown }[];
  contexts: number;
}

export interface RecorderOptions {
  /** getDisplayMedia: real, rejected (a cancelled dialog), video only, or not there at all. */
  display?: "real" | "reject" | "video-only" | "absent";
  /** The camera request rejects NotAllowedError from the start (AC13 `none`). */
  cameraDenied?: boolean;
}

type MediaWindow = {
  __media: {
    calls: unknown[];
    contexts: AudioContext[];
    tracks: MediaStreamTrack[];
    fail: { audio: boolean; video: boolean };
  };
};

export async function record(page: Page, options: RecorderOptions = {}) {
  await page.addInitScript(({ display = "real", cameraDenied = false }) => {
    const w = window as unknown as MediaWindow;
    w.__media = {
      calls: [],
      contexts: [],
      tracks: [],
      fail: { audio: false, video: cameraDenied },
    };
    const md = navigator.mediaDevices;
    if (display === "absent") {
      delete (MediaDevices.prototype as { getDisplayMedia?: unknown }).getDisplayMedia;
    }
    const getUserMedia = md.getUserMedia.bind(md);
    const keep = (stream: MediaStream) => {
      w.__media.tracks.push(...stream.getTracks());
      return stream;
    };
    md.getUserMedia = async (constraints) => {
      w.__media.calls.push({ fn: "getUserMedia", constraints });
      const kind = constraints?.video ? "video" : "audio";
      if (w.__media.fail[kind]) {
        throw new DOMException(
          "refused by the test",
          cameraDenied && kind === "video" ? "NotAllowedError" : "NotFoundError",
        );
      }
      return keep(await getUserMedia(constraints));
    };
    if (md.getDisplayMedia) {
      const getDisplayMedia = md.getDisplayMedia.bind(md);
      md.getDisplayMedia = async (constraints) => {
        w.__media.calls.push({ fn: "getDisplayMedia", constraints });
        if (display === "reject") throw new DOMException("no", "NotAllowedError");
        if (display === "video-only") return keep(await getUserMedia({ video: true }));
        return keep(await getDisplayMedia(constraints));
      };
    }
    const Base = window.AudioContext;
    window.AudioContext = class extends Base {
      constructor(options?: AudioContextOptions) {
        super(options);
        w.__media.contexts.push(this);
      }
    };
  }, options);
}

export async function recorded(page: Page): Promise<Recorded> {
  return page.evaluate(() => {
    const m = (window as unknown as MediaWindow).__media;
    return { calls: m.calls as Recorded["calls"], contexts: m.contexts.length };
  });
}

/** Makes later requests of a kind fail (the device is gone) or succeed again (it is back). */
export async function setFailing(page: Page, kind: "audio" | "video", failing: boolean) {
  await page.evaluate(
    ([k, f]) => {
      (window as unknown as MediaWindow).__media.fail[k as "audio" | "video"] = f as boolean;
    },
    [kind, failing] as const,
  );
}

/** Ends the live track of a kind the way an unplugged device does: `ended` fires. */
export async function unplug(page: Page, kind: "audio" | "video") {
  await page.evaluate((k) => {
    const track = (window as unknown as MediaWindow).__media.tracks
      .filter((t) => t.kind === k && t.readyState === "live")
      .at(-1)!;
    track.stop();
    track.dispatchEvent(new Event("ended"));
  }, kind);
}

/** The RGBA pixels of a canvas rectangle, row by row, from the frame just drawn. */
export async function pixels(
  page: Page,
  x: number,
  y: number,
  width: number,
  height: number,
  testid = "screen",
): Promise<number[]> {
  return page.evaluate(
    ([px, py, w, h, id]) =>
      new Promise<number[]>((resolve) => {
        requestAnimationFrame(() => {
          const canvas = document.querySelector<HTMLCanvasElement>(`[data-testid=${id}]`)!;
          const copy = document.createElement("canvas");
          copy.width = w!;
          copy.height = h!;
          const g = copy.getContext("2d")!;
          g.drawImage(canvas, px!, py!, w!, h!, 0, 0, w!, h!);
          resolve(Array.from(g.getImageData(0, 0, w!, h!).data));
        });
      }),
    [x, y, width, height, testid] as const,
  );
}

/** The mean colour of a square patch centred on (x, y). */
export async function patch(
  page: Page,
  x: number,
  y: number,
  size = 8,
  testid = "screen",
): Promise<number[]> {
  const data = await pixels(page, x - size / 2, y - size / 2, size, size, testid);
  return meanRgb(data);
}

/**
 * The fake camera's two colours as this browser decodes them, in fixture order (the decode of
 * LEFT_RGB first). Chromium turns the I420 fixture into RGB with BT.601 on Windows and BT.709 on
 * Linux (D-01), so the encoded LEFT_RGB and RIGHT_RGB are what only one platform shows; "the
 * camera image unchanged" means unchanged from the browser's own decode. Read on a page of its
 * own, so the page under test records no extra media request.
 */
export async function cameraColours(page: Page): Promise<[number[], number[]]> {
  const probe = await page.context().newPage();
  try {
    await probe.goto("/api/health");
    const [a, b] = await probe.evaluate(
      async ({ width, height, seam }) => {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        const video = document.createElement("video");
        video.muted = true;
        video.srcObject = stream;
        await video.play();
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const g = canvas.getContext("2d")!;
        g.drawImage(video, 0, 0, width, height);
        stream.getTracks().forEach((t) => t.stop());
        const mean = (x: number) => {
          const d = g.getImageData(x - 4, height / 2 - 4, 8, 8).data;
          const sum = [0, 0, 0];
          for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) sum[c]! += d[i + c]!;
          return sum.map((v) => v / (d.length / 4));
        };
        return [mean(seam / 4), mean((seam + width) / 2)];
      },
      { width: CAMERA.width, height: CAMERA.height, seam: CAMERA.seam },
    );
    const distance = (p: number[]) => p.reduce((s, v, i) => s + Math.abs(v - LEFT_RGB[i]!), 0);
    return distance(a!) <= distance(b!) ? [a!, b!] : [b!, a!];
  } finally {
    await probe.close();
  }
}

export function meanRgb(rgba: number[]): number[] {
  const sum = [0, 0, 0];
  for (let i = 0; i < rgba.length; i += 4) for (let c = 0; c < 3; c++) sum[c]! += rgba[i + c]!;
  return sum.map((v) => v / (rgba.length / 4));
}

export const near = (a: number[], b: readonly number[], tolerance: number) =>
  a.every((v, i) => Math.abs(v - b[i]!) <= tolerance);

export async function meter(page: Page, name: string): Promise<number> {
  return Number(await page.getByTestId(`meter-${name}`).getAttribute("data-value"));
}

/** Presses Start; a successful Start closes the panel (PD12); `s` opens it again. */
export async function start(page: Page, { reopen = true } = {}) {
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByTestId("panel")).toHaveCount(0);
  if (reopen) {
    await page.keyboard.press("s");
    await expect(page.getByTestId("panel")).toBeVisible();
  }
}

/** Sets a slider to its minimum or maximum with the keyboard, as a person would. */
export async function slide(
  page: Page,
  dial: "recognisability" | "reactivity",
  to: "Home" | "End",
) {
  await page.getByTestId(`slider-${dial}`).focus();
  await page.keyboard.press(to);
}

/** Two reads of the middle of the canvas 500 ms apart differ (Phase 0's check). */
export async function expectCanvasChanging(page: Page) {
  const { width, height } = page.viewportSize()!;
  const clip = { x: width / 2, y: height / 2, width: 4, height: 4 };
  const first = await page.screenshot({ clip });
  await page.waitForTimeout(500);
  const second = await page.screenshot({ clip });
  expect(second.equals(first), "the canvas did not change in 500 ms").toBe(false);
}
