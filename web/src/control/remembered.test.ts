// B-04 (spec, Data): what External control keeps in browser storage.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ADDRESS_KEY, addressStore, KEY_KEY, keyStore, MODE_KEY, modeStore } from "./remembered.ts";

function memory() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

const broken = {
  getItem: () => {
    throw new Error("disabled");
  },
  setItem: () => {
    throw new Error("full");
  },
  removeItem: () => {
    throw new Error("disabled");
  },
};

describe("browser storage itself unavailable", () => {
  // Blocked site data: reading `localStorage` throws a SecurityError before any method is called.
  const real = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    });
  });
  afterEach(() => {
    if (real) Object.defineProperty(globalThis, "localStorage", real);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it("makes every store without throwing, and they remember nothing", () => {
    const keys = keyStore();
    expect(keys.load()).toBeNull();
    expect(() => keys.save("AAAAAAAAAAAAAAAAAAAAAA")).not.toThrow();
    expect(modeStore().initial(390)).toBe("dj");
    expect(addressStore().pick([{ address: "192.168.1.5" }])).toEqual({ address: "192.168.1.5" });
  });
});

describe("the session key (djv.controlKey)", () => {
  it("saves, loads and clears under its key", () => {
    const storage = memory();
    const keys = keyStore(storage);
    expect(keys.load()).toBeNull();
    keys.save("AAAAAAAAAAAAAAAAAAAAAA");
    expect(storage.map.get(KEY_KEY)).toBe("AAAAAAAAAAAAAAAAAAAAAA");
    expect(keys.load()).toBe("AAAAAAAAAAAAAAAAAAAAAA");
    keys.clear();
    expect(keys.load()).toBeNull();
  });

  it("never throws when storage is unavailable", () => {
    const keys = keyStore(broken);
    expect(keys.load()).toBeNull();
    expect(() => keys.save("x")).not.toThrow();
    expect(() => keys.clear()).not.toThrow();
  });
});

describe("the QR address (djv.controlAddress, SD14)", () => {
  const addresses = [
    { address: "192.168.1.5", name: "Wi-Fi" },
    { address: "10.0.0.2", name: "Ethernet" },
  ];

  it("preselects the first address, then the one chosen while it is listed", () => {
    const storage = memory();
    const store = addressStore(storage);
    expect(store.pick(addresses)).toEqual(addresses[0]);
    store.save("10.0.0.2");
    expect(storage.map.get(ADDRESS_KEY)).toBe("10.0.0.2");
    expect(store.pick(addresses)).toEqual(addresses[1]);
  });

  it("falls back to the first when the stored one is no longer listed", () => {
    const storage = memory();
    const store = addressStore(storage);
    store.save("172.16.0.9");
    expect(store.pick(addresses)).toEqual(addresses[0]);
  });

  it("has nothing to pick from an empty list, and never throws", () => {
    expect(addressStore(memory()).pick([])).toBeNull();
    const store = addressStore(broken);
    expect(store.pick(addresses)).toEqual(addresses[0]);
    expect(() => store.save("10.0.0.2")).not.toThrow();
  });
});

describe("the controller's mode (djv.controlMode, SD9, AC42)", () => {
  it("starts in DJ mode below 600 CSS px and VJ from 600, then keeps the choice", () => {
    expect(modeStore(memory()).initial(599)).toBe("dj");
    expect(modeStore(memory()).initial(600)).toBe("vj");
    const storage = memory();
    const store = modeStore(storage);
    store.save("vj");
    expect(storage.map.get(MODE_KEY)).toBe("vj");
    expect(store.initial(320)).toBe("vj");
    store.save("dj");
    expect(store.initial(1024)).toBe("dj");
  });

  it("ignores anything else stored, and never throws", () => {
    const storage = memory();
    storage.map.set(MODE_KEY, "admin");
    expect(modeStore(storage).initial(1024)).toBe("vj");
    expect(modeStore(broken).initial(390)).toBe("dj");
    expect(() => modeStore(broken).save("vj")).not.toThrow();
  });
});
