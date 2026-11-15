// T10 (B-04 spec SD3): the pairing QR code as one SVG path, from the package, for exactly the
// text given.
import qrcode from "qrcode-generator";
import { describe, expect, it, vi } from "vitest";
import { qrPath } from "./qr.ts";

const URL_TEXT = "http://192.168.1.5:8001/control#code=ABC234";

describe("qrPath (SD3)", () => {
  it("is a non-empty square of modules, one unit square per dark module", () => {
    const { size, path } = qrPath(URL_TEXT);
    expect(size).toBeGreaterThanOrEqual(21);
    expect((size - 17) % 4).toBe(0); // QR versions are 21, 25, 29, … modules square
    const squares = path.match(/M\d+ \d+h1v1h-1z/g) ?? [];
    expect(squares.length).toBeGreaterThan(0);
    expect(squares.join("")).toBe(path);
    for (const square of squares) {
      const [, x, y] = /M(\d+) (\d+)/.exec(square)!;
      expect(Number(x)).toBeLessThan(size);
      expect(Number(y)).toBeLessThan(size);
    }
  });

  it("draws the package's modules for the text", () => {
    const code = qrcode(0, "M");
    code.addData(URL_TEXT);
    code.make();
    const dark: string[] = [];
    for (let row = 0; row < code.getModuleCount(); row++) {
      for (let col = 0; col < code.getModuleCount(); col++) {
        if (code.isDark(row, col)) dark.push(`M${col} ${row}h1v1h-1z`);
      }
    }
    expect(qrPath(URL_TEXT).path).toBe(dark.join(""));
  });

  it("hands the package exactly the text it was given", () => {
    const addData = vi.fn();
    const fake = vi.fn(() => ({
      addData,
      make: () => {},
      getModuleCount: () => 21,
      isDark: () => false,
    }));
    qrPath(URL_TEXT, fake as unknown as typeof qrcode);
    expect(addData).toHaveBeenCalledTimes(1);
    expect(addData).toHaveBeenCalledWith(URL_TEXT);
  });
});
