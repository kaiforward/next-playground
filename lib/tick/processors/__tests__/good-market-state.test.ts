import { describe, it, expect } from "vitest";
import { toGoodMarketStates } from "@/lib/tick/processors/good-market-state";
import { marketBandForRow } from "@/lib/engine/market-pricing";
import { GOODS } from "@/lib/constants/goods";
import { unitResourceVector } from "@/lib/engine/resources";
import { consumptionRate } from "@/lib/engine/physical-economy";
import type { MarketRowForLogistics } from "@/lib/tick/world/directed-logistics-world";

function foodMarket(stock: number, demandRate: number): MarketRowForLogistics {
  return {
    id: "A|food", goodId: "food", stock, anchorMult: 1,
    demandRate, storageCapacity: 0,
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
    expect(out[0].targetStock).toBe(marketBandForRow(m, GOODS[m.goodId]).targetStock);
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

  it("passes the government boost once into planner and logistics demand", () => {
    const market = { ...foodMarket(20, 40), id: "A|weapons", goodId: "weapons" };
    const base = { buildings: {}, population: 100, yields: unitResourceVector(), markets: [market] };
    const [frontier] = toGoodMarketStates({ ...base,});
    const [militarist] = toGoodMarketStates({ ...base,});
    const expectedBoost = consumptionRate("weapons", { population: 100, technicians: 0, engineers: 0 })
      - consumptionRate("weapons", { population: 100, technicians: 0, engineers: 0 });
    expect(militarist.demand - frontier.demand).toBeCloseTo(expectedBoost, 10);
  });

  it("threads the persisted satisfaction through to GoodMarketState", () => {
    const withSatisfaction = { ...foodMarket(20, 40), satisfaction: 0.7 };
    const [withValue] = toGoodMarketStates({
      buildings: {}, population: 100, yields: unitResourceVector(), markets: [withSatisfaction],
    });
    expect(withValue.satisfaction).toBe(0.7);

    const [withoutValue] = toGoodMarketStates({
      buildings: {}, population: 100, yields: unitResourceVector(), markets: [foodMarket(20, 40)],
    });
    expect(withoutValue.satisfaction).toBeUndefined();
  });

  it("uses explicit realized production including zero, while missing values fall back to capacity", () => {
    const base = {
      buildings: { food: 3 }, population: 100,
      yields: unitResourceVector(), markets: [{ ...foodMarket(20, 40), realizedProductionRate: 0 }],
    };
    const [assessed] = toGoodMarketStates(base);
    expect(assessed.capacityProduction).toBeGreaterThan(0);
    expect(assessed.production).toBe(0);

    const [legacy] = toGoodMarketStates({
      ...base,
      markets: [{ ...foodMarket(20, 40), realizedProductionRate: undefined }],
    });
    expect(legacy.production).toBe(legacy.capacityProduction);
  });

  it("threads assessment policy fields through the one shared market derivation", () => {
    const [state] = toGoodMarketStates({
      buildings: {}, population: 100, yields: unitResourceVector(),
      markets: [{
        ...foodMarket(20, 40), satisfaction: 0.5, productionSuppressed: true,
        squeezePulses: 2, proposalPulses: 1, logisticsFundingBound: true,
      }],
    });
    expect(state).toMatchObject({
      satisfaction: 0.5, productionSuppressed: true, squeezePulses: 2,
      proposalPulses: 1, logisticsFundingBound: true,
    });
  });
});
