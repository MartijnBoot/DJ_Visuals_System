import { describe, expect, it } from "vitest";
import type { PageMode } from "./health.ts";
import { warmUpPeers } from "./peer-warm-up.ts";

const LOCAL: PageMode = { mode: "local", cloud: false, signIn: null };
const HOSTED: PageMode = {
  mode: "hosted",
  cloud: false,
  signIn: { issuer: "https://issuer.example", clientId: "c" },
};

function recorder(fail = false) {
  const made: RTCConfiguration[] = [];
  let closed = 0;
  const create = (config: RTCConfiguration) => {
    if (fail) throw new Error("no WebRTC");
    made.push(config);
    return { close: () => void closed++ };
  };
  return { made, closed: () => closed, create };
}

describe("warmUpPeers (D-22)", () => {
  it("makes one peer connection with no ICE server on the local screen, and closes it", () => {
    const r = recorder();
    warmUpPeers("/", LOCAL, r.create);
    expect(r.made).toEqual([{ iceServers: [] }]);
    expect(r.closed()).toBe(1);
  });

  it("makes one on any path the screen is served on, with the cloud row too", () => {
    const r = recorder();
    warmUpPeers("/anything", { ...LOCAL, cloud: true }, r.create);
    expect(r.made).toHaveLength(1);
  });

  it("makes none for hosted use, which has no remote input and no preview (B-12 SD1)", () => {
    for (const path of ["/", "/builder"]) {
      const r = recorder();
      warmUpPeers(path, HOSTED, r.create);
      expect(r.made).toEqual([]);
    }
  });

  it("makes none on the builder, which makes no peer connection", () => {
    const r = recorder();
    warmUpPeers("/builder", LOCAL, r.create);
    expect(r.made).toEqual([]);
  });

  it("a browser without WebRTC is not an error: the page renders as before", () => {
    const r = recorder(true);
    expect(() => warmUpPeers("/", LOCAL, r.create)).not.toThrow();
  });
});
