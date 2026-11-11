// The fake media the browser check feeds Chromium (B-01 SD17; plan PD14). Generated at config
// load into the run's temporary directory, so no binary enters git:
//
// - click.wav: 4 s mono 16-bit PCM at 48 kHz, 120 BPM, each beat a 30 ms burst of a 60 Hz sine
//   at −1 dBFS with silence between; low-band onsets for AC6. Chromium loops it.
// - camera.y4m: 10 frames at 10 fps, 320×180, the left half one colour and the right half
//   another; the last 5 frames swap the halves (AC8). Chromium loops it too.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

export const CLICK = {
  sampleRate: 48_000,
  seconds: 4,
  periodMs: 500,
  burstMs: 30,
  hz: 60,
  amplitude: 10 ** (-1 / 20),
} as const;

export const CAMERA = { width: 320, height: 180, fps: 10, frames: 10, swapAt: 5 } as const;

/** Two colours far apart in every channel (8-bit RGB). */
export const LEFT_RGB = [220, 30, 40] as const;
export const RIGHT_RGB = [30, 200, 220] as const;

export function clickWav(): Buffer {
  const { sampleRate, seconds, periodMs, burstMs, hz, amplitude } = CLICK;
  const count = sampleRate * seconds;
  const data = Buffer.alloc(count * 2);
  const period = (sampleRate * periodMs) / 1000;
  const burst = (sampleRate * burstMs) / 1000;
  for (let i = 0; i < count; i++) {
    const inPeriod = i % period;
    const v =
      inPeriod < burst ? amplitude * Math.sin((2 * Math.PI * hz * inPeriod) / sampleRate) : 0;
    data.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36, "ascii");
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** BT.601 studio range, which Chromium assumes for I420 camera frames. */
function toYuv([r, g, b]: readonly [number, number, number]): [number, number, number] {
  const y = 16 + (65.481 * r + 128.553 * g + 24.966 * b) / 255;
  const u = 128 + (-37.797 * r - 74.203 * g + 112.0 * b) / 255;
  const v = 128 + (112.0 * r - 93.786 * g - 18.214 * b) / 255;
  return [Math.round(y), Math.round(u), Math.round(v)];
}

export function cameraY4m(): Buffer {
  const { width, height, fps, frames, swapAt } = CAMERA;
  const header = Buffer.from(`YUV4MPEG2 W${width} H${height} F${fps}:1 Ip A1:1 C420\n`, "ascii");
  const frame = (left: readonly [number, number, number], right: typeof left) => {
    const [yl, ul, vl] = toYuv(left);
    const [yr, ur, vr] = toYuv(right);
    const cw = width / 2;
    const ch = height / 2;
    const y = Buffer.alloc(width * height);
    const u = Buffer.alloc(cw * ch);
    const v = Buffer.alloc(cw * ch);
    for (let row = 0; row < height; row++) {
      y.fill(yl, row * width, row * width + width / 2);
      y.fill(yr, row * width + width / 2, (row + 1) * width);
    }
    for (let row = 0; row < ch; row++) {
      u.fill(ul, row * cw, row * cw + cw / 2);
      u.fill(ur, row * cw + cw / 2, (row + 1) * cw);
      v.fill(vl, row * cw, row * cw + cw / 2);
      v.fill(vr, row * cw + cw / 2, (row + 1) * cw);
    }
    return Buffer.concat([Buffer.from("FRAME\n", "ascii"), y, u, v]);
  };
  const parts = [header];
  for (let n = 0; n < frames; n++) {
    parts.push(n < swapAt ? frame(LEFT_RGB, RIGHT_RGB) : frame(RIGHT_RGB, LEFT_RGB));
  }
  return Buffer.concat(parts);
}

/** Writes both fixtures into `dir` and returns their paths. */
export function writeFakeMedia(dir: string): { wav: string; y4m: string } {
  const wav = join(dir, "click.wav");
  const y4m = join(dir, "camera.y4m");
  writeFileSync(wav, clickWav());
  writeFileSync(y4m, cameraY4m());
  return { wav, y4m };
}
