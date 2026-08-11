"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { ProvisionEntry } from "@/lib/types/game";

/**
 * All-systems Provisioned (0…1 fraction), keyed by systemId — assessed systems only (an unassessed
 * system carries no entry; the service gates it out, mirroring `useMigration`'s developed-only
 * gate). Tick-scoped (no viewport dep), mirrors `useStability`/`useMigration`. Gated by `active` so
 * the map only pays the request when the provision mode is selected.
 *
 * Unlike the other value-mode hooks, this raw fraction is never scoped to a faction max on the way
 * to the ramp — provision's band edges are absolute percentages (see `value-ramp.ts`), so the ramp
 * ignores `referenceMax` entirely and this hook carries the plain reading.
 */
export function useProvision(active: boolean = true): Map<string, number> {
  const { data } = useQuery({
    queryKey: queryKeys.provisionMap,
    queryFn: () =>
      apiFetch<{ systems: ProvisionEntry[] }>("/api/game/systems/provision"),
    staleTime: 10_000,
    gcTime: 30_000,
    enabled: active,
  });

  return useMemo(() => {
    const m = new Map<string, number>();
    if (active && data) {
      for (const s of data.systems) m.set(s.systemId, s.provision);
    }
    return m;
  }, [active, data]);
}
