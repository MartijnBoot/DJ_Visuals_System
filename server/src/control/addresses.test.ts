// T4 (B-04 spec SD14, SD29): which addresses the External control listener may bind. The gate
// never binds a real LAN address: `node:os` is mocked here, and every other test passes the seam.
import type { NetworkInterfaceInfo } from "node:os";
import { describe, expect, it, vi } from "vitest";

const v4 = (address: string, internal = false): NetworkInterfaceInfo => ({
  address,
  netmask: "255.255.255.0",
  family: "IPv4",
  mac: "00:00:00:00:00:00",
  internal,
  cidr: `${address}/24`,
});
const v6 = (address: string): NetworkInterfaceInfo => ({
  address,
  netmask: "ffff:ffff:ffff:ffff::",
  family: "IPv6",
  mac: "00:00:00:00:00:00",
  internal: false,
  cidr: `${address}/64`,
  scopeid: 0,
});

const fake: NodeJS.Dict<NetworkInterfaceInfo[]> = {
  Loopback: [v4("127.0.0.1", true)],
  "Wi-Fi": [v4("192.168.1.5"), v6("fe80::1")],
  Ethernet: [v4("172.16.0.1"), v4("172.15.255.1"), v4("172.32.0.1")],
  Tailscale: [v4("100.64.0.7")],
  "Link-local": [v4("169.254.10.10")],
  Public: [v4("8.8.8.8"), v4("11.0.0.1")],
  VPN: [v4("10.8.0.2")],
  Edge: [v4("172.31.255.254"), v4("192.169.0.1"), v4("10.0.0.1", true)],
  Empty: undefined,
};

vi.mock("node:os", async (original) => ({
  ...(await original<typeof import("node:os")>()),
  networkInterfaces: () => fake,
}));

const { defaultControlAddresses, privateAddresses } = await import("./addresses.ts");

const expected = [
  { address: "192.168.1.5", name: "Wi-Fi" },
  { address: "172.16.0.1", name: "Ethernet" },
  { address: "10.8.0.2", name: "VPN" },
  { address: "172.31.255.254", name: "Edge" },
];

describe("privateAddresses (SD14)", () => {
  it("keeps non-internal IPv4 in 10/8, 172.16/12 and 192.168/16, with the adapter name, in order", () => {
    expect(privateAddresses(fake)).toEqual(expected);
  });

  it("excludes 172.15.x, 172.32.x, 169.254.x, 100.64.x, public, internal and IPv6", () => {
    const kept = privateAddresses(fake).map((a) => a.address);
    for (const address of [
      "172.15.255.1",
      "172.32.0.1",
      "169.254.10.10",
      "100.64.0.7",
      "8.8.8.8",
      "11.0.0.1",
      "192.169.0.1",
      "127.0.0.1",
      "10.0.0.1",
      "fe80::1",
    ]) {
      expect(kept).not.toContain(address);
    }
  });

  it("is empty without interfaces", () => {
    expect(privateAddresses({})).toEqual([]);
  });

  it("accepts the numeric family some Node versions report", () => {
    const numeric = { eth0: [{ ...v4("10.1.2.3"), family: 4 as unknown as "IPv4" }] };
    expect(privateAddresses(numeric)).toEqual([{ address: "10.1.2.3", name: "eth0" }]);
  });
});

describe("defaultControlAddresses (PD10)", () => {
  it("is privateAddresses of the machine's interfaces, exactly the private ones", () => {
    expect(defaultControlAddresses()).toEqual(expected);
  });
});
