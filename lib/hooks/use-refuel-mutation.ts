"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/keys";
import { apiMutate } from "@/lib/query/fetcher";
import type { ShipRefuelResult } from "@/lib/types/api";

export function useRefuelMutation(shipId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (amount: number) => {
      if (!shipId) throw new Error("Missing shipId");
      return apiMutate<ShipRefuelResult>(`/api/game/ship/${shipId}/refuel`, { amount });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet });
    },
  });
}
