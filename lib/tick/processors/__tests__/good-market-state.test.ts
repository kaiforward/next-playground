import { describe, it, expect } from "vitest";
import { toGoodMarketStates } from "@/lib/tick/processors/good-market-state";
import { marketBandForRow } from "@/lib/engine/market-pricing";
import { unitResourceVector } from "@/lib/engine/resources";
import type { MarketRowForLogistics } from "@/lib/tick/world/directed-logistics-world";

function foodMarket(stock: number, demandRate: number): MarketRowForLogistics {
  return {
    id: "A|food", goodId: "food", stock, basePrice: 10, anchorMult: 1,
    demandRate, priceFloor: 0.5, priceCeiling: 3.0, storageCapacity: 0,
  };
}

describe("toGoodMarketStates", () => {
  it("passes stock + goodId through and uses the band's targetStock", () => {
    const m = foodMarket(7, 40);
    const out = toGoodMarketStates({
      buildings: {}, population: 100, yields: unitResourceVector(), markets: [m],
    });
    expect(out).toHaveLength(1);
    expect(out[0].goodId).toBe("food");
    expect(out[0].stock).toBe(7);
    expect(out[0].targetStock).toBe(marketBandForRow(m, m).targetStock);
    expect(Number.isFinite(out[0].demand)).toBe(true);
    expect(out[0].demand).toBeGreaterThanOrEqual(0);
  });

  it("returns one entry per market row", () => {
    const out = toGoodMarketStates({
      buildings: {}, population: 100, yields: unitResourceVector(),
      markets: [foodMarket(5, 20), { ...foodMarket(5, 20), id: "A|water", goodId: "water" }],
    });
    expect(out.map((g) => g.goodId)).toEqual(["food", "water"]);
  });
});
