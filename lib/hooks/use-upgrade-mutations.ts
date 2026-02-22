"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiMutate, apiDelete } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { InstallUpgradeResult } from "@/lib/types/api";
import type { ShipState } from "@/lib/types/game";

interface InstallParams {
  slotId: string;
  moduleId: string;
  tier?: number;
}

export function useUpgradeMutations(shipId: string | null) {
  const queryClient = useQueryClient();

  const install = useMutation({
    mutationFn: async (params: InstallParams) => {
      if (!shipId) throw new Error("Missing shipId");
      return apiMutate<InstallUpgradeResult>(`/api/game/ship/${shipId}/upgrades`, params);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet });
    },
  });

  const remove = useMutation({
    mutationFn: async (slotId: string) => {
      if (!shipId) throw new Error("Missing shipId");
      return apiDelete<{ ship: ShipState }>(`/api/game/ship/${shipId}/upgrades`, { slotId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet });
    },
  });

  return { install, remove };
}
