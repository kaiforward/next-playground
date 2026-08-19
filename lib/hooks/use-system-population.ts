"use client";

import { useGameSlice } from "@/lib/store/use-game-store";
import type { SystemPopulationData } from "@/lib/types/api";

/** See `use-system-substrate.ts`'s NOT_FOUND docstring — same reasoning, this type's own arm. */
const NOT_FOUND: SystemPopulationData = { visibility: "unknown" };

/**
 * Dynamic population & social state (population, popCap, unrest, needs ledger, the
 * Provisioned/band/memory read, and the unrest contributor breakdown/trend) for one system — read
 * from the store's `systemPopulation` slice, tick-current by construction (no invalidation to
 * wire). Visibility-gated in the slice itself; an absent id renders the same `visibility:
 * "unknown"` state.
 */
export function useSystemPopulation(systemId: string): SystemPopulationData {
  return useGameSlice((state) => state.slices.systemPopulation?.[systemId] ?? NOT_FOUND);
}
