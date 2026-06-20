import { prisma } from "@/lib/prisma";
import { ServiceError } from "./errors";
import type { GovernmentType, RegionInfo, UniverseData } from "@/lib/types/game";
import type { SystemDetailData, SystemSubstrateData, BodyView } from "@/lib/types/api";
import { resourceVectorFromColumns } from "@/lib/engine/resources";
import { capacityGoodRates } from "@/lib/engine/industry";
import { toSunClass, toBodyArchetypeId, toRichnessModifierId } from "@/lib/types/guards";
import { BODY_ARCHETYPES, RICHNESS_MODIFIERS } from "@/lib/constants/bodies";
import { getPlayerVisibility } from "./visibility-cache";
import { toEconomyType, toGovernmentType, toTraitId, toQualityTier, isShipTypeId } from "@/lib/types/guards";
import { TRAITS } from "@/lib/constants/traits";
import { computeVisibilitySet } from "@/lib/engine/visibility";
import { getAdjacencyList } from "./adjacency";
import { SHIP_TYPES } from "@/lib/constants/ships";
import { deriveRegionDominantFaction } from "@/lib/utils/region";
import type { ShipPosition } from "@/lib/engine/visibility";

/**
 * Get all regions, star systems, and connections.
 *
 * Region government is derived from each region's dominant owning faction
 * rather than stored directly on the region.
 */
export async function getUniverse(): Promise<UniverseData> {
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
        name: true,
        economyType: true,
        x: true,
        y: true,
        description: true,
        regionId: true,
        isGateway: true,
        factionId: true,
        traits: { select: { traitId: true, quality: true } },
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
      name: s.name,
      economyType: toEconomyType(s.economyType),
      x: s.x,
      y: s.y,
      description: s.description,
      regionId: s.regionId,
      factionId: s.factionId,
      isGateway: s.isGateway,
      traits: s.traits.map((t) => ({
        traitId: toTraitId(t.traitId),
        quality: toQualityTier(t.quality),
      })),
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
      governmentType: toGovernmentType(f.governmentType),
    })),
  };
}

/**
 * Get a single star system, gated by fog-of-war visibility.
 * Visible systems return full detail; unknown systems return basic info only.
 * Throws ServiceError(404) if not found.
 */
export async function getSystemDetail(
  systemId: string,
  playerId: string,
): Promise<SystemDetailData> {
  const [system, playerShips, adjacency] = await Promise.all([
    prisma.starSystem.findUnique({
      where: { id: systemId },
      include: {
        station: { select: { id: true, name: true } },
        traits: { select: { traitId: true, quality: true } },
        faction: { select: { id: true } },
      },
    }),
    prisma.ship.findMany({
      where: { playerId },
      select: { systemId: true, shipType: true },
    }),
    getAdjacencyList(),
  ]);

  if (!system) {
    throw new ServiceError("System not found.", 404);
  }

  // Compute visibility
  const shipPositions: ShipPosition[] = [];
  for (const s of playerShips) {
    if (isShipTypeId(s.shipType)) {
      shipPositions.push({ systemId: s.systemId, role: SHIP_TYPES[s.shipType].role });
    }
  }
  const visibilitySet = computeVisibilitySet(shipPositions, adjacency);

  const economyType = toEconomyType(system.economyType);

  if (!visibilitySet.has(systemId)) {
    return {
      id: system.id,
      name: system.name,
      economyType,
      regionId: system.regionId,
      isGateway: system.isGateway,
      visibility: "unknown",
    };
  }

  return {
    id: system.id,
    name: system.name,
    economyType,
    x: system.x,
    y: system.y,
    description: system.description,
    regionId: system.regionId,
    factionId: system.factionId,
    isGateway: system.isGateway,
    visibility: "visible",
    station: system.station
      ? { id: system.station.id, name: system.station.name }
      : null,
    traits: system.traits.map((t) => {
      const traitId = toTraitId(t.traitId);
      const quality = toQualityTier(t.quality);
      const def = TRAITS[traitId];
      return {
        traitId,
        quality,
        name: def.name,
        category: def.category,
        description: def.descriptions[quality],
      };
    }),
  };
}

/**
 * Physical substrate for one system — reads the substrate columns.
 * Visibility-gated: an unsurveyed (invisible) system
 * returns `{ visibility: "unknown" }` so a direct URL can't leak survey data.
 * Resolves catalog display data (archetype + richness names) server-side,
 * mirroring how getSystemDetail resolves trait names.
 */
export async function getSystemSubstrate(
  playerId: string,
  systemId: string,
): Promise<SystemSubstrateData> {
  const [{ visibleSet }, system] = await Promise.all([
    getPlayerVisibility(playerId),
    prisma.starSystem.findUnique({
      where: { id: systemId },
      select: {
        sunClass: true,
        population: true,
        popCap: true,
        aggGas: true, aggMinerals: true, aggOre: true, aggBiomass: true,
        aggArable: true, aggWater: true, aggRadioactive: true,
        bodies: {
          select: {
            id: true, bodyType: true, habitable: true, size: true, popCapWeight: true,
            resGas: true, resMinerals: true, resOre: true, resBiomass: true,
            resArable: true, resWater: true, resRadioactive: true,
            richnessModifiers: true,
          },
        },
        buildings: { select: { buildingType: true, count: true } },
      },
    }),
  ]);

  if (!system) {
    throw new ServiceError("System not found.", 404);
  }
  if (!visibleSet.has(systemId)) {
    return { visibility: "unknown" };
  }

  const aggregate = resourceVectorFromColumns(
    {
      aggGas: system.aggGas, aggMinerals: system.aggMinerals, aggOre: system.aggOre,
      aggBiomass: system.aggBiomass, aggArable: system.aggArable,
      aggWater: system.aggWater, aggRadioactive: system.aggRadioactive,
    },
    "agg",
  );

  const bodies: BodyView[] = system.bodies.map((b) => {
    const bodyType = toBodyArchetypeId(b.bodyType);
    return {
      id: b.id,
      bodyType,
      archetypeName: BODY_ARCHETYPES[bodyType].name,
      habitable: b.habitable,
      size: b.size,
      popCapWeight: b.popCapWeight,
      resources: resourceVectorFromColumns(
        {
          resGas: b.resGas, resMinerals: b.resMinerals, resOre: b.resOre,
          resBiomass: b.resBiomass, resArable: b.resArable,
          resWater: b.resWater, resRadioactive: b.resRadioactive,
        },
        "res",
      ),
      richness: b.richnessModifiers.map((id) => {
        const richnessId = toRichnessModifierId(id);
        const def = RICHNESS_MODIFIERS[richnessId];
        return {
          id: richnessId,
          name: def.name,
          resource: def.resource,
          multiplier: def.multiplier,
        };
      }),
    };
  });

  const buildings: Record<string, number> = {};
  for (const b of system.buildings) buildings[b.buildingType] = b.count;

  return {
    visibility: "visible",
    sunClass: toSunClass(system.sunClass),
    population: system.population,
    popCap: system.popCap,
    aggregate,
    bodies,
    goods: capacityGoodRates(buildings, system.population),
  };
}
