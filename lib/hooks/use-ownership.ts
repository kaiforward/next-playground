"use client";

import { useMemo } from "react";
import { useGameSlice } from "@/lib/store/use-game-store";
import type { OwnershipEntry } from "@/lib/types/game";

export interface SystemOwnership {
  factionId: string | null;
  developed: boolean;
  /** An open colony-establish project at this (controlled) system — the pulsing map mark. */
  forming: boolean;
}

const EMPTY_OWNERSHIP: OwnershipEntry[] = [];

/**
 * All-systems ownership (faction + developed tier + forming colony), keyed by systemId. Always
 * enabled — the political territory layer and the settlement marks both read ownership regardless
 * of the selected map mode.
 *
 * The store's `replaceEqualDeep` merge (`lib/store/game-store.ts`) keeps the `ownership` slice's
 * array reference stable across an applied frame that carries no ownership change; the `useMemo`
 * below is keyed on that same reference, so the derived Map only rebuilds when ownership actually
 * changed — the client-runtime census's C3 identity guarantee, carried at hook level (Proves 1).
 */
export function useOwnership(): Map<string, SystemOwnership> {
  const entries = useGameSlice((state) => state.slices.ownership ?? EMPTY_OWNERSHIP);

  return useMemo(() => {
    const m = new Map<string, SystemOwnership>();
    for (const s of entries) {
      m.set(s.systemId, { factionId: s.factionId, developed: s.developed, forming: s.forming });
    }
    return m;
  }, [entries]);
}
