import { calculatePrice } from "./pricing";

export interface MarketInput {
  systemId: string;
  goodId: string;
  supply: number;
  demand: number;
  basePrice: number;
  priceFloor?: number;
  priceCeiling?: number;
}

export interface PriceHistoryEntry {
  tick: number;
  prices: Record<string, number>;
}

/**
 * Build one PriceHistoryEntry per system from a flat array of market rows.
 * Groups markets by systemId, computes price for each good via calculatePrice.
 * Pure function — no DB dependency.
 */
export function buildPriceEntry(
  markets: MarketInput[],
  tick: number,
): Map<string, PriceHistoryEntry> {
  const bySystem = new Map<string, MarketInput[]>();
  for (const m of markets) {
    const arr = bySystem.get(m.systemId);
    if (arr) {
      arr.push(m);
    } else {
      bySystem.set(m.systemId, [m]);
    }
  }

  const result = new Map<string, PriceHistoryEntry>();
  for (const [systemId, systemMarkets] of bySystem) {
    const prices: Record<string, number> = {};
    for (const m of systemMarkets) {
      prices[m.goodId] = calculatePrice(m.basePrice, m.supply, m.demand, m.priceFloor, m.priceCeiling);
    }
    result.set(systemId, { tick, prices });
  }

  return result;
}

/**
 * Append a snapshot entry to an existing array, capping at `max` entries.
 * Returns a new array (does not mutate `existing`).
 */
export function appendSnapshot(
  existing: PriceHistoryEntry[],
  entry: PriceHistoryEntry,
  max: number,
): PriceHistoryEntry[] {
  const combined = [...existing, entry];
  return combined.length > max ? combined.slice(-max) : combined;
}
