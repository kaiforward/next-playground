import { GOODS } from "@/lib/constants/goods";
import type { GoodInfo } from "@/lib/types/game";

/**
 * Returns the universal goods catalog, read straight from the code constants
 * (goods have no per-world state). Safe to cache aggressively on the client.
 * Sorted by tier ascending then name for stable picker ordering.
 */
export function getGoods(): GoodInfo[] {
  return Object.entries(GOODS)
    .map(([id, def]) => ({
      id,
      name: def.name,
      basePrice: def.basePrice,
      tier: def.tier,
    }))
    .sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));
}
