import { getWorld } from "@/lib/world/store";
import { buildingsBySystem } from "@/lib/services/world-index";
import { ServiceError } from "@/lib/services/errors";
import { isEconomicallyActive } from "@/lib/engine/control";
import { developmentPointsAndPotential } from "@/lib/services/system-development";
import { clamp, weightedMean } from "@/lib/utils/math";
import type { FactionVitalsData } from "@/lib/types/api";

/**
 * Faction-level roll-up of the overview vitals across the faction's economically-active systems.
 * Population and development points/potential SUM (extensive); stability is a population-weighted mean
 * (intensive) so a populous core dominates instead of a plain per-system mean that dilutes on
 * expansion. Tick-dynamic — the hook is tick-invalidated.
 */
export function getFactionVitals(factionId: string): FactionVitalsData {
  const world = getWorld();
  const faction = world.factions.find((f) => f.id === factionId);
  if (!faction) throw new ServiceError(`Faction ${factionId} not found.`, 404);

  const buildings = buildingsBySystem();
  const owned = world.systems.filter((s) => s.factionId === factionId);
  const active = owned.filter((s) => isEconomicallyActive(s.control));

  let population = 0;
  let developmentPoints = 0;
  let developmentPotential = 0;
  const stabilityValues: number[] = [];
  const stabilityWeights: number[] = [];

  for (const s of active) {
    population += s.population;
    const dev = developmentPointsAndPotential(s, buildings.get(s.id) ?? {});
    developmentPoints += dev.points;
    developmentPotential += dev.potential;
    stabilityValues.push(1 - s.unrest);
    stabilityWeights.push(s.population);
  }

  const stabilityPct = weightedMean(stabilityValues, stabilityWeights) * 100;
  const developmentPct =
    developmentPotential > 0 ? clamp(developmentPoints / developmentPotential, 0, 1) * 100 : 0;

  return {
    territorySize: owned.length,
    activeSystemCount: active.length,
    population,
    stabilityPct,
    developmentPoints,
    developmentPotential,
    developmentPct,
  };
}
