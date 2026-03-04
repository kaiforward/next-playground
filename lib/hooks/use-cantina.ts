"use client";

import {
  useSuspenseQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { apiFetch, apiMutate } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { BartenderData, PatronData, NpcVisitResult, WagerResult } from "@/lib/types/cantina";
import type { CantinaNpcType } from "@/lib/constants/cantina-npcs";

// ── Bartender tips ──────────────────────────────────────────────

export function useBartenderTips(systemId: string) {
  const { data } = useSuspenseQuery({
    queryKey: queryKeys.cantinaTips(systemId),
    queryFn: () => apiFetch<BartenderData>(`/api/game/cantina/${systemId}/tips`),
  });
  return data;
}

// ── Patron rumors ───────────────────────────────────────────────

export function usePatronRumors(systemId: string) {
  const { data } = useSuspenseQuery({
    queryKey: queryKeys.cantinaRumors(systemId),
    queryFn: () => apiFetch<PatronData>(`/api/game/cantina/${systemId}/rumors`),
  });
  return data;
}

// ── NPC visit mutation ──────────────────────────────────────────

export function useNpcVisitMutation(systemId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (npcType: CantinaNpcType) =>
      apiMutate<NpcVisitResult>(`/api/game/cantina/${systemId}/visit`, {
        npcType,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.cantinaTips(systemId),
      });
    },
  });
}

// ── Wager mutations ─────────────────────────────────────────────

export interface SettleWagerParams {
  wager: number;
  outcome: "win" | "loss" | "tie";
}

export function useSettleWagerMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: SettleWagerParams) =>
      apiMutate<WagerResult>("/api/game/cantina/wager", params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet });
    },
  });
}
