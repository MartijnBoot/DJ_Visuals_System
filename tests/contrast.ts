// The WCAG 2.x contrast ratio of two colours (B-19 spec SD11; plan T4): `(L1 + 0.05) / (L2 + 0.05)`
// of their relative luminances. A colour is `#rrggbb` (the brief's tokens) or `rgb()`/`rgba()`
// (a computed style); an alpha below 1 is refused rather than guessed.

export function parseColour(colour: string): [number, number, number] {
  const text = colour.trim().toLowerCase();
  const hex = /^#([0-9a-f]{6})$/.exec(text);
  if (hex) {
    const n = Number.parseInt(hex[1]!, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+))?\s*\)$/.exec(text);
  if (rgb) {
    if (rgb[4] !== undefined && Number(rgb[4]) < 1) {
      throw new Error(`a translucent colour has no contrast of its own: ${colour}`);
    }
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  }
  throw new Error(`not a colour this check reads: ${colour}`);
}

export function luminance(colour: string): number {
  const [r, g, b] = parseColour(colour).map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
