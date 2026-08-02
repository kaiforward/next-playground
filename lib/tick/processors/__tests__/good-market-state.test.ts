import { describe, it, expect } from "vitest";
import { toGoodMarketStates } from "@/lib/tick/processors/good-market-state";
import { marketBandForRow } from "@/lib/engine/market-pricing";
import { GOODS } from "@/lib/constants/goods";
import { unitResourceVector } from "@/lib/engine/resources";
import { consumptionRate } from "@/lib/engine/physical-economy";
import { computeSystemLabourSnapshot } from "@/lib/engine/industry";
import { MIN_DEMAND } from "@/lib/constants/market-economy";
import { DIRECTED_LOGISTICS } from "@/lib/constants/directed-logistics";
import type { MarketRowForLogistics } from "@/lib/tick/world/directed-logistics-world";

function foodMarket(stock: number, demandRate: number): MarketRowForLogistics {
  return {
    id: "A|food", goodId: "food", stock, anchorMult: 1,
    demandRate, storageCapacity: 0,
  };
}

/** A row whose persisted `demandRate` is what the population processor would write for `population` —
 *  i.e. the real civilian rate, floored at MIN_DEMAND exactly as `civilianDemandRateForGood` does. */
function rowAtPopulation(goodId: string, population: number, stock: number, anchorMult = 1): {
  row: MarketRowForLogistics; realRate: number;
} {
  const realRate = consumptionRate(goodId, { population, technicians: 0, engineers: 0 });
  return {
    row: {
      id: `A|${goodId}`, goodId, stock, anchorMult,
      demandRate: Math.max(realRate, MIN_DEMAND), storageCapacity: 0,
    },
    realRate,
  };
}

const statesFor = (row: MarketRowForLogistics, population: number) =>
  toGoodMarketStates({ buildings: {}, population, yields: unitResourceVector(), markets: [row] });

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
    // With no buildings the industrial draw is 0, so `demand` is exactly the civilian rate at the
    // system's own labour basis — pins the civ + industrial composition, not just its finiteness.
    expect(out[0].demand).toBeCloseTo(
      consumptionRate("food", { population: 100, technicians: 0, engineers: 0 }),
      10,
    );
  });

  it("reports civilian demand separately from the civilian + industrial total", () => {
    // The housing fed-gate folds civilianDemand ALONE, so the two fields must be distinguishable.
    // A no-buildings fixture cannot check that — with zero industrial draw they are simply equal, so
    // swapping `civ` for `industrial` here would still satisfy the order-independent `demand` sum.
    // A smelter drawing ore as a recipe input separates them.
    const ore: MarketRowForLogistics = {
      id: "A|ore", goodId: "ore", stock: 10, anchorMult: 1, demandRate: 5, storageCapacity: 0,
    };
    const buildings = { metals: 3, vocational_school: 1 };
    const out = toGoodMarketStates({
      buildings, population: 100, yields: unitResourceVector(), markets: [ore],
    });
    const basis = computeSystemLabourSnapshot(buildings, 100).basis;
    expect(out[0].civilianDemand).toBeCloseTo(consumptionRate("ore", basis), 10);
    // The smelter's ore draw rides on top, so the total is strictly the larger of the two.
    expect(out[0].demand).toBeGreaterThan(out[0].civilianDemand);
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

  describe("logisticsTarget — the warehousing target, denominated in real demand", () => {
    /** The row's PRICE anchor, which the state deliberately no longer carries. */
    const priceAnchor = (row: MarketRowForLogistics) =>
      marketBandForRow(row, GOODS[row.goodId]).targetStock;

    it("equals the price anchor wherever real demand clears MIN_DEMAND", () => {
      // 100 population wants far more than MIN_DEMAND of food, so nothing is floored and the two
      // figures coincide. This is the identity that keeps the change confined to floored markets.
      const { row, realRate } = rowAtPopulation("food", 100, 7);
      expect(realRate).toBeGreaterThan(MIN_DEMAND);

      const [state] = statesFor(row, 100);
      expect(state.logisticsTarget).toBeCloseTo(priceAnchor(row), 10);
    });

    it("is strictly below the price anchor where real demand sits under MIN_DEMAND", () => {
      // Ship frames are a trace need: ~167 population before the rate clears the floor. At 100 the
      // row's persisted demandRate is the floor itself, so the price anchor describes the guard
      // rather than anything consumed here.
      const { row, realRate } = rowAtPopulation("ship_frames", 100, 0);
      expect(realRate).toBeGreaterThan(0);
      expect(realRate).toBeLessThan(MIN_DEMAND);

      const [state] = statesFor(row, 100);
      // Sourced from real demand, NOT the floored row column — this is the assertion that fails if
      // logisticsTarget is ever wired back to `demandRate`.
      expect(state.logisticsTarget).toBeCloseTo(DIRECTED_LOGISTICS.WAREHOUSE_COVER * realRate, 10);
      expect(state.logisticsTarget).toBeLessThan(priceAnchor(row));
    });

    it("is zero where nothing in the system wants the good", () => {
      // Every good carries a flat per-capita baseline, so any populated world wants a trace of the
      // whole roster; genuine zero demand means an emptied system with no industry drawing inputs
      // either. The floored price anchor still reads TARGET_COVER × MIN_DEMAND there, so only the
      // unfloored figure can tell "wanted in trace amounts" apart from "not wanted at all" — which
      // is what lets classifyMarketState drop the market out of the match.
      const { row, realRate } = rowAtPopulation("luxuries", 0, 0);
      expect(realRate).toBe(0);

      const [state] = statesFor(row, 0);
      expect(state.demand).toBe(0);
      expect(state.logisticsTarget).toBe(0);
      expect(priceAnchor(row)).toBeGreaterThan(0);
    });

    it("carries anchorMult, so an anchor-shift event moves both figures together", () => {
      const { row } = rowAtPopulation("food", 100, 7, 2);
      const [state] = statesFor(row, 100);
      expect(state.logisticsTarget).toBeCloseTo(priceAnchor(row), 10);

      const { row: unshifted } = rowAtPopulation("food", 100, 7, 1);
      const [plain] = statesFor(unshifted, 100);
      expect(state.logisticsTarget).toBeCloseTo(plain.logisticsTarget * 2, 10);
    });
  });

  it("threads assessment policy fields through the one shared market derivation", () => {
    const [state] = toGoodMarketStates({
      buildings: {}, population: 100, yields: unitResourceVector(),
      markets: [{
        ...foodMarket(20, 40), satisfaction: 0.5, productionSuppressed: true,
        squeezeCycles: 2, proposalCycles: 1, logisticsFundingBound: true,
      }],
    });
    expect(state).toMatchObject({
      satisfaction: 0.5, productionSuppressed: true, squeezeCycles: 2,
      proposalCycles: 1, logisticsFundingBound: true,
    });
  });
});
