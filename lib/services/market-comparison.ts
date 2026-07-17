import { getWorld } from "@/lib/world/store";
import { spotPrice, curveForRow } from "@/lib/engine/market-pricing";
import { GOODS } from "@/lib/constants/goods";
import { ServiceError } from "./errors";
import type { MarketComparisonEntry } from "@/lib/types/game";

/**
 * Returns price/stock for one good across all systems. Stock is floored for
 * display (matching getMarket); the mid price is derived from stock via the
 * good's price curve.
 *
 * `goodId` is the goods-catalog key (e.g. "food").
 * Throws ServiceError(404) if the good does not exist.
 */
export function getMarketComparison(
  goodId: string,
): { goodId: string; entries: MarketComparisonEntry[] } {
  const good = Object.hasOwn(GOODS, goodId) ? GOODS[goodId] : undefined;
  if (!good) {
    throw new ServiceError("Good not found.", 404);
  }

  const entries: MarketComparisonEntry[] = getWorld()
    .markets.filter((m) => m.goodId === goodId)
    .map((m) => ({
      systemId: m.systemId,
      basePrice: good.basePrice,
      currentPrice: spotPrice(curveForRow(m, good), m.stock),
      stock: Math.floor(m.stock),
    }));

  return { goodId, entries };
}
