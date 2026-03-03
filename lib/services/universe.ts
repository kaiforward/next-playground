import { prisma } from "@/lib/prisma";
import { ServiceError } from "./errors";
import type { UniverseData } from "@/lib/types/game";
import type { SystemDetailData } from "@/lib/types/api";
import { toEconomyType, toGovernmentType, toTraitId, toQualityTier, isShipTypeId } from "@/lib/types/guards";
import { TRAITS } from "@/lib/constants/traits";
import { computeVisibilitySet } from "@/lib/engine/visibility";
import { getAdjacencyList } from "./adjacency";
import { SHIP_TYPES } from "@/lib/constants/ships";
import type { ShipPosition } from "@/lib/engine/visibility";

/**
 * Get all regions, star systems, and connections.
 */
export async function getUniverse(): Promise<UniverseData> {
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
        name: true,
        economyType: true,
        x: true,
        y: true,
        description: true,
        regionId: true,
        isGateway: true,
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
