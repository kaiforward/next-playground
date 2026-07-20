"use client";

import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { apiFetch, apiPatch } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { FactionTreasuryData, TreasuryPolicyData } from "@/lib/types/api";
import type { TreasuryPolicyInput } from "@/lib/schemas/treasury";

/**
 * One faction's treasury surface. Tick-dynamic (the settlement snapshot moves
 * on the month pulse) — tick-invalidated via useTickInvalidation. The vital
 * tile, the treasury card, and the construction readout share this key, so
 * co-rendered surfaces cost one fetch.
 */
export function useFactionTreasury(factionId: string): FactionTreasuryData {
  const { data } = useSuspenseQuery({
    queryKey: queryKeys.factionTreasury(factionId),
    queryFn: () => apiFetch<FactionTreasuryData>(`/api/game/factions/${factionId}/treasury`),
  });
  return data;
}

/** Set the player faction's tax level and/or band sliders (`PATCH .../treasury`). */
export function useUpdateTreasuryPolicy(factionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: TreasuryPolicyInput) =>
      apiPatch<TreasuryPolicyData>(`/api/game/factions/${factionId}/treasury`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.factionTreasuryAll });
    },
  });
}
