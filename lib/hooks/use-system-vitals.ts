"use client";

import { useGameSlice } from "@/lib/store/use-game-store";
import type { SystemVitalsData } from "@/lib/types/api";

/** See `use-system-substrate.ts`'s NOT_FOUND docstring — same reasoning, this type's own arm. */
const NOT_FOUND: SystemVitalsData = { visibility: "unknown" };

/**
 * Dynamic vitals snapshot (stability, development-vs-own-potential, population composition, the
 * Provisioned/band/memory read) for one system's overview vital tiles — read from the store's
 * `systemVitals` slice, which updates every economy tick (the store's structural-sharing merge
 * keeps this hook's result referentially stable when a tick leaves it unchanged). Visibility-gated
 * in the slice itself; an absent id renders the same `visibility: "unknown"` state.
 */
export function useSystemVitals(systemId: string): SystemVitalsData {
  return useGameSlice((state) => state.slices.systemVitals?.[systemId] ?? NOT_FOUND);
}
