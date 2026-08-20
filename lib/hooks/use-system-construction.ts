"use client";

import { useGameSlice } from "@/lib/store/use-game-store";
import type { SystemConstructionData } from "@/lib/types/api";

/** `SystemConstructionData` has no `unknown` visibility arm (it isn't fog-of-war gated) — its own
 *  "nothing to show" arm is `{ visibility: "hidden" }`, reused here for an absent id the same way
 *  the other per-system hooks reuse their own type's existing fallback. */
const NOT_FOUND: SystemConstructionData = { visibility: "hidden" };

/** In-flight construction for one system — read from the store's `systemConstruction` slice,
 *  tick-current by construction. An absent id renders `{ visibility: "hidden" }`. */
export function useSystemConstruction(systemId: string): SystemConstructionData {
  return useGameSlice((state) => state.slices.systemConstruction?.[systemId] ?? NOT_FOUND);
}
