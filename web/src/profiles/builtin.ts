// The built-in profile as a list entry (B-02 spec SD8; plan PD9). It is code, so it exists when
// the database and the API do not; the list puts it first under this reserved id (server ids
// are UUIDs).
import { BUILT_IN_PROFILE } from "@djv/engine";
import type { StoredProfile } from "@djv/shared";
import { engineToShared } from "../profile-compat.ts";

export const BUILTIN_ID = "builtin";

const EPOCH = "1970-01-01T00:00:00.000Z";

/** The engine's built-in in the listed shape: a fresh, editable copy of the frozen original. */
export function builtinEntry(): StoredProfile {
  return {
    ...engineToShared(structuredClone(BUILT_IN_PROFILE)),
    id: BUILTIN_ID,
    revision: 1,
    createdAt: EPOCH,
    updatedAt: EPOCH,
  };
}
