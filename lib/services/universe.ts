import { prisma } from "@/lib/prisma";
import { ServiceError } from "./errors";
import type { UniverseData, StarSystemInfo } from "@/lib/types/game";
import { toEconomyType, toRegionIdentity } from "@/lib/types/guards";

/**
 * Get all regions, star systems, and connections.
 */
export async function getUniverse(): Promise<UniverseData> {
  const [regions, systems, connections] = await Promise.all([
    prisma.region.findMany({
      select: {
        id: true,
        name: true,
        identity: true,
        x: true,
        y: true,
      },
    }),
    prisma.starSystem.findMany({
      select: {
        id: true,
        name: true,
        economyType: true,
        x: true,
        y: true,
        description: true,
        regionId: true,
        isGateway: true,
      },
    }),
    prisma.systemConnection.findMany({
      select: {
        id: true,
        fromSystemId: true,
        toSystemId: true,
        fuelCost: true,
      },
    }),
  ]);

  return {
    regions: regions.map((r) => ({
      id: r.id,
      name: r.name,
      identity: toRegionIdentity(r.identity),
      x: r.x,
      y: r.y,
    })),
    systems: systems.map((s) => ({
      id: s.id,
      name: s.name,
      economyType: toEconomyType(s.economyType),
      x: s.x,
      y: s.y,
      description: s.description,
      regionId: s.regionId,
      isGateway: s.isGateway,
    })),
    connections: connections.map((c) => ({
      id: c.id,
      fromSystemId: c.fromSystemId,
      toSystemId: c.toSystemId,
      fuelCost: c.fuelCost,
    })),
  };
}

/**
 * Get a single star system with its station info.
 * Throws ServiceError(404) if not found.
 */
export async function getSystemDetail(
  systemId: string,
): Promise<StarSystemInfo & { station: { id: string; name: string } | null }> {
  const system = await prisma.starSystem.findUnique({
    where: { id: systemId },
    include: {
      station: {
        select: { id: true, name: true },
      },
    },
  });

  if (!system) {
    throw new ServiceError("System not found.", 404);
  }

  return {
    id: system.id,
    name: system.name,
    economyType: toEconomyType(system.economyType),
    x: system.x,
    y: system.y,
    description: system.description,
    regionId: system.regionId,
    isGateway: system.isGateway,
    station: system.station
      ? { id: system.station.id, name: system.station.name }
      : null,
  };
}
