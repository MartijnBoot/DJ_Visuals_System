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
// B-09 (SD4, SD5, SD12, PD10): each pick passes the transition choice current when it was made,
// with the outgoing primary as it is on screen for Dip, and with Keep colour on that primary goes
// into the incoming profile's primary slot, live only: Reset restores the stored colour.
// B-18 (SD6, SD7, PD4, PD5): an effect's strength is live in the same way, beside the palette:
// both live copies go in every swap, a successful pick drops them, and a pending pick, another
// profile or a place with no effect drops a strength change.
import { ProfileCompileError, type GuardEvent, type SetProfileOptions } from "@djv/engine";
import { derivePrimary, type EffectEntry, type Profile, type TransitionChoice } from "@djv/shared";
import type { ListResult, ProfileResult } from "./api.ts";
import { BUILTIN_ID, builtinEntry } from "./builtin.ts";
import { DEFAULT_TRANSITION, engineTransition } from "./transition.ts";

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
  /** B-18 PD5: the active profile's effects ticked DJ or VJ, in stack order. */
  effects: EffectEntry[];
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
   * B-09: with a transition, it resolves at the transition's first frame (SD16).
   */
  setProfile(profile: Profile, options?: SetProfileOptions): Promise<void>;
  setDials(dials: Profile["dials"]): void;
  log(id: string): void;
  /** B-09 SD5: the page's current transition choice, read at each pick; absent, Cut. */
  transition?(): TransitionChoice;
}

export interface ActiveProfile {
  open(): Promise<void>;
  pick(id: string): Promise<void>;
  /** Sets one palette slot live; dropped while a pick is pending or outside the palette. */
  setColour(slot: number, value: string): void;
  /** Puts one slot back to its stored colour. */
  resetColour(slot: number): void;
  /**
   * Sets one effect's strength live (B-18 SD7); dropped while a pick is pending, when `profile`
   * is not the active one or `index` is no effect of it.
   */
  setStrength(profile: string, index: number, value: number): void;
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
  // B-12 PD4: hosted use, a read refused for sign-in or for the account.
  signedOut: "profiles unavailable: sign in again; keeping the current look",
  notAllowed: "profiles unavailable: this account has no access; keeping the current look",
} as const;

/** The reason a refused read gives, when the refusal is about sign-in (B-12 PD4). */
const signInReason = (kind: string): string | null =>
  kind === "signed_out" ? REASONS.signedOut : kind === "not_allowed" ? REASONS.notAllowed : null;

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
  /** B-18 PD4: live strengths by place in the stack; a successful pick empties it. */
  let liveAmounts = new Map<number, number>();
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
    effects: faderEffects(),
  });

  /** B-18 PD5: one entry per effect ticked DJ or VJ, named as the builder names it. */
  const faderEffects = (): EffectEntry[] =>
    activeProfile.effects.flatMap((effect, index) => {
      const dj = effect.dj === true;
      const vj = effect.vj === true;
      if (!dj && !vj) return [];
      const name = (effect.type === "custom" ? effect.label.trim() : effect.type).slice(0, 40);
      const value = liveAmounts.get(index) ?? effect.amount;
      return [{ index, name, stored: effect.amount, value, dj, vj }];
    });

  /**
   * Switches to `profile` in the engine by `choice`, then its dials; `false` when the engine
   * refuses. No colour changes while a pick is pending, so the primary read here is the one on
   * screen when the transition starts (SD4, SD12).
   */
  const apply = async (
    id: string,
    profile: Profile,
    mine: number,
    choice: TransitionChoice,
  ): Promise<boolean> => {
    const onScreen = live[derivePrimary(activeProfile)] ?? "#000000";
    const slot = derivePrimary(profile);
    const palette = profile.palette.map((c, i) => (choice.keepColour && i === slot ? onScreen : c));
    // A Cut is the engine's call as before B-09: no transition is Cut (PD4).
    const options: SetProfileOptions =
      choice.kind === "cut"
        ? { pick: true }
        : { pick: true, transition: engineTransition(choice, onScreen, Math.random()) };
    try {
      await deps.setProfile({ ...profile, palette }, options);
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
    live = palette; // the stored palette, or with the carried primary (SD4)
    liveAmounts = new Map(); // every effect back at its stored strength (B-18 SD6)
    reason = null;
    guardReason = null;
    emit();
    return true;
  };

  /** A person's pick uses the choice current at the pick (SD5). */
  const pick = (id: string): Promise<void> =>
    pickWith(id, deps.transition?.() ?? DEFAULT_TRANSITION);

  const pickWith = async (id: string, choice: TransitionChoice): Promise<void> => {
    const mine = ++token;
    picking = mine;
    try {
      await pickAs(id, mine, choice);
    } finally {
      if (picking === mine) picking = 0;
    }
  };

  const pickAs = async (id: string, mine: number, choice: TransitionChoice): Promise<void> => {
    if (id === BUILTIN_ID) {
      await apply(BUILTIN_ID, builtin, mine, choice);
      return;
    }
    const result = await deps.api.get(id);
    if (mine !== token) return;
    if (result.kind !== "ok") {
      reason =
        signInReason(result.kind) ??
        (result.kind === "unreachable"
          ? REASONS.unreachable
          : result.kind === "missing"
            ? REASONS.missing
            : REASONS.unusable);
      emit();
      return;
    }
    await apply(id, result.profile, mine, choice);
  };

  const open = async (): Promise<void> => {
    const result = await deps.api.list();
    if (result.kind !== "ok") {
      reason =
        signInReason(result.kind) ??
        (result.kind === "unreachable" ? REASONS.listUnreachable : REASONS.listUnusable);
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
      // Restoring is no pick: the remembered profile is drawn alone, as before B-09 (spec, edge
      // cases: "the reloaded page draws the remembered profile alone, as today").
      if (id && stored.some((e) => e.id === id)) await pickWith(id, DEFAULT_TRANSITION);
    }
  };

  /**
   * Hands the engine the active profile with the live palette and strengths: the same effect
   * list, so no new program. It swaps on the next frame without linking, so it cannot fail; were
   * it to, the look simply stays as it was.
   */
  const push = () => {
    const effects = activeProfile.effects.map((effect, i) => {
      const amount = liveAmounts.get(i);
      return amount === undefined ? effect : { ...effect, amount };
    });
    deps.setProfile({ ...activeProfile, palette: [...live], effects }).catch(() => {});
    emit();
  };

  const recolour = (slot: number, value: string) => {
    if (picking !== 0 || slot >= live.length) return;
    live = live.map((c, i) => (i === slot ? value : c));
    push();
  };

  return {
    open,
    pick,
    setColour: recolour,
    resetColour(slot) {
      const stored = activeProfile.palette[slot];
      if (stored !== undefined) recolour(slot, stored);
    },
    setStrength(profile, index, value) {
      if (picking !== 0 || profile !== active.id) return;
      if (index < 0 || index >= activeProfile.effects.length) return;
      liveAmounts.set(index, value);
      push();
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
