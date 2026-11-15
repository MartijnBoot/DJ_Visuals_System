// The renderer's public surface (spec, In scope: engine/). Framework-free: raw WebGL2 and
// requestAnimationFrame, no dependency of any kind (Phase 0 AC16). Each frame draws the active
// profile's look (`shader.ts`, `profile.ts`) into one of two ping-pong targets, reading the
// other as the previous frame, and blits the result to the canvas. A profile with another
// effect list is linked while the old one keeps drawing and swapped in at the start of a frame
// (B-02 SD15, PD4).
import { DEFAULT_DIALS, ZERO_FEATURES, type AudioFeatures, type Dials } from "./features.ts";
import {
  beginProgram,
  createProgram,
  createTarget,
  createTexture,
  deleteTarget,
  FULLSCREEN_VERTEX,
  programReady,
  type Linking,
  type ParallelCompile,
  type Target,
} from "./gl.ts";
import { createLatencyWindow, type LatencyReading } from "./latency.ts";
import {
  BUILT_IN_PROFILE,
  customUniforms,
  PALETTE_SLOTS,
  profileUniforms,
  type Profile,
} from "./profile.ts";
import { createScaleController, type RenderScale } from "./scale.ts";
import { buildFragment, fragmentLayout, type FragmentEntry } from "./shader.ts";
import { locateErrors, ProfileCompileError, type BodyLines } from "./compile-error.ts";
import { createFrameStats, type EngineStats } from "./stats.ts";

export type { EngineStats, FrameStats } from "./stats.ts";
export type { LatencyReading } from "./latency.ts";
export type { RenderScale } from "./scale.ts";
export type { AudioFeatures, Dials } from "./features.ts";
export { DEFAULT_DIALS, ZERO_FEATURES } from "./features.ts";
export type {
  Binding,
  BuiltInEffect,
  CustomEffect,
  CustomParam,
  Effect,
  EffectInfo,
  EffectType,
  FeatureName,
  Profile,
} from "./profile.ts";
export { BUILT_IN_PROFILE, EFFECTS, effectStrength } from "./profile.ts";
export { locateErrors, ProfileCompileError } from "./compile-error.ts";
export type { CompileIssue } from "./compile-error.ts";

export interface Engine {
  start(): void;
  stop(): void;
  stats(): EngineStats;
  /** In-app audio-to-frame latency over the last 10 s (SD15). */
  latency(): LatencyReading;
  /** The newest audio features; read by the next frame. */
  setFeatures(features: AudioFeatures): void;
  /** The two dials; applied on the next frame (AC9). */
  setDials(dials: Dials): void;
  /** The camera, or `null` for the generative input (SD10). */
  setSource(video: HTMLVideoElement | null): void;
  /** The panel's quality cap: the automatic render scale never exceeds it (SD8). */
  setScaleCap(cap: RenderScale): void;
  /**
   * Switches to a profile by a hard cut (B-02 SD15, PD4). The same effect list: the values
   * apply on the next frame and this resolves at once. Another list: its program is linked
   * while the old profile keeps drawing, and this resolves at the frame that swaps it in. It
   * rejects when the program does not link (the old profile keeps drawing) or when a later
   * call supersedes it.
   */
  setProfile(profile: Profile): Promise<void>;
}

/** Thrown by `createEngine` when the canvas gives no WebGL2 context. */
export class WebGL2UnavailableError extends Error {
  constructor() {
    super("WebGL2 is not available in this browser");
    this.name = "WebGL2UnavailableError";
  }
}

/** The reason a `setProfile` promise rejects when a later call replaced it before its swap. */
export class ProfileSupersededError extends Error {
  constructor() {
    super("profile switch superseded by a later one");
    this.name = "ProfileSupersededError";
  }
}

/** `HTMLMediaElement.HAVE_CURRENT_DATA`: a frame can be uploaded. */
const HAVE_CURRENT_DATA = 2;

/** Linked programs kept for a quick switch back; the built-in's and the active one stay. */
const PROGRAM_CACHE = 8;

/** Failed keys remembered: each holds up to twelve bodies of code, so only a few (PD9). */
const FAILURE_CACHE = 16;

const UNIFORMS = [
  "uSource",
  "uPrevious",
  "uResolution",
  "uCover",
  "uHasSource",
  "uTime",
  "uTint",
  "uTintWeight",
  "uBlock",
  "uLevels",
  "uFeedback",
  "uZoom",
  "uDisplace",
  "uFlash",
  "uFlashColour",
  "uGrain",
  "uGrainColour",
  "uEdges",
  "uEdgesColour",
  "uBrightness",
  "uPalette",
  "uPaletteSize",
  "uPaletteMix",
  "uMirror",
  "uSegments",
  "uRgbSplit",
] as const;

type Locations = Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>;

/** Present only in a program with a custom effect (B-03 PD7). */
const CUSTOM_UNIFORMS = [
  "uCustomStrength",
  "uCustomParam",
  "uAudio.level",
  "uAudio.low",
  "uAudio.mid",
  "uAudio.high",
  "uAudio.beat",
] as const;

type CustomLocations = Record<(typeof CUSTOM_UNIFORMS)[number], WebGLUniformLocation | null>;

interface Linked {
  key: string;
  program: WebGLProgram;
  loc: Locations;
  /** Null for a program without custom effects: their uniforms are never set. */
  custom: CustomLocations | null;
}

interface PendingSwitch {
  profile: Profile;
  key: string;
  /** Null when the program is already linked (in the cache). */
  linking: Linking | null;
  /** Where each custom body sits in the fragment, to locate a compile error (PD9). */
  bodies: BodyLines[];
  resolve(): void;
  reject(error: Error): void;
}

/** The chain a profile's program draws: its effect list, custom code included (B-03 SD3). */
const entriesOf = (profile: Profile): FragmentEntry[] =>
  profile.effects.map((e) => (e.type === "custom" ? { type: "custom", code: e.code } : e.type));

/**
 * A program is identified by its ordered effect list and every custom body's code. The code is
 * JSON-quoted, so no code can read as another list.
 */
const keyOf = (profile: Profile) =>
  entriesOf(profile)
    .map((e) => (typeof e === "string" ? e : `custom:${JSON.stringify(e.code)}`))
    .join(",");

/** The effect types alone, for a log line: never the code. */
const typesOf = (profile: Profile) => profile.effects.map((e) => e.type).join(",");

export function createEngine(canvas: HTMLCanvasElement): Engine {
  // No multisampling: `blitFramebuffer` may not write to a multisampled default framebuffer.
  const gl = canvas.getContext("webgl2", { antialias: false });
  if (!gl) throw new WebGL2UnavailableError();
  const parallel = gl.getExtension(
    "KHR_parallel_shader_compile",
  ) as unknown as ParallelCompile | null;

  const locate = <N extends string>(program: WebGLProgram, names: readonly N[]) =>
    Object.fromEntries(names.map((name) => [name, gl.getUniformLocation(program, name)])) as Record<
      N,
      WebGLUniformLocation | null
    >;
  const linked = (key: string, program: WebGLProgram, custom: boolean): Linked => ({
    key,
    program,
    loc: locate(program, UNIFORMS),
    custom: custom ? locate(program, CUSTOM_UNIFORMS) : null,
  });
  const hasCustom = (profile: Profile) => profile.effects.some((e) => e.type === "custom");
  const fragmentFor = (profile: Profile) => buildFragment(entriesOf(profile));
  const bodiesOf = (profile: Profile): BodyLines[] =>
    fragmentLayout(entriesOf(profile)).map((body) => {
      const effect = profile.effects[body.effectIndex];
      return { ...body, label: effect?.type === "custom" ? effect.label : "" };
    });

  const builtInKey = keyOf(BUILT_IN_PROFILE);
  const cache = new Map<string, Linked>();
  let active: { profile: Profile; linked: Linked } = {
    profile: BUILT_IN_PROFILE,
    linked: linked(
      builtInKey,
      createProgram(gl, FULLSCREEN_VERTEX, fragmentFor(BUILT_IN_PROFILE)),
      false,
    ),
  };
  cache.set(builtInKey, active.linked);
  let pending: PendingSwitch | null = null;
  /** The first frame after a swap mixes nothing of the old look into the new one (PD4). */
  let swapped = false;
  /** Keys that did not link, with why: logged once; custom code is not compiled again (PD9). */
  const failures = new Map<string, Error>();
  const noteFailure = (key: string, error: Error) => {
    failures.set(key, error);
    for (const old of failures.keys()) {
      if (failures.size <= FAILURE_CACHE) break;
      failures.delete(old);
    }
  };
  /** A remembered failure, with the labels the profile has now (a rename keeps the key). */
  const failureFor = (key: string, profile: Profile): Error | null => {
    const error = failures.get(key);
    if (!error || !(error instanceof ProfileCompileError)) return error ?? null;
    return new ProfileCompileError(
      error.issues.map((issue) => {
        const effect = profile.effects[issue.effectIndex];
        return effect?.type === "custom" ? { ...issue, label: effect.label } : issue;
      }),
    );
  };

  const remember = (entry: Linked) => {
    cache.delete(entry.key);
    cache.set(entry.key, entry);
    for (const [key, old] of cache) {
      if (cache.size <= PROGRAM_CACHE) break;
      if (key === builtInKey || key === active.linked.key || key === entry.key) continue;
      gl.deleteProgram(old.program);
      cache.delete(key);
    }
  };

  const supersede = () => {
    if (!pending) return;
    if (pending.linking) gl.deleteProgram(pending.linking.program);
    pending.reject(new ProfileSupersededError());
    pending = null;
  };

  /** At the start of a frame: swap a ready profile in, or settle a failed one. */
  const advance = () => {
    if (!pending) return;
    const next = pending;
    let entry = cache.get(next.key);
    if (!entry) {
      const state = programReady(gl, next.linking!, parallel);
      if (state.state === "pending") return;
      pending = null;
      if (state.state === "failed") {
        const issues = locateErrors(state.message, next.bodies);
        const error =
          issues.length > 0 ? new ProfileCompileError(issues) : new Error(state.message);
        if (!failures.has(next.key)) {
          noteFailure(next.key, error);
          console.warn("profile program did not link; keeping the current profile", {
            effects: typesOf(next.profile),
            reason: state.message,
          });
        }
        next.reject(error);
        return;
      }
      entry = linked(next.key, state.program, hasCustom(next.profile));
    }
    pending = null;
    remember(entry);
    active = { profile: next.profile, linked: entry };
    swapped = true;
    next.resolve();
  };

  const sourceTexture = createTexture(gl);

  const frames = createFrameStats();
  const scaler = createScaleController(frames);
  const latency = createLatencyWindow();
  let handle: number | null = null;
  let features: AudioFeatures = ZERO_FEATURES;
  let dials: Dials = DEFAULT_DIALS;
  let video: HTMLVideoElement | null = null;
  let targets: [Target, Target] | null = null;
  let current = 0;

  const targetsFor = (width: number, height: number): [Target, Target] => {
    if (targets && targets[0].width === width && targets[0].height === height) return targets;
    const old = targets;
    targets = [createTarget(gl, width, height), createTarget(gl, width, height)];
    if (old) {
      // In a profile with code the limiter needs the real previous frame (B-03 PD4): the last
      // output, scaled into the new previous target. Built-in profiles start from black.
      if (active.linked.custom) copy(old[1 - current]!, targets[1 - current]!);
      for (const t of old) deleteTarget(gl, t);
      // Recreated targets are cleared black: no smear on the next frame, or it mixes that in.
      swapped = true;
    }
    return targets;
  };

  /** Scales one target's picture into another. */
  const copy = (from: Target, to: Target) => {
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, from.framebuffer);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, to.framebuffer);
    gl.blitFramebuffer(
      0,
      0,
      from.width,
      from.height,
      0,
      0,
      to.width,
      to.height,
      gl.COLOR_BUFFER_BIT,
      gl.LINEAR,
    );
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  };

  /** Uploads the camera's current frame; returns its size, or null to draw the noise field. */
  const uploadSource = (): { width: number; height: number } | null => {
    if (!video || video.readyState < HAVE_CURRENT_DATA || video.videoWidth === 0) return null;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    } catch {
      return null; // the picture never stops (SD7): fall back to the noise field
    } finally {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    }
    return { width: video.videoWidth, height: video.videoHeight };
  };

  const frame = (timestamp: number) => {
    handle = requestAnimationFrame(frame);
    advance();
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    if (width > 0 && height > 0) {
      draw(timestamp, width, height);
      // Submit time minus capture time, once per new window of audio (SD15, PD21).
      latency.recordFrame(features.capturedAt, performance.now());
    }
    frames.record(timestamp);
    scaler.record(timestamp);
  };

  const draw = (timestamp: number, canvasWidth: number, canvasHeight: number) => {
    // The internal resolution (SD8): the pass runs at canvas size × scale, the blit scales up.
    const scale = scaler.scale();
    const width = Math.max(1, Math.round(canvasWidth * scale));
    const height = Math.max(1, Math.round(canvasHeight * scale));
    const pair = targetsFor(width, height);
    const target = pair[current]!;
    const previous = pair[1 - current]!;
    const size = uploadSource();
    const u = profileUniforms(active.profile, features, dials, timestamp, size !== null, width);
    // A profile with code starts with both targets holding the last output, so a body that
    // discards a pixel leaves a picture at most one limited step old (B-03 PD3, PD4).
    if (swapped && active.linked.custom) copy(previous, target);
    if (swapped) u.feedback = 0;
    swapped = false;
    const loc = active.linked.loc;

    // Cover fit: the camera fills the frame, cropped on the long side, never stretched.
    let cover: [number, number] = [1, 1];
    if (size) {
      const ratio = size.width / size.height / (width / height);
      cover = ratio > 1 ? [1 / ratio, 1] : [1, ratio];
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, width, height);
    gl.useProgram(active.linked.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
    gl.uniform1i(loc.uSource, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, previous.texture);
    gl.uniform1i(loc.uPrevious, 1);
    gl.uniform2f(loc.uResolution, width, height);
    gl.uniform2f(loc.uCover, cover[0], cover[1]);
    gl.uniform1f(loc.uHasSource, size ? 1 : 0);
    gl.uniform1f(loc.uTime, u.time);
    gl.uniform3f(loc.uTint, ...u.tint);
    gl.uniform1f(loc.uTintWeight, u.tintWeight);
    gl.uniform1f(loc.uBlock, u.block);
    gl.uniform1f(loc.uLevels, u.levels);
    gl.uniform1f(loc.uFeedback, u.feedback);
    gl.uniform1f(loc.uZoom, u.zoom);
    gl.uniform1f(loc.uDisplace, u.displace);
    gl.uniform1f(loc.uFlash, u.flash);
    gl.uniform3f(loc.uFlashColour, ...u.flashColour);
    gl.uniform1f(loc.uGrain, u.grain);
    gl.uniform3f(loc.uGrainColour, ...u.grainColour);
    gl.uniform1f(loc.uEdges, u.edges);
    gl.uniform3f(loc.uEdgesColour, ...u.edgesColour);
    gl.uniform1f(loc.uBrightness, u.brightness);
    gl.uniform3fv(loc.uPalette, u.palette.flat(), 0, PALETTE_SLOTS * 3);
    gl.uniform1f(loc.uPaletteSize, u.paletteSize);
    gl.uniform1f(loc.uPaletteMix, u.paletteMix);
    gl.uniform1f(loc.uMirror, u.mirror);
    gl.uniform1f(loc.uSegments, u.segments);
    gl.uniform1f(loc.uRgbSplit, u.rgbSplit);
    const custom = active.linked.custom;
    if (custom) {
      const c = customUniforms(active.profile, features, dials);
      gl.uniform1fv(custom.uCustomStrength, c.strength);
      gl.uniform4fv(custom.uCustomParam, c.params);
      gl.uniform1f(custom["uAudio.level"], c.audio.level);
      gl.uniform1f(custom["uAudio.low"], c.audio.low);
      gl.uniform1f(custom["uAudio.mid"], c.audio.mid);
      gl.uniform1f(custom["uAudio.high"], c.audio.high);
      gl.uniform1f(custom["uAudio.beat"], c.audio.beat);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, target.framebuffer);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.blitFramebuffer(
      0,
      0,
      width,
      height,
      0,
      0,
      canvasWidth,
      canvasHeight,
      gl.COLOR_BUFFER_BIT,
      gl.LINEAR,
    );
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    current = 1 - current;
  };

  return {
    start() {
      if (handle === null) handle = requestAnimationFrame(frame);
    },
    stop() {
      if (handle !== null) cancelAnimationFrame(handle);
      handle = null;
    },
    stats() {
      return { ...frames.read(performance.now()), renderScale: scaler.scale() };
    },
    latency() {
      return latency.read(performance.now());
    },
    setFeatures(next) {
      features = next;
    },
    setDials(next) {
      dials = next;
    },
    setSource(next) {
      video = next;
    },
    setScaleCap(cap) {
      scaler.setCap(cap);
    },
    setProfile(profile) {
      const key = keyOf(profile);
      if (pending && pending.key === key && pending.linking) {
        // The same list is already linking: keep the link, take the newer values.
        const linking = pending.linking;
        pending.linking = null;
        supersede();
        return new Promise((resolve, reject) => {
          pending = { profile, key, linking, resolve, reject, bodies: bodiesOf(profile) };
        });
      }
      supersede();
      if (key === active.linked.key) {
        active = { ...active, profile };
        return Promise.resolve();
      }
      // Code that did not compile is not compiled again on the next slider move (PD9).
      const failed = hasCustom(profile) ? failureFor(key, profile) : null;
      if (failed) return Promise.reject(failed);
      return new Promise((resolve, reject) => {
        let linking: Linking | null = null;
        if (!cache.has(key)) {
          try {
            linking = beginProgram(gl, FULLSCREEN_VERTEX, fragmentFor(profile));
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
            return;
          }
        }
        pending = { profile, key, linking, resolve, reject, bodies: bodiesOf(profile) };
      });
    },
  };
}
