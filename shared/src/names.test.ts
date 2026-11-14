import { describe, expect, it } from "vitest";
import { nextFreeName } from "./names.ts";

describe("nextFreeName (plan PD12, AD5)", () => {
  it("keeps a free name as it is", () => {
    expect(nextFreeName("Warm", ["Cool"])).toBe("Warm");
  });

  it("gives the first free 'Name (n)', counting from 2", () => {
    expect(nextFreeName("Warm", ["Warm"])).toBe("Warm (2)");
    expect(nextFreeName("Warm", ["Warm", "Warm (2)"])).toBe("Warm (3)");
    expect(nextFreeName("Warm", ["Warm", "Warm (3)"])).toBe("Warm (2)");
  });

  it("compares case-insensitively and after trimming", () => {
    expect(nextFreeName("warm", ["WARM"])).toBe("warm (2)");
    expect(nextFreeName("  Warm ", ["warm", "WARM (2)"])).toBe("Warm (3)");
  });

  it("trims the base so the result stays within 60 characters", () => {
    const long = "x".repeat(60);
    const second = nextFreeName(long, [long]);
    expect(second).toBe(`${"x".repeat(56)} (2)`);
    expect(second.length).toBe(60);
    const twoToNine = Array.from({ length: 8 }, (_, i) => `${"x".repeat(56)} (${i + 2})`);
    const tenth = nextFreeName(long, [long, ...twoToNine]);
    expect(tenth).toBe(`${"x".repeat(55)} (10)`);
    expect(tenth.length).toBe(60);
  });

  it("does not leave a space before the suffix when the cut lands on one", () => {
    const spaced = `${"x".repeat(55)} yyyy`; // 60 characters, a space at 55
    expect(nextFreeName(spaced, [spaced])).toBe(`${"x".repeat(55)} (2)`);
  });
});
