"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { AlertData } from "@/lib/types/api";

/**
 * The alert bar's whole read — all sixteen categories. Invalidated on BOTH SSE channels
 * (useTickInvalidation): `economyTick` for every state-derived and signal-derived category, and
 * `eventNotifications` for the three event-banded categories (Crisis / Disruption / Windfall), which
 * move on their own cadence, not the economy cycle.
 */
export function useAlerts(): AlertData {
  const { data } = useSuspenseQuery({
    queryKey: queryKeys.alerts,
    queryFn: () => apiFetch<AlertData>("/api/game/player/alerts"),
  });
  return data;
}
