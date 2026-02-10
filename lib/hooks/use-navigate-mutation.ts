"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/keys";
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
      const res = await fetch(`/api/game/ship/${shipId}/navigate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ route }),
      });
      const json = await res.json();

      if (json.error) throw new Error(json.error);
      return json.data as ShipNavigateResult;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet });
    },
  });
}
