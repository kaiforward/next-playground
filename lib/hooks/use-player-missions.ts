"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { TradeMissionInfo } from "@/lib/types/game";

export function usePlayerMissions() {
  const { data } = useSuspenseQuery({
    queryKey: queryKeys.playerMissions,
    queryFn: () => apiFetch<TradeMissionInfo[]>("/api/game/missions"),
  });

  return { missions: data };
}
