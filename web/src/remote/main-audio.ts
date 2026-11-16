// Main audio (B-06 spec SD7, SD8, SD22; plan PD8, T11): the choice ("remote" or "local") and the
// source that plays. Pure: no timer, no browser API; the caller hands in the time. An arriving
// audio sender sets the choice to remote and plays at once (AC17). While the choice is remote, a
// loss plays local in the same call (AC18), and the remote plays again once it has been back and
// not lost for 3 s; a loss inside them starts them over (AC19). The local choice pins local until
// someone chooses remote again (AC20).

export type AudioSource = "remote" | "local";

/** How long the remote audio must be back and steady before it plays again (SD7). */
export const RETURN_MS = 3000;

export interface MainAudioView {
  choice: AudioSource;
  playing: AudioSource;
  /** The audio sender's sequence label. */
  label: string;
  /** The overlay's `audio:` line (SD22). */
  line: string;
}

export interface MainAudio {
  /** An audio sender's stream arrived: the choice becomes remote (SD8). */
  arrived(label: string): void;
  /** The remote audio is lost (track ended, muted over 1 s, peer disconnected or failed). */
  lost(): void;
  /** The remote audio is back at `now`. */
  back(now: number): void;
  /** The audio sender left: nothing remote any more. */
  gone(): void;
  choose(source: AudioSource): void;
  playing(now: number): AudioSource;
  /** Null while no audio sender is there. */
  view(now: number): MainAudioView | null;
}

export function createMainAudio(): MainAudio {
  let label: string | null = null;
  let choice: AudioSource = "remote";
  let isLost = false;
  /** When the remote came back; -Infinity when it never left. */
  let backSince = -Infinity;

  const playing = (now: number): AudioSource =>
    label !== null && choice === "remote" && !isLost && now - backSince >= RETURN_MS
      ? "remote"
      : "local";

  return {
    arrived(next) {
      label = next;
      choice = "remote";
      isLost = false;
      backSince = -Infinity;
    },
    lost() {
      if (label !== null) isLost = true;
    },
    back(now) {
      if (label === null || !isLost) return;
      isLost = false;
      backSince = now;
    },
    gone() {
      label = null;
      isLost = false;
      backSince = -Infinity;
    },
    choose(source) {
      choice = source;
    },
    playing,
    view(now) {
      if (label === null) return null;
      const plays = playing(now);
      const line =
        plays === "remote"
          ? `audio: remote (${label}) ok`
          : choice === "remote"
            ? "audio: local (fallback: remote lost)"
            : "audio: local";
      return { choice, playing: plays, label, line };
    },
  };
}
