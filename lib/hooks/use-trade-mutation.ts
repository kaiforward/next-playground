"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/keys";
import { apiMutate } from "@/lib/query/fetcher";
import type { ShipTradeResult } from "@/lib/types/api";
import type { MarketEntry, TradeType } from "@/lib/types/game";

interface TradeRequest {
  goodId: string;
  quantity: number;
  type: TradeType;
}

interface UseTradeMutationOptions {
  shipId: string | null;
  stationId: string | null;
  systemId: string | null;
}

export function useTradeMutation({
  shipId,
  stationId,
  systemId,
}: UseTradeMutationOptions) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (request: TradeRequest) => {
      if (!shipId || !stationId) throw new Error("Missing shipId or stationId");
      return apiMutate<ShipTradeResult>(`/api/game/ship/${shipId}/trade`, { ...request, stationId });
    },
    onSuccess: (data) => {
      // Instant UI update: patch the market cache with the updated entry
      if (systemId && data.updatedMarket) {
        queryClient.setQueryData(
          queryKeys.market(systemId),
          (old: { stationId: string; entries: MarketEntry[] } | undefined) => {
            if (!old) return old;
            return {
              ...old,
              entries: old.entries.map((e) =>
                e.goodId === data.updatedMarket.goodId
                  ? data.updatedMarket
                  : e,
              ),
            };
          },
        );
      }

      // Refetch fleet (credits + cargo changed) and trade history
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet });
      if (systemId) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.tradeHistory(systemId),
        });
      }
    },
  });
}
