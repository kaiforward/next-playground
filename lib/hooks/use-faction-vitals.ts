"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { FactionVitalsData } from "@/lib/types/api";

/**
 * Faction Overview aggregate vitals (territory / population / weighted stability / development).
 * Tick-dynamic — changes every economy tick, so it uses the default staleTime and is tick-invalidated
 * (see useTickInvalidation), kept separate from the static faction detail read.
 */
export function useFactionVitals(factionId: string): FactionVitalsData {
  const { data } = useSuspenseQuery({
    queryKey: queryKeys.factionVitals(factionId),
    queryFn: () => apiFetch<FactionVitalsData>(`/api/game/factions/${factionId}/vitals`),
  });
  return data;
}
