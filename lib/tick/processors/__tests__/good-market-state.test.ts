import { describe, it, expect } from "vitest";
import { toGoodMarketStates } from "@/lib/tick/processors/good-market-state";
import { marketBandForRow } from "@/lib/engine/market-pricing";
import { GOODS } from "@/lib/constants/goods";
import { unitResourceVector } from "@/lib/engine/resources";
import { consumptionRate } from "@/lib/engine/physical-economy";
import { computeSystemLabourSnapshot, inputDemandForGood } from "@/lib/engine/industry";
import { surplusDrawable } from "@/lib/engine/directed-logistics";
import { MIN_DEMAND, TARGET_COVER } from "@/lib/constants/market-economy";
import { ECONOMY_CONSTANTS } from "@/lib/constants/economy";
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
  it("passes stock + goodId through and derives demand from the system's own basis", () => {
    const m = foodMarket(7, 40);
    const out = toGoodMarketStates({
      buildings: {}, population: 100, yields: unitResourceVector(), markets: [m],
    });
    expect(out).toHaveLength(1);
    expect(out[0].goodId).toBe("food");
    expect(out[0].stock).toBe(7);
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

// ── The use figure and the draw figure ────────────────────────────

describe("toGoodMarketStates: the two demand figures", () => {
  // A smelter world. `ore` is the input under test; `metals` is the consumer whose own
  // output brake and event multiplier gate ore's urgency without touching ore's warehousing.
  const BUILDINGS = { metals: 3, vocational_school: 1 };
  const POPULATION = 100;

  function metalsRow(overrides: Partial<MarketRowForLogistics> = {}): MarketRowForLogistics {
    return {
      id: "A|metals", goodId: "metals", stock: 0, anchorMult: 1,
      demandRate: 5, storageCapacity: 0, ...overrides,
    };
  }
  function oreRow(overrides: Partial<MarketRowForLogistics> = {}): MarketRowForLogistics {
    return {
      id: "A|ore", goodId: "ore", stock: 10, anchorMult: 1,
      demandRate: 5, storageCapacity: 0, ...overrides,
    };
  }
  // The matcher's call shape: it is the draw figure's only reader, so it alone opts in.
  const statesOf = (markets: MarketRowForLogistics[]) =>
    toGoodMarketStates(
      { buildings: BUILDINGS, population: POPULATION, yields: unitResourceVector(), markets },
      { withDraw: true },
    );

  const stateOf = (markets: MarketRowForLogistics[], goodId: string) => {
    const state = statesOf(markets).find((g) => g.goodId === goodId);
    if (state === undefined) throw new Error(`Expected a ${goodId} state`);
    return state;
  };

  // metals: targetStock = TARGET_COVER × demandRate 5 = 200; the brake shuts at HOLD_COVER × 200 = 260.
  const METALS_BRAKE_SHUT = TARGET_COVER * 5 * ECONOMY_CONSTANTS.HOLD_COVER + 1;

  it("takes demand from the row's persisted use figure rather than recomputing it", () => {
    // A figure no recompute would produce, so reading it back proves the row is the source.
    const state = stateOf([oreRow({ honestUseRate: 12.5 }), metalsRow()], "ore");
    expect(state.demand).toBe(12.5);
    expect(state.logisticsTarget).toBeCloseTo(DIRECTED_LOGISTICS.WAREHOUSE_COVER * 12.5, 9);
    expect(state.donorReserve).toBeCloseTo(DIRECTED_LOGISTICS.DONOR_RESERVE_COVER * 12.5, 9);
  });

  it("recomputes the use figure live when the row carries none, gated by the row's suppress rate", () => {
    // The legacy-save path. It must never fall back to 0, which would make the row un-sinkable
    // and its whole yard drawable.
    const basis = computeSystemLabourSnapshot(BUILDINGS, POPULATION).basis;
    const snap = computeSystemLabourSnapshot(BUILDINGS, POPULATION);
    const civilian = consumptionRate("ore", basis);
    const industrial = inputDemandForGood(BUILDINGS, "ore", snap.state, unitResourceVector());
    expect(industrial).toBeGreaterThan(0);

    const plain = stateOf([oreRow(), metalsRow()], "ore");
    expect(plain.demand).toBeCloseTo(civilian + industrial, 9);
    expect(plain.demand).toBeGreaterThan(0);

    const struck = stateOf([oreRow({ productionSuppressRate: 0.4 }), metalsRow()], "ore");
    expect(struck.demand).toBeCloseTo(civilian + industrial * 0.4, 9);
  });

  it("leaves drawDemand equal to the use figure when nothing is braked and no event runs", () => {
    const state = stateOf([oreRow({ honestUseRate: 12.5 }), metalsRow({ stock: 0 })], "ore");
    // The use figure is the row's; the draw figure is derived from this system's own industry, so
    // they coincide only in shape here — assert the draw against its own components.
    const basis = computeSystemLabourSnapshot(BUILDINGS, POPULATION).basis;
    const snap = computeSystemLabourSnapshot(BUILDINGS, POPULATION);
    const ungated = consumptionRate("ore", basis)
      + inputDemandForGood(BUILDINGS, "ore", snap.state, unitResourceVector());
    expect(state.drawDemand).toBeCloseTo(ungated, 9);
  });

  it("collapses drawDemand to civilian want when the consuming industry is braked shut", () => {
    const basis = computeSystemLabourSnapshot(BUILDINGS, POPULATION).basis;
    const running = stateOf([oreRow(), metalsRow({ stock: 0 })], "ore");
    const braked = stateOf([oreRow(), metalsRow({ stock: METALS_BRAKE_SHUT })], "ore");

    expect(braked.drawDemand).toBeLessThan(running.drawDemand);
    expect(braked.drawDemand).toBeCloseTo(consumptionRate("ore", basis), 9);
  });

  it("keeps every warehousing quantity bit-identical across two states that differ only in draw", () => {
    // The invariant the whole split exists to protect: a target that followed the momentary state
    // of the yard it stocks is the drain/refill oscillation the donor reserve is written to prevent.
    const ore = oreRow({ honestUseRate: 12.5 });
    const running = stateOf([ore, metalsRow({ productionMult: 1 })], "ore");
    const evented = stateOf([ore, metalsRow({ productionMult: 0.25 })], "ore");

    expect(evented.drawDemand).toBeLessThan(running.drawDemand);
    expect(evented.demand).toBe(running.demand);
    expect(evented.logisticsTarget).toBe(running.logisticsTarget);
    expect(evented.donorReserve).toBe(running.donorReserve);
    expect(evented.civilianDemand).toBe(running.civilianDemand);
    expect(
      surplusDrawable(ore.stock, evented.donorReserve, evented.demand, evented.production),
    ).toBe(
      surplusDrawable(ore.stock, running.donorReserve, running.demand, running.production),
    );
  });

  it("reads a consumer good with no market row as unbraked rather than as stopped", () => {
    // A missing row carries no stock and no band; treating that as a shut brake would silently
    // erase the draw it explains.
    const withMetals = stateOf([oreRow(), metalsRow({ stock: 0 })], "ore");
    const withoutMetals = stateOf([oreRow()], "ore");
    expect(withoutMetals.drawDemand).toBeCloseTo(withMetals.drawDemand, 9);
  });

  it("skips the draw computation for callers that never read urgency", () => {
    // The build planner and the harness classification read warehousing quantities only, so
    // they do not pay for the brake pass: drawDemand falls back to the standing want even
    // where the brake would bite — the collapse test above shows the same fixture braked.
    const markets = [oreRow({ honestUseRate: 12.5 }), metalsRow({ stock: METALS_BRAKE_SHUT })];
    const ore = toGoodMarketStates(
      { buildings: BUILDINGS, population: POPULATION, yields: unitResourceVector(), markets },
    ).find((g) => g.goodId === "ore");
    if (ore === undefined) throw new Error("Expected an ore state");
    expect(ore.drawDemand).toBe(12.5);
    expect(ore.drawDemand).toBe(ore.demand);
  });
});
