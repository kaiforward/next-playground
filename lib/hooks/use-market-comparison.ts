"use client";

import { useGameSlice } from "@/lib/store/use-game-store";
import type { MarketComparisonEntry } from "@/lib/types/game";

const EMPTY_ENTRIES: MarketComparisonEntry[] = [];

/** One good's price/stock comparison across every system — read from the store's
 *  `marketComparison` slice, keyed by GOOD id (see `MarketComparisonSlice`'s docstring,
 *  `lib/runtime/snapshot.ts`). `goodId` is drawn from the fixed goods catalog by every caller, so
 *  an absent entry (a goodId outside the catalog) reads as no comparison rows rather than a
 *  distinct not-found state. */
export function useMarketComparison(goodId: string): {
  goodId: string;
  entries: MarketComparisonEntry[];
} {
  const slice = useGameSlice((state) => state.slices.marketComparison?.[goodId]);
  return { goodId, entries: slice?.entries ?? EMPTY_ENTRIES };
}
