"use client";

import { queryKeys } from "@/lib/query/keys";
import { useSystemValueMap } from "./use-system-value-map";
import type { PopulationEntry } from "@/lib/types/game";

const pickPopulation = (e: PopulationEntry) => e.population;

/**
 * All-systems population, keyed by systemId. The colour ramp is normalised per render against the
 * visible max (see ValueChoroplethLayer), so this carries the raw counts. See `useSystemValueMap` for
 * the fetch/gating contract.
 */
export function usePopulation(active: boolean = true): Map<string, number> {
  return useSystemValueMap(
    queryKeys.populationMap,
    "/api/game/systems/population",
    pickPopulation,
    active,
  );
}
