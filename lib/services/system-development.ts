import { developmentPoints, developmentPotential } from "@/lib/engine/development-points";
import { depositCountsOf, sumResourceVector } from "@/lib/engine/resources";
import type { WorldSystem } from "@/lib/world/types";

/**
 * A system's raw development points scored + its own full-build-out ceiling — the pair the system
 * overview vital and the faction Overview roll-up both read (shared so the potential assembly can't
 * drift between them). Distinct from the build planner's `systemDevelopment` (a 0..1 saturated
 * measure vs a universe reference); this is the absolute points/potential the vital tiles use.
 * `buildings` is the system's building-count map.
 */
export function developmentPointsAndPotential(
  system: WorldSystem,
  buildings: Record<string, number>,
): { points: number; potential: number } {
  const points = developmentPoints({ buildings, population: system.population });
  const depositCounts = depositCountsOf(system);
  const potential = developmentPotential({
    peopleLand: system.peopleLand,
    industryLand: system.industryLand,
    depositCounts: sumResourceVector(depositCounts),
  });
  return { points, potential };
}
