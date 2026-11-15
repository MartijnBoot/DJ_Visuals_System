// T4 (B-04 spec SD26): the device hint, "<browser> on <OS>", from the User-Agent.
import { describe, expect, it } from "vitest";
import { hint } from "./hint.ts";

const UA = {
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1",
  ipadSafari:
    "Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  androidSamsung:
    "Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36",
  androidFirefox: "Mozilla/5.0 (Android 14; Mobile; rv:132.0) Gecko/132.0 Firefox/132.0",
  windowsEdge:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
  windowsChrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
  macFirefox: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.7; rv:132.0) Gecko/20100101 Firefox/132.0",
  linuxFirefox: "Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0",
  linuxChrome:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
};

describe("hint (SD26)", () => {
  it.each([
    ["iphoneSafari", "Safari on iPhone"],
    ["iphoneChrome", "Chrome on iPhone"],
    ["ipadSafari", "Safari on iPad"],
    ["androidChrome", "Chrome on Android"],
    ["androidSamsung", "Samsung Internet on Android"],
    ["androidFirefox", "Firefox on Android"],
    ["windowsEdge", "Edge on Windows"],
    ["windowsChrome", "Chrome on Windows"],
    ["macSafari", "Safari on macOS"],
    ["macFirefox", "Firefox on macOS"],
    ["linuxFirefox", "Firefox on Linux"],
    ["linuxChrome", "Chrome on Linux"],
  ] as const)("%s → %s", (key, expected) => {
    expect(hint(UA[key])).toBe(expected);
  });

  it("is Unknown device for a missing, empty or unrecognised User-Agent", () => {
    expect(hint(undefined)).toBe("Unknown device");
    expect(hint("")).toBe("Unknown device");
    expect(hint("curl/8.5.0")).toBe("Unknown device");
    expect(hint("Mozilla/5.0 (PlayStation 5) Chrome/100")).toBe("Unknown device");
    expect(hint("Mozilla/5.0 (Windows NT 10.0) Opera-ish")).toBe("Unknown device");
  });

  it("never returns any of the User-Agent's own text beyond the fixed names", () => {
    expect(hint("Mozilla/5.0 (Windows NT 10.0) Chrome/1 secret-123")).toBe("Chrome on Windows");
  });
});
