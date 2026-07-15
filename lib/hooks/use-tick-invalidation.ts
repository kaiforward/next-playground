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
        // Development changes as systems build out / grow on the same pulse.
        queryClient.invalidateQueries({ queryKey: queryKeys.developmentMap });
        // Ownership moves on the same monthly pulse (claim/develop) — refresh the political
        // territory + filled/hollow markers so the map paints expansion live.
        queryClient.invalidateQueries({ queryKey: queryKeys.ownership });
        queryClient.invalidateQueries({ queryKey: queryKeys.systemPopulationAll });
        queryClient.invalidateQueries({ queryKey: queryKeys.systemVitalsAll });
        queryClient.invalidateQueries({ queryKey: queryKeys.systemIndustryAll });
        queryClient.invalidateQueries({ queryKey: queryKeys.systemLogisticsAll });
        // Construction advances every funded pulse (same monthly economy tick) — refresh both surfaces.
        queryClient.invalidateQueries({ queryKey: queryKeys.systemConstructionAll });
        queryClient.invalidateQueries({ queryKey: queryKeys.factionConstructionAll });
        // Faction Overview vitals (pop/stability/development roll-up + territory) advance every tick.
        queryClient.invalidateQueries({ queryKey: queryKeys.factionVitalsAll });
        // Dynamic overlay data (events, danger, presence) changes on the same
        // world pulse. It can't ride eventNotifications alone: that feed fires
        // only for notification-bearing spawns/advances (+ expiries), so a silent
        // spawn or phase-advance would leave the map's event pills stale. The
        // heartbeat fires every tick, so pills are never more than one tick behind.
        queryClient.invalidateQueries({ queryKey: queryKeys.dynamicVisible });
      }),
      // Event notifications → refresh the events feed (detail panel). The map's
      // dynamic overlay is refreshed on the tick heartbeat above, not here.
      subscribeToEvent("eventNotifications", () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.events });
      }),
    ];

    return () => unsubs.forEach((unsub) => unsub());
  }, [subscribeToEvent, queryClient]);
}
