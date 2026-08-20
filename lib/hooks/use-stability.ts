"use client";

import { useSystemValueMap } from "./use-system-value-map";
import type { StabilityEntry } from "@/lib/types/game";

const pickUnrest = (e: StabilityEntry) => e.unrest;

/**
 * All-systems unrest (0…1), keyed by systemId. Read from the store's `stability` slice. See
 * `useSystemValueMap` for the reduction/gating contract.
 */
export function useStability(active: boolean = true): Map<string, number> {
  return useSystemValueMap((state) => state.slices.stability, pickUnrest, active);
}
