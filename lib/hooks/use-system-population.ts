"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { SystemPopulationData } from "@/lib/types/api";

/**
 * Dynamic population & social state (population, popCap, unrest, needs ledger)
 * for one system. Changes every economy tick — so, unlike the static substrate
 * read, it uses the default staleTime and is tick-invalidated (see
 * useTickInvalidation). Visibility-gated server-side.
 */
export function useSystemPopulation(systemId: string): SystemPopulationData {
  const { data } = useSuspenseQuery({
    queryKey: queryKeys.systemPopulation(systemId),
    queryFn: () =>
      apiFetch<SystemPopulationData>(`/api/game/systems/${systemId}/population`),
  });
  return data;
}
