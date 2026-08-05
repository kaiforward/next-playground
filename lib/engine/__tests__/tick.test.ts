import { describe, it, expect } from "vitest";
import {
  brakeKnee,
  buildMarketTickEntry,
  processShipArrivals,
  consumptionFactor,
  productionCeiling,
  type EconomySimParams,
} from "../tick";

const PARAMS: EconomySimParams = {
  brakeUseCover: 40,
  brakeRamp: 1.3,
  brakeOutputCover: 8,
  rationCover: 2,
};

describe("brakeKnee — the warehouse knee", () => {
  it("reproduces the retired anchor geometry where the use figure equals the old floored demandRate", () => {
    // The old brake kneed at targetStock = TARGET_COVER(40) × demandRate and stopped at
    // HOLD_COVER(1.3) × that. useRate 5 → knee 200, rampEnd 260 — the deliberate no-op anchor.
    const knee = brakeKnee(
      { useRate: 5, capacityProduction: 1, anchorMult: 1, storageCapacity: 10_000 },
      PARAMS,
    );
    expect(knee).toEqual({ knee: 200, rampEnd: 260, bindingTerm: "use" });
    expect(productionCeiling(200, knee)).toBe(1);
    expect(productionCeiling(230, knee)).toBeCloseTo(0.5);
    expect(productionCeiling(260, knee)).toBe(0);
  });

  it("gives a pure exporter a positive working-inventory knee (the trap the anchor brake fell into)", () => {
    // Negligible local use once meant a knee welded to the MIN_DEMAND pricing floor; a
    // demand-derived knee of 0 would have halted production outright at any stock.
    const knee = brakeKnee(
      { useRate: 0, capacityProduction: 10, anchorMult: 1, storageCapacity: 10_000 },
      PARAMS,
    );
    expect(knee.knee).toBe(80); // 8 cycles of its own output
    expect(knee.bindingTerm).toBe("output");
    expect(productionCeiling(50, knee)).toBe(1);
  });

  it("rides anchorMult on the use term only", () => {
    const useBound = brakeKnee(
      { useRate: 5, capacityProduction: 1, anchorMult: 2, storageCapacity: 100_000 },
      PARAMS,
    );
    expect(useBound.knee).toBe(400); // 40 × 5 × 2

    const outputBound = brakeKnee(
      { useRate: 0.1, capacityProduction: 10, anchorMult: 2, storageCapacity: 100_000 },
      PARAMS,
    );
    expect(outputBound.knee).toBe(80); // 8 × 10 — no anchor quantity in the output term
    expect(outputBound.bindingTerm).toBe("output");
  });

  it("hard-stops at physical storage when the yard is smaller than the knee", () => {
    // knee 200 from the use term, storage 150 < knee → no taper: full rate to the yard, zero beyond.
    const knee = brakeKnee(
      { useRate: 5, capacityProduction: 0, anchorMult: 1, storageCapacity: 150 },
      PARAMS,
    );
    expect(knee).toEqual({ knee: 200, rampEnd: 150, bindingTerm: "storage" });
    expect(productionCeiling(150, knee)).toBe(1);
    expect(productionCeiling(151, knee)).toBe(0);
  });

  it("clips the taper at storage between the knee and the full ramp", () => {
    // knee 200, uncapped ramp 260, storage 230 → taper over [200, 230], storage-bound.
    const knee = brakeKnee(
      { useRate: 5, capacityProduction: 0, anchorMult: 1, storageCapacity: 230 },
      PARAMS,
    );
    expect(knee).toEqual({ knee: 200, rampEnd: 230, bindingTerm: "storage" });
    expect(productionCeiling(200, knee)).toBe(1);
    expect(productionCeiling(215, knee)).toBeCloseTo(0.5);
    expect(productionCeiling(230, knee)).toBe(0);
  });

  it("treats a zero knee (no use, no capacity) as no production band above empty", () => {
    const knee = brakeKnee(
      { useRate: 0, capacityProduction: 0, anchorMult: 1, storageCapacity: 100 },
      PARAMS,
    );
    expect(knee.knee).toBe(0);
    expect(productionCeiling(0, knee)).toBe(1);
    expect(productionCeiling(1, knee)).toBe(0);
  });
});

describe("productionCeiling — full rate to the knee, taper to the ramp end", () => {
  const knee = brakeKnee(
    { useRate: 2.5, capacityProduction: 0, anchorMult: 1, storageCapacity: 10_000 },
    PARAMS,
  ); // knee 100, rampEnd 130

  it("runs at full rate at and below the knee", () => {
    expect(productionCeiling(0, knee)).toBe(1);
    expect(productionCeiling(100, knee)).toBe(1);
  });

  it("ramps linearly to 0 across [knee, rampEnd]", () => {
    expect(productionCeiling(115, knee)).toBeCloseTo(0.5);
    expect(productionCeiling(130, knee)).toBe(0);
    expect(productionCeiling(200, knee)).toBe(0);
  });
});

describe("buildMarketTickEntry", () => {
  const BASE = {
    honestUseRate: 2.5,
    capacityProduction: 10,
    anchorMult: 1,
    storageCapacity: 500,
    demandRate: 1,
    maxStock: 200,
  };

  it("passes through the base production rate and threads the knee inputs verbatim", () => {
    const e = buildMarketTickEntry({
      goodId: "food",
      stock: 100,
      ...BASE,
      baseProductionRate: 10,
      baseConsumptionRate: undefined,
    });
    expect(e.productionRate).toBeCloseTo(10, 5);
    expect(e.stock).toBe(100);
    expect(e.honestUseRate).toBe(2.5);
    expect(e.capacityProduction).toBe(10);
    expect(e.anchorMult).toBe(1);
    expect(e.storageCapacity).toBe(500);
    expect(e.maxStock).toBe(200);
  });

  it("suppresses the flow rate but never the knee's capacity denominator", () => {
    // A suppressed capacityProduction would move the brake knee with strike state — the
    // cadence/strike-coupling the reference-cycle contract exists to prevent.
    const e = buildMarketTickEntry({
      goodId: "food",
      stock: 100,
      ...BASE,
      baseProductionRate: 10,
      baseConsumptionRate: undefined,
      productionSuppress: 0.5,
    });
    expect(e.productionRate).toBeCloseTo(5, 5);
    expect(e.capacityProduction).toBe(10);
  });

  it("does not add government consumption after shared demand resolution", () => {
    const e = buildMarketTickEntry({
      goodId: "food",
      stock: 100,
      ...BASE,
      baseProductionRate: undefined,
      baseConsumptionRate: 10,
    });
    expect(e.consumptionRate).toBeCloseTo(10, 5);
  });

  it("leaves consumption undefined when there is no base rate and no boost", () => {
    const e = buildMarketTickEntry({
      goodId: "food",
      stock: 100,
      ...BASE,
      baseProductionRate: undefined,
      baseConsumptionRate: undefined,
    });
    expect(e.consumptionRate).toBeUndefined();
  });
});

// ── processShipArrivals (unchanged) ─────────────────────────────

describe("processShipArrivals", () => {
  it("returns ships that have arrived (arrivalTick <= currentTick)", () => {
    const ships = [
      { id: "ship-1", arrivalTick: 5 },
      { id: "ship-2", arrivalTick: 10 },
      { id: "ship-3", arrivalTick: 15 },
    ];
    const arrived = processShipArrivals(ships, 10);
    expect(arrived).toEqual(["ship-1", "ship-2"]);
  });

  it("returns empty array when no ships have arrived", () => {
    const ships = [
      { id: "ship-1", arrivalTick: 20 },
      { id: "ship-2", arrivalTick: 30 },
    ];
    const arrived = processShipArrivals(ships, 10);
    expect(arrived).toEqual([]);
  });

  it("returns all ships when all have arrived", () => {
    const ships = [
      { id: "ship-1", arrivalTick: 3 },
      { id: "ship-2", arrivalTick: 5 },
    ];
    const arrived = processShipArrivals(ships, 10);
    expect(arrived).toEqual(["ship-1", "ship-2"]);
  });

  it("includes ships arriving exactly on the current tick", () => {
    const ships = [{ id: "ship-1", arrivalTick: 10 }];
    const arrived = processShipArrivals(ships, 10);
    expect(arrived).toEqual(["ship-1"]);
  });

  it("handles empty ship array", () => {
    const arrived = processShipArrivals([], 10);
    expect(arrived).toEqual([]);
  });
});

describe("consumptionFactor — emergency ration threshold", () => {
  it("delivers in full at and above the comfort stock", () => {
    expect(consumptionFactor(75, 75)).toBe(1);
    expect(consumptionFactor(200, 75)).toBe(1);
  });
  it("ramps as sqrt below the knee — gentle just under it, brutal near empty", () => {
    expect(consumptionFactor(75 * 0.81, 75)).toBeCloseTo(0.9); // sqrt(0.81)
    expect(consumptionFactor(75 * 0.04, 75)).toBeCloseTo(0.2); // sqrt(0.04)
  });
  it("reaches 0 at empty and never goes negative", () => {
    expect(consumptionFactor(0, 75)).toBe(0);
    expect(consumptionFactor(-5, 75)).toBe(0);
  });
  it("treats a non-positive comfort stock as unconstrained when stock exists", () => {
    expect(consumptionFactor(10, 0)).toBe(1);
    expect(consumptionFactor(0, 0)).toBe(0);
  });
});
