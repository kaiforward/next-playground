import { describe, it, expect } from "vitest";
import { createSimWorld } from "../simulator/world";
import { simulateWorldTick } from "../simulator/economy";
import { DEFAULT_SIM_CONSTANTS } from "../simulator/constants";
import { mulberry32 } from "../universe-gen";
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

    it("skips injection targeting non-existent system without crashing", () => {
      const config: SimConfig = { tickCount: 1, bots: [], seed: 42 };
      let world = createSimWorld(config, DEFAULT_SIM_CONSTANTS);
      const rng = mulberry32(42);

      const ctx = defaultCtx({
        disableRandomEvents: true,
        eventInjections: [
          { tick: 5, target: { systemIndex: 99999 }, eventType: "war" },
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
});
