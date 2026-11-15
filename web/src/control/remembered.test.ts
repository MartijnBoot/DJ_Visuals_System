// B-04 (spec, Data): what External control keeps in browser storage.
import { describe, expect, it } from "vitest";
import { ADDRESS_KEY, addressStore, KEY_KEY, keyStore } from "./remembered.ts";

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
