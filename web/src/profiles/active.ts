// The screen page's profile logic (B-02 spec SD6, SD9, SD15, SD16, AC11 to AC14; plan PD1,
// PD16, AD2), UI-free so it is tested with fakes like `capture/session.ts`. Nothing is fetched
// until a user action: `open()` (the panel opened, or Start) lists the profiles, and the first
// successful one also picks the remembered profile. `pick(id)` re-fetches, validates, hands the
// profile to the engine, then applies its starting dials and remembers it. The page keeps the
// copy it loaded: an edit or delete elsewhere changes nothing until a profile is picked (SD9).
// Every failure keeps the current look and sets a one-line reason; the screen never goes blank.
import type { Profile } from "@djv/shared";
import type { ListResult, ProfileResult } from "./api.ts";
import { BUILTIN_ID, builtinEntry } from "./builtin.ts";

export interface Entry {
  id: string;
  name: string;
}

export interface ActiveState {
  /** What the picker lists: the built-in first, then the stored names. */
  entries: Entry[];
  /** The profile on screen. */
  activeId: string;
  activeName: string;
  /** What the picker shows: the active one, or the remembered one before the first load (PD1). */
  selectedId: string;
  /** Why the built-in or the current look was kept (AC13); null when there is nothing to say. */
  reason: string | null;
  /** A list has been fetched: the picker is enabled. */
  loaded: boolean;
}

export interface ActiveDeps {
  api: {
    list(): Promise<ListResult>;
    get(id: string): Promise<ProfileResult>;
  };
  storage: { load(): string | null; save(id: string): void };
  /** Hands the profile to the engine; resolves at the swap, rejects when it cannot be prepared. */
  setProfile(profile: Profile): Promise<void>;
  setDials(dials: Profile["dials"]): void;
  log(id: string): void;
}

export interface ActiveProfile {
  open(): Promise<void>;
  pick(id: string): Promise<void>;
  state(): ActiveState;
  subscribe(listener: () => void): () => void;
}

const REASONS = {
  listUnreachable: "profiles unavailable: the server cannot be reached; keeping the current look",
  listUnusable:
    "profiles unavailable: the server's answer could not be read; keeping the current look",
  unreachable:
    "that profile could not be fetched: the server cannot be reached; keeping the current look",
  missing: "that profile no longer exists; keeping the current look",
  unusable: "that profile could not be read; keeping the current look",
  engine: "that profile could not be prepared; keeping the current look",
} as const;

export function createActiveProfile(deps: ActiveDeps): ActiveProfile {
  const builtin = builtinEntry();
  const remembered = (): string | null => {
    const id = deps.storage.load();
    return id && id !== BUILTIN_ID ? id : null;
  };

  let stored: Entry[] = [];
  let loaded = false;
  let active: Entry = { id: BUILTIN_ID, name: builtin.name };
  let reason: string | null = null;
  let rememberedPicked = false;
  let token = 0;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());

  const entries = (): Entry[] => {
    if (!loaded) {
      const id = remembered();
      return id ? [{ id, name: "remembered profile" }] : [{ id: BUILTIN_ID, name: builtin.name }];
    }
    const list: Entry[] = [{ id: BUILTIN_ID, name: builtin.name }, ...stored];
    // A profile deleted elsewhere keeps rendering, so the picker keeps showing it (SD9).
    if (active.id !== BUILTIN_ID && !stored.some((e) => e.id === active.id)) list.push(active);
    return list;
  };

  const state = (): ActiveState => ({
    entries: entries(),
    activeId: active.id,
    activeName: active.name,
    selectedId: loaded ? active.id : (entries()[0]?.id ?? BUILTIN_ID),
    reason,
    loaded,
  });

  /** Switches to `profile` in the engine, then its dials; `false` when the engine refuses. */
  const apply = async (id: string, profile: Profile, mine: number): Promise<boolean> => {
    try {
      await deps.setProfile(profile);
    } catch {
      if (mine === token) {
        reason = REASONS.engine;
        emit();
      }
      return false;
    }
    if (mine !== token) return true; // a newer pick took over: it decides what is shown
    deps.setDials(profile.dials);
    deps.storage.save(id);
    deps.log(id);
    active = { id, name: profile.name };
    reason = null;
    emit();
    return true;
  };

  const pick = async (id: string): Promise<void> => {
    const mine = ++token;
    if (id === BUILTIN_ID) {
      await apply(BUILTIN_ID, builtin, mine);
      return;
    }
    const result = await deps.api.get(id);
    if (mine !== token) return;
    if (result.kind !== "ok") {
      reason =
        result.kind === "unreachable"
          ? REASONS.unreachable
          : result.kind === "missing"
            ? REASONS.missing
            : REASONS.unusable;
      emit();
      return;
    }
    await apply(id, result.profile, mine);
  };

  const open = async (): Promise<void> => {
    const result = await deps.api.list();
    if (result.kind !== "ok") {
      reason = result.kind === "unreachable" ? REASONS.listUnreachable : REASONS.listUnusable;
      stored = [];
      loaded = true;
      emit();
      return;
    }
    stored = result.profiles.map((p) => ({ id: p.id, name: p.name }));
    loaded = true;
    reason = null;
    emit();
    if (!rememberedPicked) {
      rememberedPicked = true;
      const id = remembered();
      if (id && stored.some((e) => e.id === id)) await pick(id);
    }
  };

  return {
    open,
    pick,
    state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
