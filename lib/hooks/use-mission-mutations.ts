"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/keys";
import { apiMutate } from "@/lib/query/fetcher";
import type { AcceptMissionResult, DeliverMissionResult } from "@/lib/types/api";

export function useAcceptMission() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (missionId: string) =>
      apiMutate<AcceptMissionResult>("/api/game/missions/accept", { missionId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.missionsAll });
    },
  });
}

export function useDeliverMission() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ missionId, shipId }: { missionId: string; shipId: string }) =>
      apiMutate<DeliverMissionResult>("/api/game/missions/deliver", { missionId, shipId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.missionsAll });
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet });
    },
  });
}

export function useAbandonMission() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (missionId: string) =>
      apiMutate<{ missionId: string }>("/api/game/missions/abandon", { missionId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.missionsAll });
    },
  });
}
