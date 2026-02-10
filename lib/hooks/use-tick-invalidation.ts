"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTickContext } from "./use-tick-context";
import { queryKeys } from "@/lib/query/keys";

/**
 * Subscribes to SSE ship arrivals and invalidates fleet + market queries.
 * Mount once in GameShellInner — replaces per-page arrival useEffects.
 */
export function useTickInvalidation() {
  const { subscribeToArrivals } = useTickContext();
  const queryClient = useQueryClient();

  useEffect(() => {
    return subscribeToArrivals(() => {
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet });
      queryClient.invalidateQueries({ queryKey: ["market"] });
    });
  }, [subscribeToArrivals, queryClient]);
}
