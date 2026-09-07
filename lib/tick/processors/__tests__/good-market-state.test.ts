import { describe, it, expect } from "vitest";
import { toGoodMarketStates, anchorCeiling } from "@/lib/tick/processors/good-market-state";
import { marketBandForRow } from "@/lib/engine/market-pricing";
import { GOODS } from "@/lib/constants/goods";
import { unitResourceVector } from "@/lib/engine/resources";
import { consumptionRate } from "@/lib/engine/physical-economy";
import { computeSystemLabourSnapshot, inputDemandForGood, buildingProduction } from "@/lib/engine/industry";
import { surplusDrawable } from "@/lib/engine/directed-logistics";
import { brakeKnee } from "@/lib/engine/tick";
import { MIN_DEMAND, TARGET_COVER } from "@/lib/constants/market-economy";
import { ECONOMY_CONSTANTS, ECONOMY_SIM_PARAMS } from "@/lib/constants/economy";
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

// ── anchorCeiling — the retired third-arm control ──────────────────
// Full rate to the price anchor, taper to 0 at RETIRED_HOLD_COVER(1.3) × anchor — a fixed
// historical literal (see the good-market-state.ts docstring), never ECONOMY_CONSTANTS.BRAKE_RAMP.

describe("anchorCeiling", () => {
  const target = 100; // taper runs [100, 130]

  it("runs at full rate at and below the price anchor", () => {
    expect(anchorCeiling(0, target)).toBe(1);
    expect(anchorCeiling(target, target)).toBe(1);
  });

  it("reaches exactly 0.5 at the taper midpoint", () => {
    expect(anchorCeiling(115, target)).toBeCloseTo(0.5, 10);
  });

  it("reaches 0 at and above RETIRED_HOLD_COVER × the price anchor", () => {
    expect(anchorCeiling(130, target)).toBe(0);
    expect(anchorCeiling(200, target)).toBe(0);
  });

  it("is 0 for a non-positive target — no anchor means no band to hold", () => {
    expect(anchorCeiling(0, 0)).toBe(0);
    expect(anchorCeiling(0, -5)).toBe(0);
  });
});

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

  it("uses explicit realised production including zero, while missing values fall back to capacity", () => {
    const base = {
      buildings: { food: 3 }, population: 100,
      yields: unitResourceVector(), markets: [{ ...foodMarket(20, 40), realisedProductionRate: 0 }],
    };
    const [assessed] = toGoodMarketStates(base);
    expect(assessed.capacityProduction).toBeGreaterThan(0);
    expect(assessed.production).toBe(0);

    const [legacy] = toGoodMarketStates({
      ...base,
      markets: [{ ...foodMarket(20, 40), realisedProductionRate: undefined }],
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

  // The stock at which metals' own brake is fully shut — computed from the same warehouse knee
  // the derivation applies (use figure + capacity), so the fixture tracks the geometry.
  const METALS_SNAP = computeSystemLabourSnapshot(BUILDINGS, POPULATION);
  const METALS_BRAKE_SHUT = brakeKnee(
    {
      useRate: consumptionRate("metals", METALS_SNAP.basis)
        + inputDemandForGood(BUILDINGS, "metals", METALS_SNAP.state, unitResourceVector()),
      capacityProduction: buildingProduction(BUILDINGS, "metals", METALS_SNAP.state, unitResourceVector()),
      anchorMult: 1,
    },
    ECONOMY_SIM_PARAMS,
  ).rampEnd + 1;

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

  it("the third-arm switch pins the draw figure's brake to the retired anchor ceiling", () => {
    // At the live warehouse knee's stop the metals yard reads full (ore's draw collapses to
    // civilian want), but that stock sits far below the price anchor (TARGET_COVER ×
    // demandRate 5 = 200) — so the pinned arm reads the same fixture as unbraked and the two
    // arms genuinely disagree. Warehousing quantities must not move with the switch: it
    // reaches nothing but the draw figure.
    expect(METALS_BRAKE_SHUT).toBeLessThan(TARGET_COVER * 5);
    const markets = [oreRow(), metalsRow({ stock: METALS_BRAKE_SHUT })];
    const live = stateOf(markets, "ore");
    const pinned = toGoodMarketStates(
      { buildings: BUILDINGS, population: POPULATION, yields: unitResourceVector(), markets },
      { withDraw: true, drawBrakeCeiling: "anchor" },
    ).find((g) => g.goodId === "ore");
    if (pinned === undefined) throw new Error("Expected an ore state");

    const ungated = consumptionRate("ore", METALS_SNAP.basis)
      + inputDemandForGood(BUILDINGS, "ore", METALS_SNAP.state, unitResourceVector());
    expect(live.drawDemand).toBeCloseTo(consumptionRate("ore", METALS_SNAP.basis), 9);
    expect(pinned.drawDemand).toBeCloseTo(ungated, 9);
    expect(pinned.drawDemand).toBeGreaterThan(live.drawDemand);
    expect(pinned.demand).toBe(live.demand);
    expect(pinned.logisticsTarget).toBe(live.logisticsTarget);
    expect(pinned.donorReserve).toBe(live.donorReserve);
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

// ── The supplier-floor read path: realisedUse / steadyInbound / lateInboundShare — the three
// rolling rates pass through unchanged (absent stays absent), and the role test they feed authors
// the two lines, the margin-free flag and the deep line every colony's staging draw is capped at.

describe("toGoodMarketStates: the supplier-floor rolling figures", () => {
  it("carries a present rolling figure through onto GoodMarketState", () => {
    const m = { ...foodMarket(10, 40), realisedUse: 6, steadyInbound: 3, lateInboundShare: 0.25 };
    const out = toGoodMarketStates({
      buildings: {}, population: 100, yields: unitResourceVector(), markets: [m],
    });
    expect(out[0].realisedUse).toBe(6);
    expect(out[0].steadyInbound).toBe(3);
    expect(out[0].lateInboundShare).toBeCloseTo(0.25, 10);
  });

  it("reaches GoodMarketState as absent, never as 0, when absent on the world row", () => {
    const m = foodMarket(10, 40);
    expect("realisedUse" in m).toBe(false);
    expect("steadyInbound" in m).toBe(false);
    expect("lateInboundShare" in m).toBe(false);
    const out = toGoodMarketStates({
      buildings: {}, population: 100, yields: unitResourceVector(), markets: [m],
    });
    expect(out[0].realisedUse).toBeUndefined();
    expect(out[0].steadyInbound).toBeUndefined();
    expect(out[0].lateInboundShare).toBeUndefined();
  });

  it("authors marginFree false and consumerDeepLine equal to donorReserve for a market with no rolling figures at all", () => {
    // Unknown realised use reads as full rate, so an untreated row is an ordinary consumer whose
    // deep line IS its give line — the vacuity check that an old save behaves as it always did.
    const m = foodMarket(10, 40);
    const out = toGoodMarketStates({
      buildings: {}, population: 100, yields: unitResourceVector(), markets: [m],
    });
    expect(out[0].role).toBe("consumer");
    expect(out[0].marginFree).toBe(false);
    expect(out[0].consumerDeepLine).toBe(out[0].donorReserve);
  });
});

// ── Roles and the two lines. Every fixture below pins the use figure on the row (`honestUseRate`)
// and states production explicitly, so `u` and `production` are the fixture's own numbers rather
// than a population recompute, and each case differs from its neighbour in exactly one input.

const U = 10;
const { EXPORT_RESERVE_COVER: F, SUPPLIER_WANT_COVER: S, DONOR_RESERVE_COVER: R, WAREHOUSE_COVER: W } =
  DIRECTED_LOGISTICS;

function roleRow(over: Partial<MarketRowForLogistics> = {}): MarketRowForLogistics {
  return {
    id: "A|food", goodId: "food", stock: 0, anchorMult: 1, demandRate: 40, storageCapacity: 0,
    honestUseRate: U, realisedProductionRate: 0,
    ...over,
  };
}

const linesOf = (over: Partial<MarketRowForLogistics> = {}, stockpileScale?: number) =>
  toGoodMarketStates(
    { buildings: {}, population: 100, yields: unitResourceVector(), markets: [roleRow(over)] },
    stockpileScale === undefined ? undefined : { stockpileScale },
  )[0];

describe("toGoodMarketStates: roles and the two lines", () => {
  it("gives a full-rate consumer exactly the lines it has today", () => {
    // r = u, nothing inbound: the deep terms bind and read 40 cycles either side, which is what
    // every market in the game read before roles existed.
    const state = linesOf({ realisedUse: U });
    expect(state.role).toBe("consumer");
    expect(state.donorReserve).toBeCloseTo(R * U, 9);
    expect(state.logisticsTarget).toBeCloseTo(W * U, 9);
    expect(state.marginFree).toBe(false);
    // And the same market with no measured rate at all lands on the identical pair.
    const unknown = linesOf();
    expect(unknown.donorReserve).toBeCloseTo(state.donorReserve, 9);
    expect(unknown.logisticsTarget).toBeCloseTo(state.logisticsTarget, 9);
  });

  it("makes a part-producer a supplier on its own production, unblocked by an unknown late share", () => {
    // production 0.95u clears SUPPLIER_REPLENISHMENT without any inbound, so there is no transit
    // exposure to bound and the never-measured late share must not deny the role.
    const state = linesOf({ realisedProductionRate: 0.95 * U });
    expect(state.lateInboundShare).toBeUndefined();
    expect(state.role).toBe("supplier");
    expect(state.donorReserve).toBeCloseTo(F * U, 9);
    expect(state.logisticsTarget).toBeCloseTo(S * U, 9);
    expect(state.marginFree).toBe(true);
  });

  it("denies the role to a world whose test is carried by inbound arriving one step too late", () => {
    const gated = linesOf({ steadyInbound: U, lateInboundShare: DIRECTED_LOGISTICS.SUPPLIER_LATE_SHARE + 0.01 });
    expect(gated.role).toBe("consumer");
    expect(gated.donorReserve).toBeCloseTo(R * U, 9);
    expect(gated.logisticsTarget).toBeCloseTo(W * U, 9);
    expect(gated.marginFree).toBe(false);
    // The gate is at-or-under, not strictly under: a world sitting exactly on the line qualifies.
    const onTheLine = linesOf({ steadyInbound: U, lateInboundShare: DIRECTED_LOGISTICS.SUPPLIER_LATE_SHARE });
    expect(onTheLine.role).toBe("supplier");
    // And an inbound-carried world with no late share measured at all is denied, unlike the
    // production-carried case above.
    expect(linesOf({ steadyInbound: U }).role).toBe("consumer");
  });

  it("collapses a refinery that has stopped drawing onto the margin-free restart buffer", () => {
    // r = 0.1u: the deep reserve (4 cycles of full-rate use) falls under the 10-cycle buffer, so
    // the buffer binds on both lines and everything above it is drawable without a dead-band.
    const state = linesOf({ realisedUse: 0.1 * U });
    expect(state.role).toBe("idle");
    expect(state.donorReserve).toBeCloseTo(F * U, 9);
    expect(state.logisticsTarget).toBeCloseTo(S * U, 9);
    expect(state.marginFree).toBe(true);
  });

  it("scales a producer's lines by the stockpile scale, not only a consumer's", () => {
    const producer = linesOf({ realisedProductionRate: 2 * U }, 0.75);
    expect(producer.role).toBe("producer");
    expect(producer.donorReserve).toBeCloseTo(F * U * 0.75, 9);
    expect(producer.logisticsTarget).toBeCloseTo(S * U * 0.75, 9);
    const consumer = linesOf({ realisedUse: U }, 0.75);
    expect(consumer.donorReserve).toBeCloseTo(R * U * 0.75, 9);
    expect(consumer.logisticsTarget).toBeCloseTo(W * U * 0.75, 9);
    // Absent, the scale is a neutral 1 — the eight callers that do not resolve a faction yet.
    expect(linesOf({ realisedProductionRate: 2 * U }).donorReserve).toBeCloseTo(F * U, 9);
  });

  it("rides the deep terms on an anchor shift and leaves the buffer terms where they are", () => {
    const shifted = linesOf({ realisedUse: U, anchorMult: 0.5 });
    expect(shifted.donorReserve).toBeCloseTo(R * U * 0.5, 9);
    expect(shifted.logisticsTarget).toBeCloseTo(W * U * 0.5, 9);
    expect(shifted.consumerDeepLine).toBeCloseTo(R * U * 0.5, 9);
    // The same event over a supplier moves nothing: its pair is the anchor-immune buffer.
    const supplier = linesOf({ realisedProductionRate: 0.95 * U, anchorMult: 0.5 });
    expect(supplier.role).toBe("supplier");
    expect(supplier.donorReserve).toBeCloseTo(F * U, 9);
    expect(supplier.logisticsTarget).toBeCloseTo(S * U, 9);
    // ...and an idle world's give line is the buffer, so the cut reaches only its deep line.
    const idle = linesOf({ realisedUse: 0.1 * U, anchorMult: 0.5 });
    expect(idle.donorReserve).toBeCloseTo(F * U, 9);
    expect(idle.consumerDeepLine).toBeCloseTo(R * U * 0.5, 9);
  });

  it("publishes the full-rate consumer's deep line for every role, whatever that role gives down to", () => {
    for (const row of [
      { realisedProductionRate: 2 * U },
      { realisedProductionRate: 0.95 * U },
      { realisedUse: U },
      { realisedUse: 0.1 * U },
    ]) {
      expect(linesOf(row, 1.5).consumerDeepLine).toBeCloseTo(R * U * 1.5, 9);
    }
  });

  it("drops a supplier back to the consumer's lines once the drop counter reaches its bound", () => {
    const short = { realisedProductionRate: 0.95 * U };
    expect(linesOf({ ...short, supplierShortRuns: DIRECTED_LOGISTICS.SUPPLIER_DROP_RUNS - 1 }).role).toBe("supplier");
    const dropped = linesOf({ ...short, supplierShortRuns: DIRECTED_LOGISTICS.SUPPLIER_DROP_RUNS });
    expect(dropped.role).toBe("consumer");
    expect(dropped.donorReserve).toBeCloseTo(R * U, 9);
    expect(dropped.logisticsTarget).toBeCloseTo(W * U, 9);
  });

  it("keeps every line at zero where the system uses none of the good", () => {
    const state = linesOf({ honestUseRate: 0, realisedProductionRate: 0 });
    expect(state.demand).toBe(0);
    expect(state.role).toBe("consumer");
    expect(state.donorReserve).toBe(0);
    expect(state.logisticsTarget).toBe(0);
    expect(state.consumerDeepLine).toBe(0);
    expect(state.marginFree).toBe(false);
    // A world that makes the good with nobody using it is still read as its producer.
    expect(linesOf({ honestUseRate: 0, realisedProductionRate: 5 }).role).toBe("producer");
  });

  it("keeps the production brake's ceiling under the donation line at full rate, and accepts the inversion below it", () => {
    // The shipped constants pairing (BRAKE_RAMP × BRAKE_USE_COVER ≤ SURPLUS_MARGIN ×
    // DONOR_RESERVE_COVER) is the full-rate statement: a world that produces less than it uses
    // should not dump stock it cannot replace.
    const brakeCeiling = ECONOMY_CONSTANTS.BRAKE_RAMP * ECONOMY_CONSTANTS.BRAKE_USE_COVER * U;
    const fullRate = linesOf({ realisedUse: U });
    expect(brakeCeiling).toBeLessThanOrEqual(fullRate.donorReserve * DIRECTED_LOGISTICS.SURPLUS_MARGIN);
    // Below full rate the donation line is denominated in the smaller realised-use figure and drops
    // under the brake ceiling. The inversion is accepted: such a world runs a net loss every cycle,
    // so nothing of its own accumulates above its line and what it passes on is inbound.
    const halfRate = linesOf({ realisedUse: 0.5 * U });
    expect(halfRate.donorReserve * DIRECTED_LOGISTICS.SURPLUS_MARGIN).toBeLessThan(brakeCeiling);
  });
});
