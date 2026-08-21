"use client";

import { useGameSlice } from "@/lib/store/use-game-store";
import { EMPTY_FACTIONS } from "./empty-slices";

/** The galaxy-wide faction list — read from the store's `factions` slice. */
export function useFactions() {
  const factions = useGameSlice((state) => state.slices.factions ?? EMPTY_FACTIONS);
  return { factions };
}
