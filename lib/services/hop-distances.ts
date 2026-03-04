import { prisma } from "@/lib/prisma";
import { computeBoundedHopDistances } from "@/lib/engine/pathfinding";
import { MISSION_CONSTANTS } from "@/lib/constants/missions";

// Connections are static (set at seed time), so hop distances are computed once
// and cached for the lifetime of the process. Each process (main server and
// worker thread) gets its own module instance and therefore its own cache.
let cached: Map<string, Map<string, number>> | null = null;

/** Load or return cached bounded hop distances. */
export async function loadHopDistances(): Promise<
  Map<string, Map<string, number>>
> {
  if (!cached) {
    const connections = await prisma.systemConnection.findMany({
      select: { fromSystemId: true, toSystemId: true, fuelCost: true },
    });
    cached = computeBoundedHopDistances(
      connections,
      MISSION_CONSTANTS.MAX_EXPORT_DISTANCE,
    );
  }
  return cached;
}
