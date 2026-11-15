// The page `pnpm profile:check` drives (B-03 spec SD7, AC9; plan PD12, T13, T14): the real
// engine, served type-stripped by the script, on a blank page that ships nowhere. The page owns
// `requestAnimationFrame`, so the engine draws exactly when the page steps a frame, on a clock of
// 1/60 s per frame, and it turns off parallel shader compiling, so a link is read on the next
// frame: the same file gives the same stills, byte for byte, on every run.
import {
  createEngine,
  ProfileCompileError,
  type AudioFeatures,
  type CompileIssue,
  type Dials,
  type Profile,
} from "../engine/src/index.ts";

export interface Still {
  /** `<moment>-<dials>.png` (PD12). */
  name: string;
  /** The PNG, base64. */
  png: string;
}

/** What the script reads back for one profile. */
export type Checked =
  | { ok: true; stills: Still[]; clipped: number; compared: number }
  | { ok: false; issues: CompileIssue[] };

const FRAME_MS = 1000 / 60;
const WIDTH = 640;
const HEIGHT = 360;

/** Frames per moment of the timeline; the still is the last, after the limiter's 3 (PD12). */
const MOMENT_FRAMES = 6;
/** A pixel that moved by the limiter's full step, on 8-bit output: 0.35 − 2/255 (PD12). */
const CLIP_STEP = (0.35 - 2 / 255) * 255;

const QUIET = { level: 0, low: 0, mid: 0, high: 0, beat: 0 };
const TIMELINE: { still: string | null; audio: typeof QUIET }[] = [
  { still: "quiet", audio: QUIET },
  { still: "kick", audio: { level: 0.8, low: 1, mid: 0.2, high: 0.1, beat: 1 } },
  { still: null, audio: QUIET },
  { still: "hihat", audio: { level: 0.5, low: 0.05, mid: 0.2, high: 1, beat: 0 } },
];

// The link is read on the next frame, never "still compiling": a fixed number of frames.
const getExtension = WebGL2RenderingContext.prototype.getExtension as (
  this: WebGL2RenderingContext,
  name: string,
) => unknown;
WebGL2RenderingContext.prototype.getExtension = function (this: WebGL2RenderingContext, name) {
  return name === "KHR_parallel_shader_compile" ? null : getExtension.call(this, name);
} as typeof WebGL2RenderingContext.prototype.getExtension;

let queue: FrameRequestCallback[] = [];
let clock = 0;
window.requestAnimationFrame = (callback) => {
  queue.push(callback);
  return queue.length;
};
window.cancelAnimationFrame = () => {};

/** One frame: every callback queued, at the clock moved on by `advance` ms. */
function step(advance = FRAME_MS): void {
  clock += advance;
  const due = queue;
  queue = [];
  for (const callback of due) callback(clock);
}

/** A canvas laid out at the stills' size, so the engine draws at it. */
function canvas(): HTMLCanvasElement {
  const element = document.createElement("canvas");
  element.style.width = `${WIDTH}px`;
  element.style.height = `${HEIGHT}px`;
  element.style.display = "block";
  document.body.replaceChildren(element);
  return element;
}

/** Gives the browser a turn, so a resolved promise is seen before the next frame. */
const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * The generated test scene: a sky-to-sand gradient, colour bars, a bright disc and a dark
 * band, so every effect has edges, colours and levels to act on.
 */
function generatedScene(): HTMLCanvasElement {
  const scene = document.createElement("canvas");
  scene.width = WIDTH;
  scene.height = HEIGHT;
  const g = scene.getContext("2d")!;
  const sky = g.createLinearGradient(0, 0, 0, HEIGHT);
  sky.addColorStop(0, "#1e3a8a");
  sky.addColorStop(1, "#f59e0b");
  g.fillStyle = sky;
  g.fillRect(0, 0, WIDTH, HEIGHT);
  const bars = [
    "#ff0000",
    "#00ff00",
    "#0000ff",
    "#ffff00",
    "#00ffff",
    "#ff00ff",
    "#ffffff",
    "#000000",
  ];
  bars.forEach((colour, i) => {
    g.fillStyle = colour;
    g.fillRect(i * (WIDTH / bars.length), HEIGHT - 80, WIDTH / bars.length, 80);
  });
  g.fillStyle = "#ffffff";
  g.beginPath();
  g.arc(470, 130, 70, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#111827";
  g.beginPath();
  g.moveTo(0, 200);
  g.lineTo(300, 40);
  g.lineTo(360, 40);
  g.lineTo(60, 200);
  g.fill();
  return scene;
}

/** The camera image the script serves at `/camera`, drawn at its own size. */
async function cameraScene(): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(await (await fetch("/camera")).blob());
  const scene = document.createElement("canvas");
  scene.width = bitmap.width;
  scene.height = bitmap.height;
  scene.getContext("2d")!.drawImage(bitmap, 0, 0);
  return scene;
}

/** A still picture handed to the engine as its camera: what `setSource` reads of a video. */
function asVideo(scene: HTMLCanvasElement): HTMLVideoElement {
  Object.defineProperties(scene, {
    readyState: { value: 4 },
    videoWidth: { value: scene.width },
    videoHeight: { value: scene.height },
  });
  return scene as unknown as HTMLVideoElement;
}

const reader = document.createElement("canvas");
reader.width = WIDTH;
reader.height = HEIGHT;
const read = reader.getContext("2d", { willReadFrequently: true })!;

/** The frame just drawn, as pixels and as luma. */
function capture(element: HTMLCanvasElement): Float32Array {
  read.drawImage(element, 0, 0, WIDTH, HEIGHT);
  const d = read.getImageData(0, 0, WIDTH, HEIGHT).data;
  const luma = new Float32Array(WIDTH * HEIGHT);
  for (let p = 0; p < luma.length; p++) {
    luma[p] = 0.299 * d[p * 4]! + 0.587 * d[p * 4 + 1]! + 0.114 * d[p * 4 + 2]!;
  }
  return luma;
}

function moved(a: Float32Array, b: Float32Array): boolean {
  for (let p = 0; p < a.length; p++) if (Math.abs(a[p]! - b[p]!) >= CLIP_STEP) return true;
  return false;
}

/** The picture every profile is played on, made once per run. */
let video: HTMLVideoElement | null = null;

/**
 * Compiles the profile in the real engine and, when it compiles, plays the timeline at each dial
 * setting: one still per moment, and how many consecutive frames moved a pixel by the limiter's
 * full step (only a profile with code has the limiter).
 */
async function check(profile: Profile, options: { camera: boolean }): Promise<Checked> {
  video ??= asVideo(options.camera ? await cameraScene() : generatedScene());
  const limited = profile.effects.some((e) => e.type === "custom");
  const settings: [string, Dials][] = [
    ["0-0", { recognisability: 0, reactivity: 0 }],
    ["start", profile.dials],
    ["1-1", { recognisability: 1, reactivity: 1 }],
  ];
  const stills: Still[] = [];
  let clipped = 0;
  let compared = 0;
  for (const [dialsName, dials] of settings) {
    clock = 0;
    const element = canvas();
    const engine = createEngine(element);
    engine.setSource(video);
    engine.setDials(dials);
    engine.start();
    let settled: { error: unknown } | "ok" | null = null;
    engine.setProfile(profile).then(
      () => (settled = "ok"),
      (error: unknown) => (settled = { error }),
    );
    // The clock stands still until the swap: the timeline starts at the same time every run.
    for (let frame = 0; frame < 120 && settled === null; frame++) {
      step(0);
      await turn();
    }
    const outcome = settled as { error: unknown } | "ok" | null;
    if (outcome !== "ok") {
      engine.stop();
      const error = outcome?.error;
      return {
        ok: false,
        issues:
          error instanceof ProfileCompileError
            ? [...error.issues]
            : [{ effectIndex: -1, label: "", line: 0, message: String(error ?? "no link") }],
      };
    }
    let previous: Float32Array | null = null;
    for (const moment of TIMELINE) {
      const audio: AudioFeatures = { ...moment.audio, capturedAt: clock };
      engine.setFeatures(audio);
      for (let frame = 1; frame <= MOMENT_FRAMES; frame++) {
        step();
        const luma = capture(element);
        if (limited && previous) {
          compared++;
          if (moved(previous, luma)) clipped++;
        }
        previous = luma;
        if (moment.still && frame === MOMENT_FRAMES) {
          stills.push({
            name: `${moment.still}-${dialsName}.png`,
            png: reader.toDataURL("image/png").slice("data:image/png;base64,".length),
          });
        }
      }
    }
    engine.stop();
    element.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext();
  }
  return { ok: true, stills, clipped, compared };
}

(window as unknown as { profileCheck: unknown }).profileCheck = { check };
document.title = "ready";
