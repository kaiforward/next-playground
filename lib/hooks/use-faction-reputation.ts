"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { PlayerFactionReputationInfo } from "@/lib/services/reputation";

export function useFactionReputation() {
  const { data } = useSuspenseQuery({
    queryKey: queryKeys.reputation,
    queryFn: () => apiFetch<PlayerFactionReputationInfo[]>("/api/game/reputation"),
  });

  return { reputations: data };
}
