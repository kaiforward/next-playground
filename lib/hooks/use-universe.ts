"use client";

import { useGameSlice } from "@/lib/store/use-game-store";
import { EMPTY_UNIVERSE } from "./empty-slices";

/** Static universe data (regions/systems/connections/factions) — read from the store's `universe`
 *  slice, falling back to an empty universe before the first frame lands. */
export function useUniverse() {
  const data = useGameSlice((state) => state.slices.universe ?? EMPTY_UNIVERSE);
  return { data };
}
