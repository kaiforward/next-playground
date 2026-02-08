/**
 * NPC behavior engine.
 * Provides simple AI for NPC traders: destination picking and trade decisions.
 */

import { calculatePrice } from "./pricing";

export interface NpcConnectionInfo {
  fromSystemId: string;
  toSystemId: string;
  fuelCost: number;
}

export interface NpcMarketItem {
  goodId: string;
  supply: number;
  demand: number;
  basePrice: number;
}

export interface NpcTradeAction {
  goodId: string;
  type: "buy" | "sell";
  quantity: number;
}

/**
 * Pick a random connected system for the NPC to travel to.
 */
export function pickNpcDestination(
  currentSystemId: string,
  connections: NpcConnectionInfo[],
): string | null {
  const outgoing = connections.filter(
    (c) => c.fromSystemId === currentSystemId,
  );

  if (outgoing.length === 0) {
    return null;
  }

  const idx = Math.floor(Math.random() * outgoing.length);
  return outgoing[idx].toSystemId;
}

/**
 * Simulate NPC trading at a station.
 *
 * Simple NPC behavior:
 *   - Buy goods that are cheap (currentPrice < basePrice) — up to what the NPC can afford
 *   - Sell goods that are expensive (currentPrice > basePrice * 1.5)
 *
 * Returns the list of trade actions and the NPC's remaining credits.
 */
export function simulateNpcTrade(
  market: NpcMarketItem[],
  npcCredits: number,
): { trades: NpcTradeAction[]; creditsAfter: number } {
  const trades: NpcTradeAction[] = [];
  let credits = npcCredits;

  for (const item of market) {
    const currentPrice = calculatePrice(
      item.basePrice,
      item.supply,
      item.demand,
    );

    // Buy cheap goods
    if (currentPrice < item.basePrice && item.supply > 5) {
      const maxAffordable = Math.floor(credits / currentPrice);
      const maxFromSupply = Math.floor(item.supply * 0.1); // NPC buys at most 10% of supply
      const quantity = Math.min(maxAffordable, maxFromSupply, 5); // cap at 5 per good

      if (quantity > 0) {
        trades.push({ goodId: item.goodId, type: "buy", quantity });
        credits -= quantity * currentPrice;
      }
    }

    // Sell into high-demand markets (NPC conceptually "has" goods if price is high enough)
    if (currentPrice > item.basePrice * 1.5 && item.demand > 10) {
      const quantity = Math.min(3, Math.floor(item.demand * 0.05)); // sell small amounts

      if (quantity > 0) {
        trades.push({ goodId: item.goodId, type: "sell", quantity });
        credits += quantity * currentPrice;
      }
    }
  }

  return { trades, creditsAfter: credits };
}
