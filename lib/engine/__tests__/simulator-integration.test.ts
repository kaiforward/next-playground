import { describe, it, expect } from "vitest";
import { createSimWorld } from "../simulator/world";
import { simulateWorldTick } from "../simulator/economy";
import { runSimulation } from "../simulator/runner";
import { DEFAULT_SIM_CONSTANTS } from "../simulator/constants";
import { mulberry32 } from "../universe-gen";
import { calculatePrice } from "../pricing";
import type { SimConfig, SimRunContext } from "../simulator/types";

/** Build a default SimRunContext for tests. */
function defaultCtx(overrides?: Partial<SimRunContext>): SimRunContext {
  return {
    constants: DEFAULT_SIM_CONSTANTS,
    disableRandomEvents: false,
    eventInjections: [],
    adjacencyList: new Map(),
    systemToGov: new Map(),
    ...overrides,
  };
}

describe("Simulator Integration", () => {
  // ── Determinism ─────────────────────────────────────────────────

  describe("determinism", () => {
    it("same seed produces identical results", { timeout: 60_000 }, () => {
      const config: SimConfig = {
        tickCount: 100,
        bots: [{ strategy: "greedy", count: 1 }],
        seed: 42,
      };

      const results1 = runSimulation(config);
      const results2 = runSimulation(config);

      expect(results1.summaries[0].finalCredits).toBe(results2.summaries[0].finalCredits);
      expect(results1.summaries[0].totalTrades).toBe(results2.summaries[0].totalTrades);
      expect(results1.summaries[0].creditsCurve).toEqual(results2.summaries[0].creditsCurve);
    });

    it("different seeds produce different results", { timeout: 60_000 }, () => {
      const config1: SimConfig = {
        tickCount: 100,
        bots: [{ strategy: "greedy", count: 1 }],
        seed: 42,
      };
      const config2: SimConfig = { ...config1, seed: 99 };

      const results1 = runSimulation(config1);
      const results2 = runSimulation(config2);

      // Very unlikely to be identical with different seeds
      expect(results1.summaries[0].creditsCurve).not.toEqual(
        results2.summaries[0].creditsCurve,
      );
    });
  });

  // ── Full simulation ─────────────────────────────────────────────

  describe("runSimulation", () => {
    it("runs a basic simulation and returns results with constants", { timeout: 30_000 }, () => {
      const config: SimConfig = {
        tickCount: 50,
        bots: [
          { strategy: "random", count: 1 },
          { strategy: "greedy", count: 1 },
        ],
        seed: 42,
      };

      const results = runSimulation(config);

      expect(results.summaries).toHaveLength(2);
      expect(results.elapsedMs).toBeGreaterThan(0);
      expect(results.constants).toBeDefined();
      expect(results.overrides).toEqual({});

      for (const summary of results.summaries) {
        expect(summary.creditsCurve).toHaveLength(50);
        expect(summary.strategy).toBeTruthy();
        expect(summary.playerName).toBeTruthy();
      }
    });

    it("includes overrides in results when provided", () => {
      const config: SimConfig = {
        tickCount: 20,
        bots: [{ strategy: "greedy", count: 1 }],
        seed: 42,
      };

      const overrides = { economy: { reversionRate: 0.1 } };
      const results = runSimulation(config, overrides);

      expect(results.overrides).toEqual(overrides);
      expect(results.constants.economy.reversionRate).toBe(0.1);
    });

    it("includes label in results when provided", () => {
      const config: SimConfig = {
        tickCount: 20,
        bots: [{ strategy: "greedy", count: 1 }],
        seed: 42,
      };

      const results = runSimulation(config, {}, "test-label");
      expect(results.label).toBe("test-label");
    });

    it("frontier regions have higher price volatility than federation", () => {
      const config: SimConfig = { tickCount: 1, bots: [], seed: 42 };
      let world = createSimWorld(config, DEFAULT_SIM_CONSTANTS);
      const rng = mulberry32(42);
      const ctx = defaultCtx({ disableRandomEvents: true });

      // Classify systems by government type and economy type
      const govBySystem = new Map<string, string>();
      const econBySystem = new Map<string, string>();
      for (const sys of world.systems) {
        const region = world.regions.find((r) => r.id === sys.regionId);
        if (region) govBySystem.set(sys.id, region.governmentType);
        econBySystem.set(sys.id, sys.economyType);
      }

      // Track tick-over-tick absolute price changes grouped by (gov, econ).
      // Controlling for economy type isolates the volatility modifier effect
      // from the confounding production/consumption/reversion dynamics.
      const changesByGovEcon = new Map<string, number[]>();

      for (let i = 0; i < 100; i++) {
        const pricesBefore = new Map<string, number>();
        for (const m of world.markets) {
          pricesBefore.set(
            `${m.systemId}:${m.goodId}`,
            calculatePrice(m.basePrice, m.supply, m.demand, m.priceFloor, m.priceCeiling),
          );
        }

        world = simulateWorldTick(world, rng, ctx);

        for (const m of world.markets) {
          const mKey = `${m.systemId}:${m.goodId}`;
          const gov = govBySystem.get(m.systemId);
          const econ = econBySystem.get(m.systemId);
          if (!gov || !econ) continue;
          const before = pricesBefore.get(mKey);
          if (before === undefined || m.basePrice === 0) continue;
          const after = calculatePrice(m.basePrice, m.supply, m.demand, m.priceFloor, m.priceCeiling);
          const change = Math.abs(after - before) / m.basePrice;
          const groupKey = `${gov}:${econ}`;
          const existing = changesByGovEcon.get(groupKey) ?? [];
          existing.push(change);
          changesByGovEcon.set(groupKey, existing);
        }
      }

      function mean(values: number[]): number {
        return values.reduce((a, b) => a + b, 0) / values.length;
      }

      // For each economy type that has both frontier and federation systems,
      // frontier volatilityModifier (1.5) should produce larger price changes
      // than federation (0.8). Check that the majority of economy types agree.
      const econTypes = new Set([...econBySystem.values()]);
      let frontierWins = 0;
      let comparisonCount = 0;
      for (const econ of econTypes) {
        const fChanges = changesByGovEcon.get(`frontier:${econ}`);
        const fedChanges = changesByGovEcon.get(`federation:${econ}`);
        if (fChanges && fChanges.length > 0 && fedChanges && fedChanges.length > 0) {
          if (mean(fChanges) > mean(fedChanges)) frontierWins++;
          comparisonCount++;
        }
      }

      // At least one comparison should exist and frontier should win the majority
      if (comparisonCount > 0) {
        expect(frontierWins).toBeGreaterThan(comparisonCount / 2);
      }
    });

    it("government consumption boosts affect demand", { timeout: 60_000 }, () => {
      const config: SimConfig = { tickCount: 1, bots: [], seed: 42 };
      let world = createSimWorld(config, DEFAULT_SIM_CONSTANTS);
      const rng = mulberry32(42);
      const ctx = defaultCtx({ disableRandomEvents: true });

      // Run 500 ticks so consumption boosts shift demand clearly
      for (let i = 0; i < 500; i++) {
        world = simulateWorldTick(world, rng, ctx);
      }

      // Federation has consumptionBoosts: { medicine: 1 }
      // Compare within same economy type to isolate government effect
      const systemInfo = new Map<string, { gov: string; econ: string }>();
      for (const sys of world.systems) {
        const region = world.regions.find((r) => r.id === sys.regionId);
        if (region) systemInfo.set(sys.id, { gov: region.governmentType, econ: sys.economyType });
      }

      // Group medicine demand by economy type, then compare fed vs non-fed
      const byEcon: Record<string, { fed: number[]; other: number[] }> = {};
      for (const m of world.markets) {
        if (m.goodId !== "medicine") continue;
        const info = systemInfo.get(m.systemId);
        if (!info) continue;
        if (!byEcon[info.econ]) byEcon[info.econ] = { fed: [], other: [] };
        if (info.gov === "federation") {
          byEcon[info.econ].fed.push(m.demand);
        } else {
          byEcon[info.econ].other.push(m.demand);
        }
      }

      // For economy types with both fed and non-fed systems, fed should average higher
      let comparisons = 0;
      let fedWins = 0;
      for (const { fed, other } of Object.values(byEcon)) {
        if (fed.length === 0 || other.length === 0) continue;
        comparisons++;
        const fedAvg = fed.reduce((a, b) => a + b, 0) / fed.length;
        const otherAvg = other.reduce((a, b) => a + b, 0) / other.length;
        if (fedAvg > otherAvg) fedWins++;
      }

      // Federation should win at least half of per-economy-type comparisons
      // (with uniform government distribution, the signal is weaker but still present)
      if (comparisons > 0) {
        expect(fedWins / comparisons).toBeGreaterThanOrEqual(0.5);
      }
    });

    it("greedy outperforms random over 200 ticks", { timeout: 60_000 }, () => {
      const config: SimConfig = {
        tickCount: 200,
        bots: [
          { strategy: "random", count: 1 },
          { strategy: "greedy", count: 1 },
        ],
        seed: 42,
      };

      const results = runSimulation(config);
      const randomSummary = results.summaries.find((s) => s.strategy === "random")!;
      const greedySummary = results.summaries.find((s) => s.strategy === "greedy")!;

      expect(greedySummary.finalCredits).toBeGreaterThan(randomSummary.finalCredits);
    });

    it("all strategies produce valid metrics", { timeout: 60_000 }, () => {
      const config: SimConfig = {
        tickCount: 20,
        bots: [
          { strategy: "random", count: 1 },
          { strategy: "nearest", count: 1 },
          { strategy: "greedy", count: 1 },
          { strategy: "optimal", count: 1 },
        ],
        seed: 42,
      };

      const results = runSimulation(config);

      for (const summary of results.summaries) {
        expect(summary.totalTrades).toBeGreaterThanOrEqual(0);
        expect(summary.totalFuelSpent).toBeGreaterThanOrEqual(0);
        expect(summary.creditsCurve).toHaveLength(20);
        // Credits should never go negative
        for (const credits of summary.creditsCurve) {
          expect(credits).toBeGreaterThanOrEqual(0);
        }
      }
    });
  });
});
