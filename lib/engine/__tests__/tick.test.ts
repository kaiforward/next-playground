import { describe, it, expect } from "vitest";
import {
  simulateEconomyTick,
  buildMarketTickEntry,
  processShipArrivals,
  selfLimitingFactor,
  outputUptake,
  type MarketTickEntry,
  type EconomySimParams,
} from "../tick";

const PARAMS: EconomySimParams = {
  noiseFraction: 0, // deterministic: no noise unless a test opts in
  holdCover: 1.3,
};

function entry(over: Partial<MarketTickEntry>): MarketTickEntry {
  return {
    goodId: "food",
    stock: 100,
    minStock: 5,
    targetStock: 100,
    maxStock: 200,
    ...over,
  };
}

describe("simulateEconomyTick — production", () => {
  it("raises stock for a producer, self-limiting near the ceiling", () => {
    const mid = simulateEconomyTick([entry({ productionRate: 10, stock: 100 })], PARAMS);
    expect(mid[0].stock).toBeGreaterThan(100);
    const high = simulateEconomyTick([entry({ productionRate: 10, stock: 199 })], PARAMS);
    expect(high[0].stock - 199).toBeLessThan(mid[0].stock - 100); // slows near MAX
    expect(high[0].stock).toBeLessThanOrEqual(200); // clamped
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

describe("simulateEconomyTick — anchor-relative consumption", () => {
  it("consumes at the full nominal rate once stock is at/above the anchor", () => {
    // targetStock 100: consume factor = 1 at the anchor and above (clamped).
    const atAnchor = simulateEconomyTick([entry({ consumptionRate: 10, stock: 100 })], PARAMS);
    expect(100 - atAnchor[0].stock).toBeCloseTo(10, 5);

    const above = simulateEconomyTick([entry({ consumptionRate: 10, stock: 150 })], PARAMS);
    expect(150 - above[0].stock).toBeCloseTo(10, 5);
  });
});

describe("simulateEconomyTick — consumption", () => {
  it("lowers stock for a consumer, self-limiting near the floor", () => {
    const mid = simulateEconomyTick([entry({ consumptionRate: 10, stock: 100 })], PARAMS);
    expect(mid[0].stock).toBeLessThan(100);
    const low = simulateEconomyTick([entry({ consumptionRate: 10, stock: 6 })], PARAMS);
    expect(low[0].stock).toBeGreaterThanOrEqual(5); // clamped at MIN
  });

  it("applies event consumption multipliers", () => {
    const base = simulateEconomyTick([entry({ consumptionRate: 10, stock: 100 })], PARAMS);
    const boosted = simulateEconomyTick([entry({ consumptionRate: 10, consumptionMult: 2, stock: 100 })], PARAMS);
    expect(100 - boosted[0].stock).toBeGreaterThan(100 - base[0].stock);
  });
});

describe("simulateEconomyTick — noise", () => {
  it("perturbs stock within the band when noiseFraction > 0", () => {
    const out = simulateEconomyTick(
      [entry({ stock: 100, volatility: 1 })],
      { noiseFraction: 0.1, holdCover: 1.3 }, // 10% of band width (195) = 19.5 per tick
      () => 1, // rng=1 -> +full noise
    );
    expect(out[0].stock).toBeGreaterThan(100);
    expect(out[0].stock).toBeLessThanOrEqual(200);
  });

  it("does not mutate the input array", () => {
    const input = [entry({ productionRate: 10 })];
    const snapshot = input[0].stock;
    simulateEconomyTick(input, PARAMS);
    expect(input[0].stock).toBe(snapshot);
  });
});

describe("buildMarketTickEntry", () => {
  const BASE_BAND = { minStock: 5, targetStock: 100, maxStock: 200 };

  it("passes through the base production rate unmodified", () => {
    const e = buildMarketTickEntry({
      goodId: "food",
      stock: 100,
      ...BASE_BAND,
      volatility: 1,
      baseProductionRate: 10,
      baseConsumptionRate: undefined,
      govConsumptionBoost: 0,
      traits: [],
    });
    expect(e.productionRate).toBeCloseTo(10, 5);
    expect(e.stock).toBe(100);
    expect(e.minStock).toBe(5);
    expect(e.maxStock).toBe(200);
  });

  it("ignores traits when computing production — they no longer grant a bonus", () => {
    const e = buildMarketTickEntry({
      goodId: "food",
      stock: 100,
      ...BASE_BAND,
      volatility: 1,
      baseProductionRate: 10,
      baseConsumptionRate: undefined,
      govConsumptionBoost: 0,
      traits: [{ traitId: "precursor_ruins", quality: 3 }],
    });
    expect(e.productionRate).toBeCloseTo(10, 5);
  });

  it("folds the government consumption boost into a consumed good's rate", () => {
    const e = buildMarketTickEntry({
      goodId: "food",
      stock: 100,
      ...BASE_BAND,
      volatility: 1,
      baseProductionRate: undefined,
      baseConsumptionRate: 10,
      govConsumptionBoost: 5,
      traits: [],
    });
    expect(e.consumptionRate).toBeCloseTo(10 + 5, 5); // base + boost
  });

  it("ignores a government boost on a good the system does not consume", () => {
    const e = buildMarketTickEntry({
      goodId: "food",
      stock: 100,
      ...BASE_BAND,
      volatility: 1,
      baseProductionRate: undefined,
      baseConsumptionRate: undefined,
      govConsumptionBoost: 5,
      traits: [],
    });
    expect(e.consumptionRate).toBeUndefined(); // no base rate ⇒ boost cannot create consumption
  });

  it("leaves consumption undefined when there is no base rate and no boost", () => {
    const e = buildMarketTickEntry({
      goodId: "food",
      stock: 100,
      ...BASE_BAND,
      volatility: 1,
      baseProductionRate: undefined,
      baseConsumptionRate: undefined,
      govConsumptionBoost: 0,
      traits: [],
    });
    expect(e.consumptionRate).toBeUndefined();
  });
});

// ── selfLimitingFactor ───────────────────────────────────────────

describe("selfLimitingFactor", () => {
  const MIN = 5;
  const MAX = 105;

  it("returns 0 when min === max (degenerate range)", () => {
    expect(selfLimitingFactor(50, 50, 50, "produce")).toBe(0);
    expect(selfLimitingFactor(50, 50, 50, "consume")).toBe(0);
  });

  it("consume: returns 0 at the floor (value === min)", () => {
    expect(selfLimitingFactor(MIN, MIN, MAX, "consume")).toBe(0);
  });

  it("consume: returns 1 at the ceiling (value === max)", () => {
    expect(selfLimitingFactor(MAX, MIN, MAX, "consume")).toBe(1);
  });

  it("produce: returns 0 at the ceiling (value === max)", () => {
    expect(selfLimitingFactor(MAX, MIN, MAX, "produce")).toBe(0);
  });

  it("produce: returns 1 at the floor (value === min)", () => {
    expect(selfLimitingFactor(MIN, MIN, MAX, "produce")).toBe(1);
  });

  it("produce and consume branches differ at mid-range value", () => {
    const mid = (MIN + MAX) / 2;
    const p = selfLimitingFactor(mid, MIN, MAX, "produce");
    const c = selfLimitingFactor(mid, MIN, MAX, "consume");
    // At the exact midpoint both branches collapse to the same sqrt(0.5).
    expect(p).toBeCloseTo(Math.sqrt(0.5), 6);
    expect(c).toBeCloseTo(Math.sqrt(0.5), 6);
    // Off-midpoint they diverge: produce reads remaining headroom, consume reads fill.
    const offMid = MIN + (MAX - MIN) * 0.3;
    const pOff = selfLimitingFactor(offMid, MIN, MAX, "produce"); // headroom 0.7 → sqrt(0.7)
    const cOff = selfLimitingFactor(offMid, MIN, MAX, "consume"); // fill 0.3 → sqrt(0.3)
    expect(pOff).toBeCloseTo(Math.sqrt(0.7), 6);
    expect(cOff).toBeCloseTo(Math.sqrt(0.3), 6);
    expect(pOff).toBeGreaterThan(cOff);
  });

  it("clamps gracefully when value is below min (consume returns 0)", () => {
    expect(selfLimitingFactor(MIN - 10, MIN, MAX, "consume")).toBe(0);
  });

  it("clamps gracefully when value is above max (produce returns 0)", () => {
    expect(selfLimitingFactor(MAX + 10, MIN, MAX, "produce")).toBe(0);
  });

  it("clamps gracefully when value is below min (produce returns 1)", () => {
    expect(selfLimitingFactor(MIN - 10, MIN, MAX, "produce")).toBe(1);
  });

  it("clamps gracefully when value is above max (consume returns 1)", () => {
    expect(selfLimitingFactor(MAX + 10, MIN, MAX, "consume")).toBe(1);
  });
});

// ── Per-entry band: relative noise + per-entry self-limiting ────

describe("simulateEconomyTick — per-entry band", () => {
  it("clamps to the per-entry band and scales noise to band width", () => {
    const e = { goodId: "ore", stock: 50, minStock: 10, targetStock: 50, maxStock: 90, productionRate: 0, consumptionRate: 0 };
    const high = simulateEconomyTick([e], { noiseFraction: 0.02, holdCover: 1.3 }, () => 1)[0]; // +max noise
    expect(high.stock).toBeLessThanOrEqual(90);
    expect(high.stock).toBeCloseTo(51.6, 5); // band-width-scaled: (1*2-1)*0.02*80 = +1.6, not ±3
  });

  it("self-limiting uses the entry's own min/max", () => {
    expect(selfLimitingFactor(10, 10, 90, "consume")).toBe(0); // at floor → no consumption
    expect(selfLimitingFactor(90, 10, 90, "produce")).toBe(0); // at ceiling → no production
  });

  it("clamps stock to per-entry minStock when noise would push it below", () => {
    const e = { goodId: "ore", stock: 10, minStock: 10, targetStock: 50, maxStock: 90, productionRate: 0, consumptionRate: 0 };
    const low = simulateEconomyTick([e], { noiseFraction: 0.02, holdCover: 1.3 }, () => 0)[0]; // -max noise
    expect(low.stock).toBeGreaterThanOrEqual(10);
  });

  it("clamps stock to per-entry maxStock when noise would push it above", () => {
    const e = { goodId: "ore", stock: 90, minStock: 10, targetStock: 50, maxStock: 90, productionRate: 0, consumptionRate: 0 };
    const high = simulateEconomyTick([e], { noiseFraction: 0.02, holdCover: 1.3 }, () => 1)[0]; // +max noise
    expect(high.stock).toBeLessThanOrEqual(90);
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

describe("outputUptake (seller-side stock signal)", () => {
  it("is ~1 at the floor (selling freely) and ~0 at the ceiling (piling up)", () => {
    expect(outputUptake(10, 10, 100)).toBeCloseTo(1, 6);
    expect(outputUptake(100, 10, 100)).toBeCloseTo(0, 6);
  });
  it("mirrors the produce self-limiting factor exactly", () => {
    expect(outputUptake(40, 10, 100)).toBeCloseTo(selfLimitingFactor(40, 10, 100, "produce"), 6);
  });
  it("returns 0 for a degenerate zero-width band", () => {
    expect(outputUptake(5, 5, 5)).toBe(0);
  });
});
