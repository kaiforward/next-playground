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
        // Development changes as systems build out / grow on the same cycle.
        queryClient.invalidateQueries({ queryKey: queryKeys.developmentMap });
        // Migration attractiveness is a function of unrest/population/popCap/labour — all rewritten by
        // the economy processor this tick — so it goes stale on the same cycle as its sibling value modes.
        queryClient.invalidateQueries({ queryKey: queryKeys.migrationMap });
        // Provisioned + band are written once per economy cycle, the same cycle as the rest
        // of this handler's signals — refresh the choropleth on the same cadence.
        queryClient.invalidateQueries({ queryKey: queryKeys.provisionMap });
        // Ownership moves on the same cycle start (claim/develop) — refresh the political
        // territory + filled/hollow markers so the map paints expansion live.
        queryClient.invalidateQueries({ queryKey: queryKeys.ownership });
        queryClient.invalidateQueries({ queryKey: queryKeys.systemPopulationAll });
        queryClient.invalidateQueries({ queryKey: queryKeys.systemVitalsAll });
        queryClient.invalidateQueries({ queryKey: queryKeys.systemIndustryAll });
        queryClient.invalidateQueries({ queryKey: queryKeys.systemLogisticsAll });
        // Construction advances every funded cycle (same cycle economy tick) — refresh both surfaces.
        queryClient.invalidateQueries({ queryKey: queryKeys.systemConstructionAll });
        queryClient.invalidateQueries({ queryKey: queryKeys.factionConstructionAll });
        // Tracker roll-up mirrors the same funded front/colonies, so it goes stale on the same cycle
        // (also dirtied directly by pin writes — useSetSystemPin).
        queryClient.invalidateQueries({ queryKey: queryKeys.tracker });
        // Build-options feasibility (ETA, pool headroom) shifts on the same cycle.
        queryClient.invalidateQueries({ queryKey: queryKeys.systemBuildOptionsAll });
        // Faction Overview vitals (pop/stability/development roll-up + territory) advance every tick.
        queryClient.invalidateQueries({ queryKey: queryKeys.factionVitalsAll });
        // Treasury settles on the cycle start; funded fractions + snapshot move then.
        queryClient.invalidateQueries({ queryKey: queryKeys.factionTreasuryAll });
        // Alert bar: every category except the three event bands moves on this cycle.
        queryClient.invalidateQueries({ queryKey: queryKeys.alerts });
      }),
      // Event notifications → refresh the events feed (detail panel).
      subscribeToEvent("eventNotifications", () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.events });
        // Alert bar: the three event-banded categories (Crisis / Disruption / Windfall) move on
        // this channel, not economyTick.
        queryClient.invalidateQueries({ queryKey: queryKeys.alerts });
      }),
    ];

    return () => unsubs.forEach((unsub) => unsub());
  }, [subscribeToEvent, queryClient]);
}
