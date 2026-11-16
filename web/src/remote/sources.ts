// The screen page's sources (B-06 spec SD7, SD8, SD9, SD12, SD17, SD19, SD21, SD22; plan PD2,
// PD6, PD7, PD12, T13): the capture session (the local camera and input, unchanged), the peer
// connections (`peers.ts`) and the two state machines (`main-audio.ts`, `picture.ts`), joined.
// The frame asks two questions — which features, which video element — and `frame(now)`, run at
// the start of each frame, decides both from flags read there, so a loss is acted on in the frame
// it is seen (AC18). Rules:
// - Before Start every sender is paused and no remote feature source exists (SD17). After Start
//   the audio sender's track is fed, through a muted <audio> element (PD12), into a feature source
//   on the session's own AudioContext (PD6), so the local input's source keeps running beside it
//   and the fallback is instant; once ready, that sender becomes main (SD8).
// - With System audio as the local choice, the share is stopped and the default input opened as
//   the standby, without remembering it (PD2, AC21).
// - A remote camera is listed once its peer is connected and its track is in, as
//   "<hint> — Device n", id `remote:<deviceId>` (SD21); it is drawn only once picked and only
//   once its element has a frame (AC16). A `remote:` id never reaches the session.
// - Senders stream per PD7: the audio sender from Start on; a video sender while `picture`
//   lists it active.
import type { AudioFeatures, FeatureSource } from "@djv/audio";
import type { DeviceEntry } from "@djv/shared";
import type { Session } from "../capture/session.ts";
import { createMainAudio, type AudioSource, type MainAudioView } from "./main-audio.ts";
import type { Feed, Peers } from "./peers.ts";
import { createPicture } from "./picture.ts";

const REMOTE = "remote:";
const DEFAULT_INPUT = { kind: "input", deviceId: "default" } as const;

export interface SourcesDeps {
  session: Pick<Session, "read" | "state" | "context" | "setCamera" | "setAudio">;
  peers: Pick<Peers, "feeds" | "connection" | "setActive" | "drop" | "devices">;
  createFeatureSource(
    context: AudioContext,
    stream: MediaStream,
    moduleUrl: string,
  ): Promise<FeatureSource>;
  moduleUrl: string;
  /** PD12: a muted element that keeps a remote audio track flowing into Web Audio. */
  attachAudio(stream: MediaStream): { release(): void };
  createVideo(stream: MediaStream): HTMLVideoElement;
  hasFrame(video: HTMLVideoElement): boolean;
  /** Capture state changes for remote audio, with the sequence label (SD25). */
  log(state: string, label: string): void;
  /** Something the screen state carries changed. */
  onChange(): void;
}

export interface RemoteFacts {
  cameras: { deviceId: string; label: string; remote: true }[];
  /** The picked camera when it is a remote one, else null (the session's own id stands). */
  cameraId: string | null;
  mainAudio: Omit<MainAudioView, "line"> | null;
}

export interface Sources {
  /** The approved senders, from the server's status: anyone gone is dropped. */
  setSenders(senders: readonly Pick<DeviceEntry, "deviceId" | "hint" | "label" | "sends">[]): void;
  /** Start happened: the AudioContext exists. */
  start(): void;
  /** Once per frame, before `read` and `video`. */
  frame(now: number): void;
  read(now: number): AudioFeatures;
  /** What `engine.setSource` gets this frame. */
  video(): HTMLVideoElement | null;
  setCamera(id: string): void;
  setMainAudio(source: AudioSource): void;
  facts(now: number): RemoteFacts;
  /** The overlay's lines (T14): the main-audio line, or null without an audio sender. */
  audioLine(now: number): string | null;
  /** Whether the remote audio is what is analysed, and whether a remote camera is drawn. */
  analysing(now: number): { audio: string | null; video: string | null };
  stop(): void;
}

interface RemoteAudio {
  deviceId: string;
  track: MediaStreamTrack;
  element: { release(): void };
  source: FeatureSource | null;
}

export function createSources(deps: SourcesDeps): Sources {
  const main = createMainAudio();
  const picture = createPicture();
  let senders = new Map<string, Pick<DeviceEntry, "deviceId" | "hint" | "label" | "sends">>();
  let started = false;
  let audio: RemoteAudio | null = null;
  /** Whether the main audio has arrived: from then on a new track is a return, not an arrival. */
  let arrived = false;
  let wasLost = false;
  let lastPlaying: AudioSource = "local";
  /** The first switch to remote is the arrival, not a restoration: no "restored remote". */
  let logsRestored = false;
  let standbyAsked = false;
  const videos = new Map<string, { track: MediaStreamTrack; element: HTMLVideoElement }>();
  let shownVideo: HTMLVideoElement | null = null;
  let shownId: string | null = null;
  let signature = "";

  const audioSender = () => [...senders.values()].find((s) => s.sends.includes("audio"));
  const labelOf = (deviceId: string) => senders.get(deviceId)?.label ?? "";

  const dropAudio = () => {
    if (!audio) return;
    audio.source?.stop();
    audio.element.release();
    audio = null;
  };

  /** A new remote audio track: its element, then its feature source on the session's context. */
  const analyse = (feed: Feed) => {
    const context = deps.session.context();
    if (!context) return;
    dropAudio();
    const next: RemoteAudio = {
      deviceId: feed.deviceId,
      track: feed.track,
      element: deps.attachAudio(feed.stream),
      source: null,
    };
    audio = next;
    deps.createFeatureSource(context, feed.stream, deps.moduleUrl).then(
      (source) => {
        if (audio === next) next.source = source;
        else source.stop();
      },
      () => deps.log("remote audio could not be analysed", labelOf(feed.deviceId)),
    );
  };

  const facts = (now: number): RemoteFacts => {
    const cameras: RemoteFacts["cameras"] = [];
    for (const sender of senders.values()) {
      if (!sender.sends.includes("video") || !videos.has(sender.deviceId)) continue;
      if (!deps.peers.connection(sender.deviceId)?.connected) continue;
      cameras.push({
        deviceId: `${REMOTE}${sender.deviceId}`,
        label: `${sender.hint} — ${sender.label}`,
        remote: true,
      });
    }
    const wanted = picture.wanted(now);
    const view = main.view(now);
    return {
      cameras,
      cameraId: wanted?.startsWith(REMOTE) ? wanted : null,
      mainAudio: view ? { choice: view.choice, playing: view.playing, label: view.label } : null,
    };
  };

  const frameAudio = (now: number) => {
    const sender = audioSender();
    const feed = sender
      ? deps.peers.feeds().find((f) => f.deviceId === sender.deviceId && f.kind === "audio")
      : undefined;
    if (started && sender && feed && audio?.track !== feed.track) analyse(feed);
    if (!sender) return;
    const ready = audio !== null && audio.source !== null && feed !== undefined;
    const lost = !ready || feed.lost || audio?.track !== feed.track;
    if (!arrived) {
      if (!ready || lost) return;
      arrived = true;
      main.arrived(sender.label);
      // PD2, AC21: a running System audio share cannot be the standby; the default input is.
      if (!standbyAsked && deps.session.state().audioChoice?.kind === "system") {
        standbyAsked = true;
        void deps.session.setAudio(DEFAULT_INPUT, { remember: false });
      }
    } else if (lost && !wasLost) {
      main.lost();
      deps.log("remote audio lost", sender.label);
      if (main.view(now)?.choice === "remote") deps.log("fallback local", sender.label);
    } else if (!lost && wasLost) {
      main.back(now);
    }
    wasLost = arrived && lost;
    const playing = main.playing(now);
    if (playing === "remote" && lastPlaying === "local" && arrived && logsRestored) {
      deps.log("restored remote", sender.label);
    }
    logsRestored = true;
    lastPlaying = playing;
  };

  const framePicture = (now: number) => {
    const state = deps.session.state();
    picture.setLocal(state.cameraId ?? null);
    const feeds = deps.peers.feeds().filter((f) => f.kind === "video");
    for (const feed of feeds) {
      const held = videos.get(feed.deviceId);
      if (held?.track !== feed.track) {
        videos.set(feed.deviceId, { track: feed.track, element: deps.createVideo(feed.stream) });
      }
      const id = `${REMOTE}${feed.deviceId}`;
      if (feed.lost) picture.lost(id, now);
      else picture.back(id, now);
    }
    for (const deviceId of videos.keys()) {
      if (!feeds.some((f) => f.deviceId === deviceId)) picture.lost(`${REMOTE}${deviceId}`, now);
    }
    const elementOf = (id: string): HTMLVideoElement | null =>
      id.startsWith(REMOTE)
        ? (videos.get(id.slice(REMOTE.length))?.element ?? null)
        : id === state.cameraId
          ? state.video
          : null;
    const ready = (id: string) => {
      const element = elementOf(id);
      return element !== null && deps.hasFrame(element);
    };
    shownId = picture.shown(now, ready);
    shownVideo = shownId === null ? null : (elementOf(shownId) ?? shownVideo);
  };

  const frameActive = () => {
    const streaming = new Set(started ? picture.active() : []);
    const sender = audioSender();
    if (started && sender) streaming.add(sender.deviceId);
    for (const deviceId of deps.peers.devices()) {
      deps.peers.setActive(deviceId, streaming.has(deviceId));
    }
  };

  return {
    setSenders(list) {
      const next = new Map(list.map((s) => [s.deviceId, s]));
      for (const deviceId of senders.keys()) {
        if (next.has(deviceId)) continue;
        picture.gone(`${REMOTE}${deviceId}`);
        videos.delete(deviceId);
        if (audio?.deviceId === deviceId) dropAudio();
        if (senders.get(deviceId)?.sends.includes("audio")) {
          main.gone();
          arrived = false;
          wasLost = false;
          lastPlaying = "local";
          logsRestored = false;
        }
      }
      for (const deviceId of deps.peers.devices()) {
        if (!next.has(deviceId)) deps.peers.drop(deviceId);
      }
      senders = next;
    },

    start() {
      started = true;
    },

    frame(now) {
      frameAudio(now);
      framePicture(now);
      frameActive();
      const current = JSON.stringify(facts(now));
      if (current !== signature) {
        signature = current;
        deps.onChange();
      }
    },

    read(now) {
      return main.playing(now) === "remote" && audio?.source
        ? audio.source.read(now)
        : deps.session.read(now);
    },

    video: () => shownVideo,

    setCamera(id) {
      picture.pick(id);
      if (!id.startsWith(REMOTE)) void deps.session.setCamera(id);
    },

    setMainAudio(source) {
      main.choose(source);
    },

    facts,

    audioLine: (now) => main.view(now)?.line ?? null,

    analysing(now) {
      const playing = main.playing(now) === "remote" && audio?.source ? audio.deviceId : null;
      const drawn = shownId?.startsWith(REMOTE) ? shownId.slice(REMOTE.length) : null;
      return { audio: playing, video: drawn };
    },

    stop() {
      dropAudio();
      videos.clear();
    },
  };
}
