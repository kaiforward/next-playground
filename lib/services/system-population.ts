import { prisma } from "@/lib/prisma";
import { ServiceError } from "@/lib/services/errors";
import { getPlayerVisibility } from "@/lib/services/visibility-cache";
import { STRIKE_PARAMS } from "@/lib/constants/population";
import { demandFootprint } from "@/lib/constants/market-economy";
import { GOODS } from "@/lib/constants/goods";
import type { SystemPopulationData } from "@/lib/types/api";

/**
 * Dynamic population & social state for one system — population, popCap, unrest,
 * a strike flag, and the demand footprint. Visibility-gated (an unsurveyed system
 * returns `{ visibility: "unknown" }` so a direct URL can't leak survey data),
 * mirroring getSystemSubstrate. Unlike the substrate read, these fields change
 * every economy tick, so the hook (`useSystemPopulation`) is tick-invalidated.
 */
export async function getSystemPopulation(
  playerId: string,
  systemId: string,
): Promise<SystemPopulationData> {
  const [{ visibleSet }, system] = await Promise.all([
    getPlayerVisibility(playerId),
    prisma.starSystem.findUnique({
      where: { id: systemId },
      select: { population: true, popCap: true, unrest: true },
    }),
  ]);

  if (!system) throw new ServiceError("System not found.", 404);
  if (!visibleSet.has(systemId)) return { visibility: "unknown" };

  // Full consumption footprint (already filtered to consumed goods, demand-sorted).
  const demand = demandFootprint(system.population).map((e) => ({
    goodId: e.goodId,
    goodName: GOODS[e.goodId]?.name ?? e.goodId,
    demandRate: e.demandRate,
  }));

  return {
    visibility: "visible",
    population: system.population,
    popCap: system.popCap,
    unrest: system.unrest,
    striking: system.unrest >= STRIKE_PARAMS.threshold,
    demand,
  };
}
