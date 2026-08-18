"use client";

import { queryKeys } from "@/lib/query/keys";
import { useSystemValueMap } from "./use-system-value-map";
import type { DevelopmentEntry } from "@/lib/types/game";

const pickDevelopment = (e: DevelopmentEntry) => e.development;

/**
 * All-systems development (raw tier-weighted development points), keyed by systemId. The ramp colours
 * relative to the scope max (see ValueChoroplethLayer), so this carries the raw values. See
 * `useSystemValueMap` for the fetch/gating contract.
 */
export function useDevelopment(active: boolean = true): Map<string, number> {
  return useSystemValueMap(
    queryKeys.developmentMap,
    "/api/game/systems/development",
    pickDevelopment,
    active,
  );
}
