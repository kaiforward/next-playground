import { getWorld } from "@/lib/world/store";
import { buildingsBySystem } from "@/lib/services/world-index";
import { ServiceError } from "@/lib/services/errors";
import { isEconomicallyActive } from "@/lib/engine/control";
import { developmentPoints, developmentPotential } from "@/lib/engine/development-points";
import { computeLabourAllocation, labourParts } from "@/lib/engine/industry";
import { resourceVectorFromColumns, sumResourceVector } from "@/lib/engine/resources";
import { clamp } from "@/lib/utils/math";
import type { SystemVitalsData } from "@/lib/types/api";

/**
 * Dynamic vitals snapshot for one system's overview vital tiles — stability, development (vs the
 * system's OWN full-build-out potential, not a universe-wide reference), and population
 * composition. Changes every economy tick, so the hook (`useSystemVitals`) is tick-invalidated.
 */
export function getSystemVitals(systemId: string): SystemVitalsData {
  const world = getWorld();
  const system = world.systems.find((s) => s.id === systemId);
  if (!system) throw new ServiceError("System not found.", 404);
  if (!isEconomicallyActive(system.control)) return { visibility: "unknown" };

  const buildings: Record<string, number> = buildingsBySystem().get(systemId) ?? {};

  // Stability: pct moves OPPOSITE to unrest.
  const stabilityPct = (1 - system.unrest) * 100;

  // Development: points scored vs this system's own physical ceiling. potential ≤ 0 clamps
  // pct to 0 rather than dividing by zero — the clamp also absorbs points slightly exceeding
  // a base-heads-only potential (never reads over 100%).
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
  const developmentPct = potential > 0 ? clamp(points / potential, 0, 1) * 100 : 0;

  // Population: role composition from the same labour-allocation the Industry/Labour panels use.
  const composition = computeLabourAllocation(labourParts(buildings), system.population);

  return {
    visibility: "visible",
    stability: {
      pct: stabilityPct,
      unrest: system.unrest,
    },
    development: {
      points,
      potential,
      pct: developmentPct,
    },
    population: {
      headcount: system.population,
      composition: {
        unskilled: composition.unskilled,
        technicians: composition.technicians,
        engineers: composition.engineers,
        unemployed: composition.unemployed,
      },
    },
  };
}
