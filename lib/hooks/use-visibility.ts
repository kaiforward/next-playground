"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";

/**
 * Fetches the player's visibility set — which system IDs are within sensor
 * range of their ships. This is tick-scoped (only changes when ships move)
 * and decoupled from viewport, so fog-of-war rendering is always stable
 * regardless of pan/zoom.
 *
 * Invalidated on `shipArrived` only (not every tick).
 */
export function useVisibility(): { visibleSystemIds: Set<string> } {
  const { data } = useQuery({
    queryKey: queryKeys.visibility,
    queryFn: () =>
      apiFetch<{ systemIds: string[] }>("/api/game/systems/visibility"),
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const visibleSystemIds = useMemo(
    () => new Set(data?.systemIds ?? []),
    [data],
  );

  return { visibleSystemIds };
}
