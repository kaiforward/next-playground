import { getWorld } from "@/lib/world/store";
import type { StabilityEntry } from "@/lib/types/game";

/** Per-system unrest (0…1) for the stability choropleth. */
export function getStabilityBySystem(): StabilityEntry[] {
  return getWorld().systems.map((s) => ({ systemId: s.id, unrest: s.unrest }));
}
