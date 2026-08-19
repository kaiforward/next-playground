"use client";

import { useGameSlice } from "@/lib/store/use-game-store";
import { EMPTY_RELATIONS } from "./empty-slices";

/** The galaxy-wide pair-score relations matrix — read from the store's `relations` slice. */
export function useRelations() {
  const relations = useGameSlice((state) => state.slices.relations ?? EMPTY_RELATIONS);
  return { relations };
}
