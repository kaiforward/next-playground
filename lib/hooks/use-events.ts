"use client";

import { useGameSlice } from "@/lib/store/use-game-store";
import { EMPTY_EVENTS } from "./empty-slices";

/** The tick's active events — read from the store's `events` slice, falling back to an empty list
 *  before the first frame lands (see `empty-slices.ts`'s judgment-call docstring). */
export function useEvents() {
  const events = useGameSlice((state) => state.slices.events ?? EMPTY_EVENTS);
  return { events };
}
