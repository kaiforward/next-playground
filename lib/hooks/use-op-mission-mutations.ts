"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/keys";
import { apiMutate } from "@/lib/query/fetcher";
import type { AcceptOpMissionResult, StartOpMissionResult } from "@/lib/types/api";

export function useAcceptOpMission() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (missionId: string) =>
      apiMutate<AcceptOpMissionResult>(
        `/api/game/op-missions/${missionId}/accept`,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.opMissionsAll });
    },
  });
}

export function useStartOpMission() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ missionId, shipId }: { missionId: string; shipId: string }) =>
      apiMutate<StartOpMissionResult>(
        `/api/game/op-missions/${missionId}/start`,
        { shipId },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.opMissionsAll });
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet });
    },
  });
}

export function useAbandonOpMission() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (missionId: string) =>
      apiMutate<{ missionId: string }>(
        `/api/game/op-missions/${missionId}/abandon`,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.opMissionsAll });
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet });
    },
  });
}
