"use client";

import { useGameSlice } from "@/lib/store/use-game-store";
import type { SystemIndustryData } from "@/lib/types/api";

/** See `use-system-substrate.ts`'s NOT_FOUND docstring — same reasoning, this type's own arm. */
const NOT_FOUND: SystemIndustryData = { visibility: "unknown" };

/**
 * Industrial base and supply-chain state for one system — read from the store's `systemIndustry`
 * slice, tick-current by construction. Visibility-gated in the slice itself; an absent id renders
 * the same `visibility: "unknown"` state.
 */
export function useSystemIndustry(systemId: string): SystemIndustryData {
  return useGameSlice((state) => state.slices.systemIndustry?.[systemId] ?? NOT_FOUND);
}
