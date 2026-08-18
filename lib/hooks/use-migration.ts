"use client";

import { queryKeys } from "@/lib/query/keys";
import { useSystemValueMap } from "./use-system-value-map";
import type { MigrationEntry } from "@/lib/types/game";

const pickAttraction = (e: MigrationEntry) => e.attraction;

/**
 * All-systems migration attractiveness (the pull score), keyed by systemId — developed systems only,
 * the service gates the rest out. The ramp colours relative to the scope max (see
 * ValueChoroplethLayer), so this carries the raw values. See `useSystemValueMap` for the fetch/gating
 * contract.
 */
export function useMigration(active: boolean = true): Map<string, number> {
  return useSystemValueMap(
    queryKeys.migrationMap,
    "/api/game/systems/migration",
    pickAttraction,
    active,
  );
}
