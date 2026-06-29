import { prisma } from "@/lib/prisma";
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
 *  - economy: per-SYSTEM shard over id-asc order (the order the economy processor
 *    shards, see lib/tick/adapters/prisma/economy.ts getSystemIds) — when this
 *    system's markets / production / consumption refresh.
 *  - logistics: per-FACTION shard over the directed-logistics faction-key order
 *    (PrismaDirectedLogisticsWorld.getFactionShardKeys: factionIds by localeCompare,
 *    null/independents last) — when this faction's surplus→deficit redistribution
 *    and autonomic build run (build shares the same shard).
 */
export async function getSystemCadence(systemId: string): Promise<SystemCadence> {
  const system = await prisma.starSystem.findUnique({
    where: { id: systemId },
    select: { factionId: true },
  });
  if (!system) throw new ServiceError("System not found.", 404);

  const [systemCount, systemRank, factionRows] = await Promise.all([
    prisma.starSystem.count(),
    prisma.starSystem.count({ where: { id: { lt: systemId } } }),
    prisma.starSystem.findMany({ distinct: ["factionId"], select: { factionId: true } }),
  ]);

  const economyShardGroup = shardGroupForIndex(systemRank, systemCount, ECONOMY_UPDATE_INTERVAL);

  // Replicate getFactionShardKeys' deterministic order exactly so the countdown
  // matches the processor: non-null factionIds by localeCompare, null last.
  const factionKeys = factionRows
    .map((r) => r.factionId)
    .sort((a, b) => (a === null ? 1 : b === null ? -1 : a.localeCompare(b)));
  const factionIndex = factionKeys.indexOf(system.factionId);
  const logisticsShardGroup =
    factionIndex < 0
      ? 0
      : shardGroupForIndex(factionIndex, factionKeys.length, DIRECTED_LOGISTICS.INTERVAL);

  return { economyShardGroup, logisticsShardGroup };
}
