import { prisma } from "@/lib/prisma";
import { buildMarketEntry } from "./market-entry";
import { GOVERNMENT_TYPES } from "@/lib/constants/government";
import { ServiceError } from "./errors";
import type { MarketEntry, TradeHistoryEntry } from "@/lib/types/game";
import { toTradeType, toGovernmentType } from "@/lib/types/guards";

/**
 * Get market data for the station in the given system.
 * Throws ServiceError(404) if no station found.
 */
export async function getMarket(
  systemId: string,
): Promise<{ stationId: string; entries: MarketEntry[] }> {
  const station = await prisma.station.findUnique({
    where: { systemId },
    include: { system: { select: { faction: { select: { governmentType: true } } } } },
  });

  if (!station) {
    throw new ServiceError("No station found in this system.", 404);
  }

  const govDef = station.system.faction
    ? GOVERNMENT_TYPES[toGovernmentType(station.system.faction.governmentType)]
    : undefined;

  const marketEntries = await prisma.stationMarket.findMany({
    where: { stationId: station.id },
    include: {
      good: {
        select: { id: true, name: true, basePrice: true, priceFloor: true, priceCeiling: true },
      },
    },
  });

  const entries: MarketEntry[] = marketEntries.map((m) =>
    buildMarketEntry(m.good.id, m.good, m.stock, m.demandRate, govDef, m.anchorMult),
  );

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
