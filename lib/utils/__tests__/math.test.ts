import { describe, it, expect } from "vitest";
import {
  clamp,
  median,
  barWidthPct,
  projectedWidthPct,
  quantile,
  weightedMean,
  ticksToHours,
} from "@/lib/utils/math";
import { HOURS_PER_TICK, CYCLE_LENGTH } from "@/lib/constants/tick-cadence";

describe("clamp", () => {
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

describe("barWidthPct", () => {
  // TrackerRow's progress track renders `${barWidthPct(progress)}%` as a style attribute,
  // which jsdom cannot honestly verify (no layout engine) — so the width maths is pinned here
  // instead, per the component-test convention's own escape hatch.

  it("maps a mid-range fraction to its percentage — the exact bug this fixes: reading a fraction as a percentage rendered 0.55%, not 55%", () => {
    expect(barWidthPct(0.55)).toBeCloseTo(55, 10);
  });

  it("maps the bounds: 0 to 0, 1 to 100", () => {
    expect(barWidthPct(0)).toBe(0);
    expect(barWidthPct(1)).toBe(100);
  });

  it("clamps out-of-range input at both ends rather than drawing a fill past 100% or below 0", () => {
    expect(barWidthPct(1.5)).toBe(100);
    expect(barWidthPct(-0.3)).toBe(0);
  });
});

describe("projectedWidthPct", () => {
  // The forecast segment ProgressBar and TrackerRow both draw after the fill. Same reason as
  // above: its only observable in a component test is a style attribute, so the maths lives here.

  it("converts the forecast fraction to a percentage when there is room for all of it", () => {
    expect(projectedWidthPct(0.2, 0.15)).toBeCloseTo(15, 10);
  });

  it("clamps to the room the fill leaves — a project 10% from done forecast a full 30% cycle draws 10, finishing the bar rather than overflowing it", () => {
    expect(projectedWidthPct(0.9, 0.3)).toBeCloseTo(10, 10);
    expect(projectedWidthPct(0.9, 0.3) + barWidthPct(0.9)).toBeCloseTo(100, 10);
  });

  it("draws nothing on a completed bar, and nothing for a project absorbing nothing this cycle", () => {
    expect(projectedWidthPct(1, 0.3)).toBe(0);
    expect(projectedWidthPct(0.4, 0)).toBe(0);
  });

  it("never draws a negative segment from a bad upstream value", () => {
    expect(projectedWidthPct(0.4, -0.2)).toBe(0);
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

describe("ticksToHours", () => {
  it("scales linearly by HOURS_PER_TICK", () => {
    expect(ticksToHours(1)).toBe(HOURS_PER_TICK);
    expect(ticksToHours(10)).toBeCloseTo(10 * HOURS_PER_TICK, 10);
    expect(ticksToHours(0)).toBe(0);
  });

  it("agrees with the spec's derived language: 4 ticks/day", () => {
    expect(ticksToHours(1) * 4).toBe(24); // 4 ticks cover one 24-hour day
  });

  it("agrees with the spec's derived language: a cycle = CYCLE_LENGTH ticks = 144 h = 6 days", () => {
    const cycleHours = ticksToHours(CYCLE_LENGTH);
    expect(cycleHours).toBe(144);
    expect(cycleHours / 24).toBe(6);
  });

  it("agrees with the spec's derived language: 1 year ≈ 1,461 ticks", () => {
    const ticksPerYear = (365.25 * 24) / HOURS_PER_TICK;
    expect(Math.round(ticksPerYear)).toBe(1461);
    expect(ticksToHours(ticksPerYear)).toBeCloseTo(365.25 * 24, 6);
  });
});
