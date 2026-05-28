import { prisma } from "@/lib/prisma";
import { calculatePrice } from "@/lib/engine/pricing";
import { ServiceError } from "./errors";
import { getPlayerVisibility } from "./visibility-cache";
import { GOODS } from "@/lib/constants/goods";
import type { MarketComparisonEntry } from "@/lib/types/game";

/**
 * Returns price/supply/demand for one good across all systems visible to the player.
 * Supply and demand are floored for display (matching getMarket); price calculation
 * uses the raw float ratio for signal fidelity.
 *
 * `goodId` accepts either the database CUID (used by `MarketEntry.goodId` from
 * `getMarket()`) OR a `GOODS` constant key (used by the map overlay good picker
 * which has no easy access to CUIDs). Constant keys are resolved to the
 * corresponding `Good.name` lookup.
 *
 * Throws ServiceError(404) if the good does not exist.
 */
export async function getMarketComparison(
  playerId: string,
  goodId: string,
): Promise<{ goodId: string; entries: MarketComparisonEntry[] }> {
  const goodNameFromKey = GOODS[goodId]?.name;
  const good = await prisma.good.findFirst({
    where: goodNameFromKey
      ? { OR: [{ id: goodId }, { name: goodNameFromKey }] }
      : { id: goodId },
    select: { id: true, basePrice: true, priceFloor: true, priceCeiling: true },
  });

  if (!good) {
    throw new ServiceError("Good not found.", 404);
  }

  const { visibleSet } = await getPlayerVisibility(playerId);
  if (visibleSet.size === 0) {
    return { goodId: good.id, entries: [] };
  }

  const visibleIds = [...visibleSet];

  // Stations are 1:1 with systems by `systemId`. Query markets for this good
  // whose station's system is visible. Use the resolved CUID, not the raw input.
  const markets = await prisma.stationMarket.findMany({
    where: {
      goodId: good.id,
      station: { systemId: { in: visibleIds } },
    },
    select: {
      supply: true,
      demand: true,
      station: { select: { systemId: true } },
    },
  });

  const entries: MarketComparisonEntry[] = markets.map((m) => ({
    systemId: m.station.systemId,
    basePrice: good.basePrice,
    // Price uses the raw float ratio (smoother signal); supply/demand are floored
    // for display so the player never sees fractional goods.
    currentPrice: calculatePrice(
      good.basePrice,
      m.supply,
      m.demand,
      good.priceFloor,
      good.priceCeiling,
    ),
    supply: Math.floor(m.supply),
    demand: Math.floor(m.demand),
  }));

  return { goodId: good.id, entries };
}
