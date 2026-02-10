"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { UniverseData } from "@/lib/types/game";

export function useUniverse() {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.universe,
    queryFn: () => apiFetch<UniverseData>("/api/game/systems"),
    staleTime: Infinity, // static data — never refetch
  });

  return {
    data: data ?? null,
    loading: isLoading,
  };
}
