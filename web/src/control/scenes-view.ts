// What /control shows and sends while a look is staged (B-07 spec SD4, SD9, SD11; plan PD20, T9).
// Pure: the controller's Editing switch reads "staged" or "live", and every control shows the look
// it edits — the page shows the screen's state, never its own guess — and sends the target that
// look needs. Live sends no target at all, so every B-04 message is what it was (AC9).
import type { ScreenState, Staged, TransitionKind } from "@djv/shared";
import type { ControlInput } from "./device-link.ts";

export type Editing = "staged" | "live";

/** What the controls show: the live look, or the staged one (PD20). */
export interface ShownLook {
  /** The pressed profile tile, and the profile an effect fader names. */
  id: string;
  palette: string[];
  storedPalette: string[];
  primary: number;
  dials: ScreenState["dials"];
  effects: ScreenState["effects"];
  transition: { kind: TransitionKind; duration: number; keepColour: boolean };
  /** The pressed camera tile: the live camera, or the staged feed's match. */
  cameraId: string | null;
}

/** A camera tile matching a staged feed: by its label, or a sender by its hint (PD6). */
function feedCamera(state: ScreenState, feed: Staged["feed"]): string | null {
  if (!feed || feed.label === "") return null;
  const found = state.cameras.filter((c) =>
    feed.kind === "local"
      ? !c.remote && c.label === feed.label
      : c.remote && c.label.startsWith(`${feed.label} — `),
  );
  return found.length === 1 ? found[0]!.deviceId : null;
}

export function shownLook(state: ScreenState, editing: Editing): ShownLook {
  const staged = state.staged;
  if (editing === "staged" && staged) {
    return {
      id: staged.id,
      palette: staged.palette,
      storedPalette: staged.storedPalette,
      primary: staged.primary,
      dials: staged.dials,
      effects: staged.effects,
      // A scene holds no Keep colour (SD1).
      transition: { ...staged.transition, keepColour: false },
      cameraId: feedCamera(state, staged.feed),
    };
  }
  return {
    id: state.activeId,
    palette: state.palette,
    storedPalette: state.storedPalette,
    primary: state.primary,
    dials: state.dials,
    effects: state.effects,
    transition: state.transition,
    cameraId: state.cameraId,
  };
}

const TARGETED = new Set([
  "pick",
  "dials",
  "colour",
  "resetColour",
  "camera",
  "transition",
  "effect",
]);

/** The seven controls carry `target: "staged"` while the switch reads Staged; nothing else does. */
export function withTarget<M extends ControlInput>(message: M, editing: Editing): M {
  return editing === "staged" && TARGETED.has(message.type)
    ? { ...message, target: "staged" }
    : message;
}

export interface SaveChoice {
  label: string;
  /** Update replaces this scene's content (SD9). */
  updateId: string | undefined;
  /** The name it saves under; null takes the name field's. */
  name: string | null;
}

/** SD9, AC21: Update and Save as new while the look's scene is listed; else one Save. */
export function saveChoices(
  staged: Staged | null | undefined,
  scenes: readonly { id: string; name: string }[],
): SaveChoice[] {
  const tied = staged?.fromScene ?? null;
  if (!tied) return [{ label: "Save", updateId: undefined, name: null }];
  const listed = scenes.find((s) => s.id === tied.id);
  const asNew: SaveChoice = { label: "Save as new", updateId: undefined, name: null };
  return listed
    ? [{ label: `Update ${listed.name}`, updateId: listed.id, name: listed.name }, asNew]
    : [asNew];
}

const NAME_RULE = "A name is 1 to 60 characters";

/** AC20: checked here for feedback; the server decides (and alone knows a taken name). */
export function nameProblem(name: string): string | null {
  const trimmed = name.trim();
  return trimmed.length >= 1 && trimmed.length <= 60 ? null : NAME_RULE;
}

/** AC18: "Feed: label (applies at Go)" while the staged feed is not the camera on screen. */
export function feedLine(state: ScreenState): string | null {
  const feed = state.staged?.feed;
  if (!feed || feed.label === "") return null;
  if (feedCamera(state, feed) === state.cameraId && state.cameraId !== null) return null;
  return `Feed: ${feed.label} (applies at Go)`;
}
