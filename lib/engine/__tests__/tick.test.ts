import { describe, it, expect } from "vitest";
import {
  simulateEconomyTick,
  buildMarketTickEntry,
  processShipArrivals,
  updateProsperity,
  getProsperityMultiplier,
  getProsperityLabel,
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
    const input = [entry({ productionRate: 10 })];
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

  it("ignores traits when computing production — they no longer grant a bonus", () => {
    const e = buildMarketTickEntry(
      {
        goodId: "food",
        stock: 100,
        volatility: 1,
        baseProductionRate: 10,
        baseConsumptionRate: undefined,
        govConsumptionBoost: 0,
        traits: [{ traitId: "precursor_ruins", quality: 3 }],
        prosperity: 1,
      },
      prosperityParams,
    );
    expect(e.productionRate).toBeCloseTo(13, 5);
  });

  it("folds the government consumption boost into a consumed good's rate", () => {
    const e = buildMarketTickEntry(
      {
        goodId: "food",
        stock: 100,
        volatility: 1,
        baseProductionRate: undefined,
        baseConsumptionRate: 10,
        govConsumptionBoost: 5,
        traits: [],
        prosperity: 0, // multAtZero = 0.7
      },
      prosperityParams,
    );
    expect(e.consumptionRate).toBeCloseTo((10 + 5) * 0.7, 5); // (base + boost) * mult
  });

  it("ignores a government boost on a good the system does not consume", () => {
    const e = buildMarketTickEntry(
      {
        goodId: "food",
        stock: 100,
        volatility: 1,
        baseProductionRate: undefined,
        baseConsumptionRate: undefined,
        govConsumptionBoost: 5,
        traits: [],
        prosperity: 0,
      },
      prosperityParams,
    );
    expect(e.consumptionRate).toBeUndefined(); // no base rate ⇒ boost cannot create consumption
  });

  it("leaves consumption undefined when there is no base rate and no boost", () => {
    const e = buildMarketTickEntry(
      {
        goodId: "food",
        stock: 100,
        volatility: 1,
        baseProductionRate: undefined,
        baseConsumptionRate: undefined,
        govConsumptionBoost: 0,
        traits: [],
        prosperity: 0,
      },
      prosperityParams,
    );
    expect(e.consumptionRate).toBeUndefined();
  });
});

// ── Prosperity system ───────────────────────────────────────────

describe("updateProsperity", () => {
  const params: ProsperityParams = {
    decayRate: 0.03, maxGain: 0.1, targetVolume: 50,
    min: -1, max: 1, multAtMin: 0.3, multAtZero: 0.7, multAtMax: 1.3,
  };

  it("gains from trade volume, capped at maxGain", () => {
    expect(updateProsperity(0, 50, params)).toBeCloseTo(0.1, 5); // full target → maxGain
    expect(updateProsperity(0, 500, params)).toBeCloseTo(0.1, 5); // 10× target still caps
    expect(updateProsperity(0, 25, params)).toBeCloseTo(0.05, 5); // half target → half gain
  });

  it("decays toward zero by at most decayRate, never overshooting", () => {
    expect(updateProsperity(0.5, 0, params)).toBeCloseTo(0.47, 5); // 0.5 − 0.03
    expect(updateProsperity(-0.5, 0, params)).toBeCloseTo(-0.47, 5); // pulls up toward 0
    expect(updateProsperity(0.02, 0, params)).toBeCloseTo(0, 5); // decay clipped to |current|
  });

  it("clamps the result to [min, max]", () => {
    expect(updateProsperity(0.98, 50, params)).toBe(1); // 0.98 − 0.03 + 0.1 = 1.05 → 1
  });
});

describe("getProsperityMultiplier", () => {
  const params: ProsperityParams = {
    decayRate: 0.03, maxGain: 0.1, targetVolume: 50,
    min: -1, max: 1, multAtMin: 0.3, multAtZero: 0.7, multAtMax: 1.3,
  };

  it("hits the anchor multipliers at -1, 0, +1", () => {
    expect(getProsperityMultiplier(-1, params)).toBeCloseTo(0.3, 5);
    expect(getProsperityMultiplier(0, params)).toBeCloseTo(0.7, 5);
    expect(getProsperityMultiplier(1, params)).toBeCloseTo(1.3, 5);
  });

  it("interpolates linearly within each half", () => {
    expect(getProsperityMultiplier(-0.5, params)).toBeCloseTo(0.5, 5); // midpoint of [0.3, 0.7]
    expect(getProsperityMultiplier(0.5, params)).toBeCloseTo(1.0, 5); // midpoint of [0.7, 1.3]
  });
});

describe("getProsperityLabel", () => {
  it("maps prosperity values to bands at their boundaries", () => {
    expect(getProsperityLabel(-0.6)).toBe("Crisis");
    expect(getProsperityLabel(-0.5)).toBe("Crisis"); // inclusive upper edge
    expect(getProsperityLabel(-0.3)).toBe("Disrupted");
    expect(getProsperityLabel(-0.1)).toBe("Disrupted");
    expect(getProsperityLabel(0)).toBe("Stagnant");
    expect(getProsperityLabel(0.3)).toBe("Stagnant");
    expect(getProsperityLabel(0.5)).toBe("Active");
    expect(getProsperityLabel(0.7)).toBe("Active");
    expect(getProsperityLabel(0.9)).toBe("Booming");
    expect(getProsperityLabel(1)).toBe("Booming");
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
