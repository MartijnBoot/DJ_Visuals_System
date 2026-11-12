// The profile id remembered across reloads (B-02 spec SD16; plan PD9): one plain string in
// localStorage beside `djv.sources`, never profile data. Anything else reads as nothing
// remembered, and neither function ever throws: storage may be full or disabled.

export const PROFILE_KEY = "djv.profile";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function loadProfileId(storage: StorageLike = localStorage): string | null {
  try {
    const value: unknown = storage.getItem(PROFILE_KEY);
    return typeof value === "string" && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function saveProfileId(id: string, storage: StorageLike = localStorage): void {
  try {
    storage.setItem(PROFILE_KEY, id);
  } catch {
    // Remembering is a convenience; the set goes on without it.
  }
}
