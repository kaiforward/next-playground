"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/keys";
import { apiMutate } from "@/lib/query/fetcher";
import type { ShipPurchaseResult } from "@/lib/types/api";

interface PurchaseShipParams {
  systemId: string;
  shipType: string;
}

export function usePurchaseShipMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ systemId, shipType }: PurchaseShipParams) => {
      return apiMutate<ShipPurchaseResult>("/api/game/shipyard", { systemId, shipType });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet });
    },
  });
}
