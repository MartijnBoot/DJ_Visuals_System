// Replace on import (B-03 spec SD10, AC17, AC19; plan PD11): a file of exactly one profile whose
// name a stored profile has, trimmed and in any case, may replace that profile in place. A
// bundle only ever adds, and the built-in is never replaced.
import type { ProfileFile, StoredProfile } from "@djv/shared";
import { BUILTIN_ID } from "../profiles/builtin.ts";

const key = (name: string) => name.trim().toLowerCase();

/** The stored profile a one-profile file would replace, or null. */
export function replaceTarget(
  file: ProfileFile,
  stored: readonly StoredProfile[],
): StoredProfile | null {
  if (file.profiles.length !== 1) return null;
  const name = key(file.profiles[0]!.name);
  return stored.find((p) => p.id !== BUILTIN_ID && key(p.name) === name) ?? null;
}
