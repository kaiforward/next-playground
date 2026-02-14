import { prisma } from "@/lib/prisma";
import { calculatePrice } from "@/lib/engine/pricing";
import { ServiceError } from "./errors";
import type { MarketEntry, TradeHistoryEntry } from "@/lib/types/game";
import { toTradeType } from "@/lib/types/guards";

/**
 * Get market data for the station in the given system.
 * Throws ServiceError(404) if no station found.
 */
export async function getMarket(
  systemId: string,
): Promise<{ stationId: string; entries: MarketEntry[] }> {
  const station = await prisma.station.findUnique({
    where: { systemId },
  });

  if (!station) {
    throw new ServiceError("No station found in this system.", 404);
  }

  const marketEntries = await prisma.stationMarket.findMany({
    where: { stationId: station.id },
    include: {
      good: {
        select: { id: true, name: true, basePrice: true, priceFloor: true, priceCeiling: true },
      },
    },
  });

  const entries: MarketEntry[] = marketEntries.map((m) => ({
    goodId: m.good.id,
    goodName: m.good.name,
    basePrice: m.good.basePrice,
    currentPrice: calculatePrice(m.good.basePrice, m.supply, m.demand, m.good.priceFloor, m.good.priceCeiling),
    supply: m.supply,
    demand: m.demand,
  }));

  return { stationId: station.id, entries };
}

/**
 * Get the most recent 50 trade history entries for the station in a system.
 * Throws ServiceError(404) if no station found.
 */
export async function getTradeHistory(
  systemId: string,
): Promise<TradeHistoryEntry[]> {
  const station = await prisma.station.findUnique({
    where: { systemId },
  });

  if (!station) {
    throw new ServiceError("No station found in this system.", 404);
  }

  const history = await prisma.tradeHistory.findMany({
    where: { stationId: station.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      good: {
        select: { name: true },
      },
    },
  });

  return history.map((h) => ({
    id: h.id,
    stationId: h.stationId,
    goodId: h.goodId,
    goodName: h.good.name,
    price: h.price,
    quantity: h.quantity,
    type: toTradeType(h.type),
    createdAt: h.createdAt.toISOString(),
  }));
}
