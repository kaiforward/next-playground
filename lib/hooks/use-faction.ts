"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { FactionDetail } from "@/lib/services/factions";

export function useFaction(factionId: string) {
  const { data } = useSuspenseQuery({
    queryKey: queryKeys.faction(factionId),
    queryFn: () =>
      apiFetch<FactionDetail>(`/api/game/factions/${factionId}`),
  });

  return { faction: data };
}
