import { prisma } from "@/lib/prisma";
import type { StabilityEntry } from "@/lib/types/game";

/** Per-system unrest (0…1) for the stability choropleth. */
export async function getStabilityBySystem(): Promise<StabilityEntry[]> {
  const rows = await prisma.starSystem.findMany({ select: { id: true, unrest: true } });
  return rows.map((r) => ({ systemId: r.id, unrest: r.unrest }));
}
