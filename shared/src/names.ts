// The one "Name (n)" rule (B-02 spec SD7, SD14; plan PD12, AD5): import, duplicate and "save
// mine as a copy" all name a profile through it, so a 60-character name can be taken twice.
import { LIMITS } from "./profile.ts";

/** `base` if no taken name matches it (case-insensitive, trimmed), else the first free "base (n)". */
export function nextFreeName(base: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((name) => name.trim().toLowerCase()));
  const name = base.trim();
  if (!used.has(name.toLowerCase())) return name;
  for (let n = 2; ; n++) {
    const suffix = ` (${n})`;
    const candidate = name.slice(0, LIMITS.nameLength - suffix.length).trimEnd() + suffix;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}
