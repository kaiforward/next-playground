import { describe, it, expect } from "vitest";
import { prepareTradeBars } from "../substrate";
import type { SubstrateGoodRate } from "@/lib/engine/physical-economy";

describe("prepareTradeBars", () => {
  const goods: SubstrateGoodRate[] = [
    { goodId: "water", production: 10, consumption: 2 }, // net +8 (export)
    { goodId: "machinery", production: 1, consumption: 5 }, // net -4 (import)
    { goodId: "food", production: 4, consumption: 4 }, // net 0 (balanced)
  ];

  it("computes net balance and resolves display names", () => {
    const bars = prepareTradeBars(goods);
    const water = bars.find((b) => b.goodId === "water")!;
    expect(water.name).toBe("Water");
    expect(water.net).toBe(8);
    const machinery = bars.find((b) => b.goodId === "machinery")!;
    expect(machinery.net).toBe(-4);
  });

  it("sorts net exporters first, net importers last", () => {
    const bars = prepareTradeBars(goods);
    expect(bars.map((b) => b.goodId)).toEqual(["water", "food", "machinery"]);
  });

  it("normalizes both directions to the largest single rate across all goods", () => {
    const bars = prepareTradeBars(goods);
    const water = bars.find((b) => b.goodId === "water")!;
    // maxRate = 10 (water production) → fractions are value / 10.
    expect(water.prodFraction).toBeCloseTo(1.0, 5);
    expect(water.consFraction).toBeCloseTo(0.2, 5);
    const machinery = bars.find((b) => b.goodId === "machinery")!;
    expect(machinery.consFraction).toBeCloseTo(0.5, 5);
  });

  it("returns an empty array for no goods", () => {
    expect(prepareTradeBars([])).toEqual([]);
  });

  it("yields zero fractions when every rate is zero", () => {
    const bars = prepareTradeBars([{ goodId: "water", production: 0, consumption: 0 }]);
    expect(bars[0].prodFraction).toBe(0);
    expect(bars[0].consFraction).toBe(0);
    expect(bars[0].net).toBe(0);
  });
});
