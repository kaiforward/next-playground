"use client";

import { useSystemValueMap } from "./use-system-value-map";
import type { PopulationEntry } from "@/lib/types/game";

const pickPopulation = (e: PopulationEntry) => e.population;

/**
 * All-systems population, keyed by systemId. Read from the store's `population` slice. The colour
 * ramp is normalised per render against the visible max (see ValueChoroplethLayer), so this carries
 * the raw counts. See `useSystemValueMap` for the reduction/gating contract.
 */
export function usePopulation(active: boolean = true): Map<string, number> {
  return useSystemValueMap((state) => state.slices.population, pickPopulation, active);
}
