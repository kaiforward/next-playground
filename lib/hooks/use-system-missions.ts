"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { SystemMissionsData } from "@/lib/types/api";

export function useSystemMissions(systemId: string) {
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.systemMissions(systemId),
    queryFn: () => apiFetch<SystemMissionsData>(`/api/game/missions?systemId=${systemId}`),
  });

  return {
    available: data?.available ?? [],
    active: data?.active ?? [],
    loading: isLoading,
    error: error?.message ?? null,
  };
}
