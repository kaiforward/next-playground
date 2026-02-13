"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { SystemPriceHistory } from "@/lib/types/game";

export function usePriceHistory(systemId: string | null) {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.priceHistory(systemId ?? ""),
    queryFn: () =>
      apiFetch<SystemPriceHistory[]>(`/api/game/prices/${systemId}`),
    enabled: !!systemId,
    staleTime: 90_000, // Snapshots update every 100s
  });

  return {
    history: data ?? [],
    loading: isLoading,
  };
}
