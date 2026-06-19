import type { EdgeView } from "@/lib/tick/world/trade-flow-world";
import { buildOpenEdges } from "@/lib/tick/world/trade-flow-topology";

/**
 * Cached faction-bounded open-edge list (both endpoints share a faction; adjacent
 * independents via null===null), deduped + sorted by "${a}|${b}". The connection
 * graph + faction assignments are static after seed, so build once per process.
 * Shared by the trade-flow and migration processors — one topology, one cache.
 */
let cachedOpenEdges: EdgeView[] | null = null;

export async function getOpenEdges(): Promise<EdgeView[]> {
  if (cachedOpenEdges) return cachedOpenEdges;
  // Lazy imports keep lib/prisma (which throws at module-load without DATABASE_URL)
  // out of this module's static graph, so unit tests reaching topology through a
  // processor body load without a database. The one-time cold-fill reads connections
  // off the module prisma client, not a tick transaction — the graph is static, so it
  // need not occupy a tick's transaction slot.
  const [{ getSystemFactionMap }, { prisma }] = await Promise.all([
    import("@/lib/services/adjacency"),
    import("@/lib/prisma"),
  ]);
  const sysFaction = await getSystemFactionMap();
  const conns = await prisma.systemConnection.findMany({
    select: { fromSystemId: true, toSystemId: true, fuelCost: true },
  });
  cachedOpenEdges = buildOpenEdges(conns, sysFaction);
  return cachedOpenEdges;
}

export function invalidateOpenEdgeCache(): void {
  cachedOpenEdges = null;
}
