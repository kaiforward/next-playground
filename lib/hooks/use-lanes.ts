"use client";

import { useGameSlice } from "@/lib/store/use-game-store";
import { EMPTY_LANES } from "./empty-slices";
import type { LaneStateRow } from "@/lib/types/api";

/**
 * Every lane's live state, read from the store's coarse `lanes` slice (`use-trade-flow.ts`'s
 * convention) — always the whole galaxy's lanes, no interest gating (the map layer needs every lane
 * on screen, not just the ones a panel opened for). The one frame that carries no `lanes` slice is
 * a PRE-BOOT one (no state frame has landed yet); it reads the same empty array a freshly-generated
 * world's `getLaneStates()` would. A live world always has one lane row per connection — generation
 * mints them, and the save version refuses anything older — so "the world has connections but no
 * lanes" is not a state this hook covers.
 */
export function useLanes(): LaneStateRow[] {
  return useGameSlice((state) => state.slices.lanes ?? EMPTY_LANES);
}
