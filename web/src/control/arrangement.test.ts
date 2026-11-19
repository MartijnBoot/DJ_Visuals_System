// B-19 T5 (spec SD5, AC12, AC14; plan PD3): the viewport decides the arrangement. Horizontal only
// while narrower than 600 CSS px and taller than wide; every other viewport is vertical.
import { describe, expect, it } from "vitest";
import { arrangementFor } from "./arrangement.ts";

describe("arrangementFor (PD3)", () => {
  it.each([
    [320, 568, "horizontal"],
    [390, 844, "horizontal"],
    [599, 600, "horizontal"],
    [600, 601, "vertical"],
    [320, 320, "vertical"],
    [568, 320, "vertical"],
    [768, 1024, "vertical"],
    [1024, 768, "vertical"],
  ] as const)("%i×%i is %s", (width, height, expected) => {
    expect(arrangementFor(width, height)).toBe(expected);
  });
});
