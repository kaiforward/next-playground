"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { OwnershipEntry } from "@/lib/types/game";

export interface SystemOwnership {
  factionId: string | null;
  developed: boolean;
}

/**
 * All-systems ownership (faction + developed tier), keyed by systemId. Tick-scoped: claims and
 * developments move ownership on the monthly pulse, so this rides a tick-invalidated path (see
 * useTickInvalidation) rather than the static atlas. Always enabled — the political territory layer
 * and the filled/hollow system markers both read ownership regardless of the selected map mode.
 *
 * TanStack's structural sharing keeps `data` referentially stable across refetches that return the
 * same ownership, so the derived Map (and the map's re-sync) only churns when ownership actually changes.
 */
export function useOwnership(): Map<string, SystemOwnership> {
  const { data } = useQuery({
    queryKey: queryKeys.ownership,
    queryFn: () =>
      apiFetch<{ systems: OwnershipEntry[] }>("/api/game/systems/ownership"),
    staleTime: 10_000,
    gcTime: 30_000,
  });

  return useMemo(() => {
    const m = new Map<string, SystemOwnership>();
    if (data) {
      for (const s of data.systems) m.set(s.systemId, { factionId: s.factionId, developed: s.developed });
    }
    return m;
  }, [data]);
}
