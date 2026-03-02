import { prisma } from "@/lib/prisma";
import type { AtlasData, StarSystemInfo } from "@/lib/types/game";
import { toEconomyType, toGovernmentType, toTraitId, toQualityTier } from "@/lib/types/guards";

/**
 * Lightweight map data: positions, economies, regions, connections.
 * No names, descriptions, or traits — those are fetched per-viewport.
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

interface ViewportBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Full system data for systems within a bounding box.
 * Used to load detail progressively when zoomed in.
 */
export async function getViewportSystems(
  bounds: ViewportBounds,
): Promise<StarSystemInfo[]> {
  const systems = await prisma.starSystem.findMany({
    where: {
      x: { gte: bounds.minX, lte: bounds.maxX },
      y: { gte: bounds.minY, lte: bounds.maxY },
    },
    select: {
      id: true,
      name: true,
      economyType: true,
      x: true,
      y: true,
      description: true,
      regionId: true,
      isGateway: true,
      traits: { select: { traitId: true, quality: true } },
    },
  });

  return systems.map((s) => ({
    id: s.id,
    name: s.name,
    economyType: toEconomyType(s.economyType),
    x: s.x,
    y: s.y,
    description: s.description,
    regionId: s.regionId,
    isGateway: s.isGateway,
    traits: s.traits.map((t) => ({
      traitId: toTraitId(t.traitId),
      quality: toQualityTier(t.quality),
    })),
  }));
}
