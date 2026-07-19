import { getWorld } from "@/lib/world/store";
import { buildingsBySystem, marketsBySystem } from "./world-index";
import { ServiceError } from "./errors";
import { isEconomicallyActive } from "@/lib/engine/control";
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
import { systemPopNeeds } from "@/lib/services/pop-needs";
import { marketBandForRow } from "@/lib/engine/market-pricing";
import { GOODS } from "@/lib/constants/goods";
import { BODY_ARCHETYPES } from "@/lib/constants/bodies";
import { deriveRegionDominantFaction } from "@/lib/utils/region";

/**
 * Get all regions, star systems, and connections.
 *
 * Region government is derived from each region's dominant owning faction
 * rather than stored directly on the region.
 */
export function getUniverse(): UniverseData {
  const world = getWorld();

  const factionGovById = new Map<string, GovernmentType>(
    world.factions.map((f) => [f.id, f.governmentType]),
  );
  const factionNameById = new Map<string, string>(world.factions.map((f) => [f.id, f.name]));

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
    regions: regionInfos,
    systems: world.systems.map((s) => ({
      id: s.id,
      name: s.name,
      economyType: s.economyType,
      sunClass: s.sunClass,
      x: s.x,
      y: s.y,
      description: s.description,
      regionId: s.regionId,
      factionId: s.factionId,
      isGateway: s.isGateway,
    })),
    connections: world.connections.map((c) => ({
      id: `${c.fromId}:${c.toId}`,
      fromSystemId: c.fromId,
      toSystemId: c.toId,
      fuelCost: c.fuelCost,
    })),
    factions: world.factions.map((f) => ({
      id: f.id,
      name: f.name,
      color: f.color,
      governmentType: f.governmentType,
    })),
  };
}

/**
 * Get a single star system with full detail. All systems are visible in
 * single-player (fog-of-war returns in Phase 3 — the `visibility` field and
 * the "unknown" branch of the response type stay for it).
 * Throws ServiceError(404) if not found.
 */
export function getSystemDetail(systemId: string): SystemDetailData {
  const world = getWorld();
  const system = world.systems.find((s) => s.id === systemId);
  if (!system) {
    throw new ServiceError("System not found.", 404);
  }

  return {
    id: system.id,
    name: system.name,
    economyType: system.economyType,
    sunClass: system.sunClass,
    x: system.x,
    y: system.y,
    description: system.description,
    regionId: system.regionId,
    factionId: system.factionId,
    isGateway: system.isGateway,
    visibility: "visible",
    // Stations are gone from the world model — markets are per-system.
    station: null,
  };
}

/**
 * Physical substrate for one system — the static "what is physically here".
 * Resolves catalog display data (archetype names) server-side.
 * Throws ServiceError(404) if the system does not exist.
 */
export function getSystemSubstrate(systemId: string): SystemSubstrateData {
  const world = getWorld();
  const system = world.systems.find((s) => s.id === systemId);
  if (!system) {
    throw new ServiceError("System not found.", 404);
  }

  const bodies: BodyView[] = world.bodies
    .filter((b) => b.systemId === systemId)
    .map((b) => ({
      id: b.id,
      bodyType: b.bodyType,
      archetypeName: BODY_ARCHETYPES[b.bodyType].name,
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
    }));

  return {
    visibility: "visible",
    sunClass: system.sunClass,
    availableSpace: system.availableSpace,
    habitableSpace: system.habitableSpace,
    bodies,
  };
}

/**
 * Industrial base and supply-chain state for one system.
 * Throws ServiceError(404) if the system does not exist.
 * Stock is read from the system's markets to compute per-good input gates.
 */
export function getSystemIndustry(systemId: string): SystemIndustryData {
  const world = getWorld();
  const system = world.systems.find((s) => s.id === systemId);
  if (!system) {
    throw new ServiceError("System not found.", 404);
  }
  if (!isEconomicallyActive(system.control)) return { visibility: "unknown" };

  const buildings: Record<string, number> = buildingsBySystem().get(systemId) ?? {};

  // marketStock + per-good stock band keyed by good KEY (world market rows
  // already use good keys as goodId).
  const marketStock: Record<string, number> = {};
  const minStockByGood: Record<string, number> = {};
  const maxStockByGood: Record<string, number> = {};
  for (const row of marketsBySystem().get(systemId) ?? []) {
    const band = marketBandForRow(row, GOODS[row.goodId]);
    marketStock[row.goodId] = row.stock;
    minStockByGood[row.goodId] = band.minStock;
    maxStockByGood[row.goodId] = band.maxStock;
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

  const popNeeds = systemPopNeeds(systemId, buildings, system.population);

  return {
    visibility: "visible",
    unrest: system.unrest,
    // yields are inert for the supply-chain readout (tier-1+ goods are yield-independent),
    // but feed the deposit-fill rows and the production/consumption profile below.
    ...buildIndustryReadout(
      buildings,
      system.population,
      marketStock,
      (goodKey) => minStockByGood[goodKey] ?? 0,
      yields,
      (goodKey) => maxStockByGood[goodKey],
    ),
    space: summariseSpace(system.availableSpace, system.generalSpace, system.habitableSpace, buildings),
    deposits: summariseDeposits(slotCap, worked, yields),
    goods: capacityGoodRates(buildings, system.population, yields),
    popNeeds,
  };
}
