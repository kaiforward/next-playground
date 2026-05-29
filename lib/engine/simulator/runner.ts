/**
 * Simulation runner — orchestrates world creation, tick loop, and bot execution.
 */

import type { EventTypeId } from "@/lib/constants/events";
import { mulberry32 } from "@/lib/engine/universe-gen";
import { createSimWorld } from "./world";
import { simulateWorldTick } from "./economy";
import { executeBotTick } from "./bot";
import { computeSummary, computeStrategyAggregates } from "./metrics";
import { resolveConstants } from "./constants";
import { buildSimAdjacencyList } from "./pathfinding-cache";
import { takeMarketSnapshot, computeMarketHealth, SNAPSHOT_INTERVAL } from "./market-analysis";
import {
  trackEventLifecycles,
  flushActiveEvents,
  computeEventImpacts,
} from "./event-analysis";
import { STRATEGIES } from "./strategies";
import type { GovernmentType } from "@/lib/types/game";
import type { SimConfig, SimResults, SimRunContext, TickMetrics, MarketSnapshot, EventLifecycle, RegionOverviewEntry } from "./types";
import type { SimConstantOverrides } from "./constants";
import type { TradeStrategy } from "./strategies/types";

/**
 * Run a full simulation and return results.
 * Overrides are optional — when provided, they're merged with defaults
 * and the delta is recorded in the result for reproducibility.
 */
export async function runSimulation(
  config: SimConfig,
  overrides?: SimConstantOverrides,
  label?: string,
): Promise<SimResults> {
  const start = performance.now();
  const rng = mulberry32(config.seed);
  const constants = resolveConstants(overrides);

  // Create world with bots
  let world = createSimWorld(config, constants);

  // Build adjacency list once (connections don't change during simulation)
  const adjacencyList = buildSimAdjacencyList(world.connections);

  // Build systemId → governmentType lookup. After the Layer 2 cutover, gov is a
  // property of the owning faction (read off SimSystem directly), not the region.
  const systemToGov: Map<string, GovernmentType> = new Map(
    world.systems.map((s) => [s.id, s.governmentType]),
  );

  // Build region overview for output — derive the modal government type from
  // the region's member systems, mirroring atlas service's dominant-faction
  // resolution. Border regions get the more common gov; ties broken alphabetically.
  const systemsByRegion = new Map<string, GovernmentType[]>();
  for (const s of world.systems) {
    const list = systemsByRegion.get(s.regionId) ?? [];
    list.push(s.governmentType);
    systemsByRegion.set(s.regionId, list);
  }
  const regionOverview: RegionOverviewEntry[] = world.regions.map((r) => {
    const govs = systemsByRegion.get(r.id) ?? [];
    const counts = new Map<GovernmentType, number>();
    for (const g of govs) counts.set(g, (counts.get(g) ?? 0) + 1);
    let dominant: GovernmentType = "federation";
    let bestCount = 0;
    for (const [g, count] of counts) {
      if (count > bestCount || (count === bestCount && g < dominant)) {
        dominant = g;
        bestCount = count;
      }
    }
    return {
      name: r.name,
      dominantGovernmentType: dominant,
      systemCount: govs.length,
    };
  });

  // Build run context
  const ctx: SimRunContext = {
    constants,
    disableRandomEvents: config.disableRandomEvents ?? false,
    eventInjections: config.eventInjections ?? [],
    adjacencyList,
    systemToGov,
  };

  // Create strategy instances (one per player)
  const strategyMap = new Map<string, TradeStrategy>();
  for (const player of world.players) {
    const factory = STRATEGIES[player.strategy];
    if (!factory) {
      throw new Error(`Unknown strategy: ${player.strategy}`);
    }
    // Each player gets their own RNG-derived strategy for determinism
    strategyMap.set(player.id, factory(rng));
  }

  // Metrics per player
  const metricsMap = new Map<string, TickMetrics[]>();
  for (const player of world.players) {
    metricsMap.set(player.id, []);
  }

  // Market snapshots (sampled periodically)
  const marketSnapshots: { tick: number; markets: MarketSnapshot[] }[] = [];

  // Event lifecycle tracking
  const activeEventTracker = new Map<string, { type: EventTypeId; systemId: string; severity: number; startTick: number; sourceEventId: string | null; startPrices: { goodId: string; price: number }[] }>();
  const completedEvents: EventLifecycle[] = [];

  // Main loop
  for (let t = 0; t < config.tickCount; t++) {
    // 1. Save pre-tick markets (simulateWorldTick returns a new object)
    const preTickMarkets = world.markets;

    // 2. Simulate world tick (ship arrivals → events → economy)
    world = await simulateWorldTick(world, rng, ctx);

    // 3. Execute bot ticks (deterministic order by ID)
    const sortedPlayers = [...world.players].sort((a, b) => a.id.localeCompare(b.id));

    for (const player of sortedPlayers) {
      const strategy = strategyMap.get(player.id)!;
      const result = executeBotTick(player.id, world, strategy, ctx);
      world = result.world;
      metricsMap.get(player.id)!.push(result.metrics);
    }

    // 4. Sample market state at regular intervals
    if (world.tick % SNAPSHOT_INTERVAL === 0) {
      marketSnapshots.push({ tick: world.tick, markets: takeMarketSnapshot(world) });
    }

    // 5. Track event lifecycles (detect new + expired events)
    completedEvents.push(...trackEventLifecycles(world, activeEventTracker, preTickMarkets));
  }

  // Flush any events still active at simulation end
  completedEvents.push(...flushActiveEvents(activeEventTracker, world.tick, world.markets));

  // Always capture the final tick if not already sampled
  if (marketSnapshots.length === 0 || marketSnapshots[marketSnapshots.length - 1].tick !== world.tick) {
    marketSnapshots.push({ tick: world.tick, markets: takeMarketSnapshot(world) });
  }

  // Compute summaries
  const totalSystems = world.systems.length;
  const systemNames = new Map(world.systems.map((s) => [s.id, s.name]));
  const summaries = world.players.map((player) => {
    const metrics = metricsMap.get(player.id)!;
    return computeSummary(player, metrics, totalSystems, systemNames);
  });

  // Compute strategy aggregates
  const strategyAggregates = computeStrategyAggregates(summaries);

  // Compute market health from final state
  const marketHealth = computeMarketHealth(world);

  // Compute event impact
  const eventImpacts = computeEventImpacts(
    completedEvents,
    metricsMap,
    systemNames,
  );

  return {
    config,
    constants,
    overrides: overrides ?? {},
    summaries,
    strategyAggregates,
    marketSnapshots,
    marketHealth,
    eventImpacts,
    regionOverview,
    label,
    elapsedMs: performance.now() - start,
  };
}
