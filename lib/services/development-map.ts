import { getWorld } from "@/lib/world/store";
import { buildingsBySystem } from "@/lib/services/world-index";
import { developmentPoints } from "@/lib/engine/development-points";
import type { DevelopmentEntry } from "@/lib/types/game";

/**
 * Per-system development (raw tier-weighted development points) for the development choropleth
 * (all-systems bulk read). Folds each system's built base + resident population through the pure
 * `developmentPoints` — a map-only score the choropleth's value-ramp layer colours relative to the
 * scope max, exactly like population. Tick-scoped — development changes as systems grow — so the route
 * serves it `no-cache` and the client invalidates it on the tick.
 */
export function getDevelopmentBySystem(): DevelopmentEntry[] {
  const buildings = buildingsBySystem();
  const systems = getWorld().systems;
  return systems.map((s) => ({
    systemId: s.id,
    development: developmentPoints({
      buildings: buildings.get(s.id) ?? {},
      population: s.population,
    }),
  }));
}
