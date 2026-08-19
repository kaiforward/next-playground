"use client";

import { useGameSlice } from "@/lib/store/use-game-store";
import type { SystemLogisticsData } from "@/lib/types/api";

/** See `use-system-substrate.ts`'s NOT_FOUND docstring — same reasoning, this type's own arm. */
const NOT_FOUND: SystemLogisticsData = { visibility: "unknown" };

/**
 * Per-system logistics (prod/con + imports/exports) for the Logistics tab — read from the store's
 * `systemLogistics` slice, tick-current by construction. Visibility-gated in the slice itself; an
 * absent id renders the same `visibility: "unknown"` state.
 */
export function useSystemLogistics(systemId: string): SystemLogisticsData {
  return useGameSlice((state) => state.slices.systemLogistics?.[systemId] ?? NOT_FOUND);
}
