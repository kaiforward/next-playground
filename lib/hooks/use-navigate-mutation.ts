"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/keys";
import { apiMutate } from "@/lib/query/fetcher";
import type { ShipNavigateResult } from "@/lib/types/api";

export function useNavigateMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      shipId,
      route,
    }: {
      shipId: string;
      route: string[];
    }) => {
      return apiMutate<ShipNavigateResult>(`/api/game/ship/${shipId}/navigate`, { route });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet });
    },
  });
}
