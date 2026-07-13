"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { DevelopmentEntry } from "@/lib/types/game";

/**
 * All-systems development (0..1), keyed by systemId. Tick-scoped (no viewport
 * dep), mirrors `usePopulation`/`useStability`. Gated by `active` so the map
 * only pays the request when the development mode is selected. The ramp is
 * ABSOLUTE (see ValueChoroplethLayer), so this hook carries the raw values.
 */
export function useDevelopment(active: boolean = true): Map<string, number> {
  const { data } = useQuery({
    queryKey: queryKeys.developmentMap,
    queryFn: () =>
      apiFetch<{ systems: DevelopmentEntry[] }>("/api/game/systems/development"),
    staleTime: 10_000,
    gcTime: 30_000,
    enabled: active,
  });

  return useMemo(() => {
    const m = new Map<string, number>();
    if (active && data) {
      for (const s of data.systems) m.set(s.systemId, s.development);
    }
    return m;
  }, [active, data]);
}
