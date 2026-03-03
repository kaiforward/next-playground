import { prisma } from "@/lib/prisma";
import type { AtlasData } from "@/lib/types/game";
import { toEconomyType, toGovernmentType } from "@/lib/types/guards";

/**
 * Lightweight map data: positions, economies, regions, connections.
 * No names, descriptions, or traits — those are fetched via static/dynamic tiles.
 */
export async function getAtlas(): Promise<AtlasData> {
  const [regions, systems, connections] = await Promise.all([
    prisma.region.findMany({
      select: {
        id: true,
        name: true,
        dominantEconomy: true,
        governmentType: true,
        x: true,
        y: true,
      },
    }),
    prisma.starSystem.findMany({
      select: {
        id: true,
        x: true,
        y: true,
        regionId: true,
        economyType: true,
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
      dominantEconomy: toEconomyType(r.dominantEconomy),
      governmentType: toGovernmentType(r.governmentType),
      x: r.x,
      y: r.y,
    })),
    systems: systems.map((s) => ({
      id: s.id,
      x: s.x,
      y: s.y,
      regionId: s.regionId,
      economyType: toEconomyType(s.economyType),
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