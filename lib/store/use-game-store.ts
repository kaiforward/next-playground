"use client";

/**
 * The app's one snapshot-store instance and the selector hook every component reads it through.
 * A single module-level store (rather than one created per component tree) is what makes "every
 * component reads the same store instance" hold (spec §2 "Shared reads") — sibling surfaces that
 * must agree, agree by construction because there is exactly one store to read from.
 *
 * `useGameSlice` re-renders only when the selected value's identity changes — Zustand's default
 * selector-equality behaviour (`Object.is`) over `useStore`. That is only correct because the
 * store itself does the structural-sharing merge (`game-store.ts` via `replaceEqualDeep`): an
 * unchanged slice keeps its reference across applied frames, so `Object.is` on the selected value
 * correctly reports "unchanged" instead of every apply looking like a change.
 */
import { useStore } from "zustand/react";
import { createGameStore, type StoreState } from "./game-store";

export const gameStore = createGameStore();

export function useGameSlice<T>(select: (state: StoreState) => T): T {
  return useStore(gameStore.readonlyApi, select);
}
