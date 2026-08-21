"use client";

import { useDetailEntry } from "@/lib/hooks/detail-read";
import type { SystemPopulationData } from "@/lib/types/api";

/** See `use-system-substrate.ts`'s NOT_FOUND docstring — same reasoning, this type's own arm. */
const NOT_FOUND: SystemPopulationData = { visibility: "unknown" };

/**
 * Dynamic population & social state (population, popCap, unrest, needs ledger, the
 * Provisioned/band/memory read, and the unrest contributor breakdown/trend) for one system — read
 * from the store's `systemPopulation` slice, tick-current by construction (no invalidation to
 * wire). Visibility-gated in the slice itself; an absent id renders the same `visibility:
 * "unknown"` state — for either of two reasons: the id doesn't exist, or it exists but isn't in
 * the current interest set yet (see `lib/hooks/detail-read.ts`). Telling those apart is the panel
 * root's job (`system-panel.tsx`'s presence gate), not this hook's.
 */
export function useSystemPopulation(systemId: string): SystemPopulationData {
  return useDetailEntry("systemPopulation", systemId, "system") ?? NOT_FOUND;
}
