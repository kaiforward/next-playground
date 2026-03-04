import type { MarketEntry } from "@/lib/types/game";
import {
  LOCAL_TIP_TEMPLATES,
  NEIGHBOR_TIP_TEMPLATES,
  NO_TIPS_LINES,
} from "@/lib/constants/cantina-npcs";

export interface BartenderTip {
  text: string;
  type: "local" | "neighbor";
  goodId: string;
  goodName: string;
  /** For neighbor tips: the system where the good fetches a premium. */
  systemName: string | null;
}

/** Max tips returned per visit. */
const MAX_TIPS = 3;
/** A good must be at least this fraction below base price to count as a local deal. */
const LOCAL_DISCOUNT_THRESHOLD = 0.15;
/** Minimum absolute price differential for a neighbor tip to be interesting. */
const NEIGHBOR_DIFF_THRESHOLD = 10;

/**
 * Find 1-2 goods trading well below base price at the local market.
 * Pure function — no DB.
 */
export function generateLocalTips(entries: MarketEntry[]): BartenderTip[] {
  const deals = entries
    .filter((e) => e.currentPrice < e.basePrice * (1 - LOCAL_DISCOUNT_THRESHOLD))
    .sort((a, b) => a.currentPrice / a.basePrice - b.currentPrice / b.basePrice)
    .slice(0, 2);

  return deals.map((e, i) => ({
    text: LOCAL_TIP_TEMPLATES[i % LOCAL_TIP_TEMPLATES.length].replace(
      "{good}",
      e.goodName,
    ),
    type: "local",
    goodId: e.goodId,
    goodName: e.goodName,
    systemName: null,
  }));
}

export interface NeighborMarket {
  systemName: string;
  entries: MarketEntry[];
}

/**
 * Find the best price differentials between local market and connected systems.
 * Returns tips for goods that sell for significantly more at a neighbor.
 * Pure function — no DB.
 */
export function generateNeighborTips(
  localEntries: MarketEntry[],
  neighbors: NeighborMarket[],
): BartenderTip[] {
  const localPrices = new Map(
    localEntries.map((e) => [e.goodId, e]),
  );

  const opportunities: Array<{
    diff: number;
    goodId: string;
    goodName: string;
    systemName: string;
  }> = [];

  for (const neighbor of neighbors) {
    for (const entry of neighbor.entries) {
      const local = localPrices.get(entry.goodId);
      if (!local) continue;

      const diff = entry.currentPrice - local.currentPrice;
      if (diff > NEIGHBOR_DIFF_THRESHOLD) {
        opportunities.push({
          diff,
          goodId: entry.goodId,
          goodName: entry.goodName,
          systemName: neighbor.systemName,
        });
      }
    }
  }

  // Best opportunities first, take up to 2
  opportunities.sort((a, b) => b.diff - a.diff);
  const top = opportunities.slice(0, 2);

  return top.map((opp, i) => ({
    text: NEIGHBOR_TIP_TEMPLATES[i % NEIGHBOR_TIP_TEMPLATES.length]
      .replace("{good}", opp.goodName)
      .replace("{system}", opp.systemName),
    type: "neighbor",
    goodId: opp.goodId,
    goodName: opp.goodName,
    systemName: opp.systemName,
  }));
}

/**
 * Combine local + neighbor tips, capped at MAX_TIPS.
 * Falls back to a "no tips" line if nothing interesting.
 */
export function combineTips(
  localTips: BartenderTip[],
  neighborTips: BartenderTip[],
): BartenderTip[] {
  const combined = [...localTips, ...neighborTips].slice(0, MAX_TIPS);

  if (combined.length === 0) {
    return [
      {
        text: NO_TIPS_LINES[Math.floor(Math.random() * NO_TIPS_LINES.length)],
        type: "local",
        goodId: "",
        goodName: "",
        systemName: null,
      },
    ];
  }

  return combined;
}
