import { prisma } from "@/lib/prisma";
import { spotPrice, curveForGood } from "@/lib/engine/market-pricing";
import { GOOD_NAME_TO_KEY } from "@/lib/constants/goods";
import { ServiceError } from "./errors";
import { getPlayerVisibility } from "./visibility-cache";
import type { MarketComparisonEntry } from "@/lib/types/game";

/**
 * Returns price/stock for one good across all systems visible to the player.
 * Stock is floored for display (matching getMarket); the mid price is derived
 * from stock via the good's price curve.
 *
 * `goodId` is the database CUID. Clients that don't have a CUID handy (e.g. the
 * map overlay picker) should fetch the catalog via `useGoods()` first.
 *
 * Throws ServiceError(404) if the good does not exist.
 */
export async function getMarketComparison(
  playerId: string,
  goodId: string,
): Promise<{ goodId: string; entries: MarketComparisonEntry[] }> {
  const good = await prisma.good.findUnique({
    where: { id: goodId },
    select: { id: true, name: true, basePrice: true, priceFloor: true, priceCeiling: true },
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
  // whose station's system is visible.
  const markets = await prisma.stationMarket.findMany({
    where: {
      goodId: good.id,
      station: { systemId: { in: visibleIds } },
    },
    select: {
      stock: true,
      station: { select: { systemId: true } },
    },
  });

  const goodKey = GOOD_NAME_TO_KEY.get(good.name) ?? good.id;
  const curve = curveForGood(goodKey, good.basePrice, good.priceFloor, good.priceCeiling);

  const entries: MarketComparisonEntry[] = markets.map((m) => ({
    systemId: m.station.systemId,
    basePrice: good.basePrice,
    currentPrice: spotPrice(curve, m.stock),
    stock: Math.floor(m.stock),
  }));

  return { goodId: good.id, entries };
}
