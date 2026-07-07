import { getWorld } from "@/lib/world/store";
import { tileBounds } from "@/lib/engine/tiles";
import type { StaticTileSystem } from "@/lib/types/game";

/**
 * Static tile data: system names and economy types within a tile.
 * This data is immutable (never changes during gameplay) and cached forever by the browser.
 */
export function getStaticTile(col: number, row: number): { systems: StaticTileSystem[] } {
  const bounds = tileBounds(col, row);

  return {
    systems: getWorld()
      .systems.filter(
        (s) => s.x >= bounds.minX && s.x < bounds.maxX && s.y >= bounds.minY && s.y < bounds.maxY,
      )
      .map((s) => ({
        id: s.id,
        name: s.name,
        economyType: s.economyType,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}
