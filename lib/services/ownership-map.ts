import { getWorld } from "@/lib/world/store";
import type { OwnershipEntry } from "@/lib/types/game";

/** Per-system ownership (faction + developed tier + forming colony) for the political territory
 *  layer and the settlement marks. All-systems bulk read; tick-scoped, since claims/developments
 *  move ownership on the cycle start. `developed` mirrors the atlas derivation
 *  (`control === "developed"`); `forming` is an open colony-establish project at the system. */
export function getOwnershipBySystem(): OwnershipEntry[] {
  const world = getWorld();
  const forming = new Set<string>();
  for (const p of world.constructionProjects) {
    if (p.kind === "colony_establish") forming.add(p.systemId);
  }
  return world.systems.map((s) => ({
    systemId: s.id,
    factionId: s.factionId,
    developed: s.control === "developed",
    forming: forming.has(s.id),
  }));
}
