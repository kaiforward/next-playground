"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { ProsperityEntry } from "@/lib/types/game";

/**
 * All-systems prosperity, keyed by systemId. Tick-scoped (no viewport dep),
 * mirrors `useTradeFlow`. Gated by `active` so callers that don't need it
 * (map mode off) don't pay the request; the badge calls it always-on. The
 * shared `["prosperity"]` key means the map and the panel reuse one fetch.
 */
export function useProsperity(active: boolean = true): Map<string, number> {
  const { data } = useQuery({
    queryKey: queryKeys.prosperity,
    queryFn: () =>
      apiFetch<{ systems: ProsperityEntry[] }>("/api/game/systems/prosperity"),
    staleTime: 10_000,
    gcTime: 30_000,
    enabled: active,
  });

  return useMemo(() => {
    const m = new Map<string, number>();
    if (active && data) {
      for (const s of data.systems) m.set(s.systemId, s.prosperity);
    }
    return m;
  }, [active, data]);
}
