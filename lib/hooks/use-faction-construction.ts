"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { FactionConstructionData } from "@/lib/types/api";

/** A faction's construction command summary (pool composition, switches, queue lists). Tick-invalidated. */
export function useFactionConstruction(factionId: string): FactionConstructionData {
  const { data } = useSuspenseQuery({
    queryKey: queryKeys.factionConstruction(factionId),
    queryFn: () => apiFetch<FactionConstructionData>(`/api/game/factions/${factionId}/construction`),
  });
  return data;
}
