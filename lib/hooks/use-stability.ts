"use client";

import { queryKeys } from "@/lib/query/keys";
import { useSystemValueMap } from "./use-system-value-map";
import type { StabilityEntry } from "@/lib/types/game";

const pickUnrest = (e: StabilityEntry) => e.unrest;

/**
 * All-systems unrest (0…1), keyed by systemId. The badge calls it always-on while the map mode gates
 * it; the shared `["stability"]` key means the two reuse one fetch. See `useSystemValueMap` for the
 * fetch/gating contract.
 */
export function useStability(active: boolean = true): Map<string, number> {
  return useSystemValueMap(
    queryKeys.stability,
    "/api/game/systems/stability",
    pickUnrest,
    active,
  );
}
