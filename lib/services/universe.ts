import { prisma } from "@/lib/prisma";
import { ServiceError } from "./errors";
import type { UniverseData, EconomyType, StarSystemInfo } from "@/lib/types/game";

/**
 * Get all star systems and connections.
 */
export async function getUniverse(): Promise<UniverseData> {
  const [systems, connections] = await Promise.all([
    prisma.starSystem.findMany({
      select: {
        id: true,
        name: true,
        economyType: true,
        x: true,
        y: true,
        description: true,
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
    systems: systems.map((s) => ({
      id: s.id,
      name: s.name,
      economyType: s.economyType as EconomyType,
      x: s.x,
      y: s.y,
      description: s.description,
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
    economyType: system.economyType as EconomyType,
    x: system.x,
    y: system.y,
    description: system.description,
    station: system.station
      ? { id: system.station.id, name: system.station.name }
      : null,
  };
}
