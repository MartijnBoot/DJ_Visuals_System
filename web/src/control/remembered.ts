// What External control remembers in browser storage (B-04 spec, Data): on the screen machine, the
// address chosen for the QR code (`djv.controlAddress`); on a controller's LAN origin, the session
// key (`djv.controlKey`, useless once the pairing ends) and the mode (`djv.controlMode`). Plain strings;
// anything unreadable reads as nothing remembered, and nothing here ever throws: storage may be
// full or disabled, and the link goes on without it.

export const KEY_KEY = "djv.controlKey";
export const ADDRESS_KEY = "djv.controlAddress";
export const MODE_KEY = "djv.controlMode";
/** B-06 (Data): a sender's session key and what it sends, on the LAN origin. */
export const SEND_KEY_KEY = "djv.sendKey";
export const SEND_CHOICE_KEY = "djv.sendChoice";

export type Mode = "dj" | "vj";

/** Below this width a first open starts in DJ mode (SD9). */
export const DJ_BELOW_PX = 600;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const nothing: StorageLike = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

/** `localStorage`, or a store that keeps nothing when merely reading it throws (blocked site data). */
const browserStorage = (): StorageLike => {
  try {
    return localStorage;
  } catch {
    return nothing;
  }
};

const read = (storage: StorageLike, key: string): string | null => {
  try {
    const value: unknown = storage.getItem(key);
    return typeof value === "string" && value.length > 0 ? value : null;
  } catch {
    return null;
  }
};

const write = (storage: StorageLike, key: string, value: string | null): void => {
  try {
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, value);
  } catch {
    // A convenience only.
  }
};

const sessionKey = (storage: StorageLike, name: string) => ({
  load: () => read(storage, name),
  save: (key: string) => write(storage, name, key),
  clear: () => write(storage, name, null),
});

/** The session key store the controller's link uses. */
export function keyStore(storage: StorageLike = browserStorage()) {
  return sessionKey(storage, KEY_KEY);
}

/** The session key store a sender's link uses (B-06 SD15): apart from the controller's. */
export function sendKeyStore(storage: StorageLike = browserStorage()) {
  return sessionKey(storage, SEND_KEY_KEY);
}

/** What a sender sends and from which devices, for its next pairing (B-06 SD14). */
export interface SendChoice {
  video: boolean;
  audio: boolean;
  cameraId?: string;
  audioSource?: { kind: "input"; deviceId: string } | { kind: "system" };
}

function isSendChoice(v: unknown): v is SendChoice {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const { video, audio, cameraId, audioSource } = v as Record<string, unknown>;
  if (typeof video !== "boolean" || typeof audio !== "boolean") return false;
  if (cameraId !== undefined && typeof cameraId !== "string") return false;
  if (audioSource === undefined) return true;
  if (typeof audioSource !== "object" || audioSource === null) return false;
  const { kind, deviceId } = audioSource as Record<string, unknown>;
  return kind === "system" || (kind === "input" && typeof deviceId === "string");
}

export function sendChoiceStore(storage: StorageLike = browserStorage()) {
  return {
    load(): SendChoice | null {
      const raw = read(storage, SEND_CHOICE_KEY);
      if (raw === null) return null;
      try {
        const parsed: unknown = JSON.parse(raw);
        return isSendChoice(parsed) ? parsed : null;
      } catch {
        return null;
      }
    },
    save: (choice: SendChoice) => write(storage, SEND_CHOICE_KEY, JSON.stringify(choice)),
  };
}

/**
 * The address the QR code and URL use (SD14): the one chosen before while it is still bound,
 * else the first.
 */
export function addressStore(storage: StorageLike = browserStorage()) {
  return {
    pick<A extends { address: string }>(addresses: readonly A[]): A | null {
      const chosen = read(storage, ADDRESS_KEY);
      return addresses.find((a) => a.address === chosen) ?? addresses[0] ?? null;
    },
    save: (address: string) => write(storage, ADDRESS_KEY, address),
  };
}

/** The controller's mode: the one chosen on this device, else by the viewport (SD9, AC42). */
export function modeStore(storage: StorageLike = browserStorage()) {
  return {
    initial(width: number): Mode {
      const stored = read(storage, MODE_KEY);
      if (stored === "dj" || stored === "vj") return stored;
      return width < DJ_BELOW_PX ? "dj" : "vj";
    },
    save: (mode: Mode) => write(storage, MODE_KEY, mode),
  };
}
