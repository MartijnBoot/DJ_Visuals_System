// What External control remembers in browser storage (B-04 spec, Data): on the screen machine, the
// address chosen for the QR code (`djv.controlAddress`); on a controller's LAN origin, the session
// key (`djv.controlKey`, useless once the pairing ends). Plain strings;
// anything unreadable reads as nothing remembered, and nothing here ever throws: storage may be
// full or disabled, and the link goes on without it.

export const KEY_KEY = "djv.controlKey";
export const ADDRESS_KEY = "djv.controlAddress";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

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

/** The session key store the controller's link uses. */
export function keyStore(storage: StorageLike = localStorage) {
  return {
    load: () => read(storage, KEY_KEY),
    save: (key: string) => write(storage, KEY_KEY, key),
    clear: () => write(storage, KEY_KEY, null),
  };
}

/**
 * The address the QR code and URL use (SD14): the one chosen before while it is still bound,
 * else the first.
 */
export function addressStore(storage: StorageLike = localStorage) {
  return {
    pick<A extends { address: string }>(addresses: readonly A[]): A | null {
      const chosen = read(storage, ADDRESS_KEY);
      return addresses.find((a) => a.address === chosen) ?? addresses[0] ?? null;
    },
    save: (address: string) => write(storage, ADDRESS_KEY, address),
  };
}
