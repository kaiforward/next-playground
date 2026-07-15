import { describe, it, expect } from "vitest";
import { weightedMean } from "@/lib/utils/math";

describe("weightedMean", () => {
  it("weights each value by its weight", () => {
    // (0.9·100 + 0.5·10) / (100 + 10) = 95 / 110
    expect(weightedMean([0.9, 0.5], [100, 10])).toBeCloseTo(95 / 110, 10);
  });

  it("lets a high-weight member dominate a low-weight outlier (the whole point)", () => {
    // A stable 1000-pop capital shouldn't be dragged to the plain mean (0.55) by a
    // tiny 5-pop unstable outpost — the weighted result sits right next to the capital.
    const wm = weightedMean([0.9, 0.2], [1000, 5]);
    expect(wm).toBeGreaterThan(0.89);
  });

  it("returns 0 for empty input (no divide-by-zero)", () => {
    expect(weightedMean([], [])).toBe(0);
  });

  it("falls back to a plain arithmetic mean when the total weight is 0", () => {
    expect(weightedMean([0.4, 0.6], [0, 0])).toBeCloseTo(0.5, 10);
  });
});
