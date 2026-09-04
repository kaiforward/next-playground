"use client";

import { useGameSlice } from "@/lib/store/use-game-store";
import { EMPTY_LANES } from "./empty-slices";
import type { LaneStateRow } from "@/lib/types/api";

/**
 * Every lane's live state, read from the store's coarse `lanes` slice (`use-trade-flow.ts`'s
 * convention) — always the whole galaxy's lanes, no interest gating (the map layer needs every lane
 * on screen, not just the ones a panel opened for). A frame that carries no `lanes` slice at all
 * (pre-boot, or a world generated before lanes existed) reads the same empty array a real
 * lane-less world's `getLaneStates()` would.
 */
export function useLanes(): LaneStateRow[] {
  return useGameSlice((state) => state.slices.lanes ?? EMPTY_LANES);
}
