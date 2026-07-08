import { getWorld } from "@/lib/world/store";
import type { AtlasData, GovernmentType, RegionInfo } from "@/lib/types/game";
import { deriveRegionDominantFaction } from "@/lib/utils/region";

/**
 * Lightweight map data: positions, economies, regions, connections.
 * No names, descriptions, or traits — those are fetched via static/dynamic tiles.
 *
 * Each region's government is derived from its dominant owning faction
 * rather than stored on the region itself.
 */
export function getAtlas(): AtlasData {
  const world = getWorld();
  const factions = [...world.factions].sort((a, b) => a.name.localeCompare(b.name));

  const factionGovById = new Map<string, GovernmentType>(
    factions.map((f) => [f.id, f.governmentType]),
  );
  const factionNameById = new Map<string, string>(factions.map((f) => [f.id, f.name]));

  const systemFactionsByRegion = new Map<string, string[]>();
  for (const s of world.systems) {
    if (!s.factionId) continue;
    const list = systemFactionsByRegion.get(s.regionId) ?? [];
    list.push(s.factionId);
    systemFactionsByRegion.set(s.regionId, list);
  }

  const regionInfos: RegionInfo[] = world.regions.map((r) => {
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
      dominantEconomy: r.dominantEconomy,
      dominantFactionId,
      dominantGovernmentType: dominantGov,
      x: r.x,
      y: r.y,
    };
  });

  return {
    meta: {
      mapSize: world.meta.mapSize,
      systemCount: world.meta.systemCount,
      seed: world.meta.seed,
    },
    regions: regionInfos,
    systems: world.systems.map((s) => ({
      id: s.id,
      x: s.x,
      y: s.y,
      regionId: s.regionId,
      factionId: s.factionId,
      economyType: s.economyType,
      isGateway: s.isGateway,
      developed: s.control === "developed",
    })),
    connections: world.connections.map((c) => ({
      id: `${c.fromId}:${c.toId}`,
      fromSystemId: c.fromId,
      toSystemId: c.toId,
      fuelCost: c.fuelCost,
    })),
    factions: factions.map((f) => ({
      id: f.id,
      name: f.name,
      color: f.color,
    })),
  };
}
