"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { DynamicTileSystem } from "@/lib/types/game";

/**
 * Fetches dynamic data (events, danger, ship presence) for ALL visible systems.
 * No viewport dependency — data is cached per tick and viewport culling happens
 * client-side. This eliminates flicker and redundant API calls on pan/zoom.
 *
 * Invalidated on `shipArrived` and `eventNotifications`.
 */
export function useDynamicData(
  active: boolean,
): { dynamicSystems: DynamicTileSystem[] } {
  // useQuery (not useSuspenseQuery) because `enabled` gates fetching until
  // the camera is zoomed in — useSuspenseQuery doesn't support `enabled`.
  const { data } = useQuery({
    queryKey: queryKeys.dynamicVisible,
    queryFn: () =>
      apiFetch<{ systems: DynamicTileSystem[] }>(
        "/api/game/systems/dynamic",
      ),
    staleTime: 10_000,
    gcTime: 30_000,
    enabled: active,
  });

  return { dynamicSystems: data?.systems ?? [] };
}
