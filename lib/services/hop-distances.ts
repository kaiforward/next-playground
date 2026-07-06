import { computeBoundedHopDistances } from "@/lib/engine/pathfinding";

/** BFS depth bound for the cached hop-distance map — routes beyond this many
 * hops are treated as unreachable by consumers (directed logistics/build). */
const MAX_HOP_DISTANCE = 8;

// Connections are static (set at seed time), so hop distances are computed once
// and cached for the lifetime of the process. Each process (main server and
// worker thread) gets its own module instance and therefore its own cache.
let cached: Map<string, Map<string, number>> | null = null;

/** Load or return cached bounded hop distances. */
export async function loadHopDistances(): Promise<
  Map<string, Map<string, number>>
> {
  if (!cached) {
    // Deferred import: prisma reads DATABASE_URL at load, so import it lazily (only
    // on the cache-miss DB read) to keep this module loadable without a DB connection.
    const { prisma } = await import("@/lib/prisma");
    const connections = await prisma.systemConnection.findMany({
      select: { fromSystemId: true, toSystemId: true, fuelCost: true },
    });
    cached = computeBoundedHopDistances(connections, MAX_HOP_DISTANCE);
  }
  return cached;
}
