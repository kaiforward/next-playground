import { getWorld } from "@/lib/world/store";
import type { PopulationEntry } from "@/lib/types/game";

/** Per-system population for the population choropleth (all-systems bulk read). */
export function getPopulationBySystem(): PopulationEntry[] {
  return getWorld().systems.map((s) => ({ systemId: s.id, population: s.population }));
}
