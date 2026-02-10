import { describe, it, expect } from "vitest";
import {
  simulateEconomyTick,
  processShipArrivals,
  type MarketTickEntry,
  type EconomySimParams,
} from "../tick";

// ── Test helpers ────────────────────────────────────────────────

/** Deterministic RNG that always returns 0.5 (zero noise). */
const zeroNoiseRng = () => 0.5;

/** Deterministic RNG returning a fixed sequence. */
function sequenceRng(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

const defaultParams: EconomySimParams = {
  reversionRate: 0.05,
  noiseAmplitude: 3,
  minLevel: 5,
  maxLevel: 200,
  productionRate: 3,
  consumptionRate: 2,
  equilibrium: {
    produces: { supply: 120, demand: 40 },
    consumes: { supply: 40, demand: 120 },
    neutral: { supply: 60, demand: 60 },
  },
};

function makeEntry(overrides: Partial<MarketTickEntry> = {}): MarketTickEntry {
  return {
    goodId: "ore",
    supply: 60,
    demand: 60,
    basePrice: 30,
    economyType: "mining",
    produces: [],
    consumes: [],
    ...overrides,
  };
}

// ── simulateEconomyTick ─────────────────────────────────────────

describe("simulateEconomyTick", () => {
  it("does not mutate the input array", () => {
    const entries = [makeEntry()];
    const original = JSON.parse(JSON.stringify(entries));
    simulateEconomyTick(entries, defaultParams, zeroNoiseRng);
    expect(entries).toEqual(original);
  });

  it("returns same length as input", () => {
    const entries = [makeEntry(), makeEntry(), makeEntry()];
    const result = simulateEconomyTick(entries, defaultParams, zeroNoiseRng);
    expect(result).toHaveLength(3);
  });

  describe("mean reversion", () => {
    it("pulls supply toward neutral target when above", () => {
      // supply=100, target=60 → reversion = (60-100)*0.05 = -2
      const entry = makeEntry({ supply: 100, demand: 60 });
      const [result] = simulateEconomyTick([entry], defaultParams, zeroNoiseRng);
      expect(result.supply).toBeLessThan(100);
    });

    it("pulls supply toward neutral target when below", () => {
      // supply=30, target=60 → reversion = (60-30)*0.05 = +1.5
      const entry = makeEntry({ supply: 30, demand: 60 });
      const [result] = simulateEconomyTick([entry], defaultParams, zeroNoiseRng);
      expect(result.supply).toBeGreaterThan(30);
    });

    it("pulls demand toward neutral target when above", () => {
      const entry = makeEntry({ supply: 60, demand: 100 });
      const [result] = simulateEconomyTick([entry], defaultParams, zeroNoiseRng);
      expect(result.demand).toBeLessThan(100);
    });

    it("uses producer equilibrium targets for produced goods", () => {
      // Producer: target supply=120. Current supply=60.
      // reversion = (120-60)*0.05 = +3, plus productionRate=+3 → supply increases significantly
      const entry = makeEntry({
        supply: 60,
        demand: 60,
        produces: ["ore"],
      });
      const [result] = simulateEconomyTick([entry], defaultParams, zeroNoiseRng);
      // Supply should move toward 120 + production boost
      expect(result.supply).toBeGreaterThan(60);
      // Demand should move toward 40 - production demand reduction
      expect(result.demand).toBeLessThan(60);
    });

    it("uses consumer equilibrium targets for consumed goods", () => {
      // Consumer: target supply=40. Current supply=60.
      // reversion = (40-60)*0.05 = -1, minus consumptionRate=2 → supply drops
      const entry = makeEntry({
        supply: 60,
        demand: 60,
        consumes: ["ore"],
      });
      const [result] = simulateEconomyTick([entry], defaultParams, zeroNoiseRng);
      expect(result.supply).toBeLessThan(60);
      expect(result.demand).toBeGreaterThan(60);
    });
  });

  describe("production and consumption effects", () => {
    it("producers increase supply by productionRate", () => {
      // At equilibrium (supply=120, target=120): reversion=0, noise=0
      // Only production effect: +3 supply
      const entry = makeEntry({
        supply: 120,
        demand: 40,
        produces: ["ore"],
      });
      const [result] = simulateEconomyTick([entry], defaultParams, zeroNoiseRng);
      expect(result.supply).toBe(123); // 120 + 0 reversion + 0 noise + 3 production
    });

    it("producers slightly reduce demand", () => {
      const entry = makeEntry({
        supply: 120,
        demand: 40,
        produces: ["ore"],
      });
      const [result] = simulateEconomyTick([entry], defaultParams, zeroNoiseRng);
      // demand: 40 + 0 reversion + 0 noise - round(3*0.3)=1 → 39
      expect(result.demand).toBe(39);
    });

    it("consumers decrease supply by consumptionRate", () => {
      const entry = makeEntry({
        supply: 40,
        demand: 120,
        consumes: ["ore"],
      });
      const [result] = simulateEconomyTick([entry], defaultParams, zeroNoiseRng);
      // supply: 40 + 0 reversion + 0 noise - 2 consumption → 38
      expect(result.supply).toBe(38);
    });

    it("consumers increase demand", () => {
      const entry = makeEntry({
        supply: 40,
        demand: 120,
        consumes: ["ore"],
      });
      const [result] = simulateEconomyTick([entry], defaultParams, zeroNoiseRng);
      // demand: 120 + 0 reversion + 0 noise + round(2*0.5)=1 → 121
      expect(result.demand).toBe(121);
    });
  });

  describe("clamping", () => {
    it("clamps supply to minLevel", () => {
      const entry = makeEntry({ supply: 5, consumes: ["ore"] });
      const [result] = simulateEconomyTick([entry], defaultParams, zeroNoiseRng);
      expect(result.supply).toBeGreaterThanOrEqual(defaultParams.minLevel);
    });

    it("clamps supply to maxLevel", () => {
      const entry = makeEntry({ supply: 200, produces: ["ore"] });
      const [result] = simulateEconomyTick([entry], defaultParams, zeroNoiseRng);
      expect(result.supply).toBeLessThanOrEqual(defaultParams.maxLevel);
    });

    it("clamps demand to minLevel", () => {
      const entry = makeEntry({ demand: 5, produces: ["ore"] });
      const [result] = simulateEconomyTick([entry], defaultParams, zeroNoiseRng);
      expect(result.demand).toBeGreaterThanOrEqual(defaultParams.minLevel);
    });

    it("clamps demand to maxLevel", () => {
      const entry = makeEntry({ demand: 200, consumes: ["ore"] });
      const [result] = simulateEconomyTick([entry], defaultParams, zeroNoiseRng);
      expect(result.demand).toBeLessThanOrEqual(defaultParams.maxLevel);
    });
  });

  describe("noise", () => {
    it("applies noise from the RNG", () => {
      // rng returning 0 → noise = (0*2-1)*3 = -3
      // rng returning 1 → noise = (1*2-1)*3 = +3
      const entry = makeEntry({ supply: 60, demand: 60 });

      // All-zero RNG: noise = -3 for both supply and demand
      const [lowResult] = simulateEconomyTick([entry], defaultParams, () => 0);
      // All-one RNG: noise = +3
      const [highResult] = simulateEconomyTick([entry], defaultParams, () => 1);

      expect(highResult.supply).toBeGreaterThan(lowResult.supply);
      expect(highResult.demand).toBeGreaterThan(lowResult.demand);
    });

    it("is deterministic with a fixed RNG", () => {
      const entry = makeEntry({ supply: 80, demand: 50, produces: ["ore"] });
      const rng1 = sequenceRng([0.2, 0.7, 0.3, 0.9]);
      const rng2 = sequenceRng([0.2, 0.7, 0.3, 0.9]);
      const r1 = simulateEconomyTick([entry, entry], defaultParams, rng1);
      const r2 = simulateEconomyTick([entry, entry], defaultParams, rng2);
      expect(r1).toEqual(r2);
    });
  });

  describe("convergence", () => {
    it("converges toward equilibrium over many ticks", () => {
      // Start far from producer equilibrium, run 200 ticks with zero noise
      let entries = [makeEntry({ supply: 60, demand: 100, produces: ["ore"] })];
      for (let i = 0; i < 200; i++) {
        entries = simulateEconomyTick(entries, defaultParams, zeroNoiseRng);
      }
      // Should be near producer equilibrium (120, 40) ± production overshoot
      // Supply should be well above 100 (toward 120+)
      expect(entries[0].supply).toBeGreaterThan(100);
      // Demand should be well below 60 (toward 40-)
      expect(entries[0].demand).toBeLessThan(60);
    });
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
