"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { BattleInfo } from "@/lib/types/game";

export function useActiveBattles() {
  const { data } = useSuspenseQuery({
    queryKey: queryKeys.battles,
    queryFn: () => apiFetch<BattleInfo[]>("/api/game/battles"),
  });

  return { battles: data };
}

export function useBattleDetail(battleId: string) {
  const { data } = useSuspenseQuery({
    queryKey: queryKeys.battleDetail(battleId),
    queryFn: () => apiFetch<BattleInfo>(`/api/game/battles/${battleId}`),
  });

  return { battle: data };
}
