"use client";

import { useSystemValueMap } from "./use-system-value-map";
import type { MigrationEntry } from "@/lib/types/game";

const pickAttraction = (e: MigrationEntry) => e.attraction;

/**
 * All-systems migration attractiveness (the pull score), keyed by systemId — developed systems only,
 * the store's `migration` slice (built from `getMigrationBySystem`) gates the rest out. The ramp
 * colours relative to the scope max (see ValueChoroplethLayer), so this carries the raw values. See
 * `useSystemValueMap` for the reduction/gating contract.
 */
export function useMigration(active: boolean = true): Map<string, number> {
  return useSystemValueMap((state) => state.slices.migration, pickAttraction, active);
}
