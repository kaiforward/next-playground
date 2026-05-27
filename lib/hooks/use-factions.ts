"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { FactionSummary } from "@/lib/services/factions";

export function useFactions() {
  const { data } = useSuspenseQuery({
    queryKey: queryKeys.factions,
    queryFn: () => apiFetch<FactionSummary[]>("/api/game/factions"),
  });

  return { factions: data };
}
