import { getWorld } from "@/lib/world/store";
import { marketsBySystem } from "./world-index";
import { buildMarketEntry } from "./market-entry";
import { GOODS } from "@/lib/constants/goods";
import { ServiceError } from "./errors";
import { isEconomicallyActive } from "@/lib/engine/control";
import type { MarketEntry } from "@/lib/types/game";

/**
 * Get market data for the given system. Markets are per-system in the world
 * model (stations are gone); `stationId` is kept as the system id so the
 * response shape the client already consumes is unchanged.
 * Throws ServiceError(404) if the system doesn't exist.
 */
export function getMarket(systemId: string): { stationId: string; entries: MarketEntry[] } {
  const world = getWorld();
  const system = world.systems.find((s) => s.id === systemId);
  if (!system) {
    throw new ServiceError("System not found.", 404);
  }
  if (!isEconomicallyActive(system.control)) {
    return { stationId: systemId, entries: [] };
  }

  const entries: MarketEntry[] = (marketsBySystem().get(systemId) ?? [])
    .map((m) => buildMarketEntry(m.goodId, GOODS[m.goodId], m.stock, m.demandRate, m.anchorMult));

  return { stationId: systemId, entries };
}
