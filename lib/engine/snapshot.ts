import { spotPrice, curveForGood } from "./market-pricing";

export interface MarketInput {
  systemId: string;
  goodId: string;
  stock: number;
  basePrice: number;
  priceFloor?: number;
  priceCeiling?: number;
  /** Stored pricing-anchor multiplier (1 = none). */
  anchorMult?: number;
}

export interface PriceHistoryEntry {
  tick: number;
  prices: Record<string, number>;
}

/**
 * Build one PriceHistoryEntry per system from a flat array of market rows.
 * Groups by systemId, computes each good's spot price from its stock. Pure.
 */
export function buildPriceEntry(
  markets: MarketInput[],
  tick: number,
): Map<string, PriceHistoryEntry> {
  const bySystem = new Map<string, MarketInput[]>();
  for (const m of markets) {
    const arr = bySystem.get(m.systemId);
    if (arr) arr.push(m);
    else bySystem.set(m.systemId, [m]);
  }

  const result = new Map<string, PriceHistoryEntry>();
  for (const [systemId, systemMarkets] of bySystem) {
    const prices: Record<string, number> = {};
    for (const m of systemMarkets) {
      const curve = curveForGood(m.goodId, m.basePrice, m.priceFloor ?? 0.2, m.priceCeiling ?? 5.0, m.anchorMult ?? 1);
      prices[m.goodId] = spotPrice(curve, m.stock);
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
