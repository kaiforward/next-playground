import { getWorld } from "@/lib/world/store";
import { buildingsBySystem } from "@/lib/services/world-index";
import { labourDemand } from "@/lib/engine/industry";
import { migrationAttractiveness } from "@/lib/engine/migration";
import { MIGRATION_PARAMS } from "@/lib/constants/population";
import type { MigrationEntry } from "@/lib/types/game";

/**
 * Per-system migration attractiveness (the pull score) for the migration choropleth — reuses the exact
 * pure `migrationAttractiveness` function and `MIGRATION_PARAMS.weights` the migration processor acts
 * on, so the map colours the same number that drives population flow. Developed systems only: an
 * undeveloped system has no meaningful attraction, so it's gated out here rather than the map drawing a
 * hollow value for it. Map-only/single-consumer read, so the gate lives in this service (unlike
 * stability, which returns all systems because it's shared with a badge consumer).
 */
export function getMigrationBySystem(): MigrationEntry[] {
  const buildings = buildingsBySystem();
  const systems = getWorld().systems;
  const entries: MigrationEntry[] = [];
  for (const s of systems) {
    if (s.control !== "developed") continue;
    entries.push({
      systemId: s.id,
      attraction: migrationAttractiveness(
        {
          unrest: s.unrest,
          population: s.population,
          popCap: s.popCap,
          labourDemand: labourDemand(buildings.get(s.id) ?? {}),
        },
        MIGRATION_PARAMS.weights,
      ),
    });
  }
  return entries;
}
