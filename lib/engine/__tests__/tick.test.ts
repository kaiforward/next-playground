import { describe, it, expect } from "vitest";
import {
  simulateEconomyTick,
  buildMarketTickEntry,
  processShipArrivals,
  type MarketTickEntry,
  type EconomySimParams,
  type ProsperityParams,
} from "../tick";

const PARAMS: EconomySimParams = {
  noiseAmplitude: 0, // deterministic: no noise unless a test opts in
  minLevel: 5,
  maxLevel: 200,
};

function entry(over: Partial<MarketTickEntry>): MarketTickEntry {
  return {
    goodId: "food",
    stock: 100,
    economyType: "agricultural",
    produces: [],
    consumes: [],
    ...over,
  };
}

describe("simulateEconomyTick — production", () => {
  it("raises stock for a producer, self-limiting near the ceiling", () => {
    const mid = simulateEconomyTick([entry({ produces: ["food"], productionRate: 10, stock: 100 })], PARAMS);
    expect(mid[0].stock).toBeGreaterThan(100);
    const high = simulateEconomyTick([entry({ produces: ["food"], productionRate: 10, stock: 199 })], PARAMS);
    expect(high[0].stock - 199).toBeLessThan(mid[0].stock - 100); // slows near MAX
    expect(high[0].stock).toBeLessThanOrEqual(200); // clamped
  });

  it("does nothing for a good the system does not produce", () => {
    const out = simulateEconomyTick([entry({ produces: ["water"], productionRate: 10, stock: 100 })], PARAMS);
    expect(out[0].stock).toBe(100);
  });

  it("applies event production multipliers", () => {
    const base = simulateEconomyTick([entry({ produces: ["food"], productionRate: 10, stock: 100 })], PARAMS);
    const boosted = simulateEconomyTick([entry({ produces: ["food"], productionRate: 10, productionMult: 2, stock: 100 })], PARAMS);
    expect(boosted[0].stock - 100).toBeGreaterThan(base[0].stock - 100);
  });
});

describe("simulateEconomyTick — consumption", () => {
  it("lowers stock for a consumer, self-limiting near the floor", () => {
    const mid = simulateEconomyTick([entry({ consumes: ["food"], consumptionRate: 10, stock: 100 })], PARAMS);
    expect(mid[0].stock).toBeLessThan(100);
    const low = simulateEconomyTick([entry({ consumes: ["food"], consumptionRate: 10, stock: 6 })], PARAMS);
    expect(low[0].stock).toBeGreaterThanOrEqual(5); // clamped at MIN
  });
});

describe("simulateEconomyTick — noise", () => {
  it("perturbs stock within the band when amplitude > 0", () => {
    const out = simulateEconomyTick(
      [entry({ stock: 100, volatility: 1 })],
      { ...PARAMS, noiseAmplitude: 3 },
      () => 1, // rng=1 -> +full amplitude
    );
    expect(out[0].stock).toBeGreaterThan(100);
    expect(out[0].stock).toBeLessThanOrEqual(200);
  });

  it("does not mutate the input array", () => {
    const input = [entry({ produces: ["food"], productionRate: 10 })];
    const snapshot = input[0].stock;
    simulateEconomyTick(input, PARAMS);
    expect(input[0].stock).toBe(snapshot);
  });
});

describe("buildMarketTickEntry", () => {
  const prosperityParams: ProsperityParams = {
    decayRate: 0.03, maxGain: 0.1, targetVolume: 50,
    min: -1, max: 1, multAtMin: 0.3, multAtZero: 0.7, multAtMax: 1.3,
  };

  it("scales production and consumption by the prosperity multiplier", () => {
    const e = buildMarketTickEntry(
      {
        goodId: "food",
        stock: 100,
        economyType: "agricultural",
        produces: ["food"],
        consumes: [],
        volatility: 1,
        baseProductionRate: 10,
        baseConsumptionRate: undefined,
        govConsumptionBoost: 0,
        traits: [],
        prosperity: 1, // multAtMax = 1.3
      },
      prosperityParams,
    );
    expect(e.productionRate).toBeCloseTo(13, 5); // 10 * 1.3
    expect(e.stock).toBe(100);
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
