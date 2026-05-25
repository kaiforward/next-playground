import { prisma } from "@/lib/prisma";
import { buildAdjacencyList } from "@/lib/engine/visibility";

/**
 * Cached adjacency list for the system connection graph.
 * Connections are static (only change at seed time), so we build
 * the adjacency map once and reuse it across all visibility checks.
 */
let cachedAdjacency: Map<string, string[]> | null = null;

export async function getAdjacencyList(): Promise<Map<string, string[]>> {
  if (cachedAdjacency) return cachedAdjacency;

  const connections = await prisma.systemConnection.findMany({
    select: { fromSystemId: true, toSystemId: true },
  });

  cachedAdjacency = buildAdjacencyList(connections);
  return cachedAdjacency;
}

/**
 * Cached systemId → regionId map. Systems don't change region after seed,
 * so this is safe to memoize for the process lifetime.
 */
let cachedSystemRegion: Map<string, string> | null = null;

export async function getSystemRegionMap(): Promise<Map<string, string>> {
  if (cachedSystemRegion) return cachedSystemRegion;

  const systems = await prisma.starSystem.findMany({
    select: { id: true, regionId: true },
  });

  cachedSystemRegion = new Map(systems.map((s) => [s.id, s.regionId]));
  return cachedSystemRegion;
}
