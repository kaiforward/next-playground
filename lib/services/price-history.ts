import { prisma } from "@/lib/prisma";
import { ServiceError } from "./errors";
import type { SystemPriceHistory } from "@/lib/types/game";
import type { PriceHistoryEntry } from "@/lib/engine/snapshot";

/**
 * Get price history for a system, pivoted into per-good arrays.
 * Returns one entry per good with { goodId, goodName, points: {tick, price}[] }.
 */
export async function getPriceHistory(
  systemId: string,
): Promise<SystemPriceHistory[]> {
  const [row, goods] = await Promise.all([
    prisma.priceHistory.findUnique({ where: { systemId } }),
    prisma.good.findMany({ select: { id: true, name: true } }),
  ]);

  if (!row) {
    throw new ServiceError("Price history not found for this system.", 404);
  }

  const entries: PriceHistoryEntry[] = JSON.parse(row.entries);
  const goodNameById = new Map(goods.map((g) => [g.id, g.name]));

  // Pivot: { tick, prices }[] → per-good { goodId, goodName, points }[]
  const pointsByGood = new Map<string, { tick: number; price: number }[]>();
  for (const entry of entries) {
    for (const [goodId, price] of Object.entries(entry.prices)) {
      let points = pointsByGood.get(goodId);
      if (!points) {
        points = [];
        pointsByGood.set(goodId, points);
      }
      points.push({ tick: entry.tick, price });
    }
  }

  const result: SystemPriceHistory[] = [];
  for (const [goodId, points] of pointsByGood) {
    result.push({
      goodId,
      goodName: goodNameById.get(goodId) ?? goodId,
      points,
    });
  }

  return result;
}
