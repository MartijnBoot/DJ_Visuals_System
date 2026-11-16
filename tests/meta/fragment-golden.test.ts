// B-03 AC8 (plan T4, T5): a profile without a custom effect gets, byte for byte, the fragment
// shader it got before B-03. The hashes were recorded from `buildFragment` on `main` at
// `658aefd`, before `shader.ts` was touched; a change to the built-in text fails here first.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { BUILT_IN_PROFILE, EFFECTS, type EffectType } from "../../engine/src/profile.ts";
import { buildFragment } from "../../engine/src/shader.ts";

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

const ALL = Object.keys(EFFECTS) as EffectType[];
const BUILT_IN = BUILT_IN_PROFILE.effects.map((e) => e.type);

describe("built-in-only fragments are unchanged (B-03 AC8)", () => {
  it("the empty list", () => {
    expect(sha256(buildFragment([]))).toBe(
      "61e00896f9c630fabb283ae10cdaf66c3c80dcf13268346d5afa54e37c46b799",
    );
  });

  it("the built-in profile's list", () => {
    expect(sha256(buildFragment(BUILT_IN))).toBe(
      "389d99a5041c11d4b058c88da5bcb3d8a89e424ec1dc93c66a95deffbd4b6146",
    );
  });

  it("all twelve effects in library order", () => {
    expect(sha256(buildFragment(ALL))).toBe(
      "e48585b164df691f94bd792e598bf7beec608d88cf9f71b573dce7bba8fdb3f4",
    );
  });

  it("holds no carriage return, so the hash is the same on every platform", () => {
    expect(buildFragment(ALL)).not.toContain("\r");
  });
});
