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
        // Migration attractiveness is a function of unrest/population/popCap/labour — all rewritten by
        // the economy processor this tick — so it goes stale on the same pulse as its sibling value modes.
        queryClient.invalidateQueries({ queryKey: queryKeys.migrationMap });
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
        // Build-options feasibility (ETA, pool headroom) shifts on the same pulse.
        queryClient.invalidateQueries({ queryKey: queryKeys.systemBuildOptionsAll });
        // Faction Overview vitals (pop/stability/development roll-up + territory) advance every tick.
        queryClient.invalidateQueries({ queryKey: queryKeys.factionVitalsAll });
        // Treasury settles on the month pulse; funded fractions + snapshot move then.
        queryClient.invalidateQueries({ queryKey: queryKeys.factionTreasuryAll });
      }),
      // Event notifications → refresh the events feed (detail panel).
      subscribeToEvent("eventNotifications", () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.events });
      }),
    ];

    return () => unsubs.forEach((unsub) => unsub());
  }, [subscribeToEvent, queryClient]);
}
