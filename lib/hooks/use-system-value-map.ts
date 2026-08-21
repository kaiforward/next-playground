"use client";

import { useMemo } from "react";
import { useGameSlice } from "@/lib/store/use-game-store";
import type { StoreState } from "@/lib/store/game-store";

/**
 * The shared body of the value-mode choropleth hooks: reads one all-systems slice from the store and
 * reduces it to a `systemId → number` Map for the map layer.
 *
 * `active` gates the reduction, not a fetch (there is no fetch — the slice already rides every state
 * frame regardless of which map mode is selected): an inactive caller reads an empty Map even though
 * the slice itself still holds the last data, so the Pixi layer tears its geometry down immediately
 * instead of drawing a mode nobody selected. Reading the slice unconditionally would resurrect the
 * last mode's fill on every remount.
 *
 * `select` and `pick` are explicit accessors, not field names: the entry shapes name their value
 * differently (`unrest`, `population`, `attraction`, …) and nothing here indexes a row by string key.
 * Pass module-scope functions — an inline arrow is a fresh identity each render and defeats the
 * store's own identity guarantee on top of rebuilding the Map unnecessarily.
 *
 * `useOwnership` and `useTradeFlow` are deliberately not members of this family: ownership carries a
 * record per system rather than a number and is always enabled, and trade flow returns an edge list.
 */
export function useSystemValueMap<T extends { systemId: string }>(
  select: (state: StoreState) => T[] | undefined,
  pick: (entry: T) => number,
  active: boolean,
): Map<string, number> {
  const entries = useGameSlice(select);

  return useMemo(() => {
    const m = new Map<string, number>();
    if (active && entries) {
      for (const s of entries) m.set(s.systemId, pick(s));
    }
    return m;
  }, [active, entries, pick]);
}
