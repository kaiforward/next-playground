"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { TradeFlowEdgeInfo, TradeFlowEdges } from "@/lib/types/api";

/**
 * Fetches the directed-logistics overlay edge set across the player's visible
 * systems. Tick-scoped: no viewport dependency, refetched only when ships arrive
 * or the cache stales. The array is zeroed when the overlay toggle is off so the
 * Pixi layer tears its particles down immediately.
 */
export function useTradeFlow(
  logisticsActive: boolean,
): { logisticsEdges: TradeFlowEdgeInfo[] } {
  const { data } = useQuery({
    queryKey: queryKeys.tradeFlow,
    queryFn: () => apiFetch<TradeFlowEdges>("/api/game/systems/trade-flow"),
    staleTime: 10_000,
    gcTime: 30_000,
    enabled: logisticsActive,
  });

  return {
    logisticsEdges: logisticsActive ? data?.logisticsEdges ?? [] : [],
  };
}
