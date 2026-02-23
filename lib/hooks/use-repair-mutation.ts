"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiMutate } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { RepairResult } from "@/lib/types/api";

export function useRepairMutation(shipId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      if (!shipId) throw new Error("Missing shipId");
      return apiMutate<RepairResult>(`/api/game/ship/${shipId}/repair`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet });
      queryClient.invalidateQueries({ queryKey: queryKeys.convoys });
    },
  });
}
