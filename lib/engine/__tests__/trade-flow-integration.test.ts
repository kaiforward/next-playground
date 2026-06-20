/**
 * Integration: trade flow restores activity in an otherwise stagnant region.
 *
 * Runs the unified economy + trade-flow processor bodies together against an
 * in-memory world (no Prisma, no bots). Compares two parallel runs with the
 * same seeded RNG — one with flow enabled, one with FLOW_BUDGET=0 — and
 * asserts that flow records cross-system flow events and drives consumer
 * markets away from their starting shortage.
 */

import { describe, it, expect } from "vitest";
import { runEconomyProcessor } from "@/lib/tick/processors/economy";
import { runTradeFlowProcessor } from "@/lib/tick/processors/trade-flow";
import { InMemoryEconomyWorld } from "@/lib/tick/adapters/memory/economy";
import { InMemoryTradeFlowWorld } from "@/lib/tick/adapters/memory/trade-flow";
import { DEFAULT_SIM_CONSTANTS } from "@/lib/engine/simulator/constants";
import { mulberry32 } from "@/lib/engine/universe-gen";
import { STRIKE_PARAMS } from "@/lib/constants/population";
import type { TickContext } from "@/lib/tick/types";
import type {
  SimConnection,
  SimFlowEvent,
  SimMarketEntry,
  SimRegion,
  SimSystem,
} from "@/lib/engine/simulator/types";
import { unitResourceVector } from "@/lib/engine/resources";

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

  // Low-pop "producers": empty buildings produce nothing (capacity-driven), so the
  // producer role comes from the initial stock gradient below + tiny low-pop consumption.
  const producers = ["a", "b"].map<SimSystem>((id) => ({
    id,
    name: id.toUpperCase(),
    economyType: "agricultural",
    regionId: "r1",
    factionId: "faction-0",
    governmentType: "federation",
    population: 100,
    popCap: 1000,
    traits: [],
    bodyDanger: 0,
    unrest: 0,
    buildings: {},
    yields: unitResourceVector(),
  }));

  // Arable-barren, populous consumers: food consumption ≈ 4/tick, no production.
  const consumers = ["c", "d"].map<SimSystem>((id) => ({
    id,
    name: id.toUpperCase(),
    economyType: "tech",
    regionId: "r1",
    factionId: "faction-0",
    governmentType: "federation",
    population: 1000,
    popCap: 2000,
    traits: [],
    bodyDanger: 0,
    unrest: 0,
    buildings: {},
    yields: unitResourceVector(),
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
      anchorMult: 1,
      demandRate: 1,
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
    modifierCaps: DEFAULT_SIM_CONSTANTS.events.modifierCaps,
    strikeParams: STRIKE_PARAMS,
  };

  const flowParams = {
    // Process every edge each tick so the small fixture sees enough activity
    // within the tick budget to exercise the convergence path.
    edgesPerTick: 100,
    flowBudget,
    gradientThreshold: 0.05,
    gradientSensitivity: 1.0,
    flowHistoryTicks: 200,
    playerDisplacementFactor: 2.0,
    distanceDecay: 0,
    playerVolumeTarget: DEFAULT_SIM_CONSTANTS.tradeFlow.playerVolumeTarget,
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
  });

  it("flow raises consumer stock higher than no-flow", async () => {
    const withoutFlow = await runScenario(0, 80);
    const withFlow = await runScenario(8, 80);

    const avgConsumer = (markets: SimMarketEntry[]) => {
      const found = markets.filter(
        (m) => (m.systemId === "c" || m.systemId === "d") && m.goodId === "food",
      );
      return found.reduce((s, m) => s + m.stock, 0) / found.length;
    };

    // With flow, surplus food moves from producer systems to consumer systems,
    // so consumer average stock is higher than the no-flow baseline.
    expect(avgConsumer(withFlow.markets)).toBeGreaterThan(avgConsumer(withoutFlow.markets));
  });
});
