"use client";

import { useGameSlice } from "@/lib/store/use-game-store";
import type { MarketEntry } from "@/lib/types/game";

const EMPTY_ENTRIES: MarketEntry[] = [];

/**
 * Market entries for one system — read from the store's `market` slice. A non-developed system
 * already reads no entries (`getMarket` returns `{ entries: [] }` for a system with no station,
 * `lib/services/market.ts`), and every existing caller already treats an empty list as "nothing to
 * show here" (`components/panels/system-market.tsx`'s `market.length === 0` guard) — so a systemId
 * absent from the world reuses that same empty-array reading rather than adding a
 * new discriminant this hook's only caller would need to learn.
 */
export function useMarket(systemId: string) {
  const slice = useGameSlice((state) => state.slices.market?.[systemId]);
  return {
    market: slice?.entries ?? EMPTY_ENTRIES,
    stationId: slice?.stationId ?? systemId,
  };
}
