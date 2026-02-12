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
      // Ship arrivals → refresh fleet and market data
      subscribeToEvent("shipArrived", () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.fleet });
        queryClient.invalidateQueries({ queryKey: queryKeys.marketAll });
      }),
      // Economy ticks → refresh market data
      subscribeToEvent("economyTick", () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.marketAll });
      }),
      // Event notifications → refresh events cache
      subscribeToEvent("eventNotifications", () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.events });
      }),
      // Cargo lost → refresh fleet (cargo quantities changed)
      subscribeToEvent("cargoLost", () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.fleet });
      }),
    ];

    return () => unsubs.forEach((unsub) => unsub());
  }, [subscribeToEvent, queryClient]);
}
