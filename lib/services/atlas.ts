import { prisma } from "@/lib/prisma";
import type { AtlasData, GovernmentType, RegionInfo } from "@/lib/types/game";
import { toEconomyType, toGovernmentType } from "@/lib/types/guards";
import { deriveRegionDominantFaction } from "@/lib/utils/region";

/**
 * Lightweight map data: positions, economies, regions, connections.
 * No names, descriptions, or traits — those are fetched via static/dynamic tiles.
 *
 * After the Layer 2 cutover, each region's government is derived from its
 * dominant owning faction rather than stored on the region itself.
 */
export async function getAtlas(): Promise<AtlasData> {
  const [regions, systems, connections, factions] = await Promise.all([
    prisma.region.findMany({
      select: {
        id: true,
        name: true,
        dominantEconomy: true,
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
        factionId: true,
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
    prisma.faction.findMany({
      select: { id: true, name: true, color: true, governmentType: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const factionGovById = new Map<string, GovernmentType>(
    factions.map((f) => [f.id, toGovernmentType(f.governmentType)]),
  );
  const factionNameById = new Map<string, string>(
    factions.map((f) => [f.id, f.name]),
  );

  const systemFactionsByRegion = new Map<string, string[]>();
  for (const s of systems) {
    if (!s.factionId) continue;
    const list = systemFactionsByRegion.get(s.regionId) ?? [];
    list.push(s.factionId);
    systemFactionsByRegion.set(s.regionId, list);
  }

  const regionInfos: RegionInfo[] = regions.map((r) => {
    const dominantFactionId = deriveRegionDominantFaction(
      systemFactionsByRegion.get(r.id) ?? [],
      factionNameById,
    );
    const dominantGov: GovernmentType = dominantFactionId
      ? factionGovById.get(dominantFactionId) ?? "frontier"
      : "frontier";
    return {
      id: r.id,
      name: r.name,
      dominantEconomy: toEconomyType(r.dominantEconomy),
      dominantFactionId,
      dominantGovernmentType: dominantGov,
      x: r.x,
      y: r.y,
    };
  });

  return {
    regions: regionInfos,
    systems: systems.map((s) => ({
      id: s.id,
      x: s.x,
      y: s.y,
      regionId: s.regionId,
      factionId: s.factionId,
      economyType: toEconomyType(s.economyType),
      isGateway: s.isGateway,
    })),
    connections: connections.map((c) => ({
      id: c.id,
      fromSystemId: c.fromSystemId,
      toSystemId: c.toSystemId,
      fuelCost: c.fuelCost,
    })),
    factions: factions.map((f) => ({
      id: f.id,
      name: f.name,
      color: f.color,
    })),
  };
}
