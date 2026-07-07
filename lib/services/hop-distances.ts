import { getWorld, getWorldVersion } from "@/lib/world/store";
import { computeBoundedHopDistances } from "@/lib/engine/pathfinding";

/** BFS depth bound for the cached hop-distance map — routes beyond this many
 * hops are treated as unreachable by consumers (directed logistics/build). */
const MAX_HOP_DISTANCE = 8;

// Connections are static within a world, so hop distances are computed once
// per world-store version and cached until a new world is set/loaded.
let cached: { version: number; value: Map<string, Map<string, number>> } | null = null;

/** Load or return cached bounded hop distances. */
export async function loadHopDistances(): Promise<Map<string, Map<string, number>>> {
  const version = getWorldVersion();
  if (cached?.version !== version) {
    const connections = getWorld().connections.map((c) => ({
      fromSystemId: c.fromId,
      toSystemId: c.toId,
      fuelCost: c.fuelCost,
    }));
    cached = { version, value: computeBoundedHopDistances(connections, MAX_HOP_DISTANCE) };
  }
  return cached.value;
}
