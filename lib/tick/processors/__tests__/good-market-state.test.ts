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

  it("surfaces local production per good (powers the matcher's self-supply gate)", () => {
    // A system with gas extractors produces gas → production must be reported > 0.
    const out = toGoodMarketStates({
      buildings: { gas: 3 }, population: 100, yields: unitResourceVector(),
      markets: [{ ...foodMarket(100, 5), id: "A|gas", goodId: "gas" }],
    });
    const gas = out.find((g) => g.goodId === "gas")!;
    expect(gas.production).toBeGreaterThan(0);
  });

  it("reports zero production for a good the system does not make", () => {
    const out = toGoodMarketStates({
      buildings: {}, population: 100, yields: unitResourceVector(), markets: [foodMarket(50, 20)],
    });
    expect(out[0].production).toBe(0);
  });
});
