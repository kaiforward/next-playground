"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { PopulationEntry } from "@/lib/types/game";

/**
 * All-systems population, keyed by systemId. Tick-scoped (no viewport dep),
 * mirrors `useStability`. Gated by `active` so the map only pays the request
 * when the population mode is selected. The colour ramp is normalised per
 * render against the visible max (see ValueChoroplethLayer), so this hook
 * just carries the raw counts.
 */
export function usePopulation(active: boolean = true): Map<string, number> {
  const { data } = useQuery({
    queryKey: queryKeys.populationMap,
    queryFn: () =>
      apiFetch<{ systems: PopulationEntry[] }>("/api/game/systems/population"),
    staleTime: 10_000,
    gcTime: 30_000,
    enabled: active,
  });

  return useMemo(() => {
    const m = new Map<string, number>();
    if (active && data) {
      for (const s of data.systems) m.set(s.systemId, s.population);
    }
    return m;
  }, [active, data]);
}
