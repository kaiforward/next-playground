"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { MarketEntry } from "@/lib/types/game";

export function useMarket(systemId: string | null) {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.market(systemId ?? ""),
    queryFn: () =>
      apiFetch<{ stationId: string; entries: MarketEntry[] }>(
        `/api/game/market/${systemId}`,
      ),
    enabled: !!systemId,
  });

  return {
    market: data?.entries ?? [],
    stationId: data?.stationId ?? null,
    loading: isLoading,
  };
}
