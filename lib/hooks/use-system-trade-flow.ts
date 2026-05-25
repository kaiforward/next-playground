"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { SystemTradeFlowData } from "@/lib/types/api";

/**
 * Per-system trade flow detail for the system overview panel.
 * Tick-scoped — invalidated by `useTickInvalidation` on shipArrived /
 * economyTick. Visibility-gated server-side; invisible systems return
 * empty arrays so the panel can render `<EmptyState>` cleanly.
 */
export function useSystemTradeFlow(systemId: string): SystemTradeFlowData {
  const { data } = useSuspenseQuery({
    queryKey: queryKeys.systemTradeFlow(systemId),
    queryFn: () =>
      apiFetch<SystemTradeFlowData>(
        `/api/game/systems/${systemId}/trade-flow`,
      ),
  });
  return data;
}
