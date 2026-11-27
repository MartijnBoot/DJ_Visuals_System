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
  type SceneDefinition,
  type SceneTransition,
  type Staged,
} from "@djv/shared";
import type { ProfileResult } from "../profiles/api.ts";
import {
  SCENE_PREFIX,
  definitionOf,
  faderEntries,
  fetchReason,
  type LiveSnapshot,
} from "../profiles/active.ts";
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
  /** Moves on with every change to the staged look; Go reads it when pressed (PD21). */
  revision(): number;
  /**
   * After a Go lands (AC11): the copy of the new live look, unless the staged look changed since
   * `revision` (SD11: that change wins). A staged pick still loading lands in the copy (PD21).
   */
  afterGo(
    revision: number,
    snapshot: LiveSnapshot,
    dials: Profile["dials"],
    feed: Feed | null,
    transition: SceneTransition,
    fromScene: { id: string; name: string } | null,
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
  /** B-07 AC6: a saved scene staged: its copy as the base, as stored, tied to it (SD11). */
  fromScene(scene: SceneDefinition, id: string, name: string): void;
  /** B-07 PD8: after a Save or Update the look is tied to what it was saved as. */
  tie(scene: { id: string; name: string } | null): void;
  /** B-07 PD3: why a save, rename or delete was refused; cleared by the next edit. */
  setReason(reason: string | null): void;
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
  /** Every change moves it on, so a Go can tell whether the look changed while it ran. */
  let revision = 0;

  const changed = () => {
    revision++;
    deps.onChange();
  };
  /** Runs `edit` on the look when there is one, then tells the page. */
  const edit = (fn: (current: Look) => void) => {
    if (!look) return;
    fn(look);
    look.reason = null; // a refusal's words belong to the look as it was
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

  const copyOf = (
    snapshot: LiveSnapshot,
    dials: Profile["dials"],
    feed: Feed | null,
    transition: SceneTransition,
    fromScene: { id: string; name: string } | null,
    settled: boolean,
  ): Look => ({
    id: snapshot.id,
    name: snapshot.name,
    stored: snapshot.stored,
    palette: [...snapshot.palette],
    amounts: [...snapshot.amounts],
    dials: { ...dials },
    feed,
    transition: { kind: transition.kind, duration: transition.duration },
    fromScene,
    settled,
    reason: null,
  });

  return {
    fromLive(snapshot, dials, feed, transition, fromScene = null) {
      token++; // a pick in flight belongs to the look it was made on
      look = copyOf(snapshot, dials, feed, transition, fromScene, true);
      changed();
    },

    revision: () => revision,

    afterGo(at, snapshot, dials, feed, transition, fromScene) {
      if (!look || at !== revision) return;
      // The token stays: a pick still loading belongs to this copy and lands in it (PD21).
      look = copyOf(snapshot, dials, feed, transition, fromScene, look.settled);
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
    fromScene(scene, id, name) {
      token++;
      look = {
        id: `${SCENE_PREFIX}${id}`,
        name,
        stored: scene.profile,
        palette: [...scene.profile.palette],
        amounts: scene.profile.effects.map((e) => e.amount),
        dials: { ...scene.dials },
        feed: scene.feed ?? null,
        transition: { kind: scene.transition.kind, duration: scene.transition.duration },
        fromScene: { id, name },
        settled: true,
        reason: null,
      };
      changed();
    },
    tie(scene) {
      if (!look) return;
      look.fromScene = scene;
      changed();
    },
    setReason(reason) {
      if (!look) return;
      look.reason = reason;
      changed();
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
