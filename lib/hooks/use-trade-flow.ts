"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { TradeFlowEdgeInfo } from "@/lib/types/api";

/**
 * Fetches aggregate trade-flow edges across the player's visible systems.
 * Tick-scoped: no viewport dependency, refetched only when ships arrive
 * (visibility set changes) or after the cache stales.
 *
 * Gated by `active` — when the trade-flow overlay is off we don't pay the
 * request, the DB groupBy, or the visibility filter. Mirrors the
 * `useDynamicData(active)` pattern.
 */
export function useTradeFlow(
  active: boolean,
): { edges: TradeFlowEdgeInfo[] } {
  const { data } = useQuery({
    queryKey: queryKeys.tradeFlow,
    queryFn: () =>
      apiFetch<{ edges: TradeFlowEdgeInfo[] }>(
        "/api/game/systems/trade-flow",
      ),
    staleTime: 10_000,
    gcTime: 30_000,
    enabled: active,
  });

  // When the toggle flips off, `enabled: false` stops new fetches but
  // TanStack keeps the prior response cached so a re-toggle is instant.
  // We still need to hand an empty array back to the Pixi layer so it
  // tears down particles immediately — the canvas reads `flowEdges` every
  // sync, and stale cached data would otherwise keep particles alive
  // until the cache is garbage-collected (gcTime later).
  return { edges: active ? data?.edges ?? [] : [] };
}
