import { describe, it, expect } from "vitest";
import {
  simulateEconomyTick,
  buildMarketTickEntry,
  processShipArrivals,
  consumptionFactor,
  productionCeiling,
  type MarketTickEntry,
  type EconomySimParams,
} from "../tick";

const PARAMS: EconomySimParams = {
  holdCover: 1.3,
  rationCover: 2,
};

function entry(over: Partial<MarketTickEntry>): MarketTickEntry {
  return {
    goodId: "food",
    stock: 100,
    minStock: 5,
    targetStock: 100,
    demandRate: 1,
    maxStock: 200,
    ...over,
  };
}

describe("simulateEconomyTick — production", () => {
  it("produces at the FULL rate at and below the anchor", () => {
    const atAnchor = simulateEconomyTick([entry({ productionRate: 10, stock: 100 })], PARAMS);
    expect(atAnchor[0].stock).toBeCloseTo(110); // no throttle at the anchor
    const low = simulateEconomyTick([entry({ productionRate: 10, stock: 20 })], PARAMS);
    expect(low[0].stock).toBeCloseTo(30);
  });

  it("ramps linearly to zero across the deceleration zone [T, 1.3T]", () => {
    const mid = simulateEconomyTick([entry({ productionRate: 10, stock: 115 })], PARAMS);
    expect(mid[0].stock).toBeCloseTo(115 + 10 * 0.5);
    const atCeiling = simulateEconomyTick([entry({ productionRate: 10, stock: 130 })], PARAMS);
    expect(atCeiling[0].stock).toBeCloseTo(130);
  });

  it("does nothing when the production rate is zero or undefined", () => {
    expect(simulateEconomyTick([entry({ productionRate: 0, stock: 100 })], PARAMS)[0].stock).toBe(100);
    expect(simulateEconomyTick([entry({ stock: 100 })], PARAMS)[0].stock).toBe(100);
  });

  it("applies event production multipliers", () => {
    const base = simulateEconomyTick([entry({ productionRate: 10, stock: 100 })], PARAMS);
    const boosted = simulateEconomyTick([entry({ productionRate: 10, productionMult: 2, stock: 100 })], PARAMS);
    expect(boosted[0].stock - 100).toBeGreaterThan(base[0].stock - 100);
  });
});

describe("simulateEconomyTick — operating ceiling", () => {
  it("idles production at holdCover × targetStock, well below maxStock", () => {
    // targetStock 100, holdCover 1.3 → operating ceiling 130 (maxStock is 200).
    const atCeiling = simulateEconomyTick([entry({ productionRate: 10, stock: 130 })], PARAMS);
    expect(atCeiling[0].stock).toBeCloseTo(130, 5); // throttled to ~0 at the operating ceiling

    const below = simulateEconomyTick([entry({ productionRate: 10, stock: 100 })], PARAMS);
    expect(below[0].stock).toBeGreaterThan(100); // still produces below the ceiling
    expect(below[0].stock).toBeLessThan(130);
  });
});

describe("simulateEconomyTick — consumption", () => {
  it("delivers in full throughout a depleted strategic reserve", () => {
    for (const stock of [40, 10, 2]) {
      const result = simulateEconomyTick([entry({ consumptionRate: 1, stock })], PARAMS);
      expect(result[0].stock).toBeCloseTo(stock - 1);
    }
  });

  it("rations only below the emergency threshold and can draw below old minStock", () => {
    const scarce = simulateEconomyTick([entry({ consumptionRate: 1, stock: 0.5 })], PARAMS);
    expect(scarce[0].stock).toBeCloseTo(0.5 - 0.5, 6);
    expect(scarce[0].stock).toBeLessThan(50);
  });

  it("keeps access independent of pricing-anchor shifts", () => {
    const lowAnchor = simulateEconomyTick(
      [entry({ targetStock: 20, demandRate: 1, consumptionRate: 1, stock: 1 })],
      PARAMS,
    );
    const highAnchor = simulateEconomyTick(
      [entry({ targetStock: 160, demandRate: 1, consumptionRate: 1, stock: 1 })],
      PARAMS,
    );
    expect(lowAnchor[0].stock).toBeCloseTo(highAnchor[0].stock, 8);
  });

  it("never draws more than the stock that exists (stock floors at 0, not minStock)", () => {
    const nearEmpty = simulateEconomyTick([entry({ consumptionRate: 1000, stock: 5 })], PARAMS);
    expect(nearEmpty[0].stock).toBeGreaterThanOrEqual(0);
  });
});

describe("simulateEconomyTick — consumption multipliers", () => {
  it("applies event consumption multipliers", () => {
    const base = simulateEconomyTick([entry({ consumptionRate: 10, stock: 100 })], PARAMS);
    const boosted = simulateEconomyTick([entry({ consumptionRate: 10, consumptionMult: 2, stock: 100 })], PARAMS);
    expect(100 - boosted[0].stock).toBeGreaterThan(100 - base[0].stock);
  });
});

describe("simulateEconomyTick — immutability", () => {
  it("does not mutate the input array", () => {
    const input = [entry({ productionRate: 10 })];
    const snapshot = input[0].stock;
    simulateEconomyTick(input, PARAMS);
    expect(input[0].stock).toBe(snapshot);
  });
});

describe("buildMarketTickEntry", () => {
  const BASE_BAND = { minStock: 5, targetStock: 100, demandRate: 1, maxStock: 200 };

  it("passes through the base production rate unmodified", () => {
    const e = buildMarketTickEntry({
      goodId: "food",
      stock: 100,
      ...BASE_BAND,
      baseProductionRate: 10,
      baseConsumptionRate: undefined,
      govConsumptionBoost: 0,
    });
    expect(e.productionRate).toBeCloseTo(10, 5);
    expect(e.stock).toBe(100);
    expect(e.minStock).toBe(5);
    expect(e.targetStock).toBe(100);
    expect(e.maxStock).toBe(200);
  });

  it("folds the government consumption boost into a consumed good's rate", () => {
    const e = buildMarketTickEntry({
      goodId: "food",
      stock: 100,
      ...BASE_BAND,
      baseProductionRate: undefined,
      baseConsumptionRate: 10,
      govConsumptionBoost: 5,
    });
    expect(e.consumptionRate).toBeCloseTo(10 + 5, 5); // base + boost
  });

  it("ignores a government boost on a good the system does not consume", () => {
    const e = buildMarketTickEntry({
      goodId: "food",
      stock: 100,
      ...BASE_BAND,
      baseProductionRate: undefined,
      baseConsumptionRate: undefined,
      govConsumptionBoost: 5,
    });
    expect(e.consumptionRate).toBeUndefined(); // no base rate ⇒ boost cannot create consumption
  });

  it("leaves consumption undefined when there is no base rate and no boost", () => {
    const e = buildMarketTickEntry({
      goodId: "food",
      stock: 100,
      ...BASE_BAND,
      baseProductionRate: undefined,
      baseConsumptionRate: undefined,
      govConsumptionBoost: 0,
    });
    expect(e.consumptionRate).toBeUndefined();
  });
});


// ── Per-entry band: clamp + per-entry self-limiting ────

describe("simulateEconomyTick — per-entry band", () => {
  it("clamps stock to [0, maxStock]", () => {
    const low = { goodId: "ore", stock: -5, minStock: 10, targetStock: 50, demandRate: 1, maxStock: 90, productionRate: 0, consumptionRate: 0 };
    const outLow = simulateEconomyTick([low], PARAMS)[0];
    expect(outLow.stock).toBe(0);

    const high = { goodId: "ore", stock: 100, minStock: 10, targetStock: 50, demandRate: 1, maxStock: 90, productionRate: 0, consumptionRate: 0 };
    const outHigh = simulateEconomyTick([high], PARAMS)[0];
    expect(outHigh.stock).toBe(90);
  });

  it("does not use minStock as a floor (price-saturation point only)", () => {
    const belowMin = { goodId: "ore", stock: 3, minStock: 10, targetStock: 50, demandRate: 1, maxStock: 90, productionRate: 0, consumptionRate: 10 };
    const out = simulateEconomyTick([belowMin], PARAMS)[0];
    expect(out.stock).toBeLessThan(10); // can go below minStock via consumption
    expect(out.stock).toBeGreaterThanOrEqual(0); // but not below 0
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

describe("productionCeiling — knee at the anchor", () => {
  it("runs at full rate at and below the anchor", () => {
    expect(productionCeiling(0, 100, 1.3)).toBe(1);
    expect(productionCeiling(100, 100, 1.3)).toBe(1);
  });
  it("ramps linearly to 0 across [T, holdCover×T]", () => {
    expect(productionCeiling(115, 100, 1.3)).toBeCloseTo(0.5);
    expect(productionCeiling(130, 100, 1.3)).toBe(0);
    expect(productionCeiling(200, 100, 1.3)).toBe(0);
  });
  it("returns 0 for a non-positive anchor (no band to produce into)", () => {
    expect(productionCeiling(10, 0, 1.3)).toBe(0);
  });
});
