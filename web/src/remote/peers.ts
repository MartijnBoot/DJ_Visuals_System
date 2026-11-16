// The screen page's peer connections (B-06 spec SD10, SD12, SD16, SD20, AC12; plan PD7, PD8,
// PD11, PD15, T10): one per sender, answering the sender's offer `recvonly`. No ICE server: only
// host candidates, nothing needs internet, no media passes the server (SD10). A new offer from a
// device replaces its connection (the sender offers again whenever the screen reconnects). Each
// received track is a feed, lost at once when it ends or the peer becomes `disconnected` or
// `failed`, and after `MUTE_LOSS_MS` of mute (PD8); and, as the owner amended PD8 (2026-11-16),
// when its inbound `packetsReceived` has not moved for `MUTE_LOSS_MS` while the sender was asked
// to stream — Chromium gives a receiver no ended, mute or state change when the sender stops its
// track, so the statistics are the only sign. Read every `STALL_POLL_MS`. `setActive` asks the
// sender to pause or
// resume its encoding of one kind, once per change (SD12): a sender of both has its audio and its
// video paused apart. Logs carry the device id and an event, never an
// SDP or a candidate (SD25); the caller maps the id to the sequence label.
import type { ScreenMessage } from "@djv/shared";
import { MUTE_LOSS_MS } from "../capture/session.ts";
import { opusMusic } from "./sdp.ts";
import { legMs, type LegSample } from "./stats.ts";

export type FeedKind = "audio" | "video";

/** How often the statistics are read for a stalled feed (PD8 as amended). */
export const STALL_POLL_MS = 250;

export interface Feed {
  deviceId: string;
  kind: FeedKind;
  track: MediaStreamTrack;
  stream: MediaStream;
  lost: boolean;
}

export interface PeerConnectionView {
  state: RTCPeerConnectionState;
  /** When this device's first offer since it was last forgotten arrived (PD5's 10 s). */
  firstOfferAt: number;
  /** Whether the current connection has reached `connected`. */
  connected: boolean;
}

type SetupMessage = Extract<ScreenMessage, { type: "answer" | "candidate" | "stream" }>;

export interface PeersDeps {
  createPeer?: (config: RTCConfiguration) => RTCPeerConnection;
  send(message: SetupMessage): void;
  now(): number;
  log(event: string, deviceId: string): void;
  /** A feed, a loss or a connection state changed. */
  onChange?(): void;
}

export interface Peers {
  offer(deviceId: string, sdp: string): void;
  candidate(deviceId: string, init: RTCIceCandidateInit): void;
  drop(deviceId: string): void;
  setActive(deviceId: string, kind: FeedKind, active: boolean): void;
  feeds(): Feed[];
  connection(deviceId: string): PeerConnectionView | null;
  /** The network leg in ms for one statistics poll, or null (PD15). */
  stats(deviceId: string, kind: FeedKind): Promise<number | null>;
  /** Every device with a connection. */
  devices(): string[];
  close(): void;
}

interface FeedState {
  feed: Omit<Feed, "lost">;
  ended: boolean;
  mutedLong: boolean;
  /** No new packet for `MUTE_LOSS_MS` while streaming (PD8 as amended). */
  stalled: boolean;
  /** The last `packetsReceived` seen, and when it last moved (or streaming began). */
  packets: number | null;
  movedAt: number;
  release(): void;
}

interface Entry {
  pc: RTCPeerConnection;
  feeds: Map<FeedKind, FeedState>;
  peerDown: boolean;
  connected: boolean;
  /** Per kind; null until said on this connection. */
  active: Partial<Record<FeedKind, boolean>>;
  /** When the screen last asked this sender to stream a kind. */
  activeSince: Partial<Record<FeedKind, number>>;
  samples: Partial<Record<FeedKind, LegSample | null>>;
}

const defaultPeer = (config: RTCConfiguration) => new RTCPeerConnection(config);

export function createPeers(deps: PeersDeps): Peers {
  const createPeer = deps.createPeer ?? defaultPeer;
  const entries = new Map<string, Entry>();
  const firstOffer = new Map<string, number>();
  const changed = () => deps.onChange?.();

  const forgetFeeds = (entry: Entry) => {
    for (const state of entry.feeds.values()) state.release();
    entry.feeds.clear();
  };

  const close = (deviceId: string) => {
    const entry = entries.get(deviceId);
    if (!entry) return;
    entries.delete(deviceId);
    forgetFeeds(entry);
    entry.pc.close();
  };

  const watch = (entry: Entry, deviceId: string, track: MediaStreamTrack, stream: MediaStream) => {
    const kind = track.kind === "video" ? "video" : "audio";
    entry.feeds.get(kind)?.release();
    let muteTimer: ReturnType<typeof setTimeout> | null = null;
    const state: FeedState = {
      feed: { deviceId, kind, track, stream },
      ended: track.readyState === "ended",
      mutedLong: false,
      stalled: false,
      packets: null,
      movedAt: deps.now(),
      release: () => {
        track.removeEventListener("ended", onEnded);
        track.removeEventListener("mute", onMute);
        track.removeEventListener("unmute", onUnmute);
        if (muteTimer) clearTimeout(muteTimer);
      },
    };
    function onEnded() {
      state.ended = true;
      deps.log(`${kind} track ended`, deviceId);
      changed();
    }
    function onMute() {
      muteTimer ??= setTimeout(() => {
        muteTimer = null;
        if (!track.muted) return;
        state.mutedLong = true;
        deps.log(`${kind} track muted`, deviceId);
        changed();
      }, MUTE_LOSS_MS);
    }
    function onUnmute() {
      if (muteTimer) clearTimeout(muteTimer);
      muteTimer = null;
      if (!state.mutedLong) return;
      state.mutedLong = false;
      changed();
    }
    track.addEventListener("ended", onEnded);
    track.addEventListener("mute", onMute);
    track.addEventListener("unmute", onUnmute);
    entry.feeds.set(kind, state);
    deps.log(`${kind} track`, deviceId);
    changed();
  };

  const answer = async (entry: Entry, deviceId: string, sdp: string) => {
    const { pc } = entry;
    // Called before any await, so candidates that follow are queued behind it by the browser.
    const remote = pc.setRemoteDescription({ type: "offer", sdp });
    try {
      await remote;
      for (const t of pc.getTransceivers()) t.direction = "recvonly";
      const local = await pc.createAnswer();
      const munged = { type: "answer" as const, sdp: opusMusic(local.sdp ?? "") };
      await pc.setLocalDescription(munged);
      for (const receiver of pc.getReceivers()) {
        if ("jitterBufferTarget" in receiver) receiver.jitterBufferTarget = 0;
      }
      if (entries.get(deviceId) !== entry) return;
      deps.send({ type: "answer", deviceId, sdp: munged.sdp });
      deps.log("answered", deviceId);
    } catch {
      if (entries.get(deviceId) === entry) deps.log("answer failed", deviceId);
    }
  };

  /** One read of each streaming connection's inbound packet counts (PD8 as amended). */
  const checkStalls = async () => {
    for (const [deviceId, entry] of [...entries]) {
      if (!Object.values(entry.active).includes(true) || entry.feeds.size === 0) continue;
      let report: RTCStatsReport;
      try {
        report = await entry.pc.getStats();
      } catch {
        continue;
      }
      if (entries.get(deviceId) !== entry) continue;
      const now = deps.now();
      for (const [kind, state] of entry.feeds) {
        let packets: number | null = null;
        for (const stat of (report as Map<string, Record<string, unknown>>).values()) {
          if (stat.type === "inbound-rtp" && stat.kind === kind) {
            packets = typeof stat.packetsReceived === "number" ? stat.packetsReceived : null;
          }
        }
        if (packets !== null && packets !== state.packets) {
          state.packets = packets;
          state.movedAt = now;
        }
        if (entry.active[kind] !== true) continue; // a paused kind sends nothing by design
        const since = Math.max(state.movedAt, entry.activeSince[kind] ?? now);
        const stalled = now - since >= MUTE_LOSS_MS;
        if (stalled === state.stalled) continue;
        state.stalled = stalled;
        deps.log(stalled ? `${kind} stalled` : `${kind} flowing`, deviceId);
        changed();
      }
    }
  };
  const poll = setInterval(() => void checkStalls(), STALL_POLL_MS);

  return {
    offer(deviceId, sdp) {
      close(deviceId);
      if (!firstOffer.has(deviceId)) firstOffer.set(deviceId, deps.now());
      const pc = createPeer({ iceServers: [] });
      const entry: Entry = {
        pc,
        feeds: new Map(),
        peerDown: false,
        connected: false,
        active: {}, // a new connection starts paused at the sender: say it again
        activeSince: {},
        samples: {},
      };
      entries.set(deviceId, entry);
      pc.addEventListener("track", (event) => {
        if (entries.get(deviceId) !== entry) return;
        const stream = event.streams[0] ?? new MediaStream([event.track]);
        watch(entry, deviceId, event.track, stream);
      });
      pc.addEventListener("icecandidate", (event) => {
        if (entries.get(deviceId) !== entry || !event.candidate) return;
        const { candidate, sdpMid, sdpMLineIndex } = event.candidate.toJSON();
        deps.send({
          type: "candidate",
          deviceId,
          candidate: candidate ?? "",
          sdpMid: sdpMid ?? null,
          sdpMLineIndex: sdpMLineIndex ?? null,
        });
      });
      pc.addEventListener("connectionstatechange", () => {
        if (entries.get(deviceId) !== entry) return;
        const state = pc.connectionState;
        deps.log(`peer ${state}`, deviceId);
        if (state === "connected") {
          entry.connected = true;
          entry.peerDown = false;
        } else if (state === "disconnected" || state === "failed") {
          entry.peerDown = true;
        }
        changed();
      });
      deps.log("offer", deviceId);
      void answer(entry, deviceId, sdp);
      changed();
    },

    candidate(deviceId, init) {
      const entry = entries.get(deviceId);
      if (!entry) return;
      entry.pc.addIceCandidate(init).catch(() => deps.log("candidate refused", deviceId));
    },

    drop(deviceId) {
      close(deviceId);
      firstOffer.delete(deviceId);
      changed();
    },

    setActive(deviceId, kind, active) {
      const entry = entries.get(deviceId);
      if (!entry || entry.active[kind] === active) return;
      entry.active[kind] = active;
      if (active) entry.activeSince[kind] = deps.now();
      const feed = entry.feeds.get(kind);
      if (!active && feed?.stalled) {
        feed.stalled = false; // paused, it sends nothing by design: not a loss
        changed();
      }
      deps.send({ type: "stream", deviceId, kind, active });
    },

    feeds() {
      const out: Feed[] = [];
      for (const entry of entries.values()) {
        for (const state of entry.feeds.values()) {
          const lost = state.ended || state.mutedLong || state.stalled || entry.peerDown;
          out.push({ ...state.feed, lost });
        }
      }
      return out;
    },

    connection(deviceId) {
      const entry = entries.get(deviceId);
      if (!entry) return null;
      return {
        state: entry.pc.connectionState,
        firstOfferAt: firstOffer.get(deviceId) ?? deps.now(),
        connected: entry.connected,
      };
    },

    async stats(deviceId, kind) {
      const entry = entries.get(deviceId);
      if (!entry) return null;
      let report: RTCStatsReport;
      try {
        report = await entry.pc.getStats();
      } catch {
        return null;
      }
      const leg = legMs(entry.samples[kind] ?? null, report, kind);
      entry.samples[kind] = leg.sample;
      return leg.ms;
    },

    devices: () => [...entries.keys()],

    close() {
      clearInterval(poll);
      for (const deviceId of [...entries.keys()]) close(deviceId);
      firstOffer.clear();
    },
  };
}
