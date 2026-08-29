import { describe, expect, it } from "vitest";
import { DEPTH_OPACITY, opacityForDepth } from "@/components/ui/depth-opacity";

describe("opacityForDepth", () => {
  // Literal depths, not `FULL_OPACITY_DEPTH` — the spec fixes "the newest three at full opacity",
  // so 3 is a real specified number these tests are entitled to name. Asserting against the constant
  // instead would make `DEPTH_OPACITY` derived from it (as it now is) a comparison of the constant
  // against itself: it would pass for any value of `FULL_OPACITY_DEPTH`, pinning nothing.
  it("is full opacity for depths 0, 1 and 2 — the newest three, per spec", () => {
    expect(opacityForDepth(0)).toBe(1);
    expect(opacityForDepth(1)).toBe(1);
    expect(opacityForDepth(2)).toBe(1);
  });

  it("drops to 0.5 at depth 3, the fourth-newest entry — the off-by-one this pins", () => {
    expect(opacityForDepth(3)).toBe(0.5);
  });

  it("is 0.28 for anything older than the second tier (depth 4 and beyond)", () => {
    expect(opacityForDepth(4)).toBe(0.28);
    expect(opacityForDepth(10)).toBe(0.28);
  });

  it("clamps a negative depth-from-top to the newest tier rather than indexing out of bounds", () => {
    expect(opacityForDepth(-1)).toBe(1);
  });

  it("DEPTH_OPACITY itself carries the same literal values opacityForDepth is pinned against", () => {
    // A guard against the derivation producing the wrong shape (wrong length, wrong tier values)
    // even where every `opacityForDepth` case above happens to still resolve correctly.
    expect(DEPTH_OPACITY).toEqual([1, 1, 1, 0.5, 0.28]);
  });
});
