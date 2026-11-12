// The device ids remembered across reloads (spec SD6, AC5; plan PD10): one localStorage key,
// device ids only. Anything stored that is not that shape reads as nothing remembered.

export const REMEMBERED_KEY = "djv.sources";

export type AudioChoice = { kind: "input"; deviceId: string } | { kind: "system" };

export interface Remembered {
  cameraId?: string;
  audio?: AudioChoice;
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function isAudioChoice(v: unknown): v is AudioChoice {
  if (typeof v !== "object" || v === null) return false;
  const { kind, deviceId } = v as Record<string, unknown>;
  return kind === "system" || (kind === "input" && typeof deviceId === "string");
}

/** The type guard for what comes back out of storage (types at the boundary). */
export function isRemembered(v: unknown): v is Remembered {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const { cameraId, audio } = v as Record<string, unknown>;
  return (
    (cameraId === undefined || typeof cameraId === "string") &&
    (audio === undefined || isAudioChoice(audio))
  );
}

export function loadRemembered(storage: StorageLike = localStorage): Remembered {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(REMEMBERED_KEY) ?? "{}");
    return isRemembered(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** Merges `partial` into what is stored. Never throws: storage may be full or disabled. */
export function saveRemembered(partial: Remembered, storage: StorageLike = localStorage): void {
  try {
    storage.setItem(REMEMBERED_KEY, JSON.stringify({ ...loadRemembered(storage), ...partial }));
  } catch {
    // Remembering is a convenience; the set goes on without it.
  }
}
