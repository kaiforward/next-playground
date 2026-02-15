"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { TradeMissionInfo } from "@/lib/types/game";

export function usePlayerMissions() {
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.playerMissions,
    queryFn: () => apiFetch<TradeMissionInfo[]>("/api/game/missions"),
  });

  return {
    missions: data ?? [],
    loading: isLoading,
    error: error?.message ?? null,
  };
}
