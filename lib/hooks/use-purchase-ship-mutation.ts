"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/keys";
import type { ShipPurchaseResult } from "@/lib/types/api";

interface PurchaseShipParams {
  systemId: string;
  shipType: string;
}

export function usePurchaseShipMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ systemId, shipType }: PurchaseShipParams) => {
      const res = await fetch("/api/game/shipyard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ systemId, shipType }),
      });
      const json = await res.json();

      if (json.error) throw new Error(json.error);
      return json.data as ShipPurchaseResult;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet });
    },
  });
}
