// T8 (spec SD13, AC16; plan PD16): the screen wake lock, against a fake navigator and document.
import { describe, expect, it, vi } from "vitest";
import { createWakeLock } from "./wake-lock.ts";

class FakeSentinel extends EventTarget {
  released = false;
  async release() {
    this.released = true;
    this.dispatchEvent(new Event("release"));
  }
}

function fakeDocument() {
  const target = new EventTarget();
  const doc = Object.assign(target, { visibilityState: "visible" as DocumentVisibilityState });
  const show = (state: DocumentVisibilityState) => {
    doc.visibilityState = state;
    doc.dispatchEvent(new Event("visibilitychange"));
  };
  return { doc, show };
}

function fakeNavigator(outcome: "grant" | "reject" = "grant") {
  const sentinels: FakeSentinel[] = [];
  const request = vi.fn(async (_type: "screen") => {
    if (outcome === "reject")
      throw Object.assign(new Error("NotAllowedError"), { name: "NotAllowedError" });
    const s = new FakeSentinel();
    sentinels.push(s);
    return s;
  });
  return { nav: { wakeLock: { request } } as unknown as Navigator, request, sentinels };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("wake lock (AC16)", () => {
  it("is off until held, then held", async () => {
    const { nav, request } = fakeNavigator();
    const lock = createWakeLock(nav, fakeDocument().doc);
    expect(lock.state()).toBe("off");
    await lock.hold();
    expect(request).toHaveBeenCalledWith("screen");
    expect(lock.state()).toBe("held");
  });

  it("re-acquires when the page becomes visible again", async () => {
    const { nav, request, sentinels } = fakeNavigator();
    const { doc, show } = fakeDocument();
    const lock = createWakeLock(nav, doc);
    await lock.hold();
    show("hidden");
    await sentinels[0]!.release(); // the browser drops the lock on hide
    expect(lock.state()).toBe("off");
    show("visible");
    await flush();
    expect(request).toHaveBeenCalledTimes(2);
    expect(lock.state()).toBe("held");
  });

  it("does not re-acquire after release", async () => {
    const { nav, request } = fakeNavigator();
    const { doc, show } = fakeDocument();
    const lock = createWakeLock(nav, doc);
    await lock.hold();
    await lock.release();
    expect(lock.state()).toBe("off");
    show("visible");
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("is unavailable without the API", async () => {
    const lock = createWakeLock({} as Navigator, fakeDocument().doc);
    await lock.hold();
    expect(lock.state()).toBe("unavailable");
  });

  it("is unavailable when the request is refused, and never throws", async () => {
    const { nav } = fakeNavigator("reject");
    const lock = createWakeLock(nav, fakeDocument().doc);
    await expect(lock.hold()).resolves.toBeUndefined();
    expect(lock.state()).toBe("unavailable");
  });
});
