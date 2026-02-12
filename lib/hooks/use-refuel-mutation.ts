"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/keys";
import type { ShipRefuelResult } from "@/lib/types/api";

export function useRefuelMutation(shipId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (amount: number) => {
      if (!shipId) throw new Error("Missing shipId");

      const res = await fetch(`/api/game/ship/${shipId}/refuel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
      });
      const json = await res.json();

      if (json.error) throw new Error(json.error);
      return json.data as ShipRefuelResult;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet });
    },
  });
}
