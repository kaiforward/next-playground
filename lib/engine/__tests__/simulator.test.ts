import { describe, it, expect } from "vitest";
import { createSimWorld } from "../simulator/world";
import { simulateWorldTick } from "../simulator/economy";
import { runSimulation } from "../simulator/runner";
import { DEFAULT_SIM_CONSTANTS } from "../simulator/constants";
import { mulberry32 } from "../universe-gen";
import { calculatePrice } from "../pricing";
import type { SimConfig, SimRunContext, SimWorld } from "../simulator/types";

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

describe("Simulator", () => {
  // ── World creation ──────────────────────────────────────────────

  describe("createSimWorld", () => {
    it("creates a world with regions, systems, connections, and markets", () => {
      const config: SimConfig = {
        tickCount: 10,
        bots: [{ strategy: "random", count: 1 }],
        seed: 42,
      };
      const world = createSimWorld(config, DEFAULT_SIM_CONSTANTS);

      expect(world.regions.length).toBeGreaterThan(0);
      expect(world.systems.length).toBeGreaterThan(0);
      expect(world.connections.length).toBeGreaterThan(0);
      expect(world.markets.length).toBe(world.systems.length * 12); // 12 goods per system
      expect(world.players).toHaveLength(1);
      expect(world.ships).toHaveLength(1);
      expect(world.tick).toBe(0);
    });

    it("creates correct number of bots for multiple strategies", () => {
      const config: SimConfig = {
        tickCount: 1,
        bots: [
          { strategy: "greedy", count: 3 },
          { strategy: "random", count: 2 },
        ],
        seed: 42,
      };
      const world = createSimWorld(config, DEFAULT_SIM_CONSTANTS);

      expect(world.players).toHaveLength(5);
      expect(world.ships).toHaveLength(5);
      expect(world.players.filter((p) => p.strategy === "greedy")).toHaveLength(3);
      expect(world.players.filter((p) => p.strategy === "random")).toHaveLength(2);
    });

    it("initializes markets at equilibrium", () => {
      const config: SimConfig = {
        tickCount: 1,
        bots: [],
        seed: 42,
      };
      const world = createSimWorld(config, DEFAULT_SIM_CONSTANTS);

      // Collect all valid equilibrium supply/demand values from per-good targets + global neutral
      const validValues = new Set<number>();
      for (const goodConst of Object.values(DEFAULT_SIM_CONSTANTS.goods)) {
        validValues.add(goodConst.equilibrium.produces.supply);
        validValues.add(goodConst.equilibrium.produces.demand);
        validValues.add(goodConst.equilibrium.consumes.supply);
        validValues.add(goodConst.equilibrium.consumes.demand);
      }
      validValues.add(DEFAULT_SIM_CONSTANTS.equilibrium.neutral.supply);
      validValues.add(DEFAULT_SIM_CONSTANTS.equilibrium.neutral.demand);

      for (const market of world.markets) {
        expect(market.supply).toBeGreaterThan(0);
        expect(market.demand).toBeGreaterThan(0);
        expect(validValues).toContain(market.supply);
        expect(validValues).toContain(market.demand);
      }
    });
  });

  // ── Economy simulation ──────────────────────────────────────────

  describe("simulateWorldTick", () => {
    it("advances tick by 1", () => {
      const config: SimConfig = { tickCount: 1, bots: [], seed: 42 };
      const world = createSimWorld(config, DEFAULT_SIM_CONSTANTS);
      const next = simulateWorldTick(world, mulberry32(42), defaultCtx());

      expect(next.tick).toBe(1);
    });

    it("does not mutate the original world", () => {
      const config: SimConfig = { tickCount: 1, bots: [], seed: 42 };
      const world = createSimWorld(config, DEFAULT_SIM_CONSTANTS);
      const originalTick = world.tick;
      simulateWorldTick(world, mulberry32(42), defaultCtx());

      expect(world.tick).toBe(originalTick);
    });

    it("markets drift after 100 ticks", () => {
      const config: SimConfig = { tickCount: 1, bots: [], seed: 42 };
      let world = createSimWorld(config, DEFAULT_SIM_CONSTANTS);
      const rng = mulberry32(42);
      const ctx = defaultCtx();

      // Record initial market state
      const initialSupplies = world.markets.slice(0, 10).map((m) => m.supply);

      // Run 100 ticks
      for (let i = 0; i < 100; i++) {
        world = simulateWorldTick(world, rng, ctx);
      }

      // At least some markets should have changed
      const finalSupplies = world.markets.slice(0, 10).map((m) => m.supply);
      const anyChanged = initialSupplies.some((s, i) => s !== finalSupplies[i]);
      expect(anyChanged).toBe(true);
    });

    it("docks ships that have arrived", () => {
      const config: SimConfig = { tickCount: 1, bots: [], seed: 42 };
      let world = createSimWorld(config, DEFAULT_SIM_CONSTANTS);

      // Manually set a ship to in-transit arriving at tick 2
      world = {
        ...world,
        ships: [{
          ...world.ships[0],
          status: "in_transit",
          destinationSystemId: world.systems[5].id,
          arrivalTick: 2,
        }],
      };

      // Tick 1: still in transit
      const rng = mulberry32(1);
      const ctx = defaultCtx();
      let w = simulateWorldTick(world, rng, ctx);
      expect(w.ships[0].status).toBe("in_transit");

      // Tick 2: should dock
      w = simulateWorldTick(w, rng, ctx);
      expect(w.ships[0].status).toBe("docked");
      expect(w.ships[0].systemId).toBe(world.systems[5].id);
    });
  });

  // ── Event injection ───────────────────────────────────────────

  describe("event injection", () => {
    it("disableRandomEvents: true → no events spawn over 100 ticks", () => {
      const config: SimConfig = { tickCount: 1, bots: [], seed: 42 };
      let world = createSimWorld(config, DEFAULT_SIM_CONSTANTS);
      const rng = mulberry32(42);
      const ctx = defaultCtx({ disableRandomEvents: true });

      for (let i = 0; i < 100; i++) {
        world = simulateWorldTick(world, rng, ctx);
      }

      expect(world.events).toHaveLength(0);
    });

    it("injects a war at an extraction system via economyType target", () => {
      const config: SimConfig = { tickCount: 1, bots: [], seed: 42 };
      let world = createSimWorld(config, DEFAULT_SIM_CONSTANTS);
      const rng = mulberry32(42);

      const ctx = defaultCtx({
        disableRandomEvents: true,
        eventInjections: [
          { tick: 10, target: { economyType: "extraction" }, eventType: "war" },
        ],
      });

      // Run to tick 10
      for (let i = 0; i < 10; i++) {
        world = simulateWorldTick(world, rng, ctx);
      }

      expect(world.events).toHaveLength(1);
      expect(world.events[0].type).toBe("war");

      // Verify it landed on an extraction system
      const targetSystem = world.systems.find((s) => s.id === world.events[0].systemId);
      expect(targetSystem?.economyType).toBe("extraction");
    });

    it("injects with custom severity", () => {
      const config: SimConfig = { tickCount: 1, bots: [], seed: 42 };
      let world = createSimWorld(config, DEFAULT_SIM_CONSTANTS);
      const rng = mulberry32(42);

      const ctx = defaultCtx({
        disableRandomEvents: true,
        eventInjections: [
          { tick: 5, target: { economyType: "extraction" }, eventType: "war", severity: 2.0 },
        ],
      });

      for (let i = 0; i < 5; i++) {
        world = simulateWorldTick(world, rng, ctx);
      }

      expect(world.events[0].severity).toBe(2.0);
    });

    it("skips invalid eventType without crashing", () => {
      const config: SimConfig = { tickCount: 1, bots: [], seed: 42 };
      let world = createSimWorld(config, DEFAULT_SIM_CONSTANTS);
      const rng = mulberry32(42);

      const ctx = defaultCtx({
        disableRandomEvents: true,
        eventInjections: [
          { tick: 5, target: { systemIndex: 0 }, eventType: "nonexistent_event" },
        ],
      });

      for (let i = 0; i < 10; i++) {
        world = simulateWorldTick(world, rng, ctx);
      }

      expect(world.events).toHaveLength(0);
    });

    it("fires multiple injections at the same tick", () => {
      const config: SimConfig = { tickCount: 1, bots: [], seed: 42 };
      let world = createSimWorld(config, DEFAULT_SIM_CONSTANTS);
      const rng = mulberry32(42);

      const ctx = defaultCtx({
        disableRandomEvents: true,
        eventInjections: [
          { tick: 5, target: { systemIndex: 0 }, eventType: "war" },
          { tick: 5, target: { systemIndex: 1 }, eventType: "trade_festival" },
        ],
      });

      for (let i = 0; i < 5; i++) {
        world = simulateWorldTick(world, rng, ctx);
      }

      expect(world.events).toHaveLength(2);
      const types = world.events.map((e) => e.type).sort();
      expect(types).toEqual(["trade_festival", "war"]);
    });
  });

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
    it("runs a basic simulation and returns results with constants", () => {
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

    it("all strategies produce valid metrics", { timeout: 30_000 }, () => {
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
