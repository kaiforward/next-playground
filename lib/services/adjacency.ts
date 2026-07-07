import { getWorld, getWorldVersion } from "@/lib/world/store";
import { buildAdjacencyList } from "@/lib/engine/visibility";

/**
 * Module-level caches over the world's static topology (connections, region
 * and faction assignment). Each cache is keyed to the world-store version:
 * a new/loaded world bumps the version, and the next read rebuilds.
 */
let cachedAdjacency: { version: number; value: Map<string, string[]> } | null = null;

export async function getAdjacencyList(): Promise<Map<string, string[]>> {
  const version = getWorldVersion();
  if (cachedAdjacency?.version !== version) {
    const connections = getWorld().connections.map((c) => ({
      fromSystemId: c.fromId,
      toSystemId: c.toId,
    }));
    cachedAdjacency = { version, value: buildAdjacencyList(connections) };
  }
  return cachedAdjacency.value;
}

/** Cached systemId → regionId map — systems don't change region within a world. */
let cachedSystemRegion: { version: number; value: Map<string, string> } | null = null;

export async function getSystemRegionMap(): Promise<Map<string, string>> {
  const version = getWorldVersion();
  if (cachedSystemRegion?.version !== version) {
    cachedSystemRegion = {
      version,
      value: new Map(getWorld().systems.map((s) => [s.id, s.regionId])),
    };
  }
  return cachedSystemRegion.value;
}

/**
 * Cached systemId → factionId map (null for independents). Faction ownership is
 * static within a world (rebellion/territory change is SP5). Drives the
 * faction-bounded flow topology.
 */
let cachedSystemFaction: { version: number; value: Map<string, string | null> } | null = null;

export async function getSystemFactionMap(): Promise<Map<string, string | null>> {
  const version = getWorldVersion();
  if (cachedSystemFaction?.version !== version) {
    cachedSystemFaction = {
      version,
      value: new Map(getWorld().systems.map((s) => [s.id, s.factionId])),
    };
  }
  return cachedSystemFaction.value;
}
