"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTickContext } from "./use-tick-context";
import { queryKeys } from "@/lib/query/keys";

/**
 * Subscribes to SSE events and invalidates relevant queries.
 * Mount once in GameShellInner — replaces per-page arrival useEffects.
 */
export function useTickInvalidation() {
  const { subscribeToEvent } = useTickContext();
  const queryClient = useQueryClient();

  useEffect(() => {
    const unsubs = [
      // Economy ticks → refresh market data, trade flow, stability, and population
      // (market + unrest + population are all written by the economy processor on the same tick)
      subscribeToEvent("economyTick", () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.marketAll });
        queryClient.invalidateQueries({ queryKey: queryKeys.tradeFlow });
        queryClient.invalidateQueries({ queryKey: queryKeys.stability });
        queryClient.invalidateQueries({ queryKey: queryKeys.populationMap });
        queryClient.invalidateQueries({ queryKey: queryKeys.systemPopulationAll });
        queryClient.invalidateQueries({ queryKey: queryKeys.systemIndustryAll });
        queryClient.invalidateQueries({ queryKey: queryKeys.systemLogisticsAll });
      }),
      // Event notifications → refresh events cache and dynamic data (event state changed)
      subscribeToEvent("eventNotifications", () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.events });
        queryClient.invalidateQueries({ queryKey: queryKeys.dynamicVisible });
      }),
    ];

    return () => unsubs.forEach((unsub) => unsub());
  }, [subscribeToEvent, queryClient]);
}
