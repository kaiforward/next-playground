"use client";

import { useDetailEntry } from "@/lib/hooks/detail-read";
import type { MarketComparisonEntry } from "@/lib/types/game";

const EMPTY_ENTRIES: MarketComparisonEntry[] = [];

/** One good's price/stock comparison across every system — read from the store's
 *  `marketComparison` slice, keyed by GOOD id (see `MarketComparisonSlice`'s docstring,
 *  `lib/runtime/snapshot.ts`). `goodId` is drawn from the fixed goods catalog by every caller, so
 *  an absent entry (a goodId outside the catalog) reads as no comparison rows rather than a
 *  distinct not-found state — the same empty reading also covers a goodId that's in the catalog but
 *  isn't in the current interest set yet (see `lib/hooks/detail-read.ts`); telling the two apart is
 *  `market-comparison-panel.tsx`'s presence gate's job, not this hook's. */
export function useMarketComparison(goodId: string): {
  goodId: string;
  entries: MarketComparisonEntry[];
} {
  const slice = useDetailEntry("marketComparison", goodId, "good");
  return { goodId, entries: slice?.entries ?? EMPTY_ENTRIES };
}
