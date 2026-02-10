"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { TradeHistoryEntry } from "@/lib/types/game";

export function useTradeHistory(systemId: string | null) {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.tradeHistory(systemId ?? ""),
    queryFn: () =>
      apiFetch<TradeHistoryEntry[]>(`/api/game/history/${systemId}`),
    enabled: !!systemId,
  });

  return {
    history: data ?? [],
    loading: isLoading,
  };
}
