import { getWorld } from "@/lib/world/store";
import type { OwnershipEntry } from "@/lib/types/game";

/** Per-system ownership (faction + developed tier) for the political territory layer and the
 *  filled/hollow system markers. All-systems bulk read; tick-scoped, since claims/developments move
 *  ownership on the monthly pulse. `developed` mirrors the atlas derivation (`control === "developed"`). */
export function getOwnershipBySystem(): OwnershipEntry[] {
  return getWorld().systems.map((s) => ({
    systemId: s.id,
    factionId: s.factionId,
    developed: s.control === "developed",
  }));
}
