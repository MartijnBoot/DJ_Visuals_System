// The picture (B-06 spec SD9, SD12, SD19, AC16, AC22, AC23; plan PD7, PD8, PD14, PD17): which
// camera is wanted, which is shown, and which senders must stream. Pure: no timer, no element;
// the caller hands in the time and a `ready` test. Rules:
// - `wanted` is the pick; a picked remote camera lost for 1 s falls back to the local camera (the
//   session keeps it running, SD19) or the no-camera look without one; after 3 s back and steady
//   it returns, unless another camera was picked in between (AC23). A remote camera that leaves
//   cannot return (PD17).
// - `shown` moves to `wanted` only once `ready(wanted)` says it has a frame, so the previous
//   camera stays on screen until then (AC16); with nothing wanted it is the no-camera look at once.
// - `active` is every remote camera that must stream: the shown one, and the picked one (also
//   while it is lost and waiting to return), so a switch has its first frame to swap to (PD7).
// A `remote:` id never reaches the capture session: the caller hands it only local ids.

/** How long a picked remote camera may be lost before the picture falls back (PD8). */
export const FALLBACK_MS = 1000;
/** How long it must be back and steady before the picture returns to it (SD9). */
export const RETURN_MS = 3000;

const REMOTE = "remote:";
const isRemote = (id: string | null): id is string => id !== null && id.startsWith(REMOTE);

export interface Picture {
  /** The session's local camera id, or null with none. */
  setLocal(id: string | null): void;
  /** A camera picked from the panel or a controller: a local id or `remote:<deviceId>`. */
  pick(id: string): void;
  lost(id: string, now: number): void;
  back(id: string, now: number): void;
  /** A remote camera left (its sender ended or disconnected). */
  gone(id: string): void;
  tick(now: number): void;
  /** The camera the picture wants now, or null for the no-camera look. */
  wanted(now: number): string | null;
  /** The camera on screen after this frame. */
  shown(now: number, ready: (id: string) => boolean): string | null;
  /** The senders (device ids) that must stream. */
  active(): string[];
}

export function createPicture(): Picture {
  let local: string | null = null;
  let picked: string | null = null;
  let shownId: string | null = null;
  const gone = new Set<string>();
  /** The picked remote camera's loss, if any: since when, and whether the picture fell back. */
  let lostAt: number | null = null;
  let backAt: number | null = null;
  let fallen = false;

  const tick = (now: number) => {
    if (!isRemote(picked)) return;
    if (lostAt !== null && now - lostAt >= FALLBACK_MS) fallen = true;
    if (fallen && lostAt === null && backAt !== null && now - backAt >= RETURN_MS) {
      fallen = false;
      backAt = null;
    }
  };

  const wanted = (now: number): string | null => {
    tick(now);
    if (!isRemote(picked)) return local;
    if (gone.has(picked) || fallen) return local;
    return picked;
  };

  return {
    setLocal(id) {
      local = id;
    },
    pick(id) {
      picked = id;
      lostAt = null;
      backAt = null;
      fallen = false;
    },
    lost(id, now) {
      if (id !== picked || lostAt !== null) return;
      lostAt = now;
    },
    back(id, now) {
      if (id !== picked || lostAt === null) return;
      lostAt = null;
      backAt = now;
    },
    gone(id) {
      gone.add(id);
    },
    tick,
    wanted,
    shown(now, ready) {
      const target = wanted(now);
      if (target === null) shownId = null;
      else if (target !== shownId && ready(target)) shownId = target;
      return shownId;
    },
    active() {
      const out = new Set<string>();
      for (const id of [shownId, picked]) {
        if (isRemote(id) && !gone.has(id)) out.add(id.slice(REMOTE.length));
      }
      return [...out];
    },
  };
}
