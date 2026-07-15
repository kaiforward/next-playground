"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { MigrationEntry } from "@/lib/types/game";

/**
 * All-systems migration attractiveness (the pull score), keyed by systemId — developed systems only.
 * Tick-scoped (no viewport dep), mirrors `useDevelopment`/`useStability`. Gated by `active` so the map
 * only pays the request when the migration mode is selected. The ramp colours relative to the scope
 * max (see ValueChoroplethLayer), so this hook carries the raw values.
 */
export function useMigration(active: boolean = true): Map<string, number> {
  const { data } = useQuery({
    queryKey: queryKeys.migrationMap,
    queryFn: () =>
      apiFetch<{ systems: MigrationEntry[] }>("/api/game/systems/migration"),
    staleTime: 10_000,
    gcTime: 30_000,
    enabled: active,
  });

  return useMemo(() => {
    const m = new Map<string, number>();
    if (active && data) {
      for (const s of data.systems) m.set(s.systemId, s.attraction);
    }
    return m;
  }, [active, data]);
}
