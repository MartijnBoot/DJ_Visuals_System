// The staged look (B-07 spec SD2, SD3, SD11; plan PD3, PD4, PD7, T5): the look being built off to
// the side on the screen page while the output draws the live one. A pure sibling of
// `profiles/active.ts`: it holds its own base profile, live palette, live strengths, dials, feed
// and transition, and reaches nothing live — no engine, no camera, no saved choice. Its only
// request is `api.get` for a staged pick, with its own token, so a newer pick supersedes a pending
// one; a failure keeps the look and says why in the words a live pick uses. A controller sees the
// look through `state()`; its definition stays here (SD18) for Go, Save and the preview.
import {
  derivePrimary,
  type Feed,
  type Profile,
  type SceneTransition,
  type Staged,
} from "@djv/shared";
import type { ProfileResult } from "../profiles/api.ts";
import { definitionOf, faderEntries, fetchReason, type LiveSnapshot } from "../profiles/active.ts";
import { BUILTIN_ID, builtinEntry } from "../profiles/builtin.ts";

export type { LiveSnapshot } from "../profiles/active.ts";

export interface StagedDeps {
  api: { get(id: string): Promise<ProfileResult> };
  /** The staged look changed: every controller mirrors it in the next frame's state. */
  onChange(): void;
}

/** Everything the screen page needs to make the staged look live, save it or preview it. */
export interface StagedDefinition extends LiveSnapshot {
  dials: Profile["dials"];
  /** The feed Go will switch to; null leaves the camera alone (SD6). */
  feed: Feed | null;
  transition: SceneTransition;
}

export interface StagedLook {
  /** Stage from live (AC1): a copy of the live look; `fromScene` when it came from a scene (PD22). */
  fromLive(
    snapshot: LiveSnapshot,
    dials: Profile["dials"],
    feed: Feed | null,
    transition: SceneTransition,
    fromScene?: { id: string; name: string } | null,
  ): void;
  /** A staged pick (AC5): that profile with its starting dials and stored palette; keeps the rest. */
  pick(id: string): Promise<void>;
  setDials(change: Partial<Profile["dials"]>): void;
  setColour(slot: number, value: string): void;
  resetColour(slot: number): void;
  /** Dropped unless `profile` is the staged look's id and `index` one of its effects (PD7). */
  setStrength(profile: string, index: number, value: number): void;
  setFeed(feed: Feed | null): void;
  /** Kind and duration only: a scene holds no Keep colour (SD1, PD7). */
  setTransition(change: Partial<SceneTransition>): void;
  /** Unstage (AC7). */
  clear(): void;
  state(): Staged | null;
  definition(): StagedDefinition | null;
}

interface Look extends StagedDefinition {
  fromScene: { id: string; name: string } | null;
  settled: boolean;
  reason: string | null;
}

export function createStagedLook(deps: StagedDeps): StagedLook {
  let look: Look | null = null;
  /** The token of the staged pick in flight; a newer pick or a new look moves it on. */
  let token = 0;

  const changed = () => deps.onChange();
  /** Runs `edit` on the look when there is one, then tells the page. */
  const edit = (fn: (current: Look) => void) => {
    if (!look) return;
    fn(look);
    changed();
  };

  const loaded = (id: string, profile: Profile) => {
    if (!look) return;
    look.id = id;
    look.name = profile.name;
    look.stored = profile;
    look.palette = [...profile.palette];
    look.amounts = profile.effects.map((e) => e.amount);
    look.dials = { ...profile.dials };
    look.settled = true;
    look.reason = null;
  };

  return {
    fromLive(snapshot, dials, feed, transition, fromScene = null) {
      token++; // a pick in flight belongs to the look it was made on
      look = {
        id: snapshot.id,
        name: snapshot.name,
        stored: snapshot.stored,
        palette: [...snapshot.palette],
        amounts: [...snapshot.amounts],
        dials: { ...dials },
        feed,
        transition: { kind: transition.kind, duration: transition.duration },
        fromScene,
        settled: true,
        reason: null,
      };
      changed();
    },

    async pick(id) {
      if (!look) return;
      const mine = ++token;
      look.settled = false;
      changed();
      if (id === BUILTIN_ID) {
        loaded(BUILTIN_ID, definitionOf(builtinEntry()));
        changed();
        return;
      }
      const result = await deps.api.get(id);
      if (mine !== token || !look) return;
      if (result.kind === "ok") loaded(id, definitionOf(result.profile));
      else {
        look.settled = true;
        look.reason = fetchReason(result.kind);
      }
      changed();
    },

    setDials(change) {
      edit((l) => (l.dials = { ...l.dials, ...change }));
    },
    setColour(slot, value) {
      if (!look || slot >= look.palette.length) return;
      edit((l) => (l.palette = l.palette.map((c, i) => (i === slot ? value : c))));
    },
    resetColour(slot) {
      const stored = look?.stored.palette[slot];
      if (stored !== undefined) this.setColour(slot, stored);
    },
    setStrength(profile, index, value) {
      if (!look || profile !== look.id || index < 0 || index >= look.amounts.length) return;
      edit((l) => (l.amounts = l.amounts.map((a, i) => (i === index ? value : a))));
    },
    setFeed(feed) {
      edit((l) => (l.feed = feed));
    },
    setTransition(change) {
      edit((l) => {
        l.transition = {
          kind: change.kind ?? l.transition.kind,
          duration: change.duration ?? l.transition.duration,
        };
      });
    },
    clear() {
      if (!look) return;
      token++;
      look = null;
      changed();
    },

    state() {
      if (!look) return null;
      const { id, name, stored, palette, amounts, dials, feed, transition, fromScene } = look;
      return {
        id,
        name,
        palette: [...palette],
        storedPalette: [...stored.palette],
        primary: derivePrimary(stored),
        dials: { ...dials },
        effects: faderEntries(stored, (i) => amounts[i] ?? 0),
        feed:
          feed === null
            ? null
            : { kind: feed.kind, label: feed.kind === "local" ? feed.label : feed.hint },
        transition: { ...transition },
        fromScene,
        settled: look.settled,
        reason: look.reason,
      };
    },

    definition() {
      if (!look) return null;
      const { id, name, stored, palette, amounts, dials, feed, transition } = look;
      return {
        id,
        name,
        stored,
        palette: [...palette],
        amounts: [...amounts],
        dials,
        feed,
        transition,
      };
    },
  };
}
