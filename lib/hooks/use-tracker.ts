"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { TrackerData } from "@/lib/types/api";

/**
 * The Tracker panel roll-up (pinned systems, funded construction front, forming colonies). Changes
 * every economy tick — tick-invalidated alongside `factionConstructionAll` (useTickInvalidation) —
 * and is also dirtied directly by pin writes (useSetSystemPin).
 */
export function useTracker(): TrackerData {
  const { data } = useSuspenseQuery({
    queryKey: queryKeys.tracker,
    queryFn: () => apiFetch<TrackerData>("/api/game/player/tracker"),
  });
  return data;
}
