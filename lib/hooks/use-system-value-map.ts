"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/query/fetcher";

/**
 * The shared body of the value-mode choropleth hooks: one tick-scoped all-systems fetch reduced to a
 * `systemId → number` Map for the map layer. Tick-scoped means no viewport dependency — the route
 * answers for every system and the cache stales on its own.
 *
 * `active` gates two things. It gates the request, so a mode that isn't selected pays nothing; and it
 * gates the reduction, so an inactive caller gets an empty Map *even when the query still holds cached
 * data* and the Pixi layer tears its geometry down immediately instead of drawing a mode nobody
 * selected. Reading `data` unconditionally would resurrect the last mode's fill on every remount.
 *
 * `pick` is an explicit accessor, not a field name: the entry shapes name their value differently
 * (`unrest`, `population`, `attraction`, …) and nothing here indexes a row by string key. Pass a
 * module-scope function — an inline arrow is a fresh identity each render and rebuilds the Map.
 *
 * `useOwnership` and `useTradeFlow` are deliberately not members of this family: ownership carries a
 * record per system rather than a number and is always enabled, and trade flow returns an edge list.
 */
export function useSystemValueMap<T extends { systemId: string }>(
  queryKey: readonly string[],
  url: string,
  pick: (entry: T) => number,
  active: boolean,
): Map<string, number> {
  const { data } = useQuery({
    queryKey,
    queryFn: () => apiFetch<{ systems: T[] }>(url),
    staleTime: 10_000,
    gcTime: 30_000,
    enabled: active,
  });

  return useMemo(() => {
    const m = new Map<string, number>();
    if (active && data) {
      for (const s of data.systems) m.set(s.systemId, pick(s));
    }
    return m;
  }, [active, data, pick]);
}
