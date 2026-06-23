import { prisma } from "@/lib/prisma";
import { ServiceError } from "./errors";
import type { GovernmentType, RegionInfo, UniverseData } from "@/lib/types/game";
import type { SystemDetailData, SystemSubstrateData, SystemIndustryData, BodyView } from "@/lib/types/api";
import { resourceVectorFromColumns } from "@/lib/engine/resources";
import {
  capacityGoodRates,
  buildIndustryReadout,
  extractorsByResource,
  summariseSpace,
  summariseDeposits,
} from "@/lib/engine/industry";
import { marketBandForRow } from "@/lib/engine/market-pricing";
import { shardGroupForIndex } from "@/lib/tick/shard";
import { ECONOMY_UPDATE_INTERVAL } from "@/lib/constants/tick-cadence";
import { GOOD_NAME_TO_KEY } from "@/lib/constants/goods";
import { toSunClass, toBodyArchetypeId } from "@/lib/types/guards";
import { BODY_ARCHETYPES } from "@/lib/constants/bodies";
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
 * Resolves catalog display data (archetype names) server-side,
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
      relationLoadStrategy: "join",
      select: {
        sunClass: true,
        availableSpace: true,
        habitableSpace: true,
        bodies: {
          select: {
            id: true, bodyType: true, habitable: true, size: true,
            slotGas: true, slotMinerals: true, slotOre: true, slotBiomass: true,
            slotArable: true, slotWater: true, slotRadioactive: true,
            qualGas: true, qualMinerals: true, qualOre: true, qualBiomass: true,
            qualArable: true, qualWater: true, qualRadioactive: true,
          },
        },
      },
    }),
  ]);

  if (!system) {
    throw new ServiceError("System not found.", 404);
  }
  if (!visibleSet.has(systemId)) {
    return { visibility: "unknown" };
  }

  const bodies: BodyView[] = system.bodies.map((b) => {
    const bodyType = toBodyArchetypeId(b.bodyType);
    return {
      id: b.id,
      bodyType,
      archetypeName: BODY_ARCHETYPES[bodyType].name,
      habitable: b.habitable,
      size: b.size,
      slots: resourceVectorFromColumns(
        {
          slotGas: b.slotGas, slotMinerals: b.slotMinerals, slotOre: b.slotOre,
          slotBiomass: b.slotBiomass, slotArable: b.slotArable,
          slotWater: b.slotWater, slotRadioactive: b.slotRadioactive,
        },
        "slot",
      ),
      quality: resourceVectorFromColumns(
        {
          qualGas: b.qualGas, qualMinerals: b.qualMinerals, qualOre: b.qualOre,
          qualBiomass: b.qualBiomass, qualArable: b.qualArable,
          qualWater: b.qualWater, qualRadioactive: b.qualRadioactive,
        },
        "qual",
      ),
    };
  });

  return {
    visibility: "visible",
    sunClass: toSunClass(system.sunClass),
    availableSpace: system.availableSpace,
    habitableSpace: system.habitableSpace,
    bodies,
  };
}

/**
 * Industrial base and supply-chain state for one system.
 * Visibility-gated: an unsurveyed system returns `{ visibility: "unknown" }`.
 * Throws ServiceError(404) if the system does not exist.
 * Stock is read from the system's station market to compute per-good input gates.
 */
export async function getSystemIndustry(
  playerId: string,
  systemId: string,
): Promise<SystemIndustryData> {
  const [{ visibleSet }, system] = await Promise.all([
    getPlayerVisibility(playerId),
    prisma.starSystem.findUnique({
      where: { id: systemId },
      relationLoadStrategy: "join",
      select: {
        population: true,
        unrest: true,
        availableSpace: true,
        generalSpace: true,
        habitableSpace: true,
        slotGas: true, slotMinerals: true, slotOre: true, slotBiomass: true,
        slotArable: true, slotWater: true, slotRadioactive: true,
        yieldGas: true, yieldMinerals: true, yieldOre: true, yieldBiomass: true,
        yieldArable: true, yieldWater: true, yieldRadioactive: true,
        buildings: { select: { buildingType: true, count: true } },
        station: {
          select: {
            markets: {
              select: {
                stock: true,
                demandRate: true,
                storageCapacity: true,
                good: { select: { name: true, priceFloor: true, priceCeiling: true } },
              },
            },
          },
        },
      },
    }),
  ]);

  if (!system) {
    throw new ServiceError("System not found.", 404);
  }
  if (!visibleSet.has(systemId)) {
    return { visibility: "unknown" };
  }

  // Which economy shard this system lands in — static (its id-rank in the same
  // id-asc order the economy processor shards over, see lib/tick/adapters/prisma/
  // economy.ts getSystemIds). The client pairs this with the live tick to count
  // down to the next economy update; the value itself never changes.
  const [systemCount, systemRank] = await Promise.all([
    prisma.starSystem.count(),
    prisma.starSystem.count({ where: { id: { lt: systemId } } }),
  ]);
  const economyShardGroup = shardGroupForIndex(systemRank, systemCount, ECONOMY_UPDATE_INTERVAL);

  const buildings: Record<string, number> = {};
  for (const b of system.buildings) buildings[b.buildingType] = b.count;

  // marketStock + per-good reserve floor keyed by good KEY (the supply-chain
  // readout indexes by key, not DB id — mirror the tick adapter's mapping).
  const marketStock: Record<string, number> = {};
  const minStockByGood: Record<string, number> = {};
  if (system.station) {
    for (const row of system.station.markets) {
      const goodKey = GOOD_NAME_TO_KEY.get(row.good.name) ?? row.good.name;
      marketStock[goodKey] = row.stock;
      minStockByGood[goodKey] = marketBandForRow(row, row.good).minStock;
    }
  }

  const slotCap = resourceVectorFromColumns(
    {
      slotGas: system.slotGas, slotMinerals: system.slotMinerals, slotOre: system.slotOre,
      slotBiomass: system.slotBiomass, slotArable: system.slotArable,
      slotWater: system.slotWater, slotRadioactive: system.slotRadioactive,
    },
    "slot",
  );
  const yields = resourceVectorFromColumns(
    {
      yieldGas: system.yieldGas, yieldMinerals: system.yieldMinerals, yieldOre: system.yieldOre,
      yieldBiomass: system.yieldBiomass, yieldArable: system.yieldArable,
      yieldWater: system.yieldWater, yieldRadioactive: system.yieldRadioactive,
    },
    "yield",
  );
  const worked = extractorsByResource(buildings);

  return {
    visibility: "visible",
    economyShardGroup,
    unrest: system.unrest,
    // yields are inert for the supply-chain readout (tier-1+ goods are yield-independent),
    // but feed the deposit-fill rows and the production/consumption profile below.
    ...buildIndustryReadout(
      buildings,
      system.population,
      marketStock,
      (goodKey) => minStockByGood[goodKey] ?? 0,
      yields,
    ),
    space: summariseSpace(system.availableSpace, system.generalSpace, system.habitableSpace, buildings),
    deposits: summariseDeposits(slotCap, worked, yields),
    goods: capacityGoodRates(buildings, system.population, yields),
  };
}
