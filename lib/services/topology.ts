import { getWorld, getWorldVersion } from "@/lib/world/store";
import { getSystemFactionMap } from "@/lib/services/adjacency";
import type { EdgeView } from "@/lib/tick/world/trade-flow-world";
import { buildOpenEdges } from "@/lib/tick/world/trade-flow-topology";

/**
 * Cached faction-bounded open-edge list (both endpoints share a faction; adjacent
 * independents via null===null), deduped + sorted by "${a}|${b}". The connection
 * graph + faction assignments are static within a world, so the cache is keyed
 * to the world-store version and rebuilds when a new world is set/loaded.
 * Shared by the trade-flow and migration processors — one topology, one cache.
 */
let cachedOpenEdges: { version: number; value: EdgeView[] } | null = null;

export async function getOpenEdges(): Promise<EdgeView[]> {
  const version = getWorldVersion();
  if (cachedOpenEdges?.version !== version) {
    const sysFaction = await getSystemFactionMap();
    const conns = getWorld().connections.map((c) => ({
      fromSystemId: c.fromId,
      toSystemId: c.toId,
      fuelCost: c.fuelCost,
    }));
    cachedOpenEdges = { version, value: buildOpenEdges(conns, sysFaction) };
  }
  return cachedOpenEdges.value;
}
