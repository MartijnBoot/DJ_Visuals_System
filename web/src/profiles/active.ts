// The screen page's profile logic (B-02 spec SD6, SD9, SD15, SD16, AC11 to AC14; plan PD1,
// PD16, AD2), UI-free so it is tested with fakes like `capture/session.ts`. Nothing is fetched
// until a user action: `open()` (the panel opened, or Start) lists the profiles, and the first
// successful one also picks the remembered profile. `pick(id)` re-fetches, validates, hands the
// profile to the engine, then applies its starting dials and remembers it. The page keeps the
// copy it loaded: an edit or delete elsewhere changes nothing until a profile is picked (SD9).
// Every failure keeps the current look and sets a one-line reason; the screen never goes blank.
// B-04 (SD7, PD6): the active profile is kept whole, with a live copy of its palette that a
// controller edits in memory and never saves; a pick, the same profile included, starts again
// from the stored palette. While a pick is pending a colour change is dropped: handing the engine
// a profile then would cancel the pick, and the swap would discard the colour anyway.
import { ProfileCompileError, type GuardEvent } from "@djv/engine";
import { derivePrimary, type Profile } from "@djv/shared";
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
  /** The colours on screen: the stored palette with any live edits (B-04 SD7). */
  palette: string[];
  /** The active profile's palette as stored. */
  storedPalette: string[];
  /** The primary slot: stored, or derived when absent (B-04 SD10). */
  primary: number;
}

export interface ActiveDeps {
  api: {
    list(): Promise<ListResult>;
    get(id: string): Promise<ProfileResult>;
  };
  storage: { load(): string | null; save(id: string): void };
  /**
   * Hands the profile to the engine; resolves at the swap, rejects when it cannot be prepared.
   * `pick`: the person picked it, so custom effects the guard turned off run again (B-03 PD8).
   */
  setProfile(profile: Profile, options?: { pick?: boolean }): Promise<void>;
  setDials(dials: Profile["dials"]): void;
  log(id: string): void;
}

export interface ActiveProfile {
  open(): Promise<void>;
  pick(id: string): Promise<void>;
  /** Sets one palette slot live; dropped while a pick is pending or outside the palette. */
  setColour(slot: number, value: string): void;
  /** Puts one slot back to its stored colour. */
  resetColour(slot: number): void;
  /** The engine's guard acted (B-03 SD8): its reason shows until the next successful pick. */
  guard(event: GuardEvent): void;
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

/** The guard's reasons (B-03 PD8); the panel and every controller show them word for word. */
const GUARD_REASONS = {
  slow: "custom effects are off: this look is too heavy for this GPU; pick the profile again to retry",
  lostCustom:
    "the graphics context was lost and restored; custom effects are off; pick the profile again to retry",
  lost: "the graphics context was lost and restored",
} as const;

function guardReasonOf(event: GuardEvent): string {
  if (event.kind === "slow") return GUARD_REASONS.slow;
  return event.customBypassed ? GUARD_REASONS.lostCustom : GUARD_REASONS.lost;
}

/**
 * Why the engine refused a profile (B-03 AC21, PD9): the custom effect whose code does not
 * compile, by its label, never the compiler's text (the reason reaches controllers too).
 */
function engineReason(error: unknown): string {
  const located =
    error instanceof ProfileCompileError ? error.issues.find((i) => i.effectIndex >= 0) : undefined;
  if (!located) return REASONS.engine;
  return `that profile could not be prepared: custom effect "${located.label}" does not compile; keeping the current look`;
}

export function createActiveProfile(deps: ActiveDeps): ActiveProfile {
  const builtin = builtinEntry();
  const remembered = (): string | null => {
    const id = deps.storage.load();
    return id && id !== BUILTIN_ID ? id : null;
  };

  let stored: Entry[] = [];
  let loaded = false;
  let active: Entry = { id: BUILTIN_ID, name: builtin.name };
  let activeProfile: Profile = builtin;
  let live: string[] = [...builtin.palette];
  /** The token of the pick in flight, or 0. */
  let picking = 0;
  let reason: string | null = null;
  /** Kept apart from `reason`: opening the panel clears that, never this (B-03 PD8). */
  let guardReason: string | null = null;
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
    reason: reason ?? guardReason,
    loaded,
    palette: [...live],
    storedPalette: [...activeProfile.palette],
    primary: derivePrimary(activeProfile),
  });

  /** Switches to `profile` in the engine, then its dials; `false` when the engine refuses. */
  const apply = async (id: string, profile: Profile, mine: number): Promise<boolean> => {
    try {
      await deps.setProfile(profile, { pick: true });
    } catch (error) {
      if (mine === token) {
        reason = engineReason(error);
        emit();
      }
      return false;
    }
    if (mine !== token) return true; // a newer pick took over: it decides what is shown
    deps.setDials(profile.dials);
    deps.storage.save(id);
    deps.log(id);
    active = { id, name: profile.name };
    activeProfile = profile;
    live = [...profile.palette];
    reason = null;
    guardReason = null;
    emit();
    return true;
  };

  const pick = async (id: string): Promise<void> => {
    const mine = ++token;
    picking = mine;
    try {
      await pickAs(id, mine);
    } finally {
      if (picking === mine) picking = 0;
    }
  };

  const pickAs = async (id: string, mine: number): Promise<void> => {
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

  /** Hands the engine the active profile with the live palette: same effects, no new program. */
  const recolour = (slot: number, value: string) => {
    if (picking !== 0 || slot >= live.length) return;
    live = live.map((c, i) => (i === slot ? value : c));
    // The same effect list swaps on the next frame without linking, so it cannot fail; were it
    // to, the colour simply stays as it was.
    deps.setProfile({ ...activeProfile, palette: [...live] }).catch(() => {});
    emit();
  };

  return {
    open,
    pick,
    setColour: recolour,
    resetColour(slot) {
      const stored = activeProfile.palette[slot];
      if (stored !== undefined) recolour(slot, stored);
    },
    guard(event) {
      guardReason = guardReasonOf(event);
      emit();
    },
    state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
