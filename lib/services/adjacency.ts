import { prisma } from "@/lib/prisma";
import { buildAdjacencyList } from "@/lib/engine/visibility";
import { invalidateTradeFlowEdgeCache } from "@/lib/tick/adapters/prisma/trade-flow";

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

/** Force-clear the adjacency cache (e.g. after a reseed in integration tests). */
export function invalidateAdjacencyCache(): void {
  cachedAdjacency = null;
  cachedSystemRegion = null;
  cachedSystemFaction = null;
  // The trade-flow open-edge cache derives from the faction map above, so clear
  // it here too — one reseed hook sweeps every seed-derived cache.
  invalidateTradeFlowEdgeCache();
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

/**
 * Cached systemId → factionId map (null for independents). Faction ownership is
 * static after seed (rebellion/territory change is SP5), so memoize for the
 * process lifetime. Drives the faction-bounded flow topology.
 */
let cachedSystemFaction: Map<string, string | null> | null = null;

export async function getSystemFactionMap(): Promise<Map<string, string | null>> {
  if (cachedSystemFaction) return cachedSystemFaction;

  const systems = await prisma.starSystem.findMany({
    select: { id: true, factionId: true },
  });

  cachedSystemFaction = new Map(systems.map((s) => [s.id, s.factionId]));
  return cachedSystemFaction;
}
