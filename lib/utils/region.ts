import type { SystemConnectionInfo } from "@/lib/types/game";

/** Map each system to its regionId for fast lookups. */
export function buildSystemRegionMap(
  systems: { id: string; regionId: string }[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const s of systems) {
    map.set(s.id, s.regionId);
  }
  return map;
}

/** Connections where both endpoints belong to the given region. */
export function getIntraRegionConnections(
  regionId: string,
  connections: SystemConnectionInfo[],
  systemRegionMap: Map<string, string>,
): SystemConnectionInfo[] {
  return connections.filter(
    (c) =>
      systemRegionMap.get(c.fromSystemId) === regionId &&
      systemRegionMap.get(c.toSystemId) === regionId,
  );
}

/** Connections where endpoints are in different regions. */
export function getInterRegionConnections(
  connections: SystemConnectionInfo[],
  systemRegionMap: Map<string, string>,
): SystemConnectionInfo[] {
  return connections.filter(
    (c) =>
      systemRegionMap.get(c.fromSystemId) !==
      systemRegionMap.get(c.toSystemId),
  );
}

/** Region IDs reachable from a gateway system via cross-region connections. */
export function getGatewayTargetRegions(
  gatewaySystemId: string,
  connections: SystemConnectionInfo[],
  systemRegionMap: Map<string, string>,
): string[] {
  const homeRegion = systemRegionMap.get(gatewaySystemId);
  const regionIds = new Set<string>();

  for (const c of connections) {
    if (c.fromSystemId === gatewaySystemId) {
      const targetRegion = systemRegionMap.get(c.toSystemId);
      if (targetRegion && targetRegion !== homeRegion) {
        regionIds.add(targetRegion);
      }
    }
    if (c.toSystemId === gatewaySystemId) {
      const targetRegion = systemRegionMap.get(c.fromSystemId);
      if (targetRegion && targetRegion !== homeRegion) {
        regionIds.add(targetRegion);
      }
    }
  }

  return [...regionIds];
}
