import { describe, it, expect } from "vitest";
import { clamp, median, quantile, weightedMean } from "@/lib/utils/math";

describe("clamp", () => {
  // The Tracker's progress bar width is `clamp(progress, 0, 100)%`. Its only observable there is a
  // style attribute, which jsdom cannot honestly verify — so the bounds are pinned here instead,
  // per the component-test convention's own escape hatch.
  it("returns the value untouched when it is already inside the bounds", () => {
    expect(clamp(42, 0, 100)).toBe(42);
  });

  it("raises a value below the minimum to the minimum", () => {
    expect(clamp(-13, 0, 100)).toBe(0);
  });

  it("lowers a value above the maximum to the maximum", () => {
    expect(clamp(180, 0, 100)).toBe(100);
  });

  it("is inclusive at both bounds", () => {
    expect(clamp(0, 0, 100)).toBe(0);
    expect(clamp(100, 0, 100)).toBe(100);
  });
});

describe("median", () => {
  it("returns the middle value for an odd-length list", () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it("averages the two middle values for an even-length list", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("returns 0 for an empty list rather than NaN", () => {
    expect(median([])).toBe(0);
  });

  it("does not mutate its input", () => {
    const xs = [3, 1, 2];
    median(xs);
    expect(xs).toEqual([3, 1, 2]);
  });
});

describe("quantile", () => {
  it("returns the value at the requested quantile", () => {
    expect(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.1)).toBe(2);
  });

  it("returns 0 for an empty list rather than NaN", () => {
    expect(quantile([], 0.5)).toBe(0);
  });
});

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
