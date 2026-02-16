"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { MarketEntry } from "@/lib/types/game";

export function useMarket(systemId: string) {
  const { data } = useSuspenseQuery({
    queryKey: queryKeys.market(systemId),
    queryFn: () =>
      apiFetch<{ stationId: string; entries: MarketEntry[] }>(
        `/api/game/market/${systemId}`,
      ),
  });

  return {
    market: data.entries,
    stationId: data.stationId,
  };
}
