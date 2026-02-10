"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { GameWorldState } from "@/lib/types/game";

export function useGameWorld() {
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.world,
    queryFn: () => apiFetch<GameWorldState>("/api/game/world"),
    staleTime: 5_000, // world state changes on every tick
  });

  return {
    world: data ?? null,
    loading: isLoading,
    error: error?.message ?? null,
  };
}
