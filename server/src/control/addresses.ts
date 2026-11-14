// Which addresses the External control listener binds (B-04 spec SD14, SD29; plan PD10): each
// non-internal IPv4 address of the machine in 10.0.0.0/8, 172.16.0.0/12 or 192.168.0.0/16, with
// its adapter name, in the order the system lists them. Never 0.0.0.0, a public address or IPv6.
// A pure function of the interface list, so it is tested against a faked one; `boot` takes the
// list as a seam so the gate binds 127.0.0.1 instead (SD29).
import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";

export interface ControlAddress {
  address: string;
  /** The adapter's name, shown in the panel's address picker. */
  name: string;
}

function isPrivate(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return false;
  }
  const [a, b] = parts as [number, number, number, number];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

export function privateAddresses(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>,
): ControlAddress[] {
  const found: ControlAddress[] = [];
  for (const [name, infos] of Object.entries(interfaces)) {
    for (const info of infos ?? []) {
      // Some Node versions reported the family as the number 4.
      const ipv4 = info.family === "IPv4" || (info.family as unknown) === 4;
      if (ipv4 && !info.internal && isPrivate(info.address)) {
        found.push({ address: info.address, name });
      }
    }
  }
  return found;
}

/** What `boot` binds when no seam is passed: the machine's own private addresses. */
export function defaultControlAddresses(): ControlAddress[] {
  return privateAddresses(networkInterfaces());
}
