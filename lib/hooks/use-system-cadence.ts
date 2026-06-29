"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { SystemCadence } from "@/lib/types/api";

/**
 * Static per-system cadence shard groups for the header countdowns. The values
 * never change for a fixed universe, so this is a plain (non-suspense) query with
 * staleTime Infinity — it never blocks the header and never tick-invalidates. The
 * live countdown is derived client-side from these + the current tick.
 */
export function useSystemCadence(systemId: string): SystemCadence | undefined {
  const { data } = useQuery({
    queryKey: queryKeys.systemCadence(systemId),
    queryFn: () => apiFetch<SystemCadence>(`/api/game/systems/${systemId}/cadence`),
    staleTime: Infinity,
    gcTime: Infinity,
  });
  return data;
}
