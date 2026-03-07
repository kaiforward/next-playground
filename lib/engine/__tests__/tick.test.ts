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
    economyType: "extraction",
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
    // Self-limiting sqrt curve: production scales by sqrt((max-supply)/range),
    // consumption scales by sqrt((supply-min)/range). range = 200 - 5 = 195.

    it("producers increase supply by scaled productionRate", () => {
      // At equilibrium (supply=120, target=120): reversion=0, noise=0
      // prodScale = sqrt((200-120)/195) ≈ 0.6405
      // scaledProduction = 3 * 0.6405 ≈ 1.9215
      const entry = makeEntry({
        supply: 120,
        demand: 40,
        produces: ["ore"],
      });
      const [result] = simulateEconomyTick([entry], defaultParams, zeroNoiseRng);
      const prodScale = Math.sqrt((200 - 120) / 195);
      expect(result.supply).toBeCloseTo(120 + 3 * prodScale, 5);
    });

    it("producers do not affect demand", () => {
      const entry = makeEntry({
        supply: 120,
        demand: 40,
        produces: ["ore"],
      });
      const [result] = simulateEconomyTick([entry], defaultParams, zeroNoiseRng);
      expect(result.demand).toBe(40);
    });

    it("consumers decrease supply by scaled consumptionRate", () => {
      // At equilibrium (supply=40, target=40): reversion=0, noise=0
      // consScale = sqrt((40-5)/195) ≈ 0.4237
      // scaledConsumption = 2 * 0.4237 ≈ 0.8474
      const entry = makeEntry({
        supply: 40,
        demand: 120,
        consumes: ["ore"],
      });
      const [result] = simulateEconomyTick([entry], defaultParams, zeroNoiseRng);
      const consScale = Math.sqrt((40 - 5) / 195);
      expect(result.supply).toBeCloseTo(40 - 2 * consScale, 5);
    });

    it("consumers do not affect demand", () => {
      const entry = makeEntry({
        supply: 40,
        demand: 120,
        consumes: ["ore"],
      });
      const [result] = simulateEconomyTick([entry], defaultParams, zeroNoiseRng);
      expect(result.demand).toBe(120);
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

  describe("per-good equilibrium overrides", () => {
    it("uses equilibriumProduces when present", () => {
      // Custom target: supply=80, demand=60 (instead of global 120/40)
      const entry = makeEntry({
        supply: 80,
        demand: 60,
        produces: ["ore"],
        equilibriumProduces: { supply: 80, demand: 60 },
      });
      const [result] = simulateEconomyTick([entry], defaultParams, zeroNoiseRng);
      // At custom equilibrium: reversion = 0, only production effect
      // prodScale = sqrt((200-80)/195) ≈ 0.7845, scaledProduction = 3 * 0.7845 ≈ 2.3534
      const prodScale = Math.sqrt((200 - 80) / 195);
      expect(result.supply).toBeCloseTo(80 + 3 * prodScale, 5);
      // Demand unchanged — production only affects supply
      expect(result.demand).toBe(60);
    });

    it("uses equilibriumConsumes when present", () => {
      // Custom target: supply=50, demand=100 (instead of global 40/120)
      const entry = makeEntry({
        supply: 50,
        demand: 100,
        consumes: ["ore"],
        equilibriumConsumes: { supply: 50, demand: 100 },
      });
      const [result] = simulateEconomyTick([entry], defaultParams, zeroNoiseRng);
      // At custom equilibrium: reversion = 0, only consumption effect
      // consScale = sqrt((50-5)/195) ≈ 0.4804, scaledConsumption = 2 * 0.4804 ≈ 0.9608
      const consScale = Math.sqrt((50 - 5) / 195);
      expect(result.supply).toBeCloseTo(50 - 2 * consScale, 5);
      // demand: 100 + round(0.9608*0.5) = 100 + round(0.4804) = 100 + 0 = 100
      expect(result.demand).toBe(100);
    });

    it("falls back to global equilibrium when per-good not set", () => {
      const withOverride = makeEntry({
        supply: 60, demand: 60, produces: ["ore"],
        equilibriumProduces: { supply: 120, demand: 40 },
      });
      const withoutOverride = makeEntry({
        supply: 60, demand: 60, produces: ["ore"],
      });
      const rng1 = sequenceRng([0.5, 0.5]);
      const rng2 = sequenceRng([0.5, 0.5]);
      const [r1] = simulateEconomyTick([withOverride], defaultParams, rng1);
      const [r2] = simulateEconomyTick([withoutOverride], defaultParams, rng2);
      // Both use the same target (120/40) so results match
      expect(r1.supply).toBe(r2.supply);
      expect(r1.demand).toBe(r2.demand);
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

// ── Modifier integration ────────────────────────────────────────

describe("modifier integration", () => {
  it("scales supply target via supplyTargetMult", () => {
    // Neutral entry: base target supply=60. Mult ×2.0 → effective target 120.
    // Supply at 60, reversion pulls toward 120: (120-60)*0.05 = +3
    const entry = makeEntry({ supply: 60, demand: 60, supplyTargetMult: 2.0 });
    const [result] = simulateEconomyTick([entry], defaultParams, zeroNoiseRng);
    // Without mult: (60-60)*0.05 = 0, supply stays at 60
    // With mult: (120-60)*0.05 = +3, supply becomes 63
    expect(result.supply).toBe(63);
  });

  it("scales demand target via demandTargetMult", () => {
    const entry = makeEntry({ supply: 60, demand: 60, demandTargetMult: 2.0 });
    const [result] = simulateEconomyTick([entry], defaultParams, zeroNoiseRng);
    // demand target: 60 × 2.0 = 120. reversion: (120-60)*0.05 = +3 → 63
    expect(result.demand).toBe(63);
  });

  it("scales production via productionMult", () => {
    // Producer at equilibrium: supply=120, target=120
    // prodScale = sqrt((200-120)/195) ≈ 0.6405
    // productionMult=0.5 → effective = 3 * 0.5 = 1.5, scaled = 1.5 * 0.6405 ≈ 0.9608
    const entry = makeEntry({
      supply: 120, demand: 40,
      produces: ["ore"],
      productionMult: 0.5,
    });
    const [result] = simulateEconomyTick([entry], defaultParams, zeroNoiseRng);
    const prodScale = Math.sqrt((200 - 120) / 195);
    expect(result.supply).toBeCloseTo(120 + 3 * 0.5 * prodScale, 5);
    // With full production (no mult): scaled = 3 * 0.6405 ≈ 1.9215
    const [full] = simulateEconomyTick(
      [makeEntry({ supply: 120, demand: 40, produces: ["ore"] })],
      defaultParams,
      zeroNoiseRng,
    );
    expect(full.supply).toBeCloseTo(120 + 3 * prodScale, 5);
    expect(result.supply).toBeLessThan(full.supply);
  });

  it("scales consumption via consumptionMult", () => {
    // consScale = sqrt((40-5)/195) ≈ 0.4237
    // consumptionMult=0.5 → effective = 2 * 0.5 = 1, scaled = 1 * 0.4237 ≈ 0.4237
    const entry = makeEntry({
      supply: 40, demand: 120,
      consumes: ["ore"],
      consumptionMult: 0.5,
    });
    const [result] = simulateEconomyTick([entry], defaultParams, zeroNoiseRng);
    const consScale = Math.sqrt((40 - 5) / 195);
    expect(result.supply).toBeCloseTo(40 - 2 * 0.5 * consScale, 5);
    // Without mult: scaled = 2 * 0.4237 ≈ 0.8474
    const [full] = simulateEconomyTick(
      [makeEntry({ supply: 40, demand: 120, consumes: ["ore"] })],
      defaultParams,
      zeroNoiseRng,
    );
    expect(full.supply).toBeCloseTo(40 - 2 * consScale, 5);
    expect(result.supply).toBeGreaterThan(full.supply);
  });

  it("dampens reversion via reversionMult", () => {
    // Supply=100, target=60. Normal reversion: (60-100)*0.05 = -2 → 98
    // With reversionMult=0.5: (60-100)*(0.05*0.5) = -1 → 99
    const entry = makeEntry({ supply: 100, demand: 60, reversionMult: 0.5 });
    const [result] = simulateEconomyTick([entry], defaultParams, zeroNoiseRng);
    expect(result.supply).toBe(99);

    // Without dampening: supply should be 98
    const [nodamp] = simulateEconomyTick(
      [makeEntry({ supply: 100, demand: 60 })],
      defaultParams,
      zeroNoiseRng,
    );
    expect(nodamp.supply).toBe(98);
  });

  it("defaults produce identical results to no modifiers", () => {
    const plain = makeEntry({ supply: 80, demand: 50, produces: ["ore"] });
    const withDefaults = makeEntry({
      supply: 80, demand: 50, produces: ["ore"],
      supplyTargetMult: 1,
      demandTargetMult: 1,
      productionMult: 1.0,
      consumptionMult: 1.0,
      reversionMult: 1.0,
    });
    const rng1 = sequenceRng([0.3, 0.7]);
    const rng2 = sequenceRng([0.3, 0.7]);
    const [r1] = simulateEconomyTick([plain], defaultParams, rng1);
    const [r2] = simulateEconomyTick([withDefaults], defaultParams, rng2);
    expect(r1.supply).toBe(r2.supply);
    expect(r1.demand).toBe(r2.demand);
  });

  it("combined modifiers converge toward scaled equilibrium", () => {
    // Large demand multiplier + dampened reversion: run many ticks
    let entries = [makeEntry({
      supply: 60, demand: 60,
      demandTargetMult: 2.0, // target demand: 60 × 2.0 = 120
      reversionMult: 0.5,
    })];
    for (let i = 0; i < 200; i++) {
      entries = simulateEconomyTick(entries, defaultParams, zeroNoiseRng);
      // Re-apply modifiers each tick (they persist)
      entries = entries.map((e) => ({
        ...e,
        demandTargetMult: 2.0,
        reversionMult: 0.5,
      }));
    }
    // Demand should have converged toward 120
    expect(entries[0].demand).toBeGreaterThan(100);
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
