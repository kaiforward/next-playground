import { getWorld } from "@/lib/world/store";
import { regionInfos } from "./world-index";
import { ServiceError } from "./errors";
import { isEconomicallyActive } from "@/lib/engine/control";
import type { UniverseData } from "@/lib/types/game";
import type { SystemDetailData, SystemSubstrateData, SystemIndustryData, BodyView } from "@/lib/types/api";
import { depositCountsOf, qualityOf, effOf } from "@/lib/engine/resources";
import {
  capacityGoodRates,
  extractorsByResource,
  summariseSpace,
  summariseDeposits,
} from "@/lib/engine/industry";
import { systemPopNeeds } from "@/lib/services/pop-needs";
import { readSystemIndustry } from "@/lib/services/system-industry-readout";
import { BODY_ARCHETYPES } from "@/lib/constants/bodies";
import { occupiedBodyIds } from "@/lib/utils/substrate";

/**
 * Get all regions, star systems, and connections.
 *
 * Region government is derived from each region's dominant owning faction
 * rather than stored directly on the region.
 */
export function getUniverse(): UniverseData {
  const world = getWorld();

  return {
    regions: regionInfos(),
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
 * Throws ServiceError("not_found") if not found.
 */
export function getSystemDetail(systemId: string): SystemDetailData {
  const world = getWorld();
  const system = world.systems.find((s) => s.id === systemId);
  if (!system) {
    throw new ServiceError("System not found.", "not_found");
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
 * Throws ServiceError("not_found") if the system does not exist.
 */
export function getSystemSubstrate(systemId: string): SystemSubstrateData {
  const world = getWorld();
  const system = world.systems.find((s) => s.id === systemId);
  if (!system) {
    throw new ServiceError("System not found.", "not_found");
  }

  const systemBodies = world.bodies.filter((b) => b.systemId === systemId);
  // Same contributing-set filter + score-descending sort as the habitability fold (lib/engine/habitability.ts) and
  // `habitabilityBodiesBySystem` (lib/world/tick.ts) — re-derives WHICH bodies the cached
  // `frontierIndex` covers, never a second occupancy opinion.
  const occupied = occupiedBodyIds(
    systemBodies.map((b) => ({
      id: b.id,
      score: BODY_ARCHETYPES[b.bodyType].scores.default,
      peopleLand: b.peopleLand,
      locked: BODY_ARCHETYPES[b.bodyType].techLocked,
    })),
    system.habitabilityQuality,
  );

  const bodies: BodyView[] = systemBodies.map((b) => {
    const arch = BODY_ARCHETYPES[b.bodyType];
    return {
      id: b.id,
      bodyType: b.bodyType,
      archetypeName: arch.name,
      score: arch.scores.default,
      locked: arch.techLocked,
      counts: depositCountsOf(b),
      quality: qualityOf(b),
      peopleLand: b.peopleLand,
      extractionModifier: arch.extractionModifier,
      occupied: occupied.has(b.id),
    };
  });

  return {
    visibility: "visible",
    sunClass: system.sunClass,
    peopleLand: system.peopleLand,
    bodies,
  };
}

/**
 * Industrial base and supply-chain state for one system.
 * Throws ServiceError("not_found") if the system does not exist.
 * Stock is read from the system's markets to compute per-good input gates.
 */
export function getSystemIndustry(systemId: string): SystemIndustryData {
  const world = getWorld();
  const system = world.systems.find((s) => s.id === systemId);
  if (!system) {
    throw new ServiceError("System not found.", "not_found");
  }
  if (!isEconomicallyActive(system.control)) return { visibility: "unknown" };

  // The shared readout context (buildings roster, yields, the four per-good market accessors) —
  // assembled once in system-industry-readout.ts so this panel read and the alert bar's idle-capacity
  // read can never disagree about what a building's `used` is. yields are inert for the supply-chain
  // readout (tier-1+ goods are yield-independent), but feed the deposit-fill rows and the
  // production/consumption profile below.
  const { buildings, yields, readout } = readSystemIndustry(system);

  const depositCounts = depositCountsOf(system);
  const worked = extractorsByResource(buildings);

  // The readout's labourAllocation IS the civilian demand basis — reuse it
  // rather than running a second labour pass for the needs read.
  const popNeeds = systemPopNeeds(systemId, readout.labourAllocation);

  return {
    visibility: "visible",
    unrest: system.unrest,
    ...readout,
    space: summariseSpace(system.peopleLand, depositCounts, buildings),
    deposits: summariseDeposits(depositCounts, worked, yields),
    goods: capacityGoodRates(buildings, system.population, yields, effOf(system)),
    popNeeds,
  };
}
