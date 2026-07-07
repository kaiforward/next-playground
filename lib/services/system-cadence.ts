import { getWorld } from "@/lib/world/store";
import { ServiceError } from "./errors";
import { economyShardRankById, logisticsFactionShardKeys } from "./world-index";
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
 * Both orderings come from the shared shard-order helpers the tick adapters
 * consume (`lib/engine/shard-order.ts`), so the countdown can't drift from the
 * order the processors actually run:
 *  - economy: per-SYSTEM shard over the economy shard order — when this
 *    system's markets / production / consumption refresh.
 *  - logistics: per-FACTION shard over the faction shard keys — when this
 *    faction's surplus→deficit redistribution and autonomic build run (build
 *    shares the same shard).
 */
export function getSystemCadence(systemId: string): SystemCadence {
  const world = getWorld();
  const system = world.systems.find((s) => s.id === systemId);
  if (!system) throw new ServiceError("System not found.", 404);

  const shardRanks = economyShardRankById();
  const economyShardGroup = shardGroupForIndex(
    shardRanks.get(systemId) ?? 0,
    shardRanks.size,
    ECONOMY_UPDATE_INTERVAL,
  );

  const factionKeys = logisticsFactionShardKeys();
  const factionIndex = factionKeys.indexOf(system.factionId);
  const logisticsShardGroup =
    factionIndex < 0
      ? 0
      : shardGroupForIndex(factionIndex, factionKeys.length, DIRECTED_LOGISTICS.INTERVAL);

  return { economyShardGroup, logisticsShardGroup };
}
