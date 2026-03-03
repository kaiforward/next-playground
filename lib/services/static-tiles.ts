import { prisma } from "@/lib/prisma";
import { tileBounds } from "@/lib/engine/tiles";
import { toEconomyType } from "@/lib/types/guards";
import type { StaticTileSystem } from "@/lib/types/game";

/**
 * Static tile data: system names and economy types within a tile.
 * This data is immutable (never changes during gameplay) and cached forever by the browser.
 */
export async function getStaticTile(
  col: number,
  row: number,
): Promise<{ systems: StaticTileSystem[] }> {
  const bounds = tileBounds(col, row);

  const systems = await prisma.starSystem.findMany({
    where: {
      x: { gte: bounds.minX, lt: bounds.maxX },
      y: { gte: bounds.minY, lt: bounds.maxY },
    },
    select: {
      id: true,
      name: true,
      economyType: true,
    },
    orderBy: { id: "asc" },
  });

  return {
    systems: systems.map((s) => ({
      id: s.id,
      name: s.name,
      economyType: toEconomyType(s.economyType),
    })),
  };
}
