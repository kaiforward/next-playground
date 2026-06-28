"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { TradeFlowEdgeInfo, TradeFlowEdges } from "@/lib/types/api";

/**
 * Fetches the two trade-flow edge sets (market diffusion + directed logistics)
 * across the player's visible systems. Tick-scoped: no viewport dependency,
 * refetched only when ships arrive or the cache stales.
 *
 * One request feeds both overlays; it fires when EITHER overlay is on so a
 * single fetch serves both toggles. Each array is zeroed when its own toggle is
 * off so the Pixi layer tears its particles down immediately (cached data would
 * otherwise keep them alive until gcTime).
 */
export function useTradeFlow(
  marketActive: boolean,
  logisticsActive: boolean,
): { marketEdges: TradeFlowEdgeInfo[]; logisticsEdges: TradeFlowEdgeInfo[] } {
  const { data } = useQuery({
    queryKey: queryKeys.tradeFlow,
    queryFn: () => apiFetch<TradeFlowEdges>("/api/game/systems/trade-flow"),
    staleTime: 10_000,
    gcTime: 30_000,
    enabled: marketActive || logisticsActive,
  });

  return {
    marketEdges: marketActive ? data?.marketEdges ?? [] : [],
    logisticsEdges: logisticsActive ? data?.logisticsEdges ?? [] : [],
  };
}
