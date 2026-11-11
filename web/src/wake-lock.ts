// The screen wake lock (spec SD13, AC16; plan PD16): held while capture runs, re-acquired when
// the page becomes visible again (the browser drops it on hide). A missing API or a refused
// request reads `unavailable` in the overlay; nothing ever shows on the output.

export type WakeLockState = "held" | "unavailable" | "off";

export interface WakeLockHolder {
  hold(): Promise<void>;
  release(): Promise<void>;
  state(): WakeLockState;
}

export function createWakeLock(
  nav: Pick<Navigator, "wakeLock"> | Partial<Pick<Navigator, "wakeLock">>,
  doc: Pick<Document, "visibilityState" | "addEventListener">,
): WakeLockHolder {
  let wanted = false;
  let sentinel: WakeLockSentinel | null = null;
  let current: WakeLockState = "off";

  const acquire = async () => {
    if (!nav.wakeLock) {
      current = "unavailable";
      return;
    }
    try {
      const next = await nav.wakeLock.request("screen");
      next.addEventListener("release", () => {
        if (sentinel === next) sentinel = null;
        if (current === "held") current = "off";
      });
      sentinel = next;
      current = "held";
    } catch {
      current = "unavailable";
    }
  };

  doc.addEventListener("visibilitychange", () => {
    if (wanted && !sentinel && doc.visibilityState === "visible") void acquire();
  });

  return {
    async hold() {
      wanted = true;
      if (!sentinel) await acquire();
    },
    async release() {
      wanted = false;
      const held = sentinel;
      sentinel = null;
      current = "off";
      await held?.release();
    },
    state: () => current,
  };
}
