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
import { STRATEGIES } from "./strategies";
import type { SimConfig, SimResults, SimRunContext, TickMetrics } from "./types";
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

  // Build run context
  const ctx: SimRunContext = {
    constants,
    disableRandomEvents: config.disableRandomEvents ?? false,
    eventInjections: config.eventInjections ?? [],
    adjacencyList,
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

  // Main loop
  for (let t = 0; t < config.tickCount; t++) {
    // 1. Simulate world tick (ship arrivals → events → economy)
    world = simulateWorldTick(world, rng, ctx);

    // 2. Execute bot ticks (deterministic order by ID)
    const sortedPlayers = [...world.players].sort((a, b) => a.id.localeCompare(b.id));

    for (const player of sortedPlayers) {
      const strategy = strategyMap.get(player.id)!;
      const result = executeBotTick(player.id, world, strategy, ctx);
      world = result.world;
      metricsMap.get(player.id)!.push(result.metrics);
    }
  }

  // Compute summaries
  const summaries = world.players.map((player) => {
    const metrics = metricsMap.get(player.id)!;
    return computeSummary(player, metrics);
  });

  return {
    config,
    constants,
    overrides: overrides ?? {},
    summaries,
    label,
    elapsedMs: performance.now() - start,
  };
}
