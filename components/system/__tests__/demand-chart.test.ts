import { describe, it, expect } from "vitest";
import { demandBars } from "../demand-chart";
import type { PopulationDemandEntry } from "@/lib/types/api";

const entry = (goodId: string, demandRate: number, base: number, technicians: number, engineers: number): PopulationDemandEntry => ({
  goodId,
  goodName: goodId,
  demandRate,
  breakdown: { base, technicians, engineers },
});

describe("demandBars", () => {
  it("splits a good into base/technician/engineer segments summing to its total", () => {
    const [bar] = demandBars([entry("food", 10, 6, 3, 1)]);
    expect(bar.segments.map((s) => s.key)).toEqual(["base", "technicians", "engineers"]);
    expect(bar.segments.map((s) => s.value)).toEqual([6, 3, 1]);
    expect(bar.segments.reduce((sum, s) => sum + s.fraction, 0)).toBeCloseTo(1);
  });

  it("adds a floor tail when the tiers sum below the floored demand rate", () => {
    // consumption 0.6 but floored up to a 1.0 tradeable minimum → 0.4 market-minimum tail.
    const [bar] = demandBars([entry("luxuries", 1.0, 0.4, 0.15, 0.05)]);
    const floor = bar.segments.find((s) => s.key === "floor");
    expect(floor?.value).toBeCloseTo(0.4);
    expect(bar.segments.reduce((sum, s) => sum + s.value, 0)).toBeCloseTo(1.0);
  });

  it("omits zero-value segments", () => {
    const [bar] = demandBars([entry("water", 5, 5, 0, 0)]);
    expect(bar.segments.map((s) => s.key)).toEqual(["base"]);
  });

  it("scales bars to the largest good so the biggest reads full-width", () => {
    const bars = demandBars([entry("food", 10, 10, 0, 0), entry("fuel", 4, 4, 0, 0)]);
    expect(bars[0].scale).toBe(1);
    expect(bars[1].scale).toBeCloseTo(0.4);
  });

  it("handles an all-zero-demand good without dividing by zero", () => {
    const [bar] = demandBars([entry("scrap", 0, 0, 0, 0)]);
    expect(bar.segments).toEqual([]);
    expect(bar.scale).toBe(0);
  });
});
