// The device hint (B-04 spec SD26; plan PD15): "<browser> on <OS>" from the upgrade's
// User-Agent, a small hand-written mapping, else "Unknown device". Only the fixed names below
// ever leave this function, never the User-Agent's own text. Shown in the panel and on
// controllers beside the sequence label; never logged (SD27).

/** Most specific first: Samsung Internet and Edge also say Chrome; Chrome also says Safari. */
const BROWSERS: readonly [RegExp, string][] = [
  [/SamsungBrowser\//, "Samsung Internet"],
  [/\bEdg(e|A|iOS)?\//, "Edge"],
  [/\b(Firefox|FxiOS)\//, "Firefox"],
  [/\b(Chrome|CriOS)\//, "Chrome"],
  [/\bVersion\/[\d.]+.*\bSafari\//, "Safari"],
];

/** Android also says Linux; iPhone and iPad also say Mac OS X. */
const SYSTEMS: readonly [RegExp, string][] = [
  [/\biPhone\b/, "iPhone"],
  [/\biPad\b/, "iPad"],
  [/\bAndroid\b/, "Android"],
  [/\bWindows\b/, "Windows"],
  [/\b(Macintosh|Mac OS X)\b/, "macOS"],
  [/\bLinux\b/, "Linux"],
];

export const UNKNOWN_DEVICE = "Unknown device";

const first = (list: readonly [RegExp, string][], text: string) =>
  list.find(([pattern]) => pattern.test(text))?.[1];

export function hint(userAgent: string | undefined): string {
  if (!userAgent) return UNKNOWN_DEVICE;
  const browser = first(BROWSERS, userAgent);
  const system = first(SYSTEMS, userAgent);
  return browser && system ? `${browser} on ${system}` : UNKNOWN_DEVICE;
}
