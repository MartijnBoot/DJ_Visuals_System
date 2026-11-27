// B-07 T6 (SD6, AC15, AC16, AC17; plan PD6, PD7): how a feed is stored from the camera on screen
// and matched at Go, as pure functions over the cameras and senders the screen already lists.
import { describe, expect, it } from "vitest";
import { feedOf, matchFeed } from "./feed.ts";

const cameras = [
  { deviceId: "cam-a", label: "Logitech C920" },
  { deviceId: "cam-b", label: "Camera 2" }, // the browser gave no label: the page's fallback
  { deviceId: "cam-c", label: "Studio left" },
];
const senders = [
  { deviceId: "d1", hint: "Safari on iPhone" },
  { deviceId: "d2", hint: "Chrome on Android" },
];

describe("feedOf: what a scene stores (PD6)", () => {
  it("a local camera by its id and the label the browser gave", () => {
    expect(feedOf({ kind: "local", deviceId: "cam-a" }, cameras, senders)).toEqual({
      kind: "local",
      deviceId: "cam-a",
      label: "Logitech C920",
    });
  });

  it("never the 'Camera n' fallback: the label is empty then", () => {
    expect(feedOf({ kind: "local", deviceId: "cam-b" }, cameras, senders)).toEqual({
      kind: "local",
      deviceId: "cam-b",
      label: "",
    });
  });

  it("a local camera not listed yet keeps its id with no label", () => {
    expect(feedOf({ kind: "local", deviceId: "cam-z" }, cameras, senders)).toEqual({
      kind: "local",
      deviceId: "cam-z",
      label: "",
    });
  });

  it("a remote camera by its sender's hint; an unknown sender is no feed", () => {
    expect(feedOf({ kind: "remote", deviceId: "d2" }, cameras, senders)).toEqual({
      kind: "remote",
      hint: "Chrome on Android",
    });
    expect(feedOf({ kind: "remote", deviceId: "d9" }, cameras, senders)).toBeNull();
  });

  it("no camera on screen is no feed", () => {
    expect(feedOf(null, cameras, senders)).toBeNull();
  });
});

describe("matchFeed: what Go switches to (AC15, AC16)", () => {
  it("a local feed by its id first", () => {
    const feed = { kind: "local" as const, deviceId: "cam-c", label: "Logitech C920" };
    expect(matchFeed(feed, cameras, senders)).toBe("cam-c");
  });

  it("then by a label exactly one listed camera has", () => {
    const feed = { kind: "local" as const, deviceId: "gone", label: "Studio left" };
    expect(matchFeed(feed, cameras, senders)).toBe("cam-c");
  });

  it("two cameras of one model share a label: no match", () => {
    const twins = [...cameras, { deviceId: "cam-d", label: "Logitech C920" }];
    const feed = { kind: "local" as const, deviceId: "gone", label: "Logitech C920" };
    expect(matchFeed(feed, twins, senders)).toBeNull();
  });

  it("an empty label matches nothing, not a fallback-named camera", () => {
    const feed = { kind: "local" as const, deviceId: "gone", label: "" };
    expect(matchFeed(feed, cameras, senders)).toBeNull();
    const fallback = { kind: "local" as const, deviceId: "gone", label: "Camera 2" };
    expect(matchFeed(fallback, cameras, senders)).toBeNull();
  });

  it("a remote feed when exactly one connected video sender has the hint", () => {
    const feed = { kind: "remote" as const, hint: "Safari on iPhone" };
    expect(matchFeed(feed, cameras, senders)).toBe("remote:d1");
    expect(matchFeed(feed, cameras, [])).toBeNull();
    const two = [...senders, { deviceId: "d3", hint: "Safari on iPhone" }];
    expect(matchFeed(feed, cameras, two)).toBeNull();
  });
});
