"use client";

import { useSystemValueMap } from "./use-system-value-map";
import type { DevelopmentEntry } from "@/lib/types/game";

const pickDevelopment = (e: DevelopmentEntry) => e.development;

/**
 * All-systems development (raw tier-weighted development points), keyed by systemId. Read from the
 * store's `development` slice. The ramp colours relative to the scope max (see
 * ValueChoroplethLayer), so this carries the raw values. See `useSystemValueMap` for the
 * reduction/gating contract.
 */
export function useDevelopment(active: boolean = true): Map<string, number> {
  return useSystemValueMap((state) => state.slices.development, pickDevelopment, active);
}
