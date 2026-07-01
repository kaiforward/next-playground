import { prisma } from "@/lib/prisma";
import type { PopulationEntry } from "@/lib/types/game";

/** Per-system population for the population choropleth (all-systems bulk read). */
export async function getPopulationBySystem(): Promise<PopulationEntry[]> {
  const rows = await prisma.starSystem.findMany({ select: { id: true, population: true } });
  return rows.map((r) => ({ systemId: r.id, population: r.population }));
}
