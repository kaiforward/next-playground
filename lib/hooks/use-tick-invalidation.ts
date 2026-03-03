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
      // Ship arrivals → refresh fleet, convoys, market, and dynamic tiles (visibility changed)
      subscribeToEvent("shipArrived", () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.fleet });
        queryClient.invalidateQueries({ queryKey: queryKeys.convoys });
        queryClient.invalidateQueries({ queryKey: queryKeys.marketAll });
        queryClient.invalidateQueries({ queryKey: queryKeys.dynamicTileAll });
      }),
      // Economy ticks → refresh market data
      subscribeToEvent("economyTick", () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.marketAll });
      }),
      // Event notifications → refresh events cache and dynamic tiles (event state changed)
      subscribeToEvent("eventNotifications", () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.events });
        queryClient.invalidateQueries({ queryKey: queryKeys.dynamicTileAll });
      }),
      // Cargo lost → refresh fleet and convoys (cargo quantities changed)
      subscribeToEvent("cargoLost", () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.fleet });
        queryClient.invalidateQueries({ queryKey: queryKeys.convoys });
      }),
      // Price snapshots → refresh price history
      subscribeToEvent("priceSnapshot", () => {
        queryClient.invalidateQueries({ queryKey: ["priceHistory"] });
      }),
      // Mission updates → refresh mission queries
      subscribeToEvent("missionsUpdated", () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.missionsAll });
      }),
      // Operational mission updates → refresh op-mission queries
      subscribeToEvent("opMissionsUpdated", () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.opMissionsAll });
      }),
      // Battle updates → refresh battle queries and fleet (ship damage)
      subscribeToEvent("battlesUpdated", () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.battles });
        queryClient.invalidateQueries({ queryKey: queryKeys.fleet });
        queryClient.invalidateQueries({ queryKey: queryKeys.opMissionsAll });
      }),
      // Game notifications → refresh notification feed and unread count
      subscribeToEvent("gameNotifications", () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
        queryClient.invalidateQueries({ queryKey: queryKeys.unreadCount });
      }),
    ];

    return () => unsubs.forEach((unsub) => unsub());
  }, [subscribeToEvent, queryClient]);
}
