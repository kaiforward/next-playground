"use client";

import { useDetailEntry } from "@/lib/hooks/detail-read";
import type { MarketEntry } from "@/lib/types/game";

const EMPTY_ENTRIES: MarketEntry[] = [];

/**
 * Market entries for one system — read from the store's `market` slice. A non-developed system
 * already reads no entries (`getMarket` returns `{ entries: [] }` for a system with no station,
 * `lib/services/market.ts`), and every existing caller already treats an empty list as "nothing to
 * show here" (`components/panels/system-market.tsx`'s `market.length === 0` guard) — so a systemId
 * absent from the world reuses that same empty-array reading rather than adding a
 * new discriminant this hook's only caller would need to learn. That same empty reading also now
 * covers a systemId that exists but isn't in the current interest set yet (see
 * `lib/hooks/detail-read.ts`) — telling the two apart is the panel root's job, not this hook's.
 */
export function useMarket(systemId: string) {
  const slice = useDetailEntry((slices) => slices.market?.[systemId], "market", systemId, "system");
  return {
    market: slice?.entries ?? EMPTY_ENTRIES,
    stationId: slice?.stationId ?? systemId,
  };
}
