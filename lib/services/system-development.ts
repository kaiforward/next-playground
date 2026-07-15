import { developmentPoints, developmentPotential } from "@/lib/engine/development-points";
import { resourceVectorFromColumns, sumResourceVector } from "@/lib/engine/resources";
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
  const slotCap = resourceVectorFromColumns(
    {
      slotGas: system.slotGas,
      slotMinerals: system.slotMinerals,
      slotOre: system.slotOre,
      slotBiomass: system.slotBiomass,
      slotArable: system.slotArable,
      slotWater: system.slotWater,
      slotRadioactive: system.slotRadioactive,
    },
    "slot",
  );
  const potential = developmentPotential({
    habitableSpace: system.habitableSpace,
    generalSpace: system.generalSpace,
    depositSlots: sumResourceVector(slotCap),
  });
  return { points, potential };
}
