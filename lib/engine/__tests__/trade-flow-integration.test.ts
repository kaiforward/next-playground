/**
 * Integration: trade flow restores prosperity in an otherwise stagnant region.
 *
 * Runs the unified economy + trade-flow processor bodies together against an
 * in-memory world (no Prisma, no bots). Compares two parallel runs with the
 * same seeded RNG — one with flow enabled, one with FLOW_BUDGET=0 — and
 * asserts that flow drives volume accumulation, market drift away from the
 * starting equilibrium, and net prosperity gain.
 */

import { describe, it, expect } from "vitest";
import { runEconomyProcessor } from "@/lib/tick/processors/economy";
import { runTradeFlowProcessor } from "@/lib/tick/processors/trade-flow";
import { InMemoryEconomyWorld } from "@/lib/tick/adapters/memory/economy";
import { InMemoryTradeFlowWorld } from "@/lib/tick/adapters/memory/trade-flow";
import { DEFAULT_SIM_CONSTANTS } from "@/lib/engine/simulator/constants";
import { mulberry32 } from "@/lib/engine/universe-gen";
import type { TickContext } from "@/lib/tick/types";
import type {
  SimConnection,
  SimFlowEvent,
  SimMarketEntry,
  SimRegion,
  SimSystem,
} from "@/lib/engine/simulator/types";

function makeCtx(tick: number): TickContext {
  return { tx: undefined as never, tick, results: new Map() };
}

/**
 * 4 systems in one region: two producers (a, b) and two consumers (c, d).
 * Edges: a-c, a-d, b-c, b-d (a small bipartite trading network).
 */
function buildFixture(): {
  region: SimRegion;
  systems: SimSystem[];
  connections: SimConnection[];
  markets: SimMarketEntry[];
} {
  const region: SimRegion = {
    id: "r1",
    name: "Test Region",
  };

  const producers = ["a", "b"].map<SimSystem>((id) => ({
    id,
    name: id.toUpperCase(),
    economyType: "agricultural",
    regionId: "r1",
    governmentType: "federation",
    produces: { food: 4 },
    consumes: {},
    traits: [],
    prosperity: 0,
    tradeVolumeAccum: 0,
  }));

  const consumers = ["c", "d"].map<SimSystem>((id) => ({
    id,
    name: id.toUpperCase(),
    economyType: "tech",
    regionId: "r1",
    governmentType: "federation",
    produces: {},
    consumes: { food: 4 },
    traits: [],
    prosperity: 0,
    tradeVolumeAccum: 0,
  }));

  const systems = [...producers, ...consumers];

  // Bidirectional connections between every producer and every consumer.
  const pairs = [
    ["a", "c"],
    ["a", "d"],
    ["b", "c"],
    ["b", "d"],
  ] as const;
  const connections: SimConnection[] = pairs.flatMap(([x, y]) => [
    { fromSystemId: x, toSystemId: y, fuelCost: 10 },
    { fromSystemId: y, toSystemId: x, fuelCost: 10 },
  ]);

  // Start producers food-rich, consumers food-poor → strong gradient.
  const markets: SimMarketEntry[] = [];
  for (const sys of systems) {
    const isProducer = sys.id === "a" || sys.id === "b";
    markets.push({
      systemId: sys.id,
      goodId: "food",
      basePrice: 50,
      // Producers food-rich (high stock → cheap), consumers food-poor (low → dear).
      stock: isProducer ? 120 : 20,
      priceFloor: 0.2,
      priceCeiling: 5.0,
    });
  }

  return { region, systems, connections, markets };
}

async function runScenario(
  flowBudget: number,
  tickCount: number,
): Promise<{
  systems: SimSystem[];
  markets: SimMarketEntry[];
  flowEvents: SimFlowEvent[];
}> {
  const { region, systems, connections, markets } = buildFixture();
  const rng = mulberry32(1234);

  // Per-iteration state — every tick we rebuild the in-memory adapters from
  // the running state, run economy then trade flow, and copy results back.
  let curSystems = systems;
  let curMarkets = markets;
  let curFlowEvents: SimFlowEvent[] = [];

  const econParams = {
    rng,
    simParams: {
      noiseAmplitude: DEFAULT_SIM_CONSTANTS.economy.noiseAmplitude,
      minLevel: DEFAULT_SIM_CONSTANTS.economy.minLevel,
      maxLevel: DEFAULT_SIM_CONSTANTS.economy.maxLevel,
    },
    prosperityParams: DEFAULT_SIM_CONSTANTS.prosperity,
    modifierCaps: DEFAULT_SIM_CONSTANTS.events.modifierCaps,
  };

  const flowParams = {
    // Run flow every tick so the small fixture sees enough activity
    // within the tick budget to exercise the convergence path.
    processEveryNTicks: 1,
    flowBudget,
    gradientThreshold: 0.05,
    gradientSensitivity: 1.0,
    flowHistoryTicks: 200,
    playerDisplacementFactor: 2.0,
    prosperityTargetVolume: DEFAULT_SIM_CONSTANTS.prosperity.targetVolume,
    minLevel: DEFAULT_SIM_CONSTANTS.economy.minLevel,
    maxLevel: DEFAULT_SIM_CONSTANTS.economy.maxLevel,
  };

  for (let t = 1; t <= tickCount; t++) {
    const economyWorld = new InMemoryEconomyWorld(
      { systems: curSystems, markets: curMarkets, modifiers: [] },
      [region],
    );
    await runEconomyProcessor(economyWorld, makeCtx(t), econParams);
    curSystems = economyWorld.systems;
    curMarkets = economyWorld.markets;

    const flowWorld = new InMemoryTradeFlowWorld(
      {
        systems: curSystems,
        markets: curMarkets,
        flowEvents: curFlowEvents,
      },
      [region],
      connections,
    );
    await runTradeFlowProcessor(flowWorld, makeCtx(t), flowParams);
    curSystems = flowWorld.systems;
    curMarkets = flowWorld.markets;
    curFlowEvents = flowWorld.flowEvents;
  }

  return { systems: curSystems, markets: curMarkets, flowEvents: curFlowEvents };
}

describe("Trade flow integration", () => {
  it("restores activity in a stagnant region with no players", async () => {
    const withoutFlow = await runScenario(0, 80);
    const withFlow = await runScenario(8, 80);

    // Without flow: no flow events recorded.
    expect(withoutFlow.flowEvents).toHaveLength(0);

    // With flow: many events recorded and surviving the prune window.
    expect(withFlow.flowEvents.length).toBeGreaterThan(0);

    const totalQuantity = withFlow.flowEvents.reduce(
      (sum, e) => sum + e.quantity,
      0,
    );
    expect(totalQuantity).toBeGreaterThan(0);

    // tradeVolumeAccum: at least one system records non-zero throughput
    // before prosperity captures it. Asserted directly so the test still
    // verifies the design's volume promise if prosperity scoring changes.
    const maxVolumeWithFlow = Math.max(
      ...withFlow.systems.map((s) => s.tradeVolumeAccum),
    );
    expect(maxVolumeWithFlow).toBeGreaterThan(0);

    // With flow: at least one system finishes above zero prosperity.
    const maxProsperityWithFlow = Math.max(
      ...withFlow.systems.map((s) => s.prosperity),
    );
    const maxProsperityWithoutFlow = Math.max(
      ...withoutFlow.systems.map((s) => s.prosperity),
    );
    expect(maxProsperityWithFlow).toBeGreaterThan(maxProsperityWithoutFlow);
    expect(maxProsperityWithFlow).toBeGreaterThan(0);
  });

  it("moves consumer markets away from initial stock shortage", async () => {
    const { markets } = await runScenario(8, 80);

    const consumerFood = markets.filter(
      (m) => (m.systemId === "c" || m.systemId === "d") && m.goodId === "food",
    );
    // Started at stock=20; flow should push consumer stock meaningfully higher.
    for (const m of consumerFood) {
      expect(m.stock).toBeGreaterThan(20);
    }
  });
});
