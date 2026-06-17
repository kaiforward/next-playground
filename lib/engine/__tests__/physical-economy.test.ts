import { describe, it, expect } from "vitest";
import { labourFactor, physicalRates } from "../physical-economy";
import { makeResourceVector } from "../resources";
import { LABOUR_HALF_POP, GOOD_CONSUMPTION } from "@/lib/constants/physical-economy";

const AGG = makeResourceVector({ water: 10, ore: 5, arable: 8 });

describe("labourFactor", () => {
  it("is 0 at or below zero population", () => {
    expect(labourFactor(0)).toBe(0);
    expect(labourFactor(-100)).toBe(0);
  });

  it("is 0.5 at the half-saturation population", () => {
    expect(labourFactor(LABOUR_HALF_POP)).toBeCloseTo(0.5, 10);
  });

  it("rises monotonically and saturates below 1", () => {
    expect(labourFactor(100)).toBeLessThan(labourFactor(1000));
    expect(labourFactor(1_000_000)).toBeLessThan(1);
    expect(labourFactor(1_000_000)).toBeGreaterThan(0.99);
  });
});

describe("physicalRates — production", () => {
  it("scales a resource-driven good with its resource aggregate", () => {
    const lo = physicalRates("water", makeResourceVector({ water: 5 }), 1000);
    const hi = physicalRates("water", makeResourceVector({ water: 10 }), 1000);
    expect(hi.production).toBeCloseTo(lo.production * 2, 10); // linear in aggregate
    expect(lo.production).toBeGreaterThan(0);
  });

  it("ignores the aggregate for a labour-only good", () => {
    const a = physicalRates("luxuries", makeResourceVector({ ore: 0 }), 1000);
    const b = physicalRates("luxuries", makeResourceVector({ ore: 99 }), 1000);
    expect(a.production).toBeCloseTo(b.production, 10);
    expect(a.production).toBeGreaterThan(0);
  });

  it("scales production with labour (population)", () => {
    const low = physicalRates("luxuries", AGG, 100);
    const high = physicalRates("luxuries", AGG, 2000);
    expect(high.production).toBeGreaterThan(low.production);
  });

  it("yields zero production for an unknown good", () => {
    expect(physicalRates("not_a_good", AGG, 1000).production).toBe(0);
  });
});

describe("physicalRates — consumption", () => {
  it("scales linearly with population", () => {
    const single = physicalRates("food", AGG, 100).consumption;
    const triple = physicalRates("food", AGG, 300).consumption;
    expect(triple).toBeCloseTo(single * 3, 10);
    expect(single).toBeCloseTo(GOOD_CONSUMPTION.food * 100, 10);
  });

  it("is zero at zero population for every term", () => {
    const r = physicalRates("food", AGG, 0);
    expect(r.production).toBe(0);
    expect(r.consumption).toBe(0);
  });

  it("yields zero consumption for an unknown good", () => {
    expect(physicalRates("not_a_good", AGG, 1000).consumption).toBe(0);
  });
});

import { substrateGoodRates } from "../physical-economy";
import { GOOD_NAMES } from "@/lib/constants/goods";

describe("substrateGoodRates", () => {
  it("returns one entry per good in GOOD_NAMES order", () => {
    const rows = substrateGoodRates(AGG, 1000);
    expect(rows.map((r) => r.goodId)).toEqual(GOOD_NAMES);
  });

  it("matches physicalRates for each good", () => {
    const rows = substrateGoodRates(AGG, 1000);
    for (const row of rows) {
      const direct = physicalRates(row.goodId, AGG, 1000);
      expect(row.production).toBeCloseTo(direct.production, 10);
      expect(row.consumption).toBeCloseTo(direct.consumption, 10);
    }
  });
});
