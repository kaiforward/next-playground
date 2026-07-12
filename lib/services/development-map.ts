import { getWorld } from "@/lib/world/store";
import { buildingsBySystem } from "@/lib/services/world-index";
import { systemDevelopment } from "@/lib/engine/development";
import type { DevelopmentEntry } from "@/lib/types/game";

/**
 * Per-system development (0..1) for the development choropleth (all-systems bulk read). Folds each
 * system's built base + resident population + habitable land through the pure `systemDevelopment`.
 * Tick-scoped — development changes as systems grow — so the route serves it `no-cache` and the
 * client invalidates it on the tick.
 */
export function getDevelopmentBySystem(): DevelopmentEntry[] {
  const buildings = buildingsBySystem();
  return getWorld().systems.map((s) => ({
    systemId: s.id,
    development: systemDevelopment({
      buildings: buildings.get(s.id) ?? {},
      population: s.population,
      habitableSpace: s.habitableSpace,
    }),
  }));
}
