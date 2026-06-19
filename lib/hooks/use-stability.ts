"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { StabilityEntry } from "@/lib/types/game";

/**
 * All-systems unrest (0…1), keyed by systemId. Tick-scoped (no viewport dep),
 * mirrors `useTradeFlow`. Gated by `active` so callers that don't need it
 * (map mode off) don't pay the request; the badge calls it always-on. The
 * shared `["stability"]` key means the map and the panel reuse one fetch.
 */
export function useStability(active: boolean = true): Map<string, number> {
  const { data } = useQuery({
    queryKey: queryKeys.stability,
    queryFn: () =>
      apiFetch<{ systems: StabilityEntry[] }>("/api/game/systems/stability"),
    staleTime: 10_000,
    gcTime: 30_000,
    enabled: active,
  });

  return useMemo(() => {
    const m = new Map<string, number>();
    if (active && data) {
      for (const s of data.systems) m.set(s.systemId, s.unrest);
    }
    return m;
  }, [active, data]);
}
