import { getWorld } from "@/lib/world/store";
import { ServiceError } from "./errors";
import { shardGroupForIndex } from "@/lib/tick/shard";
import { ECONOMY_UPDATE_INTERVAL } from "@/lib/constants/tick-cadence";
import { DIRECTED_LOGISTICS } from "@/lib/constants/directed-logistics";
import type { SystemCadence } from "@/lib/types/api";

/**
 * Static shard groups for one system's two player-meaningful cadences, used by
 * the system-header "next update" countdowns. Pure clock math on the client pairs
 * these with the live tick (see `ticksUntilShard`); the groups themselves never
 * change for a fixed universe, so the client caches them with staleTime Infinity.
 *
 * Both orderings replicate the in-memory tick adapters exactly so the countdown
 * matches the processor:
 *  - economy: per-SYSTEM shard over id order sorted by localeCompare
 *    (InMemoryEconomyWorld.getSystemIds) — when this system's markets /
 *    production / consumption refresh.
 *  - logistics: per-FACTION shard over first-seen faction-key order across
 *    the systems array, null/independents included where first encountered
 *    (MemoryDirectedLogisticsWorld.getFactionShardKeys) — when this faction's
 *    surplus→deficit redistribution and autonomic build run (build shares the
 *    same shard).
 */
export function getSystemCadence(systemId: string): SystemCadence {
  const world = getWorld();
  const system = world.systems.find((s) => s.id === systemId);
  if (!system) throw new ServiceError("System not found.", 404);

  const sortedIds = world.systems.map((s) => s.id).sort((a, b) => a.localeCompare(b));
  const systemRank = sortedIds.indexOf(systemId);
  const economyShardGroup = shardGroupForIndex(
    systemRank,
    sortedIds.length,
    ECONOMY_UPDATE_INTERVAL,
  );

  const factionKeys: Array<string | null> = [];
  const seen = new Set<string | null>();
  for (const s of world.systems) {
    if (seen.has(s.factionId)) continue;
    seen.add(s.factionId);
    factionKeys.push(s.factionId);
  }
  const factionIndex = factionKeys.indexOf(system.factionId);
  const logisticsShardGroup =
    factionIndex < 0
      ? 0
      : shardGroupForIndex(factionIndex, factionKeys.length, DIRECTED_LOGISTICS.INTERVAL);

  return { economyShardGroup, logisticsShardGroup };
}
