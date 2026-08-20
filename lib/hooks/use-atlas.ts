"use client";

import { useGameSlice } from "@/lib/store/use-game-store";
import { EMPTY_ATLAS } from "./empty-slices";

/** The lightweight map atlas — read from the store's `atlas` slice, falling back to an empty
 *  player-less atlas before the first frame lands. */
export function useAtlas() {
  const atlas = useGameSlice((state) => state.slices.atlas ?? EMPTY_ATLAS);
  return { atlas };
}
