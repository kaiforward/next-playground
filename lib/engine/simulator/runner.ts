/**
 * Simulation runner — orchestrates world creation, tick loop, and bot execution.
 */

import { mulberry32 } from "@/lib/engine/universe-gen";
import { createSimWorld } from "./world";
import { simulateWorldTick } from "./economy";
import { executeBotTick } from "./bot";
import { computeSummary } from "./metrics";
import { resolveConstants } from "./constants";
import { buildSimAdjacencyList } from "./pathfinding-cache";
import { takeMarketSnapshot, computeMarketHealth, SNAPSHOT_INTERVAL } from "./market-analysis";
import {
  trackEventLifecycles,
  flushActiveEvents,
  computeEventImpacts,
} from "./event-analysis";
import { STRATEGIES } from "./strategies";
import type { SimConfig, SimResults, SimRunContext, TickMetrics, MarketSnapshot, EventLifecycle, RegionOverviewEntry } from "./types";
import type { SimConstantOverrides } from "./constants";
import type { TradeStrategy } from "./strategies/types";

/**
 * Run a full simulation and return results.
 * Overrides are optional — when provided, they're merged with defaults
 * and the delta is recorded in the result for reproducibility.
 */
export function runSimulation(
  config: SimConfig,
  overrides?: SimConstantOverrides,
  label?: string,
): SimResults {
  const start = performance.now();
  const rng = mulberry32(config.seed);
  const constants = resolveConstants(overrides);

  // Create world with bots
  let world = createSimWorld(config, constants);

  // Build adjacency list once (connections don't change during simulation)
  const adjacencyList = buildSimAdjacencyList(world.connections);

  // Build systemId → governmentType lookup
  const regionGovMap = new Map(world.regions.map((r) => [r.id, r.governmentType]));
  const systemToGov = new Map(
    world.systems.map((s) => [s.id, regionGovMap.get(s.regionId) ?? "unknown"]),
  );

  // Build region overview for output
  const systemsPerRegion = new Map<string, number>();
  for (const s of world.systems) {
    systemsPerRegion.set(s.regionId, (systemsPerRegion.get(s.regionId) ?? 0) + 1);
  }
  const regionOverview: RegionOverviewEntry[] = world.regions.map((r) => ({
    name: r.name,
    governmentType: r.governmentType,
    systemCount: systemsPerRegion.get(r.id) ?? 0,
  }));

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
  const activeEventTracker = new Map<string, { type: string; systemId: string; severity: number; startTick: number; sourceEventId: string | null; startPrices: { goodId: string; price: number }[] }>();
  const completedEvents: EventLifecycle[] = [];

  // Main loop
  for (let t = 0; t < config.tickCount; t++) {
    // 1. Save pre-tick markets (simulateWorldTick returns a new object)
    const preTickMarkets = world.markets;

    // 2. Simulate world tick (ship arrivals → events → economy)
    world = simulateWorldTick(world, rng, ctx);

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

  // Compute market health from final state
  const marketHealth = computeMarketHealth(world, constants);

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
    marketSnapshots,
    marketHealth,
    eventImpacts,
    regionOverview,
    label,
    elapsedMs: performance.now() - start,
  };
}
