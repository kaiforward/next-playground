"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { SystemLogisticsData } from "@/lib/types/api";

/**
 * Per-system logistics (prod/con + imports/exports) for the Logistics tab.
 * Tick-scoped — invalidated by useTickInvalidation on shipArrived/economyTick.
 * Visibility-gated server-side; unsurveyed systems return `visibility: "unknown"`.
 */
export function useSystemLogistics(systemId: string): SystemLogisticsData {
  const { data } = useSuspenseQuery({
    queryKey: queryKeys.systemLogistics(systemId),
    queryFn: () =>
      apiFetch<SystemLogisticsData>(`/api/game/systems/${systemId}/logistics`),
  });
  return data;
}
