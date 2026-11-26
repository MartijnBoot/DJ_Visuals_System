// Scenes (B-07 spec SD1, SD6, SD8, SD18, SD19; Data): a saved look — a full copy of the profile
// with its live palette and strengths baked in, the dials, the feed and the transition — and the
// bundle file scenes export to. Validated by the server on write, read and import, and by the
// screen page on what it receives.
import { z } from "zod";
import { transitionDuration, transitionKind } from "./control.ts";
import { LIMITS, profileSchema, toProfileFile } from "./profile.ts";

/** SD18, PD23: at most 200 rows, and a definition's JSON at most 128 KiB of UTF-8. */
export const SCENE_LIMITS = { scenes: 200, definitionBytes: 131072 } as const;

/** SD7, SD9: trimmed, 1 to 60 characters; unique ignoring case is the database's. */
export const sceneNameSchema = z.string().trim().min(1).max(LIMITS.nameLength);

/**
 * SD6: what was on screen. A local camera by the browser's `deviceId` and its label (`""` when
 * the browser gave none, plan PD6); a remote one by the sender's hint (B-04 SD26).
 */
export const feedSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("local"),
    deviceId: z.string().min(1).max(500),
    label: z.string().max(500),
  }),
  z.strictObject({ kind: z.literal("remote"), hint: z.string().max(100) }),
]);
export type Feed = z.infer<typeof feedSchema>;

/** SD1: the transition's type and duration; no Keep colour (the palette is what it is). */
export const sceneTransitionSchema = z.strictObject({
  kind: transitionKind,
  duration: transitionDuration,
});
export type SceneTransition = z.infer<typeof sceneTransitionSchema>;

const unit = z.number().min(0).max(1);

const definitionShape = {
  profile: profileSchema,
  dials: z.strictObject({ recognisability: unit, reactivity: unit }),
  feed: feedSchema.optional(),
  transition: sceneTransitionSchema,
};

/** Data → Scene definition: `{ profile, dials, feed?, transition }`. */
export const sceneDefinitionSchema = z.strictObject(definitionShape);
export type SceneDefinition = z.infer<typeof sceneDefinitionSchema>;

/** A scene as the server stores and returns it. */
export const storedSceneSchema = z.strictObject({
  id: z.string().min(1).max(200),
  name: sceneNameSchema,
  definition: sceneDefinitionSchema,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
export type StoredScene = z.infer<typeof storedSceneSchema>;

/** SD8: `{ formatVersion: 1, scenes: [ { name, profile, dials, feed?, transition } ] }`. */
export const sceneFileSchema = z.strictObject({
  formatVersion: z.literal(1),
  scenes: z
    .array(z.strictObject({ name: sceneNameSchema, ...definitionShape }))
    .min(1)
    .max(SCENE_LIMITS.scenes),
});
export type SceneFile = z.infer<typeof sceneFileSchema>;

/** The file for some scenes; each profile is written as a profile file writes it. */
export function toSceneFile(
  scenes: readonly { name: string; definition: SceneDefinition }[],
): SceneFile {
  return {
    formatVersion: 1,
    scenes: scenes.map(({ name, definition: { profile, dials, feed, transition } }) => ({
      name,
      profile: toProfileFile([profile]).profiles[0]!,
      dials,
      ...(feed === undefined ? {} : { feed }),
      transition,
    })),
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The name of the scene an issue path `scenes.<index>…` points into, when readable. */
export function sceneNameAt(path: string, file: unknown): string | undefined {
  const match = /^scenes\.(\d+)(\.|$)/.exec(path);
  if (!match || !isRecord(file) || !Array.isArray(file.scenes)) return undefined;
  const entry: unknown = file.scenes[Number(match[1])];
  return isRecord(entry) && typeof entry.name === "string" ? entry.name : undefined;
}
